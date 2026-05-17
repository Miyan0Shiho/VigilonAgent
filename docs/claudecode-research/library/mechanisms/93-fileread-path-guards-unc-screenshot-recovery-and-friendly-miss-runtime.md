# FileRead Path Guards / UNC / Screenshot Recovery / Friendly Miss Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：FileRead Skill Triggers / Memory Freshness / Session Analytics Sidecars`](./92-fileread-skill-triggers-memory-freshness-and-session-analytics-sidecars.md) | [`下一站：GrepTool / Ripgrep Arg Synthesis / Ignore Merging / Pagination Runtime`](./94-greptool-ripgrep-arg-synthesis-ignore-merging-and-pagination-runtime.md)

本文继续顺着 `FileReadTool` 往下拆，但这次只讲路径与错误恢复这条边缘运行时。相邻卷册已经覆盖了：

- [`91`](./91-fileread-image-pdf-dedup-and-supplemental-block-runtime.md)：image / PDF / dedup / supplemental block
- [`92`](./92-fileread-skill-triggers-memory-freshness-and-session-analytics-sidecars.md)：skills/memory/session sidecars

而这篇只讲剩下这条 guard/recovery 主链：

- `validateInput(...)` 的 path-only safety gates
- UNC path 的 permission-first 特判
- binary / media / PDF 分流边界
- blocked device path 阻断
- macOS screenshot alternate-space 恢复
- ENOENT 的 cwd-aware 友好报错

## 1. `FileReadTool` 的第一层防线不是 stat/read，而是一组纯路径判定

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts)

`validateInput(...)` 的注释非常一致地强调：

- `pure string parsing, no I/O`
- `Path expansion + deny rule check (no I/O)`
- `UNC path check (no I/O)`
- `Binary extension check ... no I/O`

这说明 `Read` 在 Claude Code 里的安全设计不是“先碰文件，再决定能不能读”，而是：

- 先尽可能只靠路径字符串做前置分流
- 把真正的文件系统接触推迟到 permission / guard 之后

## 2. `expandPath(...)` 不是小清洗，而是整个 guard 链的 canonical path 起点

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts)

`validateInput(...)` 一上来就做：

- `const fullFilePath = expandPath(file_path)`

配套注释写得也很明确：

- consistent path normalization with FileEditTool/FileWriteTool
- handles whitespace trimming and Windows path separators

所以后面的所有判断：

- deny rule
- UNC
- binary extension
- blocked device path

都不是基于用户原始输入，而是基于一份统一归一化后的 canonical path。

## 3. deny rule 在 `Read` 里是最先执行的策略 gate，优先级高于格式/media 判定

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/utils/permissions/filesystem.ts)

路径归一化后，第一件事是：

- `matchingRuleForInput(fullFilePath, ..., 'read', 'deny')`

只要命中 deny rule，就直接返回：

- `File is in a directory that is denied by your permission settings.`

而不会继续走：

- UNC 检查
- 二进制扩展名判断
- device file 判断

这说明 `Read` 的整体优先级是：

- 先看策略是否允许进入这个路径空间
- 再看这个路径指向的对象是否适合读

## 4. UNC path 是一个专门的安全特判，目的不是拒绝，而是把 permission 提前到任何 I/O 之前

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/utils/permissions/filesystem.ts)

代码和注释都写得很重：

- `SECURITY: UNC path check`
- `defer filesystem operations until after user grants permission`
- `prevent NTLM credential leaks`

命中条件是：

- `fullFilePath.startsWith('\\\\') || fullFilePath.startsWith('//')`

命中后 `validateInput(...)` 并不拒绝，而是直接：

- `return { result: true }`

这不是“放行所有 UNC”，而是：

- 不在 validate 阶段做任何会触网/触 SMB 的 I/O
- 让后面的正式 permission 机制先接管

所以这是一个典型的 permission-first 安全分流。

## 5. binary extension gate 不是“禁止非文本”，而是把 PDF 和 image 明确保留给本工具的原生媒体路径

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/constants/files.ts)

二进制 gate 的条件是：

- `hasBinaryExtension(fullFilePath)`
- 且不是 `isPDFExtension(ext)`
- 且不是 `IMAGE_EXTENSIONS`

也就是说这里真正拒绝的是：

- 其他通用 binary 文件

而明确保留给 `Read` 自己处理的是：

- PDF
- png/jpg/jpeg/gif/webp

这说明 `FileReadTool` 的“二进制禁读”并不是一个绝对命题，而是：

- 只拒绝它没有专门 runtime 的 binary 类型
- 对有专门协议的媒体类型走原生分支

## 6. 注释里特意提到 SVG 被排除在“binary”之外，说明 `Read` 把它当普通文本/标记语言看待

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/constants/files.ts)

binary gate 的注释说：

- `PDF, images, and SVG are excluded - this tool renders them natively.`

但代码里的 `IMAGE_EXTENSIONS` 并没有 `svg`。这说明这里的设计意图是：

- SVG 不走 generic binary reject
- 也不走 raster image runtime
- 更像是仍然被当作可读文本/markup 资产

所以 `Read` 在媒体边界上的实际划分不是“image vs text”，而是至少三类：

- raster image
- PDF
- SVG/textual asset

## 7. device-path guard 是纯路径黑名单，目标是防“无穷输出”与“阻塞输入”

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts)

`BLOCKED_DEVICE_PATHS` 明确分了三类：

- infinite output
  - `/dev/zero`
  - `/dev/random`
  - `/dev/urandom`
  - `/dev/full`
- blocks waiting for input
  - `/dev/stdin`
  - `/dev/tty`
  - `/dev/console`
- nonsensical to read
  - `/dev/stdout`
  - `/dev/stderr`
  - `/dev/fd/0-2`

注释也强调：

- checked by path only
- safe devices like `/dev/null` are intentionally omitted

也就是说这不是“所有 `/dev/*` 一律拒绝”，而是一个非常有意图的最小危险黑名单。

## 8. Linux `/proc/.../fd/0-2` 也被并入同一条 guard，说明这层不是按平台分叉，而是按语义同类归并

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts)

`isBlockedDevicePath(...)` 除了直接查 set，还额外判断：

- `/proc/self/fd/0-2`
- `/proc/<pid>/fd/0-2`

注释把它解释为：

- Linux aliases for stdio

这说明这条 guard 的设计核心不是“拦哪些固定路径”，而是：

- 识别所有会映射到 stdio / blocking stream / infinite stream 的语义等价路径

## 9. macOS screenshot alternate-path 恢复不是泛化 fuzzy match，而是只修“AM/PM 前空格字符不同”的单一系统兼容问题

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts)

这里有一个非常具体的兼容器：

- `THIN_SPACE = U+202F`
- `getAlternateScreenshotPath(filePath)`

它只处理一种模式：

- 文件名里 `AM`/`PM` 前那一个空格
- 可能是普通空格
- 也可能是 narrow no-break space

所以这不是通用文件名模糊匹配，而是针对：

- 某些 macOS 版本 screenshot naming 差异

做的单点修复。

## 10. 这条 screenshot 恢复链只在 `ENOENT` 时才触发，而且先试 alternate path，再决定是否进入友好 miss 文案

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts)

外层 `call(...)` 捕获 `ENOENT` 后，顺序是：

1. 先 `getAlternateScreenshotPath(fullFilePath)`
2. 如果有 alternate path，就重新 `callInner(...)`
3. 只有 alternate path 也还是 `ENOENT`
4. 才继续进入 friendly error builder

所以对这类 macOS screenshot，运行时优先级是：

- 先默默纠正宿主兼容问题
- 修不好才把“文件没找到”暴露给用户/模型

## 11. `ENOENT` 的最终报错也不是裸异常，而是一条带 cwd 上下文和路径建议的恢复性 receipt

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/utils/file.ts)

alternate screenshot 路径失败后，才会去算：

- `findSimilarFile(fullFilePath)`
- `suggestPathUnderCwd(fullFilePath)`

然后构造：

- `File does not exist. ... Current working directory ...`
- `Did you mean <cwdSuggestion>?`
- 或 `Did you mean <similarFilename>?`

所以 `Read` 的 miss 语义不是“抛一个系统 errno”，而是：

- 先告诉你当前 cwd
- 再尽量给出 repo 内的路径恢复建议

## 12. `cwdSuggestion` 优先于 `similarFilename`，说明恢复策略更偏“你是不是少写了 cwd 前缀/相对根”而不是“拼写有点像”

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/utils/file.ts)

拼接逻辑是：

- 如果有 `cwdSuggestion`，先用它
- 否则才退到 `similarFilename`

这说明作者认为最常见的 miss 不是：

- 单纯拼错文件名

而是：

- 路径不在当前工作区根下
- 用户/模型搞错了 cwd-relative 位置

所以恢复策略优先强调 working-directory framing。

## 13. `renderToolUseErrorMessage(...)` 也专门认识这条 cwd-aware miss 协议，并把它压成前台 `File not found`

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/UI.tsx`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts)

UI 里有个专门分支：

- raw string contains `FILE_NOT_FOUND_CWD_NOTE`
- 直接渲染 `File not found`

注释还专门解释：

- `FileReadTool throws from call() so errors lack <tool_use_error> wrapping`

这说明 `Read` 的这条友好 miss 协议不仅是后端错误文案，还已经被前台 UI 当成一种正式 error shape 识别。

## 14. 把这些 guard 串起来看，`FileReadTool` 的 path/runtime 边界是“先做安全路径分类，再做媒体分类，最后才做真实读取”

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/UI.tsx)

顺序大致可以收束成：

1. `expandPath(...)`
2. deny rule
3. UNC 特判
4. binary/media 分流
5. blocked device path
6. 真正进入读流程
7. 若 `ENOENT`，先试 screenshot alternate-path
8. 再给 cwd-aware 恢复建议

这说明 `FileReadTool` 的边缘运行时并不是一堆零散 if-else，而是一条结构很稳定的 path-governance pipeline。

## 15. 这也解释了为什么 `Read` 在 Claude Code 里已经不是“内容工具”，而是半个宿主兼容层

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/constants/files.ts)

如果只看主结果协议，`Read` 像一个内容摄取工具；但把这篇和 `91/92` 放在一起看，会发现它还承担了很多宿主层职责：

- Windows/UNC 安全前置
- Linux device/stdio 防挂死
- macOS screenshot 文件名兼容
- cwd-aware 友好 miss 恢复
- binary/media 类型分流

所以 `FileReadTool` 在 Claude Code 里其实已经部分承担了：

- host compatibility adapter
- path safety classifier
- operator recovery assistant

这也正是为什么它值得被拆成多卷，而不是留在“Read 工具总述”里一笔带过。
