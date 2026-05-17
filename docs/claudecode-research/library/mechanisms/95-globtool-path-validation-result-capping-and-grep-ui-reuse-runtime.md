# GlobTool / Path Validation / Result Capping / Grep UI Reuse Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：GrepTool / Ripgrep Arg Synthesis / Ignore Merging / Pagination Runtime`](./94-greptool-ripgrep-arg-synthesis-ignore-merging-and-pagination-runtime.md) | [`下一站：FileRead / Grep / WebSearch Runtime`](./32-file-read-grep-and-websearch-runtime.md)

本文把 `GlobTool` 从 `13` 和 `32` 的总述里单独抽出来，专门讲它自己的工具级运行时。相邻卷册已经覆盖了：

- [`13`](./13-ask-user-glob-and-semi-visible-tools.md)：`Glob` 的权限接缝与半显式工具总述
- [`32`](./32-file-read-grep-and-websearch-runtime.md)：`FileRead / Grep / WebSearch` 的总述
- [`94`](./94-greptool-ripgrep-arg-synthesis-ignore-merging-and-pagination-runtime.md)：`GrepTool` 的单工具 runtime

而这篇只讲 `GlobTool` 自己的几条主链：

- directory-only validate 与 UNC 特判
- `glob(...)` 调度与 `globLimits.maxResults`
- `truncated` 结果协议
- 相对路径节流
- UI 对 `GrepTool` 骨架的直接复用

## 1. `GlobTool` 的定位不是内容搜索，而是纯路径空间枚举

源码镜像：[`../../src/tools/GlobTool/prompt.ts`](../../src/tools/GlobTool/prompt.ts), [`../../src/tools/GlobTool/GlobTool.ts`](../../src/tools/GlobTool/GlobTool.ts)

`prompt.ts` 给它的定义非常直接：

- `Fast file pattern matching tool`
- `Returns matching file paths`
- `When ... require multiple rounds of globbing and grepping, use the Agent tool instead`

这说明 `GlobTool` 在 Claude Code 里的角色不是 `GrepTool` 的轻量版，而是：

- 只负责找路径
- 不负责读内容
- 更不负责 open-ended 多轮搜索编排

它是路径空间搜索 appliance，而不是语义搜索器。

## 2. 输入 schema 极小，说明这把工具刻意避免把自己做成 `Grep` 的另一种壳

源码镜像：[`../../src/tools/GlobTool/GlobTool.ts`](../../src/tools/GlobTool/GlobTool.ts)

`GlobTool` 只有两个正式输入：

- `pattern`
- `path`

没有：

- `type`
- `head_limit`
- `offset`
- `output_mode`
- context lines

这说明它不是把 `ripgrep`/`find` 的各种开关重新包装一遍，而是非常刻意地把能力边界收窄成：

- 在某个目录下，用 glob pattern 找文件路径

## 3. `validateInput(...)` 的核心语义是“如果给了 path，它必须存在且必须是目录”

源码镜像：[`../../src/tools/GlobTool/GlobTool.ts`](../../src/tools/GlobTool/GlobTool.ts)

`GlobTool` 的 validate 层只有一条主线：

1. 如果没给 `path`
   - 直接默认 `cwd`
2. 如果给了 `path`
   - `expandPath(path)`
   - `stat(...)`
   - 不存在 -> cwd-aware miss
   - 存在但不是目录 -> `Path is not a directory`

所以这把工具对 `path` 的要求比 `Read`/`Grep` 更硬：

- `Read` 可以读文件
- `Grep` 可以对文件或目录做搜索
- `Glob` 的 `path` 必须是目录根

## 4. UNC 特判和 `GrepTool` / `FileReadTool` 保持同一宿主安全边界

源码镜像：[`../../src/tools/GlobTool/GlobTool.ts`](../../src/tools/GlobTool/GlobTool.ts)

validate 里也保留了同类注释：

- `SECURITY: Skip filesystem operations for UNC paths to prevent NTLM credential leaks.`

命中条件依旧是：

- `absolutePath.startsWith('\\\\') || absolutePath.startsWith('//')`

命中后直接：

- `return { result: true }`

这说明 `GlobTool` 和 `Read` / `Grep` 一样，都会在 validate 阶段避免对 UNC path 做任何实际 I/O，把后续决定交给 permission/runtime 层。

## 5. 路径不存在时，它同样走 cwd-aware 的友好 miss 协议，但文案明确改成 directory 语义

源码镜像：[`../../src/tools/GlobTool/GlobTool.ts`](../../src/utils/file.ts)

`ENOENT` 时返回的不是 `Path does not exist`，而是：

- `Directory does not exist: ...`

并且同样会补：

- `FILE_NOT_FOUND_CWD_NOTE`
- `suggestPathUnderCwd(...)`

所以 `GlobTool` 复用了同一套 cwd-aware 恢复策略，但保留了自己的目录语义，不把 file-miss 和 dir-miss 混成一种错误。

## 6. `GlobTool` 的执行核心其实很短：它把复杂性下沉到共享 `glob(...)` helper

源码镜像：[`../../src/tools/GlobTool/GlobTool.ts`](../../src/utils/glob.ts)

`call(...)` 里真正的核心调用只有：

- `glob(input.pattern, GlobTool.getPath(input), { limit, offset: 0 }, abortController.signal, appState.toolPermissionContext)`

也就是说这把工具的大部分复杂性并不在本文件里，而是被折叠成：

- 一层路径/权限前置
- 一次共享 `glob(...)` 调用
- 一层结果整形

这和 `GrepTool` 在本文件内部自己大规模编译 rg args 很不一样。

## 7. `globLimits.maxResults` 才是这把工具的正式预算入口，不暴露给模型做任意分页控制

源码镜像：[`../../src/tools/GlobTool/GlobTool.ts`](../../src/Tool.ts)

`call(...)` 里先取：

- `const limit = globLimits?.maxResults ?? 100`

然后直接传给共享 `glob(...)` helper。

这说明 `GlobTool` 的结果预算和 `GrepTool` 的 `head_limit` 很不一样：

- `GrepTool` 允许模型显式调 `head_limit/offset`
- `GlobTool` 的结果上限来自宿主 `globLimits`
- 模型自己拿不到分页旋钮

所以 `Glob` 更像一把被宿主强限流的路径枚举器。

## 8. 它的 `truncated` 不是 UI 推测，而是执行层从 `glob(...)` helper 正式回传的结果位

源码镜像：[`../../src/tools/GlobTool/GlobTool.ts`](../../src/utils/glob.ts)

`glob(...)` 回来就是：

- `{ files, truncated }`

而 `GlobTool` 只负责把这个状态原样挂进 output schema。

这说明 `truncated` 不是“如果结果太多就猜测一下”，而是一条正式执行语义：

- helper 明确知道是否超过上限
- 工具再把这个状态编码给模型和前台

## 9. 和 `GrepTool` 一样，它也会把绝对路径立刻转成相对路径来节流 token

源码镜像：[`../../src/tools/GlobTool/GlobTool.ts`](../../src/tools/GrepTool/GrepTool.ts)

结果出来后第一步就是：

- `const filenames = files.map(toRelativePath)`

注释也直说：

- `same as GrepTool`

所以这条路径节流策略在本地搜索工具家族里已经形成一致风格：

- 执行层可以看绝对路径
- 返回给模型时尽量压成相对路径

## 10. `numFiles` 代表的是“实际返回条数”，不是“真实全量命中数”

源码镜像：[`../../src/tools/GlobTool/GlobTool.ts`](../../src/tools/GlobTool/GlobTool.ts)

输出里：

- `numFiles: filenames.length`

而不是某个“total matches before truncation”的全量值。

再配合：

- `truncated: true/false`

可以看出它的结果协议是：

- 告诉模型当前看到了多少条
- 再告诉它这是不是被截断后的窗口

而不是给出一个完整可分页总数模型。

## 11. `mapToolResultToToolResultBlockParam(...)` 很薄，强调的是路径列表本身，而不是额外 summary chrome

源码镜像：[`../../src/tools/GlobTool/GlobTool.ts`](../../src/tools/GlobTool/GlobTool.ts)

model-facing result 分两种：

- 0 条 -> `No files found`
- 否则 -> `filenames.join('\n')`

如果 `truncated` 再额外补一句：

- `(Results are truncated. Consider using a more specific path or pattern.)`

这和 `GrepTool` 很不同。`Grep` 会补：

- `Found N files`
- `Found X matches across Y files`

而 `Glob` 更接近纯净路径清单协议。

## 12. 这也解释了为什么 `extractSearchText(...)` 只返回 `filenames.join('\n')`

源码镜像：[`../../src/tools/GlobTool/GlobTool.ts`](../../src/tools/GlobTool/UI.tsx)

注释里已经写明：

- `durationMs/numFiles are chrome`

真正给搜索索引/后续抽取的只有：

- 文件名列表本身

所以对 `GlobTool` 而言，`durationMs`、`numFiles`、`truncated` 这些都被视为：

- operator/runtime metadata

而不是模型真正需要继续推理的正文。

## 13. UI 不是自己再做一套 summary，而是直接复用 `GrepTool.renderToolResultMessage`

源码镜像：[`../../src/tools/GlobTool/UI.tsx`](../../src/tools/GrepTool/UI.tsx)

`UI.tsx` 里直接写死：

- `export const renderToolResultMessage = GrepTool.renderToolResultMessage`

这说明 `Glob` 在前台层根本没有单独的结果骨架，而是明确借用了 `Grep` 的：

- `SearchResultSummary`
- verbose/condensed 双态
- `Ctrl+O` expand affordance

所以这两把工具在 UI 上已经被故意收敛成一个家族。

## 14. 但 tool-use message 和 user-facing naming 仍保持了 `Glob` 自己的极简语义

源码镜像：[`../../src/tools/GlobTool/UI.tsx`](../../src/tools/GlobTool/UI.tsx)

尽管结果面复用 `Grep`，`Glob` 自己仍保留了：

- `userFacingName() -> 'Search'`
- `renderToolUseMessage(pattern, path)`

而且文案比 `Grep` 更简单：

- 只有 `pattern`
- 以及可选 `path`

没有 `type/output_mode/context` 那一整套视图参数。

这再次强调 `Glob` 的角色是：

- 路径空间过滤器

而不是复杂的内容搜索视图。

## 15. 错误 UI 也复用同一类 cwd-note 检测，但把普通失败压成更宽泛的 `Error searching files`

源码镜像：[`../../src/tools/GlobTool/UI.tsx`](../../src/tools/GrepTool/UI.tsx)

逻辑和 `GrepTool` 基本平行：

- error string 里有 `FILE_NOT_FOUND_CWD_NOTE` -> `File not found`
- 否则 -> `Error searching files`

这说明 `Glob` 和 `Grep` 在 operator-facing error surface 上也被有意收束到一套共同语言。

## 16. 把 `GlobTool` 和 `GrepTool` 并排看，Claude Code 把“搜索”拆成了两把协同工具，而不是一把全能工具

源码镜像：[`../../src/tools/GlobTool/GlobTool.ts`](../../src/tools/GrepTool/GrepTool.ts)

两者的边界非常清楚：

- `Glob`
  - 搜文件名/路径空间
  - 预算由宿主 `globLimits` 管
  - 结果是路径列表
- `Grep`
  - 搜文件内容
  - 参数更丰富
  - 支持 mode/context/pagination/ranking

而 UI、cwd-aware miss、relative-path 节流这些则被尽量统一。

所以 Claude Code 的本地搜索工具家族不是一把复杂搜索器，而是：

- 一把做 path-space 枚举
- 一把做 content-space 搜索

两把能力边界清楚、前台骨架相似的协同工具。
