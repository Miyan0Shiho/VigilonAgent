# GrepTool / Ripgrep Arg Synthesis / Ignore Merging / Pagination Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：FileRead Path Guards / UNC / Screenshot Recovery / Friendly Miss Runtime`](./93-fileread-path-guards-unc-screenshot-recovery-and-friendly-miss-runtime.md) | [`下一站：GlobTool / Path Validation / Result Capping / Grep UI Reuse Runtime`](./95-globtool-path-validation-result-capping-and-grep-ui-reuse-runtime.md)

本文把 `GrepTool` 从 `32` 的读搜总述里单独抽出来，专门讲它自己的工具级运行时。相邻卷册已经覆盖了：

- [`32`](./32-file-read-grep-and-websearch-runtime.md)：`FileRead / Grep / WebSearch` 的总述
- [`93`](./93-fileread-path-guards-unc-screenshot-recovery-and-friendly-miss-runtime.md)：`FileReadTool` 的 path/runtime guard

而这篇只讲 `GrepTool` 自己的几条实现链：

- ripgrep 参数组装
- ignore / exclusion 合成
- `content / files_with_matches / count` 三种输出协议
- `head_limit + offset` 分页窗口
- UI summary 与 model-facing result 的分层

## 1. `GrepTool` 不是 Bash 包装器，而是强约束的 ripgrep runtime

源码镜像：[`../../src/tools/GrepTool/prompt.ts`](../../src/tools/GrepTool/prompt.ts), [`../../src/tools/GrepTool/GrepTool.ts`](../../src/tools/GrepTool/GrepTool.ts)

`prompt.ts` 里先把产品契约写死了：

- `ALWAYS use Grep for search tasks`
- `NEVER invoke grep or rg as a Bash command`

这不是提示词装饰，而是 Claude Code 对“内容搜索”这类动作的正式分工：

- shell 里的 `rg` 不再被视为一等搜索面
- 统一走 `GrepTool`
- 从而强行纳入 permissions、ignore、pagination、UI chrome 这些治理层

## 2. 输入 schema 的核心不是 `pattern + path`，而是一整套“搜索视图配置”

源码镜像：[`../../src/tools/GrepTool/GrepTool.ts`](../../src/tools/GrepTool/GrepTool.ts)

`GrepTool` 的 schema 除了基本的：

- `pattern`
- `path`

还显式暴露了：

- `glob`
- `type`
- `output_mode`
- `-A/-B/-C/context`
- `-n`
- `-i`
- `head_limit`
- `offset`
- `multiline`

这说明 `GrepTool` 在 Claude Code 里的抽象不是“搜一下”，而是：

- 用结构化参数声明一份 ripgrep 视图

也因此后面的 runtime 大部分工作其实都在把这组结构化输入稳定地编译成 rg args。

## 3. `validateInput(...)` 很薄，但仍然保留了 path-exists 与 UNC 特判

源码镜像：[`../../src/tools/GrepTool/GrepTool.ts`](../../src/tools/GrepTool/GrepTool.ts)

如果用户提供了 `path`，验证层只做两件事：

1. `expandPath(path)`
2. `fs.stat(absolutePath)`

但这里也保留了和 `FileReadTool` 同类的安全分流：

- UNC path 直接 `return { result: true }`
- 不在 validate 阶段做任何可能触发 NTLM/网络副作用的访问

所以 `GrepTool` 的 path guard 明显比 `Read` 更薄，但宿主级安全边界是一致的。

## 4. 路径不存在时，它也复用了 cwd-aware 的友好 miss 协议

源码镜像：[`../../src/tools/GrepTool/GrepTool.ts`](../../src/utils/file.ts)

`stat(...)` 命中 `ENOENT` 后，不是直接报：

- `ENOENT`

而是：

- `Path does not exist: ...`
- 带 `FILE_NOT_FOUND_CWD_NOTE`
- 再补 `suggestPathUnderCwd(...)`

这和 `FileReadTool` 的 miss 协议保持了一致的产品面：优先把错误改写成 cwd-aware 的恢复性提示。

## 5. 真正的执行核心是一条“从结构化字段稳定编译到 rg args”的流水线

源码镜像：[`../../src/tools/GrepTool/GrepTool.ts`](../../src/tools/GrepTool/GrepTool.ts)

`call(...)` 里一开始就进入：

- `const args = ['--hidden']`

然后按固定顺序逐层拼参数：

- VCS exclusions
- `--max-columns 500`
- multiline flags
- case-insensitive
- output mode flags
- line numbers
- context flags
- pattern 本体
- type filter
- glob filters
- ignore patterns
- plugin cache exclusions

所以 `GrepTool` 的稳定性很大程度上来自这条参数合成顺序，而不是 `ripGrep(...)` 自己。

## 6. `--hidden` 是默认开启的，说明 Claude Code 搜索默认不以“尊重 shell 习惯”为第一目标

源码镜像：[`../../src/tools/GrepTool/GrepTool.ts`](../../src/tools/GrepTool/prompt.ts)

args 起手就是：

- `--hidden`

这说明默认策略不是“像终端里那样顺手忽略点文件”，而是：

- 先尽量覆盖 repo 真相面
- 再靠后面的 ignore / exclusion / permission layer 去减噪

也就是先扩大可见面，再做治理，而不是一开始就按传统 shell 习惯收窄。

## 7. VCS 目录排除是硬编码的第一层降噪，不依赖 gitignore 或 permission rules

源码镜像：[`../../src/tools/GrepTool/GrepTool.ts`](../../src/tools/GrepTool/GrepTool.ts)

一上来就会对这些目录补：

- `.git`
- `.svn`
- `.hg`
- `.bzr`
- `.jj`
- `.sl`

而且方式是固定的：

- `--glob !<dir>`

这说明版本控制元数据目录在 `GrepTool` 里被视为一种结构性噪音，不需要等用户/模型自己写 ignore。

## 8. `--max-columns 500` 把超长行压断，说明这把工具默认是“给模型看”而不是“给人原样看”

源码镜像：[`../../src/tools/GrepTool/GrepTool.ts`](../../src/tools/GrepTool/UI.tsx)

代码里明确注释：

- `Limit line length to prevent base64/minified content from cluttering output`

所以 `GrepTool` 的内容模式并不追求原样保真，而是主动做：

- 长行裁剪
- 结果上下文保真优先

这是一条非常模型导向的默认：宁可少一点原始内容，也不要让 base64/minified 垃圾吞掉上下文。

## 9. multiline 不是默认打开，而是一个显式昂贵开关

源码镜像：[`../../src/tools/GrepTool/GrepTool.ts`](../../src/tools/GrepTool/prompt.ts)

只有 `multiline: true` 时才会补：

- `-U`
- `--multiline-dotall`

这意味着默认模式下：

- pattern 只在单行内匹配

而跨行结构搜索被视为一个要显式声明的更昂贵视图，而不是普通 grep 的隐式能力。

## 10. output mode 不是 cosmetic 文案差异，而是直接改变 rg 的执行语义

源码镜像：[`../../src/tools/GrepTool/GrepTool.ts`](../../src/tools/GrepTool/UI.tsx)

三种 mode 的分叉很硬：

- `files_with_matches`
  - `-l`
- `count`
  - `-c`
- `content`
  - 保留真实匹配行

这说明它不是“同一批结果换个 render”，而是从 ripgrep 层就走了不同搜索协议：

- 文件列表协议
- 计数协议
- 内容协议

## 11. `-n` 和上下文参数只在 `content` mode 生效，显示层和执行层被刻意绑定

源码镜像：[`../../src/tools/GrepTool/GrepTool.ts`](../../src/tools/GrepTool/GrepTool.ts)

代码里明确只在：

- `output_mode === 'content'`

时处理：

- `-n`
- `-A/-B/-C/context`

这意味着这些不是“统一 schema 里所有模式都能理解的字段”，而是：

- content-mode-only 语义

`GrepTool` 通过这种显式约束，避免了模型在 `files_with_matches`/`count` 模式里幻想 context lines 的存在。

## 12. pattern 以 `-` 开头时会自动改写成 `-e pattern`，这是典型的 CLI sharp edge 收敛层

源码镜像：[`../../src/tools/GrepTool/GrepTool.ts`](../../src/tools/GrepTool/GrepTool.ts)

有一条很实用的小修复：

- `if (pattern.startsWith('-')) args.push('-e', pattern)`

目的也写清了：

- 防止 ripgrep 把 pattern 当作命令行选项

所以 `GrepTool` 在这里承担了一层 CLI sharp-edge smoothing：模型给出合法搜索意图，不需要自己知道 rg 的 option parsing 陷阱。

## 13. `glob` 的解析不是简单 split，而是显式保护 `{}` brace pattern

源码镜像：[`../../src/tools/GrepTool/GrepTool.ts`](../../src/tools/GrepTool/GrepTool.ts)

处理逻辑是：

- 先按空白切
- 但如果片段里有 `{...}`，就不再按逗号拆
- 否则再按逗号拆成多个 pattern

所以像：

- `*.{ts,tsx}`

会被保留成一个整体，而不是错误分裂成两段。这说明 `GrepTool` 在 `glob` 上也不是“原样透传”，而是做了一层能覆盖常见 brace syntax 的小编译器。

## 14. ignore 合成至少有三层：permission ignore、plugin cache exclusion、VCS exclusion

源码镜像：[`../../src/tools/GrepTool/GrepTool.ts`](../../src/utils/permissions/filesystem.ts), [`../../src/utils/plugins/orphanedPluginFilter.ts`](../../src/utils/plugins/orphanedPluginFilter.ts)

把参数组装链串起来看，ignore 至少来自：

1. 硬编码 VCS 目录排除
2. `getFileReadIgnorePatterns(...)` + `normalizePatternsToPath(...)`
3. `getGlobExclusionsForPluginCache(...)`

所以 `GrepTool` 的“忽略什么”不是单源决策，而是：

- repo 噪音
- permission/system policy
- orphaned plugin cache

三种来源叠出来的总效果。

## 15. permission ignore pattern 还要再改写成 rg 能理解的相对 glob 形式

源码镜像：[`../../src/tools/GrepTool/GrepTool.ts`](../../src/utils/permissions/filesystem.ts)

permission ignore pattern 进来后，不是直接喂给 rg，而是：

- 绝对/根式 pattern -> `!${ignorePattern}`
- 其他普通 pattern -> `!**/${ignorePattern}`

注释解释得很具体：

- ripgrep 只按 working directory 解释 gitignore patterns

所以这里做的是一层“把 permission rule 编译成 rg/glob 语义”的路径桥接。

## 16. orphaned plugin version 目录排除是单独的一层 repo hygiene，而不是 permission 逻辑的一部分

源码镜像：[`../../src/tools/GrepTool/GrepTool.ts`](../../src/utils/plugins/orphanedPluginFilter.ts)

代码单独 await：

- `getGlobExclusionsForPluginCache(absolutePath)`

再把返回值直接当 `--glob` exclusion 塞进去。

这说明 plugin cache 噪音在 Claude Code 里被认为是：

- 结构性搜索污染
- 但不属于权限规则

所以单独做成了 hygiene layer。

## 17. 分页不是 UI 层行为，而是在 runtime 里通过 `applyHeadLimit(...)` 真实裁剪结果集

源码镜像：[`../../src/tools/GrepTool/GrepTool.ts`](../../src/tools/GrepTool/UI.tsx)

`head_limit` 和 `offset` 的执行核心是：

- `applyHeadLimit(items, limit, offset)`

其语义是：

- `limit === 0` -> unbounded escape hatch
- 否则 `limit ?? DEFAULT_HEAD_LIMIT`
- 先 slice
- 只有真的发生截断时才回填 `appliedLimit`

这说明分页不是“告诉前台只显示前 N 条”，而是：

- 真正在工具输出之前就截断数据面

## 18. `DEFAULT_HEAD_LIMIT = 250` 不是随手选的值，而是上下文预算治理策略

源码镜像：[`../../src/tools/GrepTool/GrepTool.ts`](../../src/tools/GrepTool/GrepTool.ts)

注释解释了默认 250 的意图：

- broad patterns can return 10k+ lines
- 250 generous enough for exploratory searches
- prevents context bloat
- explicit `head_limit=0` 才允许不受限

所以 `GrepTool` 的默认分页不是 UX 细节，而是一条明确的 context-governance policy。

## 19. `content` 与 `count` 模式会在裁剪之后才把绝对路径转成相对路径，避免浪费每行处理成本

源码镜像：[`../../src/tools/GrepTool/GrepTool.ts`](../../src/tools/GrepTool/GrepTool.ts)

代码里专门解释了顺序：

- 先 `applyHeadLimit(...)`
- 再 relativize

原因也写得很清楚：

- relativize is per-line work
- 不要处理那些最终会被丢弃的行

这说明 `GrepTool` 的分页和路径压缩不只是产品语义，还有明显的运行时成本优化。

## 20. `files_with_matches` 模式还会先按 mtime 排序，再分页，而不是原样返回 rg 顺序

源码镜像：[`../../src/tools/GrepTool/GrepTool.ts`](../../src/tools/GrepTool/GrepTool.ts)

默认模式里会：

1. 对每个匹配文件 `stat(...)`
2. 取 `mtimeMs`
3. 按新到旧排序
4. 同时间戳再按文件名稳定排序
5. 最后才 `applyHeadLimit(...)`

所以默认文件列表模式的语义其实是：

- “最新修改的匹配文件优先”

而不是：

- rg 扫描顺序
- 字典序

## 21. `Promise.allSettled(stat)` 说明作者明确在防“rg 看见了，stat 时文件刚消失”这种竞争条件

源码镜像：[`../../src/tools/GrepTool/GrepTool.ts`](../../src/tools/GrepTool/GrepTool.ts)

代码注释直接说了：

- a single ENOENT should not reject the whole batch
- failed stats sort as `mtime 0`

所以这里不是假设结果集稳定，而是承认搜索和排序之间存在文件系统竞态，并把它降级成：

- 排序质量下降
- 但工具整体仍然成功

## 22. `count` 模式不是只把 rg 输出透传回来，它还额外再汇总总命中数与文件数

源码镜像：[`../../src/tools/GrepTool/GrepTool.ts`](../../src/tools/GrepTool/UI.tsx)

`count` 路径除了保留：

- `filename:count`

还会自己再 parse 一遍，算出：

- `totalMatches`
- `fileCount`

最后在 mapper 里补：

- `Found X total occurrences across Y files`

所以 `count` 不是“让 rg 完整决定呈现”，而是：

- 底层输出 + Claude Code 自己的 summary chrome

双层协议。

## 23. `content` / `count` / `files_with_matches` 三种 tool-result 文案是专门不同的，而不是一个模板换字段

源码镜像：[`../../src/tools/GrepTool/GrepTool.ts`](../../src/tools/GrepTool/UI.tsx)

mapper 层三路分叉：

- `content`
  - 直接返回内容文本
  - 可附 `Showing results with pagination = ...`
- `count`
  - 返回 `filename:count` 列表
  - 再补 total summary
- `files_with_matches`
  - `Found N files`
  - 再拼文件名列表

也就是说，这三种模式从结果文本协议开始就是不同产品面，不只是 UI summary 不同。

## 24. UI 层也故意把三种模式压成统一的 `SearchResultSummary` 骨架

源码镜像：[`../../src/tools/GrepTool/UI.tsx`](../../src/tools/GrepTool/UI.tsx)

尽管 model-facing result 差异很大，前台还是统一走：

- `SearchResultSummary`

只是在参数上切换：

- `lines`
- `matches across files`
- `files`

非 verbose 时还统一挂：

- `CtrlOToExpand`

所以 `GrepTool` 的整体分层很清楚：

- 执行层按 mode 强分叉
- UI 层尽量用同一骨架做 operator chrome

## 25. 把这一卷和 `32` 对照看，`GrepTool` 的真正职责是“把危险/嘈杂/无界的 rg 变成 permission-aware、paged、token-conscious search appliance”

源码镜像：[`../../src/tools/GrepTool/GrepTool.ts`](../../src/tools/GrepTool/prompt.ts)

如果只看表面，`GrepTool` 像是把 `rg` 套进工具；但把整条链拆开后可以看到它实际多做了很多事：

- path validation 与 UNC 特判
- ignore/source 合成
- plugin cache hygiene
- mode-specific arg synthesis
- default pagination
- relative-path token 压缩
- mtime-based ranking
- UI summary 统一骨架

所以 `GrepTool` 在 Claude Code 里不是 shell `rg` 的镜像，而是一个已经被产品化、治理化的搜索 appliance。
