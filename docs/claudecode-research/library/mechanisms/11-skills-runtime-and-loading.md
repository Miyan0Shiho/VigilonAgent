# Skills Runtime 与加载链

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：TaskList / Ownership 协议`](./10-task-list-and-ownership.md) | [`下一站：Memdir / Session Memory`](./12-memdir-and-session-memory.md)

本文把 `loadSkillsDir.ts`、`QueryEngine.ts`、bundled skills、legacy `/commands/` 兼容层拆成一卷，说明 Claude Code 的 skill 不是几份 Markdown，而是一条真实的发现、去重、激活、注入和执行链。

## 1. skill 先是 `Command`，不是“读到再说”的松散文本

源码镜像：[`../../sources/claude-code/src/skills/loadSkillsDir.ts`](../../sources/claude-code/src/skills/loadSkillsDir.ts)

`createSkillCommand()` 把 skill 编译成标准 `Command` 对象，直接挂进 slash command 体系。这里已经固化了几件关键事：

- `name / description / whenToUse / allowedTools / argNames / effort / model`
- `context: fork` 与 `agent`
- `hooks`
- `skillRoot`
- `getPromptForCommand()`

所以 skill 在运行时里不是“读取一个 md 文件再临时解释”，而是启动阶段就被标准化成和其他命令同构的执行对象。

## 2. frontmatter 才是 skill runtime 的控制面

源码镜像：[`../../sources/claude-code/src/skills/loadSkillsDir.ts`](../../sources/claude-code/src/skills/loadSkillsDir.ts)

`parseSkillFrontmatterFields()` 说明 `SKILL.md` 的 frontmatter 不是装饰信息，而是运行时配置：

- `allowed-tools` 决定 skill 调起时带什么命令权限
- `arguments` 与 `argument-hint` 决定参数替换协议
- `when_to_use` 决定自动触发语义
- `model`、`effort`、`disable-model-invocation` 决定模型侧执行策略
- `user-invocable` 决定它是公开 slash command 还是隐藏能力
- `hooks` 把 skill 直接接进 hook 体系
- `context: fork` 与 `agent` 决定它是在当前线程跑还是转到子代理

这也是为什么 Claude Code 的 skill 更像“声明式工作流单元”，不是普通提示词模板。

## 3. `/skills/` 和 legacy `/commands/` 是两套来源，但都被收敛进同一条装配链

源码镜像：[`../../sources/claude-code/src/skills/loadSkillsDir.ts`](../../sources/claude-code/src/skills/loadSkillsDir.ts)

当前加载器同时处理两套来源：

- 新式 `/skills/`：只接受 `skill-name/SKILL.md`
- 旧式 `/commands/`：兼容 `SKILL.md` 目录格式和单文件 `.md` 命令格式

`transformSkillFiles()`、`getSkillCommandName()`、`getRegularCommandName()` 的作用，是把 legacy 目录也翻译回当前的 command/skill 命名体系。也就是说，上层 query loop 不关心 skill 来自新目录还是旧目录，最终都被压平成 `Command[]`。

## 4. skill 发现是多源合并，不是只看当前 repo

源码镜像：[`../../sources/claude-code/src/skills/loadSkillsDir.ts`](../../sources/claude-code/src/skills/loadSkillsDir.ts)

`getSkillDirCommands()` 同时装配：

- managed skills
- user skills
- project skills
- `--add-dir` 带来的额外项目 skills
- legacy commands-as-skills

并且受三类治理条件约束：

- `--bare` 下跳过自动发现，只保留显式 `--add-dir`
- `skillsLocked` 时禁止 project/user/legacy 这类本地 skill 注入
- setting source enablement 决定某层配置是否生效

所以 skill 体系并不是“仓库里放个 `.claude/skills` 就算完”，而是一个多来源、带治理策略的配置装配层。

## 5. 去重不是按名字，而是按真实文件身份

源码镜像：[`../../sources/claude-code/src/skills/loadSkillsDir.ts`](../../sources/claude-code/src/skills/loadSkillsDir.ts)

这里特意用了 `realpath()` 做 `getFileIdentity()`，然后按 canonical path 去重，而不是按 skill name 去重。原因很直接：

- 同一 skill 文件可能被 symlink 或重叠父目录重复命中
- 名字相同不一定是同一文件
- 真正要避免的是“同一物理文件被装两次”

这说明加载器面对的不是理想化单目录，而是真实复杂文件系统。

## 6. `paths` frontmatter 把 skill 变成条件激活资产

源码镜像：[`../../sources/claude-code/src/skills/loadSkillsDir.ts`](../../sources/claude-code/src/skills/loadSkillsDir.ts)

`parseSkillPaths()` 和 `conditionalSkills` 这套逻辑很关键：如果 skill 带 `paths`，它不会在启动时直接进入 unconditional skills，而是先进入待激活池。

这意味着 Claude Code 支持一种更细的 skill 策略：

- 全局可用 skill：启动即加载
- 条件 skill：只有当会话真的碰到匹配文件时才激活

它解决的是“skill 太多会污染上下文”的问题，不是目录组织问题。

## 7. 动态 skill 发现是沿文件路径向上漫游，而不是全仓暴力扫描

源码镜像：[`../../sources/claude-code/src/skills/loadSkillsDir.ts`](../../sources/claude-code/src/skills/loadSkillsDir.ts)

`discoverSkillDirsForPaths()` 的策略是：

- 从被读写文件的父目录开始向上走
- 只走到 `cwd` 为止，不重复吃启动阶段已经加载过的 cwd-level skills
- 发现 `.../.claude/skills`
- 若目录被 gitignore，则跳过
- 按“离目标文件更近”的目录优先

所以 nested skills 不是全库预索引，也不是单纯看 repo root，而是“文件接触驱动的按需发现”。

## 8. `getPromptForCommand()` 不是简单返回 Markdown

源码镜像：[`../../sources/claude-code/src/skills/loadSkillsDir.ts`](../../sources/claude-code/src/skills/loadSkillsDir.ts)

真正执行 skill 时，还会做一层 prompt 编译：

- 把 `Base directory for this skill` 注入头部
- 做参数替换
- 替换 `${CLAUDE_SKILL_DIR}`
- 替换 `${CLAUDE_SESSION_ID}`
- 对非 MCP skill 执行 `!` 风格 shell prompt expansion

这里最值得注意的是安全边界：`loadedFrom === 'mcp'` 时，明确禁止执行 skill body 里的 inline shell，因为远端 MCP skill 被当成不可信来源。

所以 skill 执行不是“读文件 -> 发给模型”，而是带变量替换和安全约束的 prompt 构建器。

## 9. bundled skill 证明 skill 不是只能来自文件系统

源码镜像：[`../../sources/claude-code/src/skills/bundled/skillify.ts`](../../sources/claude-code/src/skills/bundled/skillify.ts), [`../../sources/claude-code/src/skills/bundled/remember.ts`](../../sources/claude-code/src/skills/bundled/remember.ts)

bundled skills 直接在代码里 `registerBundledSkill()`，说明 skill 来源至少有三类：

- 文件系统 skills
- legacy commands
- 代码内建 bundled skills

而且这些内建 skill 已经开始反向利用别的运行时资产：

- `skillify` 会读取 session memory 和用户消息，反向生成新 skill
- `remember` 会把 auto-memory、`CLAUDE.md`、`CLAUDE.local.md` 当成待整理的多层记忆景观

这说明 skill 不是孤立功能，而是 Claude Code 自我扩展与自我整理的操作面。

## 10. `QueryEngine` 把 skills 和 plugins 作为启动期并行装配物

源码镜像：[`../../sources/claude-code/src/QueryEngine.ts`](../../sources/claude-code/src/QueryEngine.ts)

`before_skills_plugins` / `after_skills_plugins` 这段 profiling 很直白：headless 启动时，skills 和 plugins 是并行加载的。

这里暴露出两个结构事实：

- skills 属于 system init message 的一部分，而不是首次用到才临时读
- 它和 plugin enablement 一起构成“当前会话有哪些扩展能力”的启动快照

所以 skill runtime 在产品上扮演的是能力装配层，不只是命令仓库。

## 11. 为什么这一卷必须独立

如果只看 `mechanisms/07-skills-and-memory.md`，很容易把 skill 理解成“给模型几份工作流说明”。真实实现要复杂得多：

- frontmatter 是运行时声明语言
- source merging 决定 skill 从哪里进来
- dedup 与 gitignore 决定它如何安全落地
- conditional activation 决定它何时真正进上下文
- prompt compilation 决定它如何被执行

也就是说，Claude Code 的 skill 本质上已经是一个轻量的工作流 runtime。
