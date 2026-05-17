# Agent Memory / Snapshots / Built-In Specialist Prompts

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Agent Definitions / Selection / Spawn / Handoff Runtime`](./51-agent-definitions-selection-spawn-and-handoff-runtime.md) | [`下一站：LocalAgentTask / Retention / Panel / Notification Runtime`](./53-local-agent-task-retention-panel-and-notification-runtime.md)

前一卷已经把 `AgentTool` 的定义、选择、spawn 和 handoff 主链拆开了。这一卷继续往下钻两层“决定 agent 个性与持续性”的配置核：

- `agentMemory.ts + agentMemorySnapshot.ts`：agent 的持久记忆目录、snapshot 初始化、同步元数据与 scope 语义
- `builtInAgents.ts + built-in/*.ts`：builtin specialist agents 的 catalog gate、read-only discipline、tool/host 偏置与系统提示人格

对应源码主链是：`tools/AgentTool/agentMemory.ts + agentMemorySnapshot.ts + builtInAgents.ts + built-in/*.ts`。

## 1. Agent memory 不是 session memory 的别名，而是按 agent type 切开的长期知识层

源码镜像：[`../../src/tools/AgentTool/agentMemory.ts`](../../src/tools/AgentTool/agentMemory.ts)

`AgentMemoryScope` 只有三种：

- `user`
- `project`
- `local`

而且路径不是按 session、team、task 分，而是按 `agentType` 切目录。也就是说 agent memory 的真正语义不是“这一轮对话的附加摘要”，而是：

- 同一个 specialist agent 跨多次 spawn 的长期记忆
- 并且 scope 决定它是跨项目、项目共享、还是本地私有

这和 `SessionMemory` 是完全不同的一层。

## 2. `agentType` 先被 sanitize 再入盘，说明 plugin-namespaced agents 从一开始就被当成合法一等来源

源码镜像：[`../../src/tools/AgentTool/agentMemory.ts`](../../src/tools/AgentTool/agentMemory.ts)

`sanitizeAgentTypeForPath()` 会把 `:` 换成 `-`。原因写得很明白：

- Windows 路径不允许 `:`
- plugin agents 可能长成 `my-plugin:my-agent`

所以这层设计默认接受：

- built-in agent
- project/user agent
- plugin-namespaced agent

共用同一套 memory 目录协议，而不是把 plugin agents 当边缘情况。

## 3. `local` memory scope 在 remote mount 下会被重定向到 project-namespaced 挂载目录

源码镜像：[`../../src/tools/AgentTool/agentMemory.ts`](../../src/tools/AgentTool/agentMemory.ts)

`getLocalAgentMemoryDir()` 有一条非常关键的分叉：

- 普通本地：`<cwd>/.claude/agent-memory-local/<agentType>/`
- 如果设了 `CLAUDE_CODE_REMOTE_MEMORY_DIR`：
  - 写到 `<remote-memory-dir>/projects/<sanitized-git-root>/agent-memory-local/<agentType>/`

这说明所谓 “local memory” 并不等于“永远只在当前工作目录里”。在 remote/挂载宿主下，它会被显式 project-namespaced，避免不同仓库串用同一份 local agent memory。

## 4. `isAgentMemoryPath()` 不只是便利函数，而是一道路径信任边界

源码镜像：[`../../src/tools/AgentTool/agentMemory.ts`](../../src/tools/AgentTool/agentMemory.ts)

这段逻辑先做：

- `normalize(absolutePath)`

再分别判断：

- user scope 是否落在 `<memoryBase>/agent-memory/`
- project scope 是否落在 `<cwd>/.claude/agent-memory/`
- local scope 是否落在 cwd-based 或 remote mount-based `agent-memory-local/`

注释直接点明目的：防止 `..` 路径穿越绕过 memory 目录边界。

所以 agent memory 在这里不是“便于组织文件”，而是进入了 Claude Code 的安全路径分类面。

## 5. `loadAgentMemoryPrompt()` 把 memory 目录变成系统提示的一部分，而不是后台静默附带

源码镜像：[`../../src/tools/AgentTool/agentMemory.ts`](../../src/tools/AgentTool/agentMemory.ts)

agent memory 的接入方式不是把文件内容偷偷塞到某个 store，而是：

- `ensureMemoryDirExists(memoryDir)`
- `buildMemoryPrompt(...)`
- 返回一段名叫 `Persistent Agent Memory` 的系统提示片段

而且 scope 会改变提示文案：

- `user`：强调 learnings 要通用、跨项目
- `project`：强调适配项目并可被团队共享
- `local`：强调适配项目和机器，但不进版本控制

所以 memory scope 在 Claude Code 里不是存储后端选项，而是会直接塑造 agent 的写作/记忆策略。

## 6. `ensureMemoryDirExists()` 是 fire-and-forget，说明 agent memory 创建被设计成“不阻塞 spawn，但最终一致”

源码镜像：[`../../src/tools/AgentTool/agentMemory.ts`](../../src/tools/AgentTool/agentMemory.ts)

这里没有 `await` mkdir。注释解释得很工程化：

- 这段运行在同步的 `getSystemPrompt()` 链里
- agent 真正开始写 memory 之前，还有一整个 API round-trip
- 就算 mkdir 还没完成，写工具自己也会做 parent mkdir

这说明 agent memory 初始化的设计目标是：

- spawn latency 优先
- 最终一致就够
- 不为目录创建阻塞前台 agent 启动

## 7. snapshot 不是 memory 本体，而是 project 提供给 agent 的 seed image

源码镜像：[`../../src/tools/AgentTool/agentMemorySnapshot.ts`](../../src/tools/AgentTool/agentMemorySnapshot.ts)

snapshot 系统固定几件事：

- snapshot 根目录：`.claude/agent-memory-snapshots/<agentType>/`
- 元数据文件：`snapshot.json`
- 本地同步标记：`.snapshot-synced.json`

这说明 snapshot 的语义不是“memory 的另一种位置”，而是：

- 项目方维护的一份初始化镜像
- 本地 agent memory 决定要不要吸收它

因此它更像 bootstrapping seed，而不是 live source of truth。

## 8. `checkAgentMemorySnapshot()` 把 snapshot 同步分成三种动作，而不是只有“有/没有”

源码镜像：[`../../src/tools/AgentTool/agentMemorySnapshot.ts`](../../src/tools/AgentTool/agentMemorySnapshot.ts)

返回值只有三态：

- `none`
- `initialize`
- `prompt-update`

判定规则是：

- 没 snapshot：`none`
- 有 snapshot，但本地还没有任何 `.md` memory：`initialize`
- 本地有 memory，但 snapshot 时间更新了：`prompt-update`

这说明 Claude Code 区分得很细：

- 首次种子初始化
- 已有本地记忆后的“有新版 snapshot 可参考”

而不是粗暴覆盖。

## 9. “本地是否已有 agent memory” 的判断极其保守，只看 `.md` 文件

源码镜像：[`../../src/tools/AgentTool/agentMemorySnapshot.ts`](../../src/tools/AgentTool/agentMemorySnapshot.ts)

`hasLocalMemory` 的规则不是目录存在，而是：

- 目录里至少有一个 `.md` 文件

所以：

- 空目录不算 initialized
- 只有 synced metadata 也不算 initialized

这保证了 snapshot 初始化不会因为目录提前 mkdir 或只留下状态文件就被误判为“已经有记忆了”。

## 10. `initializeFromSnapshot()` 和 `replaceFromSnapshot()` 说明 snapshot 更新分成“首次拷贝”和“整包替换”两种严格语义

源码镜像：[`../../src/tools/AgentTool/agentMemorySnapshot.ts`](../../src/tools/AgentTool/agentMemorySnapshot.ts)

两条动作差别很大：

- `initializeFromSnapshot()`：
  - 直接 copy snapshot files
  - 再记 synced meta
- `replaceFromSnapshot()`：
  - 先删本地所有 `.md`
  - 再 copy snapshot
  - 再记 synced meta

也就是说 snapshot 不是 merge patch。真正替换时，它会显式清 orphan `.md`，保持本地 memory 镜像与 snapshot 一致。

## 11. `.snapshot-synced.json` 说明 snapshot 系统追踪的是“最后同步来源时间”，不是文件级 diff

源码镜像：[`../../src/tools/AgentTool/agentMemorySnapshot.ts`](../../src/tools/AgentTool/agentMemorySnapshot.ts)

同步元数据只记：

- `syncedFrom: <snapshotTimestamp>`

没有：

- per-file hash
- merge base
- content diff

因此 snapshot 同步协议是 timestamp-based、whole-snapshot 级别的，不是增量 patch 系统。这更像一个 “你上次吃的是哪一版种子” 的记录器。

## 12. builtin agent catalog 的变化不是内容差异，而是“哪些 specialist 会出现在这次宿主里”

源码镜像：[`../../src/tools/AgentTool/builtInAgents.ts`](../../src/tools/AgentTool/builtInAgents.ts)

当前 builtin catalog 的主要成员包括：

- `general-purpose`
- `statusline-setup`
- `Explore`
- `Plan`
- `claude-code-guide`
- `verification`

但是否真的出现，要看：

- SDK blank-slate env
- coordinator mode
- explore/plan GrowthBook gate
- 非 SDK entrypoint 才出现 `claude-code-guide`
- verification gate

所以 builtin agent 不是一个静态“产品预设集合”，而是随宿主与 rollout 变化的能力面。

## 13. `general-purpose` 的存在说明 Claude Code 把“子代理”默认看成研究/搜索 worker，而不是实现 worker

源码镜像：[`../../src/tools/AgentTool/built-in/generalPurposeAgent.ts`](../../src/tools/AgentTool/built-in/generalPurposeAgent.ts)

`general-purpose` 的系统提示重点是：

- research
- broad file/code search
- multi-step investigation
- 不要轻易创建文件

它并没有内置极强的实现导向模板。也就是说，在默认设定里，subagent 首先被当成：

- 研究助理
- 搜索助理

而不是“任何任务都应该扔给它去改代码”。

## 14. `Explore` 和 `Plan` 两个 builtin agent 都是强 read-only specialist，不只是“风格不同”

源码镜像：[`../../src/tools/AgentTool/built-in/exploreAgent.ts`](../../src/tools/AgentTool/built-in/planAgent.ts)

两者都明确：

- 禁止创建/修改/删除文件
- 禁止用 shell 写任何文件
- 只能读、搜、分析

但它们的目标不同：

- `Explore`：快速找文件、搜实现、做代码库导航
- `Plan`：基于探索结果生成实现计划、关键文件和顺序

所以它们不是同一把 read-only 工具换个名字，而是把 “找事实” 和 “做设计” 拆成两种不同专业角色。

## 15. `Explore` 的系统提示强调 “快” 和 “并行搜”，说明它是内建的 repo navigation accelerator

源码镜像：[`../../src/tools/AgentTool/built-in/exploreAgent.ts`](../../src/tools/AgentTool/built-in/exploreAgent.ts)

这份 prompt 明确要求：

- fast
- broad search first
- wherever possible spawn multiple parallel tool calls

而且它在 ant-native build 下还会自动改写搜索提示，从 `Glob/Grep` 转向 `find/grep via Bash`。说明 Explore agent 不是通用 planner，而是专门为 repo navigation 和 code discovery 做过宿主适配的搜索 worker。

## 16. `Plan` 不是“输出一个 TODO 列表”，而是带架构责任的 read-only architect role

源码镜像：[`../../src/tools/AgentTool/built-in/planAgent.ts`](../../src/tools/AgentTool/built-in/planAgent.ts)

Plan agent 的 required output 里强制要求：

- implementation strategy
- trade-offs
- sequencing
- `Critical Files for Implementation`

所以它的职责不是“简单总结一下会怎么做”，而是：

- 先探索
- 再提出架构与实施设计

这解释了为什么它和 Explore 分开存在，而不是一个 agent 里加个 thoroughness 参数。

## 17. `verification` agent 是 builtin catalog 里最强的“敌意 prompt”，说明 Claude Code 已经把 verifier 当成 first-class role

源码镜像：[`../../src/tools/AgentTool/built-in/verificationAgent.ts`](../../src/tools/AgentTool/built-in/verificationAgent.ts)

这份系统提示明显不是通用 agent 风格，而是明确灌入：

- 你不是来确认成功，而是来尝试破坏
- 两种常见失败模式：verification avoidance / 被前 80% 迷惑
- 必须给出 command run / output observed / PASS/FAIL/PARTIAL
- 必须包含至少一个 adversarial probe
- 最后必须输出 `VERDICT: ...`

这说明 verification 在 Claude Code 里不是一个“可以顺手让别的 agent 帮忙测”的小角色，而是被产品化成了专门的审计人格。

## 18. `verification` agent 还被定义成 `background: true`，说明内建 verifier 从一开始就按后台生命周期设计

源码镜像：[`../../src/tools/AgentTool/built-in/verificationAgent.ts`](../../src/tools/AgentTool/built-in/verificationAgent.ts)

它不仅是 specialist prompt，还自带：

- `background: true`
- `color: 'red'`
- 强制只读约束

这意味着 Claude Code 把 verifier 的正常运行模式预设成：

- 后台跑
- 有自己显眼的视觉编码
- 通过 task/notification 回流结果

而不是跟普通同步子代理等价对待。

## 19. `claude-code-guide` 说明 builtin agents 不只服务代码实现，也承担“官方文档中枢”角色

源码镜像：[`../../src/tools/AgentTool/built-in/claudeCodeGuideAgent.ts`](../../src/tools/AgentTool/built-in/claudeCodeGuideAgent.ts)

这个 agent 的角色和前几类完全不同，它专门负责：

- Claude Code CLI
- Claude Agent SDK
- Claude API

并且会把当前环境的：

- custom skills
- custom agents
- MCP servers
- plugin commands
- settings.json

补进自己的系统提示。也就是说它是一个 doc-specialist，但又不是纯外部文档机器人，而是会结合当前工作区配置来回答 “你现在这套 Claude Code 怎么用”。

## 20. `statusline-setup` 说明 builtin agent 还能是高度垂直的 operator specialist，而不是只做通用研究/验证

源码镜像：[`../../src/tools/AgentTool/built-in/statuslineSetup.ts`](../../src/tools/AgentTool/built-in/statuslineSetup.ts)

这个 agent 的 prompt 已经不是一般“帮我配置个东西”，而是细到：

- 从哪些 shell rc 文件读 PS1
- 哪些 escape sequence 怎么翻译
- `statusLine` command 的 JSON stdin 长什么样
- symlink settings.json 怎么更新

这说明 builtin agents 的覆盖面不止代码任务，也包括非常垂直的 operator workflow specialist。

## 21. 从这两层源码一起看，agent 的“个性”是由长期记忆层和内建角色 prompt 层共同决定的

把 `agentMemory*` 和 `built-in/*.ts` 合起来看，会发现 Claude Code 对 agent differentiation 不是只靠名字：

- prompt 层：通过 specialist system prompt 切出角色
- memory 层：通过 per-agentType persistent memory 累积长期偏好/知识
- snapshot 层：通过项目种子把 agent bootstrapping 标准化

也就是说，Claude Code 已经把 “为什么这个 agent 像一个稳定角色” 做成了两层机制，而不是只写一段 whenToUse。

## 交叉参考

- AgentTool 主 runtime：[`./51-agent-definitions-selection-spawn-and-handoff-runtime.md`](./51-agent-definitions-selection-spawn-and-handoff-runtime.md)
- managed agents 治理：[`./41-policy-settings-governance-across-agents-skills-output-styles-and-tips.md`](./41-policy-settings-governance-across-agents-skills-output-styles-and-tips.md)
- memdir / session memory：[`./12-memdir-and-session-memory.md`](./12-memdir-and-session-memory.md)
- swarm teammate 运行时：[`./16-swarm-teammates-and-permission-bridges.md`](./16-swarm-teammates-and-permission-bridges.md)
