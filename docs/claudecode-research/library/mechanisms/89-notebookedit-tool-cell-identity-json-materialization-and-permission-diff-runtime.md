# NotebookEditTool / Cell Identity / JSON Materialization / Permission Diff Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：FileWriteTool / Full Replacement / Create-Overwrite / Diff Runtime`](./88-filewrite-tool-full-replacement-create-overwrite-and-diff-runtime.md) | [`下一站：Notebook Read / ToolResult Blocks / Large Output Guard / Cell ID Runtime`](./90-notebook-read-toolresult-blocks-large-output-guard-and-cell-id-runtime.md)

本文把 `NotebookEditTool` 从旧的“文件编辑总述”里单独抽出来，专门讲 `.ipynb` 这一条结构化写入主链。相邻卷册已经覆盖了：

- [`03`](./03-file-editing-and-shell-execution.md)：文件编辑与 shell 的总述级机制
- [`87`](./87-fileedit-tool-staleness-quote-normalization-and-atomic-write-runtime.md)：文本文件的原位替换
- [`88`](./88-filewrite-tool-full-replacement-create-overwrite-and-diff-runtime.md)：整文件 replacement 写入

而这篇只讲 `NotebookEditTool` 自己的实现级运行时：

- `.ipynb` 专属输入 contract
- `cell_id` / `cell-N` 双寻址
- replace / insert / delete 三态编辑
- JSON parse / mutate / stringify 的 notebook materialization
- notebook 专用 permission diff 与 rejected surface

## 1. `NotebookEditTool` 的定位不是“改 JSON 文件”，而是“改 notebook cell 语义”

源码镜像：[`../../sources/claude-code/src/tools/NotebookEditTool/NotebookEditTool.ts`](../../sources/claude-code/src/tools/NotebookEditTool/NotebookEditTool.ts), [`../../sources/claude-code/src/tools/NotebookEditTool/prompt.ts`](../../sources/claude-code/src/tools/NotebookEditTool/prompt.ts)

它的输入核心不是文本 patch，而是：

- `notebook_path`
- `cell_id`
- `new_source`
- `cell_type`
- `edit_mode`

这说明系统并不把 notebook 当成普通 JSON 文本去改，而是把它当成：

- 带 cell identity 的结构化文档

所以这里真正被保护的不是“某几行 JSON”，而是：

- 哪个 cell 被改
- 是替换、插入还是删除
- 改完之后 notebook 还能不能保持语义正确

## 2. 工具 prompt 和真实 schema 之间有一个值得单独记住的边界：运行时已经完全转向 `cell_id`

源码镜像：[`../../sources/claude-code/src/tools/NotebookEditTool/prompt.ts`](../../sources/claude-code/src/tools/NotebookEditTool/NotebookEditTool.ts), [`../../sources/claude-code/src/utils/notebook.ts`](../../sources/claude-code/src/utils/notebook.ts)

`prompt.ts` 里仍然在说：

- `cell_number is 0-indexed`

但真实 schema 已经是：

- `cell_id`

运行时为了兼容旧编号心智，专门保留了一条 fallback：

- `parseCellId('cell-7') -> 7`

也就是说，当前实现的真实 contract 是：

- 优先用 notebook 里的真实 `cell.id`
- 兼容 `cell-N` 这种由读取层生成的 synthetic id

这条边界很重要，因为它解释了 Claude Code 为什么能同时支持：

- 原生 notebook cell id
- 以及 FileRead/ReadNotebook 暴露出来的稳定序号式寻址

## 3. `NotebookEdit` 是写操作家族里唯一明确把 `.ipynb` 变成独立工具的成员

源码镜像：[`../../sources/claude-code/src/tools/FileEditTool/FileEditTool.ts`](../../sources/claude-code/src/tools/NotebookEditTool/constants.ts)

在现有写入家族里，边界是明确切开的：

- `FileEditTool` 遇到 `.ipynb` -> 直接拒绝并要求改用 `NotebookEditTool`
- `FileWriteTool` 可以覆盖任意文件，但没有 cell 级语义
- `NotebookEditTool` 专管 notebook cell 编辑

所以 notebook 在 Claude Code 里不是“文件类型特例”，而是正式的一类：

- structured writing host

## 4. 输入验证先保护宿主级边界：绝对路径、UNC、`.ipynb` 扩展名、合法 edit mode

源码镜像：[`../../sources/claude-code/src/tools/NotebookEditTool/NotebookEditTool.ts`](../../sources/claude-code/src/utils/permissions/filesystem.ts)

`validateInput(...)` 的前几层先做最外层闸门：

- 路径标准化到 absolute
- UNC 路径直接跳过本地文件系统操作
- `extname(fullPath) !== '.ipynb'` -> 明确拒绝
- `edit_mode` 只能是 `replace | insert | delete`
- `insert` 必须显式给 `cell_type`

也就是说，在真正看 notebook JSON 之前，系统先确认：

- 这确实是 notebook
- 这次操作是 notebook 语义允许的几种动作之一

## 5. 它和 `Edit/Write` 一样强制 read-before-write，但这里保护的是“最近读过的 notebook 视图”

源码镜像：[`../../sources/claude-code/src/tools/NotebookEditTool/NotebookEditTool.ts`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts)

`NotebookEditTool` 明确复用了同一套治理原则：

- 如果 `readFileState` 里没有这个 notebook -> 直接拒绝
- 如果 `getFileModificationTime(fullPath) > readTimestamp.timestamp` -> 直接拒绝

错误文案也和文本写工具保持一致：

- `Read it first before writing to it.`

所以 notebook 并没有因为是结构化编辑就放松安全边界。相反，它仍然要求：

- 先读到一个最近、可信的 notebook 快照

## 6. `validateInput(...)` 里的核心不是 patch 校验，而是 notebook-aware cell 定位校验

源码镜像：[`../../sources/claude-code/src/tools/NotebookEditTool/NotebookEditTool.ts`](../../sources/claude-code/src/utils/notebook.ts)

它会先：

1. 读取当前 notebook 文本
2. `safeParseJSON(content)` 成 `NotebookContent`
3. 根据 `cell_id` 找目标 cell

查找顺序是：

- 先看真实 `cell.id === cell_id`
- 找不到再试 `parseCellId(cell_id)` 这种 `cell-N` fallback

失败时会给出两种不同错误：

- `Cell with ID "..." not found in notebook.`
- `Cell with index N does not exist in notebook.`

这说明工具对 cell identity 的治理非常显式，不会在“用户说的是哪个 cell”这件事上偷偷猜测。

## 7. `cell_id` 缺省并不总是错误；只有 insert 允许无锚点，语义是“插到最前面”

源码镜像：[`../../sources/claude-code/src/tools/NotebookEditTool/NotebookEditTool.ts`](../../sources/claude-code/src/components/permissions/NotebookEditPermissionRequest/NotebookEditPermissionRequest.tsx)

`validateInput(...)` 对 `cell_id` 的规则是：

- `replace` / `delete`：必须提供
- `insert`：可以不提供

进入 `call(...)` 后，如果：

- `!cell_id`

它会把 `cellIndex = 0`

也就是：

- 无锚点 insert = 在 notebook 开头插入新 cell

这和 prompt 里“after the specified cell”那条叙述一起，构成了完整插入语义：

- 给 `cell_id` -> 插在它后面
- 不给 `cell_id` -> 插在最前面

## 8. `replace one past the end` 会被自动翻译成 `insert`

源码镜像：[`../../sources/claude-code/src/tools/NotebookEditTool/NotebookEditTool.ts`](../../sources/claude-code/src/utils/notebook.ts)

这是这把工具最有意思的一条兼容分支：

- 如果 `edit_mode === 'replace'`
- 且 `cellIndex === notebook.cells.length`

运行时会自动改成：

- `edit_mode = 'insert'`

如果这时没给 `cell_type`，还会默认补：

- `code`

也就是说，这把工具在 notebook 边界上允许一种“replace 失败但其实你是在追加” 的宽容翻译，而不是直接把请求打回去。

## 9. 真正的 notebook materialization 是 “parse JSON -> mutate notebook object -> stringify with fixed indent”

源码镜像：[`../../sources/claude-code/src/tools/NotebookEditTool/NotebookEditTool.ts`](../../sources/claude-code/src/utils/slowOperations.ts)

`call(...)` 的核心不是 text diff，而是：

1. `readFileSyncWithMetadata(fullPath)`
2. `jsonParse(content)` 得到 notebook object
3. 原地 mutate `notebook.cells`
4. `jsonStringify(notebook, null, 1)`
5. `writeTextContent(...)`

这里有两件事很关键：

- 它刻意不用 memoized `safeParseJSON`，因为后面会原地 mutate object，不能污染 cache
- `IPYNB_INDENT = 1` 是固定策略，说明 notebook 物化格式在这里被统一成一格缩进

所以 `NotebookEditTool` 的“写盘”不是 patch apply，而是一次完整的：

- semantic object rewrite

## 10. replace / insert / delete 三态的真实修改逻辑完全不同

源码镜像：[`../../sources/claude-code/src/tools/NotebookEditTool/NotebookEditTool.ts`](../../sources/claude-code/src/tools/NotebookEditTool/NotebookEditTool.ts)

三种模式分别做的是：

- `delete`
  - `notebook.cells.splice(cellIndex, 1)`
- `insert`
  - 构造新 cell
  - markdown cell 只保留 `source + metadata`
  - code cell 额外带 `execution_count: null` 和 `outputs: []`
  - 再 `splice(cellIndex, 0, new_cell)`
- `replace`
  - 直接改目标 cell 的 `source`
  - 如果目标 cell 原本是 code：
    - `execution_count = null`
    - `outputs = []`
  - 如果还传了不同 `cell_type`，则同步改 cell type

这说明 notebook edit 的核心保护对象不是文本，而是：

- cell array 拓扑
- code cell 执行态
- markdown/code 的类型切换

## 11. `nbformat >= 4.5` 时还会 materialize 新的真实 cell id

源码镜像：[`../../sources/claude-code/src/tools/NotebookEditTool/NotebookEditTool.ts`](../../sources/claude-code/src/tools/NotebookEditTool/NotebookEditTool.ts)

运行时会检查：

- `nbformat > 4`
- 或 `nbformat === 4 && nbformat_minor >= 5`

满足时：

- `insert` 会生成新的 `new_cell_id`
- 非 insert 则复用原来的 `cell_id`

也就是说，Claude Code 在 notebook 新版格式下，是主动维护真实 cell identity 的，而不是只依赖位置索引。

这也解释了为什么 `outputSchema` 里会把：

- `cell_id`

重新回传给 transcript 和上层消费方。

## 12. 它保留原文件 encoding 和 line endings，但不像 `Write` 那样重设物理格式策略

源码镜像：[`../../sources/claude-code/src/tools/NotebookEditTool/NotebookEditTool.ts`](../../sources/claude-code/src/tools/FileWriteTool/FileWriteTool.ts)

`NotebookEditTool` 的写盘用的是：

- `writeTextContent(fullPath, updatedContent, encoding, lineEndings)`

也就是说：

- 保留旧 notebook 的 encoding
- 保留旧 notebook 的 line endings

这更像 `FileEditTool`，而不是 `FileWriteTool`。原因也合理：

- notebook 是结构化 JSON 文档
- 工具已经自己决定了 JSON 缩进
- 没必要再把物理换行风格也一起强行改掉

## 13. notebook permission surface 是“cell 级 diff console”，不是普通文件 diff

源码镜像：[`../../sources/claude-code/src/components/permissions/NotebookEditPermissionRequest/NotebookEditPermissionRequest.tsx`](../../sources/claude-code/src/components/permissions/NotebookEditPermissionRequest/NotebookEditToolDiff.tsx)

这条前台链和文本写工具明显不同：

- 标题固定是 `Edit notebook`
- question 会根据 mode 变成：
  - `make this edit to`
  - `insert this cell into`
  - `delete this cell from`
- `languageName` 直接按 `markdown` / `python` 切

`NotebookEditToolDiff` 里则会：

- 先异步读取 notebook
- 找到目标 cell 的旧 source
- `replace` 才生成 structured diff
- `insert` 直接展示新 cell 内容
- `delete` 直接展示被删除的旧 cell 内容

所以这不是文件级 diff，而是：

- cell-centric operator preview

## 14. rejected / success surface 也以 cell 为主语，而不是以文件为主语

源码镜像：[`../../sources/claude-code/src/tools/NotebookEditTool/UI.tsx`](../../sources/claude-code/src/components/NotebookEditToolUseRejectedMessage.tsx)

前台消息的语法很统一：

- tool use message：`path@cell_id`
- success：`Updated cell <id>`
- rejected：`NotebookEditToolUseRejectedMessage`
- error：`Error editing notebook`

这说明 transcript 层面对 notebook 操作的最小单位，不是：

- `notebook_path`

而是：

- `notebook_path + cell identity`

这和 `FileEdit/FileWrite` 的文件级叙事是两套不同的话语体系。

## 15. `readFileState` 的写后回填不是普通去重优化，而是 notebook 读写回环正确性的必要条件

源码镜像：[`../../sources/claude-code/src/tools/NotebookEditTool/NotebookEditTool.ts`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts)

写盘后它会立刻：

- `readFileState.set(fullPath, { content: updatedContent, timestamp: ..., offset: undefined, limit: undefined })`

源码注释已经点明原因：

- 如果不把 `offset/limit` 清成 `undefined`
- `Read -> NotebookEdit -> Read` 在同一毫秒内可能被误判成 `file_unchanged`

所以这不是单纯的“下次少读一点”，而是为了保证：

- notebook 编辑之后，下一次 read 不会错误复用旧的 partial/full-read dedup 结果

## 16. 它和 `Edit/Write` 的真正边界可以压缩成一句话：前两者保护文本，`NotebookEdit` 保护 cell topology

源码镜像：[`../../sources/claude-code/src/tools/NotebookEditTool/NotebookEditTool.ts`](../../sources/claude-code/src/utils/notebook.ts)

如果把三把写工具并排看：

- `FileEditTool`
  - 保护局部文本意图
- `FileWriteTool`
  - 保护整文件 replacement 意图
- `NotebookEditTool`
  - 保护 notebook cell identity、cell array 拓扑、execution/output 语义

所以 notebook 之所以必须独立成一把工具，不是因为 `.ipynb` 扩展名特殊，而是因为它承载的是一类完全不同的：

- structured document mutation model

这也是 Claude Code 不把 notebook 编辑退化成普通 JSON patch 的根本原因。
