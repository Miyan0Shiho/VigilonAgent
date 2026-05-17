# FileEditTool / Staleness / Quote Normalization / Atomic Write Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：McpAuthTool / needs-auth Placeholder / Background Reconnect Runtime`](./86-mcp-auth-tool-needs-auth-placeholder-and-background-reconnect-runtime.md) | [`下一站：FileWriteTool / Full Replacement / Create-Overwrite / Diff Runtime`](./88-filewrite-tool-full-replacement-create-overwrite-and-diff-runtime.md)

本文把 `FileEditTool` 从旧的“文件编辑总述”里单独抽出来，专门讲单文件原位替换这一条主链。相邻卷册已经覆盖了：

- [`03`](./03-file-editing-and-shell-execution.md)：文件编辑与 shell 的总述级机制
- [`75`](./75-config-tool-supported-settings-source-routing-and-immediate-effect-runtime.md)：设置文件的高层配置入口
- [`80`](./80-lsp-tool-initialization-deferred-loading-and-diagnostic-attachment-runtime.md)：LSP 诊断与附件体系

而这篇只讲 `FileEditTool` 自己的实现级运行时：

- read-before-edit 和 staleness 检查
- quote normalization / curly-quote preserve
- settings-file 专项验证
- atomic read-modify-write 段
- LSP / VSCode / file history / diagnostics 的 sidecar
- rejected / error / success 三套前台表面

## 1. `FileEditTool` 的定位不是“任意改文件”，而是“基于已读内容做原位替换”

源码镜像：[`../../sources/claude-code/src/tools/FileEditTool/FileEditTool.ts`](../../sources/claude-code/src/tools/FileEditTool/FileEditTool.ts), [`../../sources/claude-code/src/tools/FileEditTool/prompt.ts`](../../sources/claude-code/src/tools/FileEditTool/prompt.ts)

这把工具的输入核心是：

- `file_path`
- `old_string`
- `new_string`
- `replace_all`

它不是补全文本重写，也不是 patch-apply 工具，而是：

- 以 `old_string` 为锚点
- 在当前文件内容里找到目标片段
- 生成更新后的整文件内容

也因此它对“文件此前有没有被读过”“文件中现在是不是还能找到这个片段”极其敏感。

## 2. 它和 `FileWriteTool` 的边界很清楚：`old_string === ''` 才接近创建语义，其余都被当成编辑

源码镜像：[`../../sources/claude-code/src/tools/FileEditTool/UI.tsx`](../../sources/claude-code/src/tools/FileEditTool/UI.tsx), [`../../sources/claude-code/src/tools/FileWriteTool/FileWriteTool.ts`](../../sources/claude-code/src/tools/FileWriteTool/FileWriteTool.ts)

`userFacingName(...)` 的规则是：

- `edits != null` 或普通替换 -> `Update`
- `old_string === ''` -> `Create`

但这并不意味着它真的和 `FileWriteTool` 合并。实际运行时里：

- 如果目标文件不存在且 `old_string === ''`，它允许“以空锚点创建文件”
- 如果目标文件已存在而 `old_string === ''`，只允许在文件本身也为空时继续

所以它保留了“创建空壳后填内容”的一条兼容路径，但主设计仍然是编辑器，而不是写入器。

## 3. 输入验证先挡最基础的无效调用：相同字符串、deny 规则、UNC 路径、大文件

源码镜像：[`../../sources/claude-code/src/tools/FileEditTool/FileEditTool.ts`](../../sources/claude-code/src/tools/FileEditTool/FileEditTool.ts)

`validateInput(...)` 的前半段先做几层低级防线：

- `old_string === new_string` -> 明确拒绝
- team memory secret guard -> 拒绝把 secret 写进 team memory
- permission deny rule -> 直接阻断
- UNC 路径 -> 跳过本地文件系统探测，避免 Windows NTLM 泄露
- `stat.size > 1 GiB` -> 拒绝编辑超大文件

这说明它在真正读取文件之前，就先把：

- 明显无意义的调用
- 明显不安全的路径
- 明显会造成 OOM 的对象

都拦在外面。

## 4. `read-before-edit` 是硬约束，不只是建议

源码镜像：[`../../sources/claude-code/src/tools/FileEditTool/FileEditTool.ts`](../../sources/claude-code/src/tools/FileEditTool/FileEditTool.ts)

如果 `toolUseContext.readFileState` 里没有这个文件，或者只读了 partial view，就直接返回：

- `File has not been read yet. Read it first before writing to it.`

这说明 FileEditTool 在 Claude Code 里不是“模型自己猜一下这个文件怎么改”，而是明确要求：

- 先有一份最近读过的本地视图

否则就不允许写。这和 `FileWriteTool`、`NotebookEditTool` 的 read-before-write 规则是一致的。

## 5. staleness 检查不是简单看 mtime；Windows 上还会在 full read 情况下用内容相等兜底

源码镜像：[`../../sources/claude-code/src/tools/FileEditTool/FileEditTool.ts`](../../sources/claude-code/src/tools/FileEditTool/FileEditTool.ts)

验证阶段会先比较：

- `getFileModificationTime(fullFilePath)`
- `readTimestamp.timestamp`

如果发现文件在读之后改过，通常直接拒绝。

但在一个特殊分支里，如果满足：

- 上次读取是 full read
- 当前 `fileContent === readTimestamp.content`

就允许继续。

这条分支是专门为 Windows/云同步/杀软这类“mtime 变了但内容没变”的假阳性准备的。说明 FileEditTool 的 staleness 判定已经不是单纯的 timestamp guard，而是：

- 先用 timestamp
- 再用 content equality 对冲某些宿主噪音

## 6. 它显式禁止拿这把工具去改 `.ipynb`，要求改走 `NotebookEditTool`

源码镜像：[`../../sources/claude-code/src/tools/FileEditTool/FileEditTool.ts`](../../sources/claude-code/src/tools/NotebookEditTool/NotebookEditTool.ts)

如果路径以 `.ipynb` 结尾，就直接返回：

- `Use the NotebookEdit tool to edit this file.`

所以系统对 notebook 的边界非常明确：

- FileEditTool 只处理文本文件
- NotebookEditTool 负责 notebook cell 语义

这也说明“Jupyter 本体是 JSON 文本”并不会让它回退成普通字符串替换问题。

## 7. `findActualString(...)` 说明“找不到 old_string”之前，系统会先做 quote normalization

源码镜像：[`../../sources/claude-code/src/tools/FileEditTool/utils.ts`](../../sources/claude-code/src/tools/FileEditTool/utils.ts)

`findActualString(fileContent, searchString)` 的顺序是：

1. 先试 exact match
2. 再把：
   - curly quotes -> straight quotes
3. 用 normalize 后的文本做二次匹配
4. 如果命中，再从原文件里切出对应的真实片段

这条链很重要，因为模型通常更容易输出 straight quotes，而文件里可能是：

- `‘’`
- `“”`

所以“找不到 old_string”并不总是立即失败；系统会先试一次 quote-normalized 宽匹配。

## 8. `preserveQuoteStyle(...)` 又把这件事反过来做了一次：匹配时允许直引号，写回时尽量保留原文件的 curly style

源码镜像：[`../../sources/claude-code/src/tools/FileEditTool/utils.ts`](../../sources/claude-code/src/tools/FileEditTool/utils.ts)

如果：

- `old_string !== actualOldString`

就说明匹配是靠 quote normalization 成功的。

这时工具不会直接把 `new_string` 原样写回，而会调用：

- `preserveQuoteStyle(oldString, actualOldString, newString)`

把新内容中的引号尽量映射回：

- curly single / double quotes
- 甚至还对 apostrophe vs quotation 做了不同处理

这意味着 FileEditTool 的 quote 逻辑不是单向的“为了匹配而 normalize”，而是完整的：

- 匹配阶段宽容
- 写回阶段保风格

## 9. 多重匹配是显式错误，不会偷偷替你只改第一个

源码镜像：[`../../sources/claude-code/src/tools/FileEditTool/FileEditTool.ts`](../../sources/claude-code/src/tools/FileEditTool/FileEditTool.ts)

如果：

- `matches > 1`
- 且 `replace_all === false`

工具不会默默选第一个命中，而是拒绝并返回：

- 找到多个匹配
- 要么把上下文写得更唯一
- 要么显式打开 `replace_all`

这说明它宁愿把歧义上抛给模型，也不愿在多命中时偷偷做一个不可解释的“默认只改第一个”。

## 10. 设置文件编辑还有一层专门的 `validateInputForSettingsFileEdit(...)`

源码镜像：[`../../sources/claude-code/src/tools/FileEditTool/FileEditTool.ts`](../../sources/claude-code/src/utils/settings/validateEditTool.ts)

在通过匹配逻辑之后，工具还会专门调用：

- `validateInputForSettingsFileEdit(fullFilePath, file, simulateEditFn)`

这里的关键点是：

- 它不是只看输入字段
- 而是先用和真实工具相同的 replace 逻辑“模拟编辑后内容”
- 再让 settings validator 判断是否会把设置文件改坏

所以这是一层：

- semantic post-edit validation

而不是 path-based denylist。

## 11. 真正的写盘段被故意压成一小块“不要插 async”的临界区

源码镜像：[`../../sources/claude-code/src/tools/FileEditTool/FileEditTool.ts`](../../sources/claude-code/src/tools/FileEditTool/FileEditTool.ts)

`call(...)` 里有一条非常明确的注释：

- 从加载当前状态到写盘这段中间，请避免 async operations，以保持 atomicity

顺序大概是：

1. 外围 async 准备：
   - skill discovery
   - diagnosticTracker
   - mkdir
   - fileHistory backup
2. 进入临界区：
   - `readFileForEdit(...)`
   - staleness 再确认
   - `findActualString(...)`
   - `preserveQuoteStyle(...)`
   - `getPatchForEdit(...)`
   - `writeTextContent(...)`

这表明 FileEditTool 的作者明确知道：

- 在 stale-check 和 write 之间再做 await

会把整个“我刚确认文件没变”这个保证打穿。

## 12. `writeTextContent(...)` 写入之前，工具会显式保留 encoding 和 line endings

源码镜像：[`../../sources/claude-code/src/tools/FileEditTool/FileEditTool.ts`](../../sources/claude-code/src/tools/FileEditTool/FileEditTool.ts)

`readFileForEdit(...)` 不只是拿文本内容，还会保留：

- `encoding`
- `lineEndings`

然后写盘时直接：

- `writeTextContent(absoluteFilePath, updatedFile, encoding, endings)`

也就是说，它不会在编辑时悄悄把文件统一成：

- UTF-8
- LF

而是尽量保持原文件的物理格式不变。

## 13. patch 的职责分成两种：一份给真实更新，一份给展示

源码镜像：[`../../sources/claude-code/src/tools/FileEditTool/utils.ts`](../../sources/claude-code/src/tools/FileEditTool/UI.tsx)

`getPatchForEdit(...)` / `getPatchForEdits(...)` 的注释已经明确区分：

- patch 是拿来展示的
- 为了视觉效果，里面可能已经把 tab、行号等做了转换

与此同时，更新后的 `updatedFile` 才是实际写盘内容。

这说明 FileEditTool 在这里采用的是：

- one source of truth = updated file bytes
- separate presentation patch = UI / transcript-friendly diff

而不是把“展示给用户看的 patch”反过来当写盘真相。

## 14. 写完以后会主动把变更广播给多套旁路系统：diagnostics、LSP、VSCode、readFileState

源码镜像：[`../../sources/claude-code/src/tools/FileEditTool/FileEditTool.ts`](../../sources/claude-code/src/services/lsp/LSPDiagnosticRegistry.ts), [`../../sources/claude-code/src/services/mcp/vscodeSdkMcp.ts`](../../sources/claude-code/src/services/mcp/vscodeSdkMcp.ts)

写盘之后，它不会只返回结果，而是立刻做一串 side effects：

- `clearDeliveredDiagnosticsForFile(...)`
- `lspManager.changeFile(...)`
- `lspManager.saveFile(...)`
- `notifyVscodeFileUpdated(...)`
- `readFileState.set(...)` 更新本地已读状态

这说明 FileEditTool 在 Claude Code 里不是单点写磁盘，而是：

- 本地文本真相变更广播器

尤其是 `readFileState.set(...)` 很关键，因为它把“这次 edit 后的新内容”直接变成后续写操作的 fresh baseline。

## 15. file history、diff analytics、remote git diff 都是附带层，但都挂在写盘成功之后

源码镜像：[`../../sources/claude-code/src/tools/FileEditTool/FileEditTool.ts`](../../sources/claude-code/src/utils/fileHistory.ts), [`../../sources/claude-code/src/utils/gitDiff.ts`](../../sources/claude-code/src/utils/fileOperationAnalytics.ts)

写成功之后，工具还会：

- 记录 `fileHistoryTrackEdit(...)`
- `countLinesChanged(patch)`
- `logFileOperation(...)`
- 记录 `tengu_edit_string_lengths`
- 在 remote + feature gate 下再拉 `fetchSingleFileGitDiff(...)`

这些都不参与主写盘原子性，但都用于：

- 恢复
- 诊断
- 远端 UI 展示
- 统计分析

所以 FileEditTool 已经不只是“改文件”，也是一个相当重要的 observability source。

## 16. rejection UI 不是简单报错，而是会懒加载上下文生成一份“如果接受会改成什么”的 diff

源码镜像：[`../../sources/claude-code/src/tools/FileEditTool/UI.tsx`](../../sources/claude-code/src/tools/FileEditTool/UI.tsx), [`../../sources/claude-code/src/utils/readEditContext.ts`](../../sources/claude-code/src/utils/readEditContext.ts)

`renderToolUseRejectedMessage(...)` 在 edit 路径下不会只显示：

- 这次被拒绝了

它会走：

- `loadRejectionDiff(...)`
- `readEditContext(filePath, oldString, CONTEXT_LINES)`
- 再生成 patch 预览

而且这条加载是：

- `Suspense` + lazy body

说明 rejected message 在 Claude Code 里并不是纯错误提示，而是：

- 一种“拒绝了，但仍然给你看这次提案会改哪”的审阅面

## 17. 错误表面也做了有意降噪：常见 intended errors 会被压成短提示而不是惊悚大报错

源码镜像：[`../../sources/claude-code/src/tools/FileEditTool/UI.tsx`](../../sources/claude-code/src/tools/FileEditTool/UI.tsx)

非 verbose 模式下，如果 tool_use_error 里包含：

- `File has not been read yet`
- `FILE_NOT_FOUND_CWD_NOTE`

UI 会专门压成：

- `File must be read first`
- `File not found`

其他错误才回退成：

- `Error editing file`

也就是说，FileEditTool 的默认前台表面已经把常见工作流型失败当成：

- 可预期恢复提示

而不是 fatal exception。

## 18. 因而 `FileEditTool` 在 Claude Code 里的真实定位，是“带 staleness 和格式保真的原位编辑事务”

把整条链收束起来，可以看到它不是简单的字符串替换函数：

- 验证层要求 read-before-edit、无歧义匹配、settings-file 不损坏
- 匹配层做 quote normalization 和 preserve
- 执行层刻意压缩出一段 atomic read-modify-write 临界区
- 写后层又把更新广播给 diagnostics / LSP / VSCode / read state / history / analytics
- 前台层把 rejection/error/success 三种状态都做成可恢复的 operator surface

所以更准确的说法不是：

- “FileEditTool 用 old_string/new_string 改文件”

而是：

- `FileEditTool` 是 Claude Code 的带 stale guard、格式保真和多旁路广播的原位编辑事务。
