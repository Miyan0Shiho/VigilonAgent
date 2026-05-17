# Notebook Read / ToolResult Blocks / Large Output Guard / Cell ID Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：NotebookEditTool / Cell Identity / JSON Materialization / Permission Diff Runtime`](./89-notebookedit-tool-cell-identity-json-materialization-and-permission-diff-runtime.md) | [`下一站：FileRead Image / PDF / Dedup / Supplemental Block Runtime`](./91-fileread-image-pdf-dedup-and-supplemental-block-runtime.md)

本文把 notebook 读取链从 `FileReadTool` 总述里单独抽出来，专门讲 `.ipynb` 如何被读成模型可消费的 cell/runtime 表示。相邻卷册已经覆盖了：

- [`32`](./32-file-read-grep-and-websearch-runtime.md)：`FileReadTool` 的统一内容摄取层
- [`89`](./89-notebookedit-tool-cell-identity-json-materialization-and-permission-diff-runtime.md)：`NotebookEditTool` 的 cell 写入与物化

而这篇只讲 notebook 读取这一条实现级主链：

- `FileReadTool` 的 `.ipynb` 特判分支
- `readNotebook(...)` 的 cell/source/output 规整
- large output guard 与 `jq` 降级提示
- `tool_result` block 的 text/image 组织
- `cell_id` 与 `cell-N` 兼容身份模型

## 1. `.ipynb` 在 `FileReadTool` 里不是普通 JSON 文本，而是独立分支

源码镜像：[`../../src/tools/FileReadTool/FileReadTool.ts`](../../src/tools/FileReadTool/FileReadTool.ts), [`../../src/utils/notebook.ts`](../../src/utils/notebook.ts)

`callInner(...)` 里对 notebook 有一条完全独立的路径：

- `if (ext === 'ipynb')`
  - `const cells = await readNotebook(resolvedFilePath)`
  - `const cellsJson = jsonStringify(cells)`

这说明在 Claude Code 里，notebook 读取不是：

- 先把 `.ipynb` 当文本读进来
- 再让模型自己理解 cell 结构

而是：

- 本地先把 notebook 编译成更稳定的 cell 表示
- 再把这个表示交给上层 runtime

## 2. `readNotebook(...)` 的第一职责不是返回原 JSON，而是把 notebook 规整成 `NotebookCellSource[]`

源码镜像：[`../../src/utils/notebook.ts`](../../src/utils/notebook.ts)

`readNotebook(...)` 会：

1. `expandPath(notebookPath)`
2. `readFileBytes(fullPath)`
3. `buffer.toString('utf-8')`
4. `jsonParse(content) as NotebookContent`
5. `processCell(...)` 把每个 cell 变成统一的 `NotebookCellSource`

这意味着 notebook 读取的正式输出不是：

- 原始 nbformat JSON

而是：

- Claude Code 自己定义的一层 cell-source IR

## 3. `cell_id` 读取侧就已经统一了：真实 `cell.id` 优先，缺失时退化成 `cell-N`

源码镜像：[`../../src/utils/notebook.ts`](../../src/tools/NotebookEditTool/NotebookEditTool.ts)

`processCell(...)` 里对 cell identity 的规则是：

- `const cellId = cell.id ?? \`cell-${index}\``

也就是说：

- notebook 自带真实 id -> 用真实 id
- 老 notebook 或缺失 id -> 生成 `cell-0`, `cell-1`, ... 这种 fallback

这条规则正好和 `NotebookEditTool` 的写入兼容线闭合：

- 读的时候就暴露 `cell-N`
- 写的时候再用 `parseCellId(...)` 吃回去

## 4. 读取侧也会主动区分 code cell 和 markdown cell，而不是让模型自己猜

源码镜像：[`../../src/utils/notebook.ts`](../../src/utils/notebook.ts)

`processCell(...)` 统一填充的字段包括：

- `cellType`
- `source`
- `execution_count`
- `cell_id`

而语言只在：

- `cell.cell_type === 'code'`

时才附带。

这说明 notebook 读取在最基础的语义层面就已经做了归类：

- markdown 不是代码
- code cell 才有 language / execution state

## 5. cell source 不是原样数组透传，而是被规范成单一字符串

源码镜像：[`../../src/utils/notebook.ts`](../../src/utils/slowOperations.ts)

notebook 里 `cell.source` 可能是：

- string
- string[]

读取侧统一做：

- `Array.isArray(cell.source) ? cell.source.join('') : cell.source`

也就是说，上层模型看到的 notebook cell source 已经没有 nbformat 层面的 list-vs-string 差异，只有一份：

- 连续文本源码

## 6. 输出处理不是简单附带 `outputs` 字段，而是先经过按类型规整和截断

源码镜像：[`../../src/utils/notebook.ts`](../../src/tools/BashTool/utils.ts)

`processOutput(...)` 会把三类 notebook output 规整成统一结构：

- `stream`
- `execute_result / display_data`
- `error`

文本输出还会统一经过：

- `processOutputText(...)`
  - 内部用 `formatOutput(...)`
  - 产出 `truncatedContent`

所以 notebook 输出并不是“原封不动交给模型”，而是先套入和 shell 输出同一套文本截断规则。

## 7. image output 也在读取阶段就被提取成真正的 image block 原料

源码镜像：[`../../src/utils/notebook.ts`](../../src/utils/notebook.ts)

`extractImage(...)` 只认：

- `image/png`
- `image/jpeg`

并且会：

- 去掉 base64 里的空白
- 填上 `media_type`

这说明 notebook 的 image output 在本地就已经被编译成：

- 可直接进入 `ToolResultBlockParam` 的图像侧载格式

而不是保留为原始 nbformat `data` map。

## 8. `large outputs` 有正式阈值，不会让 notebook 成为无限制输出黑洞

源码镜像：[`../../src/utils/notebook.ts`](../../src/tools/FileReadTool/FileReadTool.ts)

读取侧有一条明确的输出尺寸闸门：

- `LARGE_OUTPUT_THRESHOLD = 10000`

`isLargeOutputs(...)` 会累计：

- 输出文本长度
- 图片 base64 长度

超过阈值时，不是直接失败，而是把 cell outputs 换成一条提示：

- `Outputs are too large to include. Use Bash with jq ...`

这意味着 notebook 读取对“大 output cell”采取的是：

- graceful degradation

而不是：

- 全 notebook 读取失败

## 9. 这条 `jq` 提示不是装饰文案，而是 notebook read runtime 的正式降级协议

源码镜像：[`../../src/utils/notebook.ts`](../../src/tools/BashTool/toolName.ts)

large-output fallback 给出的不是抽象错误，而是具体建议：

- `cat <notebook_path> | jq '.cells[N].outputs'`

所以 notebook read runtime 在这里做了很明确的产品选择：

- 正常情况下走结构化 notebook ingestion
- 太大时回退到 shell + jq 的 operator path

这条协议把 `FileReadTool` 和 `BashTool` 在 notebook 场景里接成了一条分层协作链。

## 10. `readNotebook(cellId?)` 还支持单 cell 精确读取，但这里目前只接受真实 `cell.id`

源码镜像：[`../../src/utils/notebook.ts`](../../src/tools/NotebookEditTool/NotebookEditTool.ts)

`readNotebook(...)` 自身支持：

- `readNotebook(notebookPath, cellId?)`

如果给了 `cellId`，它会：

- `notebook.cells.find(c => c.id === cellId)`

注意这里没有 `parseCellId(...)` fallback。也就是说：

- notebook IR 层支持按真实 id 精确读取
- 但 `cell-N` 兼容目前主要存在于编辑链和 permission preview 链

这是读取侧和写入侧一个值得单独记住的不对称点。

## 11. `FileReadTool` 的 notebook 分支会先把 cell IR 再序列化成 JSON，用它做统一预算与 read-state 基线

源码镜像：[`../../src/tools/FileReadTool/FileReadTool.ts`](../../src/utils/fileOperationAnalytics.ts)

`.ipynb` 分支里读取完 `cells` 之后马上做：

- `const cellsJson = jsonStringify(cells)`

后面几件事都围绕这份 JSON 展开：

- `Buffer.byteLength(cellsJson)` 做 bytes 预算
- `validateContentTokens(cellsJson, ext, maxTokens)` 做 token 预算
- `readFileState.set(... content: cellsJson ...)` 作为 read baseline
- `logFileOperation(... content: cellsJson ...)`

这说明 notebook 读取在 Claude Code 里的真正 canonical read representation 是：

- 序列化后的 cell IR JSON

而不是原始 notebook 文件文本。

## 12. notebook 有两层大小治理：整本 notebook 大小上限和单 cell output 大小上限

源码镜像：[`../../src/tools/FileReadTool/FileReadTool.ts`](../../src/utils/notebook.ts)

这条链实际上有两层预算：

1. 单 cell 输出太大
   - 在 `processCell(...)` 就被替换成 `jq` 提示
2. 整本 notebook 的 cell IR JSON 还是太大
   - `.ipynb` 分支直接抛 size error
   - 并给出几条更大粒度的 `jq` 读取建议

这说明系统没有把“大 notebook”简单视为一种问题，而是分成：

- 局部 outputs 爆炸
- 整体 notebook 爆炸

两种不同退化路径。

## 13. notebook 到 `tool_result` 的映射不是单文本，而是 text/image 混合 block 流

源码镜像：[`../../src/utils/notebook.ts`](../../src/tools/FileReadTool/FileReadTool.ts)

`mapNotebookCellsToToolResult(...)` 的内部步骤是：

- `cellContentToToolResult(...)` 生成 cell 本体文本块
- `cellOutputToToolResult(...)` 生成 output 文本块和 image 块
- `getToolResultFromCell(...)` 组合单 cell 结果
- 所有 cell 再 `flatMap`

所以 `FileReadTool` 读 notebook 给模型的不是：

- 一大坨字符串

而是：

- 一串 text/image block 的富内容协议

## 14. text block 不是裸文本，而是带 `<cell id="...">` wrapper 的 notebook DSL

源码镜像：[`../../src/utils/notebook.ts`](../../src/tools/NotebookEditTool/NotebookEditTool.ts)

`cellContentToToolResult(...)` 会把每个 cell 编成：

- `<cell id="..."> ... </cell id="...">`

另外还会在必要时塞入：

- `<cell_type>markdown</cell_type>`
- `<language>...</language>`

这说明 notebook 读取对模型暴露的不是 JSON，也不是纯自然语言，而是一种轻量的：

- XML-like notebook DSL

它的目的很明确：

- 让模型更稳定地引用 cell id
- 更稳定地区分代码与 markdown

## 15. 邻接 text blocks 会在结果侧被主动合并，避免 notebook transcript 过碎

源码镜像：[`../../src/utils/notebook.ts`](../../src/components/messages/UserToolResultMessage/UserToolSuccessMessage.tsx)

`mapNotebookCellsToToolResult(...)` 最后有一步专门做：

- merge adjacent text blocks

规则是：

- 前一个 block 是 text
- 当前 block 也是 text
- 就直接 `prev.text += '\n' + curr.text`

这说明 notebook read runtime 关心的不只是语义准确，还关心：

- transcript block 粒度不要碎得过头

## 16. notebook 读取和 notebook 编辑一起构成了一条完整的 `cell identity` 闭环

源码镜像：[`../../src/utils/notebook.ts`](../../src/tools/NotebookEditTool/NotebookEditTool.ts)

把 `90` 和 `89` 放在一起看，会得到一条完整闭环：

- `readNotebook(...)`
  - 暴露 `cell.id ?? cell-N`
  - 把 cell 变成模型可读 DSL
- `NotebookEditTool`
  - 优先按真实 `cell.id` 找
  - 兼容 `cell-N` fallback
  - 再把修改物化回 notebook JSON

所以 notebook 在 Claude Code 里不是“读一套、写一套”的临时拼接，而是一条正式的：

- read IR -> model reasoning -> write IR

闭环通道。

## 17. 这条 notebook read 链和普通 `FileReadTool` 的真正差别，可以压缩成一句话：普通文件返回内容，notebook 返回语义场景

源码镜像：[`../../src/tools/FileReadTool/FileReadTool.ts`](../../src/utils/notebook.ts)

普通文本读取主要解决：

- 路径
- 预算
- 行号
- 截断

而 notebook 读取额外解决：

- cell identity
- code / markdown 类型
- execution state
- structured outputs
- image outputs
- 大 output 降级
- tool_result block 组织

所以 `.ipynb` 在 Claude Code 里不是“文件的一种特殊后缀”，而是一个正式的：

- semantic document runtime

这也是为什么 notebook 读取值得从 `FileReadTool` 总述里单独拆成一卷。
