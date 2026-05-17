# FileWriteTool / Full Replacement / Create-Overwrite / Diff Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：FileEditTool / Staleness / Quote Normalization / Atomic Write Runtime`](./87-fileedit-tool-staleness-quote-normalization-and-atomic-write-runtime.md) | [`下一站：NotebookEditTool / Cell Identity / JSON Materialization / Permission Diff Runtime`](./89-notebookedit-tool-cell-identity-json-materialization-and-permission-diff-runtime.md)

本文把 `FileWriteTool` 从旧的“文件编辑总述”里单独抽出来，专门讲整文件写入这一条主链。相邻卷册已经覆盖了：

- [`03`](./03-file-editing-and-shell-execution.md)：文件编辑与 shell 的总述级机制
- [`75`](./75-config-tool-supported-settings-source-routing-and-immediate-effect-runtime.md)：设置文件的高层配置入口
- [`87`](./87-fileedit-tool-staleness-quote-normalization-and-atomic-write-runtime.md)：基于旧字符串锚点的原位替换

而这篇只讲 `FileWriteTool` 自己的实现级运行时：

- create vs overwrite 的双态 contract
- read-before-write 和整文件 replacement 语义
- atomic full-write 段与 line ending policy
- permission diff / rejected diff / turn diff sidecar
- LSP / VSCode / file history / analytics 的写后副作用

## 1. `FileWriteTool` 的定位不是 patch 编辑，而是“用一份完整内容替换整个文件”

源码镜像：[`../../sources/claude-code/src/tools/FileWriteTool/FileWriteTool.ts`](../../sources/claude-code/src/tools/FileWriteTool/FileWriteTool.ts), [`../../sources/claude-code/src/tools/FileWriteTool/prompt.ts`](../../sources/claude-code/src/tools/FileWriteTool/prompt.ts)

它的输入核心只有两项：

- `file_path`
- `content`

和 `FileEditTool` 不同，它没有：

- `old_string`
- `new_string`
- `replace_all`

这说明它不做局部定位，也不尝试解释模型“想改哪一段”。它的 contract 很直接：

- 模型提供一份完整的新文件内容
- 工具用这份内容覆盖磁盘上的当前文件

所以 `Write` 的抽象层级比 `Edit` 更高，但也更粗。

## 2. 它在 prompt 里被明确限定为“新建文件或完整重写”，而不是普通修改首选

源码镜像：[`../../sources/claude-code/src/tools/FileWriteTool/prompt.ts`](../../sources/claude-code/src/tools/FileWriteTool/prompt.ts)

`getWriteToolDescription()` 直接把几条策略写进工具说明：

- 现有文件会被 overwrite
- 如果是 existing file，必须先 `Read`
- 普通修改优先走 `Edit`
- 除非用户明确要求，否则不要创建 `*.md` / `README`

也就是说，`Write` 在产品层并不是“第二把编辑工具”，而是：

- `create new file`
- `complete rewrite`

这两个场景的正式入口。

## 3. 它和 `FileEditTool` 共享 read-before-write 哲学，但不共享锚点匹配语义

源码镜像：[`../../sources/claude-code/src/tools/FileWriteTool/FileWriteTool.ts`](../../sources/claude-code/src/tools/FileEditTool/FileEditTool.ts)

`validateInput(...)` 里最核心的判断是：

- 文件不存在 -> 允许继续
- 文件存在但没有 `readFileState` full read -> 直接拒绝
- 文件存在且读后被修改 -> 直接拒绝

它和 `Edit` 一样，要求：

- 对 existing file，先有最近读过的本地视图

但共享的只有这个“先读再写”的治理约束，不包括 `Edit` 的那套：

- `old_string` 锚点
- 多重匹配歧义
- quote normalization

`Write` 不关心“改哪一段”，因为它压根没有段级语义。

## 4. 输入验证更薄，但仍然保留了最关键的安全闸门

源码镜像：[`../../sources/claude-code/src/tools/FileWriteTool/FileWriteTool.ts`](../../sources/claude-code/src/services/teamMemorySync/teamMemSecretGuard.ts)

`validateInput(...)` 的前半段仍然先挡掉几类高风险调用：

- team memory secret guard
- deny rule 匹配
- UNC 路径探测绕过

和 `Edit` 相比，它少了：

- `old_string === new_string`
- 1 GiB 文件大小拒绝
- notebook redirect
- settings-file post-edit validator

原因也很直接：

- `Write` 不依赖局部匹配，不需要处理这些文本级边角情况
- 但“写进 team memory 泄露 secret”“访问 UNC 路径触发 NTLM”“命中 deny rule”这类宿主级风险仍然完全存在

## 5. 对 existing file，它的 staleness check 也是 `mtime + full-read content equality` 双层兜底

源码镜像：[`../../sources/claude-code/src/tools/FileWriteTool/FileWriteTool.ts`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts)

`call(...)` 进入临界区后会：

1. `readFileSyncWithMetadata(fullFilePath)`
2. 取 `getFileModificationTime(fullFilePath)`
3. 对比 `readFileState.get(fullFilePath)`

如果 timestamp 表示文件被改过，通常直接抛：

- `FILE_UNEXPECTEDLY_MODIFIED_ERROR`

但和 `Edit` 一样，它也给 Windows/同步盘噪音留了 fallback：

- 只有 full read 才允许比较内容
- `meta.content` 与 `lastRead.content` 相等时，接受这个“mtime 假阳性”

这说明 Claude Code 对 existing-file write 的一致设计是：

- 先信时间戳
- 再用 full-read content equality 抵消宿主噪音

## 6. 真正的临界区围绕的是“读旧文件 -> 确认没变 -> 全量写回”

源码镜像：[`../../sources/claude-code/src/tools/FileWriteTool/FileWriteTool.ts`](../../sources/claude-code/src/utils/fileRead.ts)

`call(...)` 里也有和 `Edit` 同样明确的注释：

- 在加载当前状态到写盘之间避免 async，以保持 atomicity

顺序大概是：

1. 外围 async 准备：
   - conditional skill discovery
   - `diagnosticTracker.beforeFileEdited(...)`
   - `mkdir(parent)`
   - file history backup
2. 进入临界区：
   - `readFileSyncWithMetadata(...)`
   - staleness 再确认
   - `writeTextContent(...)`

这里没有 patch-level 文本变换，只有“整文件 replacement”。所以它的 atomic 核心更简单，但同样脆弱：

- 一旦在 stale-check 和 write 之间插入 `await`
- “我确认写的是刚刚看过的文件”这个保证就会失效

## 7. 和 `Edit` 不同，`Write` 明确不保留旧文件 line endings，而是把模型给出的内容当真

源码镜像：[`../../sources/claude-code/src/tools/FileWriteTool/FileWriteTool.ts`](../../sources/claude-code/src/tools/FileEditTool/FileEditTool.ts)

`Edit` 会保留：

- 原文件 encoding
- 原文件 line endings

而 `Write` 只保留 encoding，line ending 则明确走：

- `writeTextContent(fullFilePath, content, enc, 'LF')`

配套注释写得很直白：

- 这是 full content replacement
- 模型已经明确给出了 line endings
- 不要再按旧文件或 repo 样本偷偷改写

所以这把工具的哲学是：

- `Edit` 尽量保持原文件物理风格
- `Write` 认为“新内容本身就是最终物理格式说明书”

## 8. create 和 overwrite 在结果协议里是两条不同产品面

源码镜像：[`../../sources/claude-code/src/tools/FileWriteTool/FileWriteTool.ts`](../../sources/claude-code/src/tools/FileWriteTool/UI.tsx)

输出 schema 里最关键的字段是：

- `type: 'create' | 'update'`
- `content`
- `structuredPatch`
- `originalFile`

其中：

- `create`：`originalFile = null`，`structuredPatch = []`
- `update`：`originalFile = oldContent`，`structuredPatch = full-file replacement patch`

这不是只为了给模型看，而是直接决定了前台如何渲染：

- create -> “写了多少行 + 代码高亮预览”
- update -> 走和 `FileEditToolUpdatedMessage` 同一条结构化 diff UI

## 9. permission surface 也不是通用确认框，而是整文件 overwrite/create 专用 diff

源码镜像：[`../../sources/claude-code/src/components/permissions/FileWritePermissionRequest/FileWritePermissionRequest.tsx`](../../sources/claude-code/src/components/permissions/FileWritePermissionRequest/FileWriteToolDiff.tsx)

`FileWritePermissionRequest` 做了几件和 `Edit` 明显不同的事：

- 标题直接分成 `Create file` / `Overwrite file`
- 问句是 `Do you want to create/overwrite <basename>?`
- IDE diff config 不是多 edit patch，而是单一 full replacement

`FileWriteToolDiff` 的策略也很清楚：

- 文件不存在 -> 直接展示整份新内容
- 文件存在 -> 先生成 full-file patch，再走 `StructuredDiff`

所以在 operator 看来，这不是“应用几个 edit”，而是：

- `create a new file`
- 或 `replace the entire old file with this new one`

## 10. rejected surface 也要懒加载旧文件 diff，避免大文件/竞态直接压垮前台

源码镜像：[`../../sources/claude-code/src/tools/FileWriteTool/UI.tsx`](../../sources/claude-code/src/utils/readEditContext.ts)

`renderToolUseRejectedMessage(...)` 不是同步把旧文件 diff 全算出来，而是：

- `openForScan(...)`
- `readCapped(...)`
- 再按需要生成 patch

如果：

- 文件过大
- 文件已经被人手动改掉
- 读取失败

它会退化成：

- create fallback
- 或 `(No changes)`

这和 `FileEditTool` 的 rejected surface 是一套设计哲学：

- 前台要能解释“你本来想写什么”
- 但不能为了展示解释而在大文件或竞态场景里自爆

## 11. 写后 sidecar 很重：LSP、VSCode、readFileState、history、analytics 都要一起更新

源码镜像：[`../../sources/claude-code/src/tools/FileWriteTool/FileWriteTool.ts`](../../sources/claude-code/src/services/lsp/manager.ts)

写盘之后，工具立刻同步几条副作用链：

- `clearDeliveredDiagnosticsForFile(...)`
- `lspManager.changeFile(...)`
- `lspManager.saveFile(...)`
- `notifyVscodeFileUpdated(...)`
- `readFileState.set(...)`
- `logEvent('tengu_write_claudemd')` for `CLAUDE.md`
- `logFileOperation(...)`

所以 `Write` 绝不是“fs.writeFile 然后结束”。它必须把：

- IDE diff view
- LSP diagnostics
- stale-write baseline
- analytics

一起推到新状态，否则后面的工具和 UI 都会读到旧世界。

## 12. remote 模式下它还会额外计算单文件 git diff，作为 sidecar result

源码镜像：[`../../sources/claude-code/src/tools/FileWriteTool/FileWriteTool.ts`](../../sources/claude-code/src/utils/gitDiff.ts)

在：

- `CLAUDE_CODE_REMOTE`
- 且 feature flag `tengu_quartz_lantern`

打开时，`Write` 会额外调用：

- `fetchSingleFileGitDiff(fullFilePath)`

把结果挂进：

- `gitDiff`

这说明在某些 remote/operator 宿主里，单文件 write 之后的审计视角并不满足于 transcript patch，还要补一个 git-style diff sidecar。

## 13. `Write` 的 transcript summary 也比 `Edit` 更偏“文件结果”，不是“编辑动作”

源码镜像：[`../../sources/claude-code/src/tools/FileWriteTool/UI.tsx`](../../sources/claude-code/src/hooks/useTurnDiffs.ts)

`renderToolResultMessage(...)` 的分流是：

- create:
  - 正常模式显示预览
  - condensed 模式只显示 “Wrote N lines to path”
  - plan file 在普通模式下只给 `/plan to preview`
- update:
  - 复用 `FileEditToolUpdatedMessage`

`useTurnDiffs.ts` 还专门把 `FileWriteTool` 纳入 turn-level diff 聚合：

- `update` 直接复用 `structuredPatch`
- `create` 则从 `content` 合成 synthetic hunk

这说明 transcript / turn-summary 层面对 `Write` 的理解是：

- 它也是 diff-producing tool
- 只是 create 场景的 diff 需要在消费侧临时合成

## 14. 它和 `Edit` 的真正边界可以压缩成一句话：`Edit` 保护局部意图，`Write` 保护整文件意图

源码镜像：[`../../sources/claude-code/src/tools/FileWriteTool/FileWriteTool.ts`](../../sources/claude-code/src/tools/FileEditTool/FileEditTool.ts)

如果把两者对照起来看：

- `Edit`
  - 校验局部锚点
  - 保留旧 line endings
  - 处理 quote normalization
  - 多重匹配时拒绝歧义
- `Write`
  - 只要求先读旧文件
  - 允许直接 create
  - full replacement
  - 把模型给出的整份内容当真

所以它们并不是“一个细粒度、一个粗粒度”的简单关系，而是：

- `Edit` 保护“我只想改这里”
- `Write` 保护“我就是要把整份文件换成这样”

这也是为什么 Claude Code 需要同时保留两把写工具，而不是只用其中一个覆盖所有文件修改场景。
