# Skillify Materialization / Command Permission Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Session Memory / Away Summary / Skillify Consumer Runtime`](./64-session-memory-away-summary-and-skillify-consumer-runtime.md) | [`下一站：Bundled Skill File Extraction / Base Dir / Memory Review Runtime`](./66-bundled-skill-file-extraction-base-dir-and-memory-review-runtime.md)

`64` 已经把 `skillify` 作为 session-memory 的一个下游 consumer 讲清了，但还缺一条更靠近“真正落地”的实现链：一份 skill 最后是怎样变成 `.claude/skills/<name>/SKILL.md` 的，以及它 frontmatter 里的 `allowed-tools` 又怎样变成运行时权限。这一卷只讲这条 materialization/runtime。

## 1. `skillify` 本身不是文件生成器，而是一个 bundled prompt command

源码镜像：[`../../src/skills/bundled/skillify.ts`](../../src/skills/bundled/skillify.ts), [`../../src/skills/bundled/index.ts`](../../src/skills/bundled/index.ts), [`../../src/skills/bundledSkills.ts`](../../src/skills/bundledSkills.ts)

`skillify` 的注册方式和别的 bundled skill 一样：

- `registerBundledSkill({...})`
- `name: 'skillify'`
- `source: 'bundled'`
- `type: 'prompt'`

它没有单独的“生成 skill 文件”专用后端。也就是说，`skillify` 的本体只是一个 prompt command，职责是把当前会话转成一份“如何制作 skill”的高强度说明书。

## 2. 它的权限设计已经暴露了真实执行面：读会话、问用户、再用普通文件工具写盘

源码镜像：[`../../src/skills/bundled/skillify.ts`](../../src/skills/bundled/skillify.ts)

注册时它声明的 `allowedTools` 是：

- `Read`
- `Write`
- `Edit`
- `Glob`
- `Grep`
- `AskUserQuestion`
- `Bash(mkdir:*)`

这已经把 materialization 路径说透了：

- `Read/Grep/Glob` 用来理解当前会话与现有 skill 生态
- `AskUserQuestion` 负责多轮访谈确认
- `Write/Edit` 负责写 `SKILL.md`
- `Bash(mkdir:*)` 负责创建 `.claude/skills/<name>/` 目录

所以 skillify 不靠隐藏 API 产物化，而是靠普通工具链完成整个沉淀流程。

## 3. `skillify` prompt 明确把“保存到 repo 还是 personal”做成显式 operator 决策

源码镜像：[`../../src/skills/bundled/skillify.ts`](../../src/skills/bundled/skillify.ts)

它在访谈脚本里要求模型必须询问：

- **This repo**：`.claude/skills/<name>/SKILL.md`
- **Personal**：`~/.claude/skills/<name>/SKILL.md`

这说明 skill 的物化位置不是 loader 再猜，而是在生成阶段就被 operator 决定。换句话说，skillify 不只是写一份 markdown，它还负责把 skill 归类到：

- 项目私有
- 跨仓库个人资产

这也是后续 loader precedence 的输入来源。

## 4. “输出 YAML code block 再确认”说明 skillify 把落盘前审阅当成第一类运行时

源码镜像：[`../../src/skills/bundled/skillify.ts`](../../src/skills/bundled/skillify.ts)

它明确要求：

- 先输出完整 `SKILL.md` 内容
- 用 `yaml` fenced code block 呈现
- 再用 `AskUserQuestion` 询问 “Does this SKILL.md look good to save?”

所以落盘前 review 不是附带 UX，而是 prompt contract 里写死的强步骤。真正的保存动作必须发生在这层 review 之后。

## 5. `skillify` 不是自动模型技能，而是强 operator-invoked capture flow

源码镜像：[`../../src/skills/bundled/skillify.ts`](../../src/skills/bundled/skillify.ts)

它注册时同时声明：

- `userInvocable: true`
- `disableModelInvocation: true`

这表示两件事：

- 用户可以显式敲 `/skillify`
- 模型不会在普通对话里自发偷偷调用它

因此“把一次 workflow 沉淀成 skill”在产品上被当作显式运营动作，而不是自动系统行为。

## 6. `registerBundledSkill()` 只负责把 skillify 变成一条命令，不负责执行落盘语义

源码镜像：[`../../src/skills/bundledSkills.ts`](../../src/skills/bundledSkills.ts)

bundled skill 注册后生成的其实是普通 `Command`：

- `type: 'prompt'`
- `allowedTools`
- `argumentHint`
- `whenToUse`
- `getPromptForCommand`

也就是说，skillify 从注册层面并没有任何“我是一个生成器”特权。它只是把一串高约束 prompt 交给通用 slash-command runtime 去执行。

## 7. 真正把 `/skillify` 注入会话的是通用 `processSlashCommand` 路线

源码镜像：[`../../src/utils/processUserInput/processSlashCommand.tsx`](../../src/utils/processUserInput/processSlashCommand.tsx)

slash skill 的主路线是：

1. `findCommand(commandName, commands)`
2. `command.getPromptForCommand(args, context)`
3. 组装 metadata message
4. 把 skill prompt 作为 `isMeta: true` user message 注入
5. 追加 attachment messages
6. 再额外插入一条 `command_permissions` attachment

因此 `/skillify` 和任何其他 prompt skill 一样，最终都是“把 skill 指令注入消息流”，而不是执行一个特殊 RPC。

## 8. `skillify` 的“保存 skill”实际上是被 prompt 驱动的普通工具行为，不是 runtime 内建的 save opcode

源码镜像：[`../../src/skills/bundled/skillify.ts`](../../src/skills/bundled/skillify.ts)

它 prompt 里写得很死：

- 在 project root 的 `.claude/skills/<name>/SKILL.md` 或 user scope `~/.claude/skills/<name>/SKILL.md`
- 用 `Write` 写文件
- 目录不存在时先创建

所以 runtime 真相是：

- skillify 生成的是执行方案
- 模型随后用普通工具把 `SKILL.md` 写出来

这和 `generateAgent.ts` 那种“先生成 JSON，再由 wrapper 保存”的路径是不同的。

## 9. skill frontmatter 里的 `allowed-tools` 真正生效，要经过 `loadSkillsDir` 的解析层

源码镜像：[`../../src/skills/loadSkillsDir.ts`](../../src/skills/loadSkillsDir.ts)

文件型 skill 载入时，frontmatter 会先过：

- `parseSkillFrontmatterFields(...)`
- `parseSlashCommandToolsFromFrontmatter(frontmatter['allowed-tools'])`

然后再进：

- `createSkillCommand(...)`

最终变成 `Command.allowedTools`。也就是说，`SKILL.md` 里的 `allowed-tools` 不是注释，而是运行时真正读取并挂到命令对象上的权限面。

## 10. `createSkillCommand()` 说明写好的 `SKILL.md` 会被重新编译回 prompt command

源码镜像：[`../../src/skills/loadSkillsDir.ts`](../../src/skills/loadSkillsDir.ts)

一旦 skill 被写到磁盘，再次加载时会被编译成标准 `Command`：

- `name`
- `description`
- `allowedTools`
- `argNames`
- `whenToUse`
- `model`
- `disableModelInvocation`
- `userInvocable`
- `context`
- `agent`
- `hooks`
- `skillRoot`
- `getPromptForCommand(...)`

也就是说，skillify 的最终产物不是孤立 markdown，而是下一轮会重新进入 slash catalog 的可执行命令定义。

## 11. `skillRoot` 和 `Base directory for this skill:` 让生成后的 skill 重新获得文件上下文能力

源码镜像：[`../../src/skills/loadSkillsDir.ts`](../../src/skills/loadSkillsDir.ts), [`../../src/skills/bundledSkills.ts`](../../src/skills/bundledSkills.ts)

无论是磁盘 skill 还是 bundled skill 抽取出的 reference files，runtime 最终都会在 prompt 前补：

- `Base directory for this skill: ...`

这使 skill 在再次被调用时，可以通过 `Read/Grep/Bash` 等工具访问自己的附属文件、脚本和模板。对 skillify 来说，这也解释了为什么它坚持要产出标准目录结构，而不是随手存一段文本。

## 12. `command_permissions` attachment 是 slash-skill runtime 给模型看的权限 sidecar，不是给用户看的消息

源码镜像：[`../../src/utils/processUserInput/processSlashCommand.tsx`](../../src/components/messages/AttachmentMessage.tsx), [`../../src/components/messages/nullRenderingAttachments.ts`](../../src/components/messages/nullRenderingAttachments.ts), [`../../src/utils/messages.ts`](../../src/utils/messages.ts)

在 prompt skill 注入末尾，runtime 会额外塞一条 attachment：

- `type: 'command_permissions'`
- `allowedTools: additionalAllowedTools`
- `model: command.model`

但这条 attachment 在前台被明确做成：

- `AttachmentMessage` 中 `return null`
- `nullRenderingAttachments` 里直接列为隐藏类型
- `normalizeAttachmentForAPI` 里也不会再翻译成可见 transcript block

这说明它的设计目的不是给用户回显，而是给后续运行时/模型保留一条“这次 skill invocation 额外获得了哪些工具权限”的隐形 sidecar。

## 13. 协调器模式下还会故意不给整份 SKILL.md，而只给一个 delegation summary

源码镜像：[`../../src/utils/processUserInput/processSlashCommand.tsx`](../../src/utils/processUserInput/processSlashCommand.tsx)

`getMessagesForPromptSlashCommand(...)` 里有一条重要特判：

- `COORDINATOR_MODE`
- `CLAUDE_CODE_COORDINATOR_MODE`
- `!context.agentId`

命中后不会加载完整 skill content，而只注入一份摘要，告诉 coordinator：

- 这个 skill 可用
- description / whenToUse / allowedTools 是什么
- 要让 worker 在 Agent prompt 里写 `Use the /<name> skill`

原因写得很直接：coordinator 只有 `Agent + TaskStop` 之类工具，整份 SKILL.md 和权限对它没有意义。真正的 worker 调 Skill tool 时，才会拿到完整 skill 内容和 permissions。

## 14. 这也解释了 skillify 为什么要把 `allowed-tools` 写得尽量最小：它会被直接暴露成 worker 权限宣告

源码镜像：[`../../src/skills/bundled/skillify.ts`](../../src/utils/processUserInput/processSlashCommand.tsx), [`../../src/skills/loadSkillsDir.ts`](../../src/skills/loadSkillsDir.ts)

因为 runtime 会：

- 从 frontmatter 解析 `allowed-tools`
- 在 slash invocation 时生成 `command_permissions`
- 在 coordinator summary 里显式写出 “This skill grants workers additional tool permissions: ...”

所以 `allowed-tools` 不是内部实现细节，而是 workflow delegation 协议的一部分。skillify prompt 才会强调：

- 用最小权限模式
- 优先写模式化的 `Bash(gh:*)` 而不是裸 `Bash`

## 15. 这篇和 `64`、`11`、`44` 的边界

[`./64-session-memory-away-summary-and-skillify-consumer-runtime.md`](./64-session-memory-away-summary-and-skillify-consumer-runtime.md) 讲的是：

- 为什么 skillify 会读 session memory

这一篇讲的是：

- skillify 最后怎样变成真实 skill 文件
- 这份 skill 文件的权限又怎样进入运行时

[`./11-skills-runtime-and-loading.md`](./11-skills-runtime-and-loading.md) 讲的是整体 skills loader；这一篇只抓 materialization 和 permission sidecar 这条更窄的链。[`./44-dynamic-skills-model-only-skills-and-host-safe-command-gates.md`](./44-dynamic-skills-model-only-skills-and-host-safe-command-gates.md) 则讲动态 skills、model-only skills、host-safe gates；本篇只覆盖 `skillify` 和普通 slash-skill 的权限物化。

## 16. 一句话结论

`skillify` 并不是“帮你自动生成一个 skill 的魔法命令”，而是一条完全建立在通用 skill runtime 之上的沉淀链：

- prompt 负责访谈和起草
- 普通工具负责 mkdir / write
- `SKILL.md` frontmatter 负责声明权限
- slash runtime 再把这些权限编译成隐形的 `command_permissions` sidecar

这也是 Claude Code 为什么能把“把一次会话变成 skill”做成正常命令系统的一部分，而不是单独硬编码功能。
