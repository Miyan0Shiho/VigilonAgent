# FileRead Skill Triggers / Memory Freshness / Session Analytics Sidecars

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：FileRead Image / PDF / Dedup / Supplemental Block Runtime`](./91-fileread-image-pdf-dedup-and-supplemental-block-runtime.md) | [`下一站：FileRead Path Guards / UNC / Screenshot Recovery / Friendly Miss Runtime`](./93-fileread-path-guards-unc-screenshot-recovery-and-friendly-miss-runtime.md)

本文继续顺着 `FileReadTool` 往下拆，但不再讲媒体结果协议，而是专门讲读文件时顺手挂上的几条 sidecar runtime。相邻卷册已经覆盖了：

- [`32`](./32-file-read-grep-and-websearch-runtime.md)：`FileReadTool` 的总述
- [`91`](./91-fileread-image-pdf-dedup-and-supplemental-block-runtime.md)：image / PDF / dedup / supplemental block 结果协议
- [`11`](./11-skills-runtime-and-loading.md)：skills runtime 的总装配
- [`12`](./12-memdir-and-session-memory.md)：memdir 与 session-memory 的总装配

而这篇只讲 `Read` 调用本身顺手触发的四类附着链：

- path-driven dynamic skill discovery
- conditional skill activation
- text-read listener fan-out
- auto-memory freshness 与 session-file analytics sidecar

## 1. `FileReadTool` 不只是内容摄取器，它还是一条“读到哪里就顺手暴露哪里能力”的触发器

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts), [`../../sources/claude-code/src/skills/loadSkillsDir.ts`](../../sources/claude-code/src/skills/loadSkillsDir.ts)

在正式进入 `callInner(...)` 之前，`call(...)` 先做了一段和“读文件内容”无关的工作：

- `discoverSkillDirsForPaths([fullFilePath], cwd)`
- `context.dynamicSkillDirTriggers?.add(dir)`
- `addSkillDirectories(newSkillDirs).catch(() => {})`
- `activateConditionalSkillsForPaths([fullFilePath], cwd)`

这说明 `Read` 在 Claude Code 里不只是“把文件给模型看”，还承担了一部分：

- 暴露新的 repo-local skill
- 激活与当前路径相匹配的条件 skill

也就是说，读文件本身会改写后续 turn 的 capability surface。

## 2. 动态 skill 发现不是全库扫描，而是“从当前文件路径往上爬到 cwd”的局部发现协议

源码镜像：[`../../sources/claude-code/src/skills/loadSkillsDir.ts`](../../sources/claude-code/src/skills/loadSkillsDir.ts)

`discoverSkillDirsForPaths(...)` 的注释写得很明确：

- walking up from file paths to cwd
- only discovers directories below cwd
- cwd-level skills are loaded at startup

它的实际协议是：

1. 从被读文件的父目录开始
2. 一层层向上回退
3. 查每一层有没有 `.claude/skills`
4. 到了 `cwd` 就停
5. 不把 `cwd` 本身再重复当成 discover 目标

所以这不是“某次读文件之后全项目重新索引 skills”，而是一条很局部、很便宜的路径邻域发现链。

## 3. 这条动态发现链还有两个显式抑制面：simple mode 和 plugin-only policy

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/skills/loadSkillsDir.ts)

`FileReadTool.call(...)` 外层先挡：

- `CLAUDE_CODE_SIMPLE`

只要 simple mode 开着，就完全跳过 skill discovery/activation。

而 `addSkillDirectories(...)` 内部还有第二层 gate：

- `projectSettings` 必须 enabled
- `!isRestrictedToPluginOnly('skills')`

所以“读文件触发新 skill”不是永远成立的，而是至少同时受：

- 宿主模式
- settings source
- plugin-only governance

三层约束。

## 4. `dynamicSkillDirTriggers` 不是加载器本体，而是给 attachment/display 用的 sidecar 记录

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/skills/loadSkillsDir.ts)

发现到新目录后，`FileReadTool` 先做：

- `context.dynamicSkillDirTriggers?.add(dir)`

然后才 fire-and-forget：

- `addSkillDirectories(newSkillDirs).catch(() => {})`

这说明 `dynamicSkillDirTriggers` 的职责不是“让 skill 真正生效”，而是：

- 记录这次 turn 是由哪些文件路径触发了 dynamic skill 暴露

也就是一条 attachment/display 侧带，而不是 loader state 本体。

## 5. `addSkillDirectories(...)` 刻意不 `await`，说明读文件不会为 skill 物化阻塞主读取

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/skills/loadSkillsDir.ts)

`FileReadTool` 这里专门注释：

- `Don't await - let skill loading happen in the background`

所以运行时语义是：

- 这次 `Read` 先成功返回
- 新 skill 在后台异步物化
- 后续通过 `skillsLoaded.emit()` 和缓存清理去让下一轮看见它

这说明“读文件触发 skill 发现”是 eventually-consistent 的，不是这次读调用必须强同步完成的一部分。

## 6. conditional skill activation 是另一条链：它不发现目录，只把已加载但未激活的 skill 推入 dynamic pool

源码镜像：[`../../sources/claude-code/src/skills/loadSkillsDir.ts`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts)

`activateConditionalSkillsForPaths(...)` 和 `discoverSkillDirsForPaths(...)` 做的不是同一件事。

它处理的是：

- 已经在 `conditionalSkills` map 里的 skill
- skill 自带 `paths` frontmatter
- 当前 file path 相对 `cwd` 命中这些 gitignore-style pattern

命中后才：

- `dynamicSkills.set(name, skill)`
- `conditionalSkills.delete(name)`

所以这条链不是“发现新目录”，而是：

- 已有 skill 的延迟可见性翻转

## 7. 这条条件激活链是单向翻转：一旦激活，就从 `conditionalSkills` 移出

源码镜像：[`../../sources/claude-code/src/skills/loadSkillsDir.ts`](../../sources/claude-code/src/skills/loadSkillsDir.ts)

匹配命中后不是简单打个 flag，而是直接：

- 加入 `dynamicSkills`
- 从 `conditionalSkills` 删除
- 记入 `activatedConditionalSkillNames`

这意味着对当前 session 而言，conditional skill activation 是：

- one-way promotion

它不是每次读文件都重新算可见性，而是命中一次后就正式进入“已暴露 skill”集合。

## 8. `nestedMemoryAttachmentTriggers` 是另一条完全独立的 read-side sidecar，不属于 skill runtime

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts)

在不同分支里，`FileReadTool` 都会做：

- `context.nestedMemoryAttachmentTriggers?.add(fullFilePath)`

这个动作出现在：

- notebook
- image
- text

路径里。

它和 `dynamicSkillDirTriggers` 的区别很重要：

- `dynamicSkillDirTriggers` 记录“因为这个路径发现了 skill”
- `nestedMemoryAttachmentTriggers` 记录“这次 turn 读过这个路径，后续 memory attachment 逻辑可能要据此工作”

所以这是另一个完全平行的 sidecar，总体更偏 memory/attachment，而不是 skills。

## 9. text-read listener 是一个显式的插件点，说明 `Read` 还承担“被动广播已读内容”职责

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts)

`FileReadTool.ts` 顶部就定义了：

- `type FileReadListener = (filePath, content) => void`
- `registerFileReadListener(listener): unsubscribe`

而 text 路径成功读取后会：

- `for (const listener of fileReadListeners.slice()) { listener(resolvedFilePath, content) }`

这说明 `Read` 还公开提供了一条同步广播面：

- 某些服务不必自己重新读盘
- 只要订阅 read listener，就能在工具已经读过之后拿到文本内容

这是一条典型的 in-process fan-out 扩展点。

## 10. `slice()` 快照说明作者明确在防“监听器自删导致跳过下一个 listener”的可重入 bug

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts)

循环前的注释已经把问题说透了：

- listener that unsubscribes mid-callback would splice the live array and skip the next listener

所以这里不是直接遍历原数组，而是：

- `fileReadListeners.slice()`

这说明这条 listener 总线的运行时假设是：

- 回调可能有副作用
- 回调可能在执行中修改订阅表

`Read` 这里显式防了这种可重入问题。

## 11. `detectSessionFileType(...)` 在 `FileReadTool` 里有一份局部实现，职责只限 analytics 分类

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/utils/memoryFileDetection.ts)

这里有一个容易混淆的点：

- `utils/memoryFileDetection.ts` 也有 `detectSessionFileType(...)`
- `FileReadTool.ts` 自己又有一份本地函数

这份本地版本的职责很窄，只做：

- `~/.claude/session-memory/*.md` -> `session_memory`
- `~/.claude/projects/*/*.jsonl` -> `session_transcript`

然后立刻只被用于：

- `tengu_session_file_read`

也就是说，这里不是在复用全局 memory detection 体系，而是在本工具里内联了一份“读的是哪类 session 文件”的 telemetry 归类器。

## 12. `tengu_session_file_read` 不是泛用 file-read 埋点，而是专盯 session-memory / transcript 的细粒度 telemetry

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts)

text 路径成功后，除了普通 `logFileOperation(...)`，还会单独打：

- `logEvent('tengu_session_file_read', { ... })`

字段包括：

- `totalLines`
- `readLines`
- `totalBytes`
- `readBytes`
- `offset`
- `limit`
- `ext`
- `messageID`
- `is_session_memory`
- `is_session_transcript`

这说明 session file read 在 Claude Code 里被视为一类值得单独观测的行为，而不是混在普通文件读取里就算了。

## 13. `isAutoMemFile(...)` 只在 text 路径落一份 WeakMap side channel，不影响正式 schema

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/utils/memoryFileDetection.ts)

当文本文件命中：

- `isAutoMemFile(fullFilePath)`

时，运行时只做一件事：

- `memoryFileMtimes.set(data, mtimeMs)`

后面 mapper 再按 `data` 对象身份反查这份 mtime。

这和 `91` 里讲过的结果层一致，但这里更重要的点是：

- freshness 信息不是路径级全局状态
- 也不是 output schema 字段
- 它只附着在这次 `Read` 产生的那个 `data` 对象上

这是一条非常局部、非常刻意的 sidecar 设计。

## 14. freshness note 的目标不是“告诉用户文件改过了”，而是“提醒模型这份 memory 可能已经过时”

源码镜像：[`../../sources/claude-code/src/memdir/memoryAge.ts`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts)

`memoryFreshnessNote(...)` 的语义不是常规文件时间戳提示，而是：

- `Memories are point-in-time observations, not live state`
- `claims about code behavior or file:line citations may be outdated`
- `Verify against current code before asserting as fact`

而且只有：

- 大于 1 天

才会返回非空值。

所以 auto-memory freshness sidecar 的本意不是展示 metadata，而是给模型一条非常明确的 epistemic caveat：这份 memory 不是现时真相。

## 15. `memoryFreshnessNote(...)` 和 `tengu_session_file_read` 说明 `Read` 在 memory/session 文件上已经进入“特殊治理”模式

源码镜像：[`../../sources/claude-code/src/memdir/memoryAge.ts`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts), [`../../sources/claude-code/src/utils/memoryFileDetection.ts`](../../sources/claude-code/src/utils/memoryFileDetection.ts)

把几条 sidecar 合在一起看：

- 路径命中 auto-memory -> 补 freshness caveat
- 路径命中 session files -> 单独打细 telemetry
- 读取任何文本 -> 还能广播给 read listeners
- 读取任何路径 -> 还能反向触发 dynamic/conditional skills

这说明 `FileReadTool` 对 memory/session 相关文件并没有把它们当普通文本处理，而是已经额外叠了：

- 能力暴露
- 记忆治理
- 运行时观测

三层附加语义。

## 16. 把这一卷和 `91` 合起来看，`FileReadTool` 的真正结构其实是“两层主链 + 多条 sidecar”

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/skills/loadSkillsDir.ts), [`../../sources/claude-code/src/utils/memoryFileDetection.ts`](../../sources/claude-code/src/utils/memoryFileDetection.ts)

前一卷 `91` 拆的是主结果协议：

- image
- PDF
- dedup
- supplemental blocks

这一卷拆的是附着 sidecar：

- dynamic skill discovery
- conditional skill activation
- nested memory attachment triggers
- read listeners
- auto-memory freshness
- session-file analytics

也就是说，`FileReadTool` 在 Claude Code 里远不是“读取磁盘 -> 返回内容”这么简单。它已经是一个：

- 内容摄取器
- capability revealer
- memory/session governor
- telemetry source

四种角色叠在一起的核心基础设施。
