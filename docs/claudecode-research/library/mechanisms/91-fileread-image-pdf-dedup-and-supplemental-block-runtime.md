# FileRead Image / PDF / Dedup / Supplemental Block Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Notebook Read / ToolResult Blocks / Large Output Guard / Cell ID Runtime`](./90-notebook-read-toolresult-blocks-large-output-guard-and-cell-id-runtime.md) | [`下一站：FileRead Skill Triggers / Memory Freshness / Session Analytics Sidecars`](./92-fileread-skill-triggers-memory-freshness-and-session-analytics-sidecars.md)

本文把 `FileReadTool` 里 notebook 之外的几条结果协议单独抽出来，专门讲 image / PDF / dedup / text-sidecar 这些过去还混在总述里的运行时。相邻卷册已经覆盖了：

- [`32`](./32-file-read-grep-and-websearch-runtime.md)：`FileReadTool` 的统一内容摄取层总述
- [`90`](./90-notebook-read-toolresult-blocks-large-output-guard-and-cell-id-runtime.md)：`.ipynb` 的独立读取链

而这篇只讲剩下这几条实现级主链：

- image read 的 token-budget 压缩链
- PDF full-read 与 page-extraction 双轨
- `newMessages` supplemental block sidecar
- `file_unchanged` dedup stub
- text read 的 `freshness prefix + line formatting + mitigation reminder`

## 1. `FileReadTool` 的输出协议从一开始就不是单一文本，而是六态 discriminated union

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts)

`outputSchema` 里把读取结果明确分成：

- `text`
- `image`
- `notebook`
- `pdf`
- `parts`
- `file_unchanged`

这意味着 `Read` 在 Claude Code 里不是“永远返回文件内容字符串”，而是一个多媒体内容摄取协议。`90` 已经把 `notebook` 单独拆开；这篇关注剩余五态。

## 2. image 分支不是“把原图 base64 化”，而是先走 token-budget-aware 压缩链

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts), [`../../sources/claude-code/src/tools/FileReadTool/imageProcessor.ts`](../../sources/claude-code/src/tools/FileReadTool/imageProcessor.ts), [`../../sources/claude-code/src/tools/FileReadTool/limits.ts`](../../sources/claude-code/src/tools/FileReadTool/limits.ts)

image 路径在 `callInner(...)` 里是：

- `if (IMAGE_EXTENSIONS.has(ext))`
- `const data = await readImageWithTokenBudget(resolvedFilePath, maxTokens)`

这里最关键的事实是：

- image 不受 text 那条 `maxSizeBytes` 预读字节上限约束
- 它直接服从 `maxTokens`
- 真正的治理核心在 `readImageWithTokenBudget(...)`

所以 `Read image` 的主约束不是“文件多大”，而是“最终塞进模型要花多少 token”。

## 3. `readImageWithTokenBudget(...)` 的第一原则是“只读磁盘一次，再在内存里反复压”

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/imageProcessor.ts)

函数开头就写明了：

- `// Read file ONCE`

具体路径是：

1. `readFileBytes(filePath, maxBytes)`
2. `detectImageFormatFromBuffer(imageBuffer)`
3. 先尝试 `maybeResizeAndDownsampleImageBuffer(...)`
4. 若估算 token 仍然超限，再走 `compressImageBufferWithTokenLimit(...)`
5. 若激进压缩失败，再退到极低质量 `sharp(...).resize(...).jpeg({ quality: 20 })`

所以这不是“不同阶段反复重新读图”，而是：

- 一次读盘
- 多段内存内压缩/重编码

这条设计正好避免了大图多次 I/O 和多次 decode 带来的浪费。

## 4. image processor 的运行时其实有 bundled/native 与 `sharp` 两级装载策略

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/imageProcessor.ts`](../../sources/claude-code/src/tools/FileReadTool/imageProcessor.ts)

`getImageProcessor()` 的装载顺序是：

- bundled mode 先试 `image-processor-napi`
- 失败再回退到 `sharp`

而 `getImageCreator()` 则始终直接走：

- `sharp`

原因注释也写得很直白：

- `image-processor-napi` 不支持从零创建图像

所以对 `FileReadTool` 来说，图片读取压缩链是一套“优先 native、保底 sharp”的宿主适配层，而不是硬依赖单一图像库。

## 5. image tool-result 不只是一张图，还可能额外外挂一条 metadata sidecar

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts)

image 分支成功后还会算：

- `const metadataText = data.file.dimensions ? createImageMetadataText(...) : null`

然后用：

- `newMessages: [createUserMessage({ content: metadataText, isMeta: true })]`

把它挂成 supplemental message。

这说明 image 读取不是只给模型一张图：

- 主 `tool_result` 里给图像 block
- supplemental sidecar 里再给尺寸/显示映射这类 operator-unfriendly 但对模型定位有用的元信息

## 6. `mapToolResultToToolResultBlockParam(...)` 对 image 的正式输出就是单个 image block

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/UI.tsx)

image 分支的 mapper 很薄：

- `content: [{ type: 'image', source: { type: 'base64', ... } }]`

而 UI 故意只显示：

- `Read image (SIZE)`

这和 text 路径形成鲜明对比：模型真正吃到的是图像块，但前台 operator surface 刻意压成一句摘要，不在 transcript 里回显 base64 或 metadata。

## 7. PDF 不是一条读法，而是 `pages` 提取轨和 full-document 轨两套完全不同协议

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/UI.tsx)

PDF 分支先看：

- `if (pages) { ... }`

有 `pages` 时走：

- `extractPDFPages(...)`
- 返回 `type: 'parts'`

没有 `pages` 时才继续看：

- `getPDFPageCount(...)`
- `isPDFSupported()`
- `readPDF(...)`
- 返回 `type: 'pdf'`

所以在 Claude Code 里：

- `pdf` = 全文档读取协议
- `parts` = 提页/切页读取协议

这两者不是一个结果类型上的小变体，而是不同宿主能力。

## 8. `parts` 路径真正回给模型的是抽页后生成的 image blocks，而不是“页码文字摘要”

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts)

带 `pages` 的分支里，`extractPDFPages(...)` 成功后会：

1. `readdir(outputDir)`
2. 找出所有 `*.jpg`
3. 对每张图再跑 `maybeResizeAndDownsampleImageBuffer(...)`
4. 组出 `imageBlocks`
5. 作为：
   - `newMessages: [createUserMessage({ content: imageBlocks, isMeta: true })]`

而主 `tool_result` 只保留一句：

- `PDF pages extracted: N page(s) ...`

这说明 `parts` 的真实内容载体是 supplemental image sidecar，不是主结果字符串。

## 9. full PDF 路径也不是把 PDF 文本提出来，而是把原始文档挂成 `document` block

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts)

full-document 分支在 `readPDF(...)` 成功后会返回：

- 主结果：`type: 'pdf'`
- supplemental：
  - `content: [{ type: 'document', source: { media_type: 'application/pdf', ... } }]`

同时 `mapToolResultToToolResultBlockParam(...)` 对 `pdf` 只给一句：

- `PDF file read: ...`

所以 full PDF 的正式协议是：

- 主 `tool_result` 不承载 PDF 内容
- 真正的 PDF 数据通过 supplemental `document` block 注入

这和 `parts` 路径“主结果是摘要，sidecar 才是真内容”的分层完全一致。

## 10. PDF 有三道不同层级的闸门，而不是单一 size check

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/limits.ts)

PDF 路径至少有三种不同的提前分流：

1. 明确 page-range 请求
   - `parsePDFPageRange(...)`
   - 受 `PDF_MAX_PAGES_PER_READ` 约束
2. 页面太多
   - `pageCount > PDF_AT_MENTION_INLINE_THRESHOLD`
   - 直接要求用户改走 `pages`
3. 模型/宿主不支持 full PDF，或文件过大
   - `!isPDFSupported()` 或 `stats.size > PDF_EXTRACT_SIZE_THRESHOLD`
   - 倾向 page extraction 语义

也就是说 PDF 不是“读得了/读不了”的单 bit 能力，而是：

- 看请求粒度
- 看模型能力
- 看文档尺寸

三者共同决定走哪条协议。

## 11. `file_unchanged` 不是普通缓存命中，而是“同一范围且磁盘没变”的 read-state 去重 stub

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/UI.tsx)

dedup 逻辑有几条硬前提：

- GrowthBook killswitch 没关
- `readFileState` 已有该文件记录
- 旧记录不是 partial view
- 旧记录来自 prior Read
  - `offset !== undefined`
- 这次的 `offset/limit` 与上次一致
- 当前 `mtime` 和旧 timestamp 相等

满足这些条件时才返回：

- `type: 'file_unchanged'`

这说明它不是“同一路径都 dedup”，而是：

- 同一路径
- 同一读取窗口
- 同一磁盘版本

三者同时成立时，才允许把先前上下文里的 full content 复用掉。

## 12. `file_unchanged` 的产品目标不是省 I/O，而是省后续 turns 的 cache-creation tokens

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/UI.tsx)

注释写得很明确：

- earlier Read `tool_result` is still in context
- two full copies waste cache_creation tokens

所以 dedup 的核心收益不是：

- 少一次读磁盘

而是：

- 避免同一段内容在 transcript 里重复出现
- 降低后续轮次 prompt/caching 成本

UI 也刻意把它压成：

- `Unchanged since last read`

说明这是一条以“上下文去重”为第一目标的协议，而不是用户可见功能卖点。

## 13. text 路径的主结果也不是裸文件内容，而是三层 sidecar 拼起来的字符串

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/limits.ts)

`text` mapper 真正拼的是：

- `memoryFileFreshnessPrefix(data)`
- `formatFileLines(data.file)`
- `CYBER_RISK_MITIGATION_REMINDER`（按模型 gate）

也就是说，模型实际拿到的文本 read result 不是：

- 原文

而是：

- 可能有一段 freshness prefix
- 正式加过行号的正文
- 可能再附一段 system-reminder

这是一条带治理语义的文本协议。

## 14. `memoryFileFreshnessPrefix(...)` 是 presentation-only side channel，不污染 schema

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts)

auto-memory 文件在 text 路径里会：

- `memoryFileMtimes.set(data, mtimeMs)`

后面 mapper 再通过：

- `memoryFileFreshnessPrefix(data)`

把 freshness note 拼回去。

这里专门用了：

- `WeakMap<object, number>`

源码注释也写明原因：

- 不想把 presentation-only 字段塞进 output schema
- 不想让 SDK 类型面跟着膨胀

这是一条很典型的 Claude Code 运行时设计：需要附加显示语义，但不愿污染正式工具协议，就走对象身份 side channel。

## 15. 文本读取默认还会强插一段 cyber-risk mitigation reminder，而且它不是 UI 文案

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/UI.tsx)

`CYBER_RISK_MITIGATION_REMINDER` 是直接拼进 model-facing `tool_result` 的：

- `<system-reminder> ... analyze malware but must refuse to improve it ... </system-reminder>`

而 UI 的 `renderToolResultMessage(...)` 仍只显示：

- `Read N lines`

这意味着这段 reminder 的消费者不是 operator，而是模型本身。它是一条“读文件时顺手补上的安全 steering”，不是前台提示。

## 16. 这条 mitigation 也不是绝对开启，而是按主模型 canonical name 做 runtime 豁免

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/limits.ts)

gate 很直接：

- `MITIGATION_EXEMPT_MODELS = new Set(['claude-opus-4-6'])`
- `shouldIncludeFileReadMitigation()`

这说明同一个 `Read` 协议在不同主模型下并非完全一致：

- 大多数模型 -> 文本 read 自动补 mitigation
- 某些豁免模型 -> 不补

所以 `FileReadTool` 的结果面并不是一个完全静态的 schema-to-string 映射，而是带模型感知的 runtime 变体。

## 17. `limits.ts` 里的双上限模型解释了为什么 text 和 image/PDF 读法会明显分岔

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/limits.ts`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts)

`limits.ts` 明确区分两种 cap：

- `maxSizeBytes`
- `maxTokens`

并说明默认语义是：

- `maxSizeBytes` 先挡 total file size
- `maxTokens` 再挡最终输出 token

这正好解释了分岔：

- text 路径要走 `readFileInRange(..., maxSizeBytes)` 再 `validateContentTokens(...)`
- image 路径直接围绕 token-budget 压缩
- PDF 路径则大多绕开纯文本 token 化，走 `document/image` supplemental block 协议

所以 `FileReadTool` 的非-notebook 分叉，本质上是在不同媒体类型上选择不同的预算执行模型。

## 18. `newMessages` 才是这条工具链最关键的隐藏骨架：主结果做 receipt，sidecar 才承载富内容

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/UI.tsx)

把 image、PDF、parts 三条路径放在一起看，会看到同一个结构：

- image
  - 主 `tool_result` = image block
  - sidecar = metadata text
- full PDF
  - 主 `tool_result` = receipt string
  - sidecar = `document` block
- page-extracted PDF
  - 主 `tool_result` = receipt string
  - sidecar = extracted page image blocks

也就是说，`Read` 工具的真正结果面不是只有 `tool_result`，而是：

- `data`
- `mapToolResultToToolResultBlockParam(...)`
- `newMessages`

三层共同组成的内容协议。

## 19. 前台 UI 刻意把这整套多媒体复杂度压扁成“单行读取摘要”

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/UI.tsx`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts)

`UI.tsx` 对五种非-notebook 类型统一采取摘要式渲染：

- image -> `Read image (SIZE)`
- pdf -> `Read PDF (SIZE)`
- parts -> `Read N pages (SIZE)`
- text -> `Read N lines`
- file_unchanged -> `Unchanged since last read`

这说明 Claude Code 对 `Read` 的产品分层非常稳定：

- transcript/console 给 operator 看简摘要
- model-facing runtime 走富内容协议

也因此，如果只看 UI，很容易低估 `FileReadTool` 背后实际已经分成了多套不同的媒体读法。
