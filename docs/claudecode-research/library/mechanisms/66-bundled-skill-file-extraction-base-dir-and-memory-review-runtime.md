# Bundled Skill File Extraction / Base Dir / Memory Review Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Skillify Materialization / Command Permission Runtime`](./65-skillify-materialization-and-command-permission-runtime.md) | [`下一站：Skills Runtime 与 Loading`](./11-skills-runtime-and-loading.md)

`65` 已经把 `skillify` 怎样物化成 `SKILL.md` 和 `command_permissions` sidecar 拆清了，但还有一层更底的 skills runtime 没独立成卷：Claude Code 不只会加载磁盘 skill，它还会把 bundled skill 自己携带的参考文件抽到磁盘、给 skill prompt 注入 base directory、替换 `${CLAUDE_SKILL_DIR}`，甚至在 shell injection 时临时放宽到该 skill 的 `allowedTools`。这一卷只讲这条“skill 带着自己的文件和局部环境运行”的运行时。

## 1. bundled skill 不只是内联 prompt，它还能携带一整包 reference files

源码镜像：[`../../src/skills/bundledSkills.ts`](../../src/skills/bundledSkills.ts)

`BundledSkillDefinition` 里有一个关键字段：

- `files?: Record<string, string>`

注释写得很明确：这些是 skill 的附属参考文件，第一次调用时才会抽到磁盘，并在 prompt 前自动补一行：

- `Base directory for this skill: <dir>`

因此 bundled skill 的真实运行态不是“只有一段 prompt 字符串”，而是“prompt + 可按需 Read/Grep 的文件树”。

## 2. `registerBundledSkill()` 会把“有 files 的 skill”改写成 lazy extraction wrapper

源码镜像：[`../../src/skills/bundledSkills.ts`](../../src/skills/bundledSkills.ts)

当 `files` 非空时，注册逻辑不会直接保留原始 `getPromptForCommand`，而是包一层：

- 先算出 `skillRoot = getBundledSkillExtractDir(definition.name)`
- 用 closure-local `extractionPromise` 做一次性 memoization
- 第一次调用时 `extractBundledSkillFiles(...)`
- 成功后 `prependBaseDir(blocks, extractedDir)`

这说明 bundled file extraction 是：

- 懒触发
- 每进程一次
- 失败降级但不阻断 skill 本体

## 3. 抽取目录是 deterministic per-skill，而不是每次随机临时目录

源码镜像：[`../../src/skills/bundledSkills.ts`](../../src/skills/bundledSkills.ts)

目录计算就是：

- `getBundledSkillExtractDir(skillName) -> join(getBundledSkillsRoot(), skillName)`

也就是说：

- skills root 是 per-process nonce 根目录
- skill 自己在里面有固定子目录

所以同一 skill 在当前进程内看到的是稳定路径，这对于 prompt 里引用附属脚本和模板是必要条件。

## 4. extraction 安全边界不是随手 `writeFile`，而是 owner-only subtree + no-follow 写入

源码镜像：[`../../src/skills/bundledSkills.ts`](../../src/skills/bundledSkills.ts)

这一层做了几件很工程化的安全约束：

- `mkdir(..., mode: 0o700)` 保证 owner-only subtree
- `safeWriteFile(..., 0o600)` 保证文件 owner-only
- `O_EXCL | O_NOFOLLOW` 防止已有路径/最终组件符号链接复用
- 不在 `EEXIST` 上做 unlink+retry，避免中间 symlink 跟随风险

所以 bundled skill files extraction 不是普通缓存写盘，而是被当作“内置资产安全物化”来做的。

## 5. `resolveSkillFilePath()` 显式阻断路径穿越，说明 bundled file tree 被当作不可信输入表面处理

源码镜像：[`../../src/skills/bundledSkills.ts`](../../src/skills/bundledSkills.ts)

它会拒绝：

- absolute path
- `..` path segment
- 正常化后逃出 base dir 的相对路径

因此 bundled skill 自带文件虽然来自内置定义，runtime 仍然按“可能逃逸 skill 根目录”的威胁模型做检查。

## 6. `prependBaseDir()` 才是 bundled skill 文件可用性的真正契约

源码镜像：[`../../src/skills/bundledSkills.ts`](../../src/skills/bundledSkills.ts)

抽取成功后，runtime 不会自动读这些文件，而只是把第一段 text block 前缀改成：

- `Base directory for this skill: <dir>\n\n`

这和磁盘 skill 的契约完全一致：模型拿到 base directory 之后，自己决定何时用 `Read/Grep/Bash` 去访问里面的内容。

也就是说，runtime 提供的是“可寻址性”，不是“自动展开所有引用文件”。

## 7. 磁盘 skill 和 bundled skill 在 `Base directory for this skill` 上是刻意同构的

源码镜像：[`../../src/skills/loadSkillsDir.ts`](../../src/skills/loadSkillsDir.ts), [`../../src/skills/bundledSkills.ts`](../../src/skills/bundledSkills.ts)

文件型 skill 直接在 `getPromptForCommand(...)` 里做：

- `Base directory for this skill: ${baseDir}\n\n${markdownContent}`

bundled skill 则在抽取完成后用 `prependBaseDir(...)` 做同样的前缀。这个同构很重要，因为它意味着模型侧不需要区分：

- 这个 skill 原本来自磁盘
- 还是编译进 CLI 的 bundled asset

两者在 prompt contract 上看到的是同一语义。

## 8. `${CLAUDE_SKILL_DIR}` 替换说明 skill 不是只能读文件，还可以把自身目录注入 shell snippets

源码镜像：[`../../src/skills/loadSkillsDir.ts`](../../src/skills/loadSkillsDir.ts)

文件型 skill 在 prompt materialization 时还会替换：

- `${CLAUDE_SKILL_DIR}` -> 当前 skill 目录
- `${CLAUDE_SESSION_ID}` -> 当前 session id

其中 `CLAUDE_SKILL_DIR` 的用途写得很明确：

- 让 bash injection `!\`...\`` 可以引用 bundled scripts 或 skill 附属脚本

这说明 skill 目录不是纯文档根，而是运行时 shell asset root。

## 9. shell injection 还会把当前 skill 的 `allowedTools` 临时注入 permission context

源码镜像：[`../../src/skills/loadSkillsDir.ts`](../../src/skills/loadSkillsDir.ts)

在 `executeShellCommandsInPrompt(...)` 前，runtime 会构造一个改写版 `getAppState()`，把：

- `toolPermissionContext.alwaysAllowRules.command = allowedTools`

挂进去。也就是说，skill markdown 里的 `!\`...\`` 代码块不是在裸环境跑，而是在“当前 skill frontmatter 允许的工具集合”这个局部权限环境里跑。

这进一步说明 `allowed-tools` 不只是给后续普通 tool use 看，也会参与 skill 自身 prompt materialization 期的 shell 执行权限。

## 10. MCP skills 被明确排除在 inline shell injection 之外

源码镜像：[`../../src/skills/loadSkillsDir.ts`](../../src/skills/loadSkillsDir.ts)

代码里有一条非常明确的安全特判：

- `if (loadedFrom !== 'mcp') { executeShellCommandsInPrompt(...) }`

注释写得更直白：

- MCP skills 是 remote 且 untrusted
- 永远不要执行它 markdown body 里的 inline shell commands
- `${CLAUDE_SKILL_DIR}` 对它们也没有意义

所以 Claude Code 把“带脚本运行的 skill”明确定义为本地/bundled/plugin 资产能力，不授予 remote MCP skill。

## 11. plugin commands 也复用了同一套 base-dir / skill-dir 注入协议

源码镜像：[`../../src/utils/plugins/loadPluginCommands.ts`](../../src/utils/plugins/loadPluginCommands.ts)

当前源码镜像里也能看到 plugin command 侧的同构逻辑：

- 同样补 `Base directory for this skill: ...`
- 同样替换 `${CLAUDE_SKILL_DIR}`

这说明这条协议不是 skills 子树的偶然实现，而是 Claude Code 在“可执行 markdown capability”上的统一 contract。

## 12. `remember` 是这条 runtime 上另一类 memory operator：review/promote，但不自动改写

源码镜像：[`../../src/skills/bundled/remember.ts`](../../src/skills/bundled/remember.ts), [`../../src/skills/bundled/index.ts`](../../src/skills/bundled/index.ts)

`remember` 注册方式和 `skillify` 一样，也是 bundled skill，但它的定位完全不同：

- 目标是 review memory landscape
- 提出 promotion / cleanup / ambiguity report
- 明确 `Do NOT apply changes`

也就是说，它不是物化新 skill 的 capture flow，而是一个 memory governance operator。它和 `skillify` 一起，说明 bundled skill 不只是产出型工具，还承担“检查并指导用户如何整理自己的 durable context”。

## 13. `remember` 的 gate 也说明它属于 auto-memory 生态，而不是普适命令

源码镜像：[`../../src/skills/bundled/remember.ts`](../../src/skills/bundled/remember.ts)

它注册时带有：

- `isEnabled: () => isAutoMemoryEnabled()`

并且只对：

- `process.env.USER_TYPE === 'ant'`

生效。说明这条 skill 的宿主前提很明确：

- 先有 auto-memory
- 再有跨层整理需求

所以 `remember` 是 memory system 的治理工具，而不是普通通用 skill。

## 14. `remember` 也体现了 bundled skill 的一个特性：可以完全不依赖文件抽取，只靠 prompt contract 工作

源码镜像：[`../../src/skills/bundled/remember.ts`](../../src/skills/bundledSkills.ts)

`remember` 没有提供 `files`，因此：

- 不会触发 extraction wrapper
- 也不会生成 `skillRoot`
- 只依赖普通 `getPromptForCommand(args)`

这正好说明 bundled skills 有两种运行态：

- prompt-only capability
- prompt + extracted file tree capability

而 runtime 用同一注册器同时支持两者。

## 15. 这篇和 `65`、`11`、`62` 的边界

[`./65-skillify-materialization-and-command-permission-runtime.md`](./65-skillify-materialization-and-command-permission-runtime.md) 讲的是：

- `skillify` 如何把 workflow 变成 `SKILL.md`
- `allowed-tools` 怎样进入 slash runtime 权限 sidecar

这一篇讲的是：

- skill 一旦存在，怎样带着自己的目录、脚本和 reference files 运行
- bundled skill / disk skill / plugin skill 如何共用同一 base-dir contract

[`./11-skills-runtime-and-loading.md`](./11-skills-runtime-and-loading.md) 讲整体 skills loader；本篇只抓 bundled extraction / base-dir / shell injection 这一条窄链。[`./62-session-memory-prompt-template-waiting-and-manual-summary-runtime.md`](./62-session-memory-prompt-template-waiting-and-manual-summary-runtime.md) 则是 session-memory operator 面；这里的 `remember` 只覆盖“review/promote memory”的 bundled skill 角色。

## 16. 一句话结论

Claude Code 的 skill runtime 不只是“把 markdown 塞给模型”。它已经演化成一个可携带文件树、可注入局部目录变量、可在受限权限环境下执行 shell snippet 的 capability substrate。而 `remember` 这种 bundled memory operator 又说明，这条 substrate 同时服务于：

- 产出型 skill
- 治理型 skill
- 以及带脚本/模板/附属文件的复杂技能包

这也是 `skills` 真正接近“功能级实现百科”而不是命令清单的地方。
