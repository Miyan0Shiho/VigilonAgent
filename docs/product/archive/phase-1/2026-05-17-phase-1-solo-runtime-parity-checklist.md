# Phase 1：Claude Code Core Parity for Solo Runtime

- 日期：2026-05-17
- 状态：Phase 1 路线图基线
- 目标：复刻 Claude Code 的核心本地 Agent Runtime 秩序，同时删除企业级产品包袱，服务个人开发者和后续 Agent 接手。

## 1. 阶段定义

Phase 1 不再泛称为 “Claude Code parity”，而是更准确地定义为：

**面向个人开发者的 Claude Code Core Parity / Solo Runtime 复刻。**

它的含义是：

- 复刻 Claude Code 的任务闭环。
- 复刻 Claude Code 的执行秩序。
- 复刻 Claude Code 的本地安全边界。
- 保留公司级工程纪律。
- 删除企业级产品包袱。
- 不复刻 Anthropic 的商业外壳。
- 不复刻 remote / bridge / multi-user / enterprise / admin / billing / telemetry / marketplace。

Vigilon 当前是个人学生开发者项目，但开发方式要模拟一家严肃公司：有定位、有阶段、有边界、有验收、有文档、有权限和可恢复性。模拟的是产品与工程纪律，不是公司组织系统。

## 2. Copy-First 机制设计要求

Phase 1 的具体功能设计必须遵守 copy-first：

1. 先按 Claude Code 源码机制和 `docs/claudecode-research/` 研究文档复刻运行时设计。
2. 再按 Vigilon 的 Solo Runtime、DeepSeek V4 和本地项目结构改写。
3. 最后再做优化、抽象和产品体验升级。

这条要求尤其适用于搜索链路、上下文压缩链路、记忆链路和核心工具实现。Phase 1 不接受先自行摸索一套“差不多能用”的搜索、压缩、记忆或工具系统。

机制对照表见：`docs/product/2026-05-17-phase-1-copy-first-mechanism-map.md`

## 3. Must Have：必须复刻

这些是 Agent Runtime 的地基。缺少任意一类，Vigilon 都会退化成“能调用工具的聊天框”。

| 机制 | 必须具备的行为 | 验收标准 |
| --- | --- | --- |
| 主 Agent Loop | 用户输入进入模型，模型发起 tool use，tool result 回填，再继续模型循环直到完成 | DeepSeek V4 驱动同一条 loop；支持工具调用、错误回填、最终报告 |
| DeepSeek V4 Tool Calling | DeepSeek V4 是主模型能力，不是旁路 demo | 能稳定生成、解析、执行工具调用，并处理失败重试 |
| Tool Registry / ToolUseContext | 所有工具从统一上下文获得 cwd、权限、配置、会话、abort signal、UI 回调 | 禁止工具各自绕过权限或自行读取零散环境状态 |
| Read Tool | 读取文件并进入上下文 | 大文件、二进制、缺失文件有明确错误与截断策略 |
| Write Tool | 创建或完整重写文件 | 写入前后进入 transcript；必要时走权限 gate |
| Edit Tool | 对已有文件做局部修改 | 有 staleness 检查、失败原因、diff 展示 |
| Grep / Glob | 快速定位文件和代码片段 | 默认尊重 ignore；结果有数量上限；输出适合模型消费 |
| Bash Tool | 执行测试、构建、诊断命令 | timeout、interrupt、危险命令审批、stdout/stderr 截断 |
| Todo / TaskList | 维护当前任务的结构化进度 | 模型能创建、更新、完成 todo；最终报告对齐 todo |
| Permission Gate | 对写文件、shell、删除、网络、外部工具等风险动作做拦截 | 至少支持 read-only、ask、accept low-risk edits、dangerous ask |
| Plan Mode | 大范围或高风险任务先计划后执行 | Plan 是 runtime phase transition；计划阶段实现读写受限；用户确认后才能进入执行 |
| Transcript | 记录消息、工具调用、工具结果、权限决定、错误与最终报告 | transcript 是 resume、审计、压缩、后续 Agent 接手的事实底座 |
| Resume | 从 transcript 恢复会话 | 退出后能继续上一次任务，并保留关键上下文 |
| Context Governance | 控制上下文成本与污染 | 文件读入去重、大输出截断、工具结果摘要、content replacement、压缩边界、resume consistency |
| Diff / Edit Safety | 用户能信任 Agent 改代码 | 修改后能看到 diff；编辑失败不静默；文件变更冲突可解释 |
| Stop / Timeout / Error Recovery | 任务可以停止，长命令不会挂死，失败能继续处理 | 用户能中断；工具失败进入模型上下文；状态保持一致 |
| Result Report | 完成后给出可接手结果 | 必须说明改了什么、验证了什么、没验证什么、剩余风险 |

## 4. Solo Simplified：必须有，但按个人开发者简化

这些机制体现公司级工程纪律，但不能企业化。目标是轻量、可本地运行、可维护。

| 机制 | 简化边界 | 不做什么 |
| --- | --- | --- |
| Local Settings | 本机配置模型、权限默认值、工具开关 | 不做组织级策略中心 |
| Project Config | 项目级规则、默认命令、ignore、允许工具 | 不做多租户或管理员下发 |
| Permission Modes | 少数清晰模式即可：read-only / ask / accept-edits / bypass-local | 不做复杂企业权限矩阵 |
| PreToolUse Hook | 允许本地脚本或规则在工具执行前拦截 | 不做完整 hook marketplace |
| MCP Loading | 支持本地 MCP 配置、加载工具、调用工具、展示错误 | 不做 OAuth、远程 marketplace、企业 server 管理 |
| Skill Loading | 支持本地 skills 读取和注入上下文 | 不做 skill 商店、自动发布、复杂信任治理 |
| Session List | 能列出本地会话并恢复 | 不做云同步、多设备协同 |
| Task Checklist | 每个开发任务映射到 checklist 项 | 不做公司项目管理系统 |
| Verification Summary | 每次任务结束必须列验证证据 | 不做企业审计报表 |
| Decision Docs | 关键方向进入 `docs/product/` 或 specs | 不做繁重流程文档 |

## 5. Explicitly Excluded：当前明确不做

这些不是“以后再说”的默认后置项，而是在当前个人开发者产品定位下明确排除。未来只有当真实个人使用场景需要时，才重新立项。

| 排除项 | 排除原因 |
| --- | --- |
| Anthropic / Claude 品牌外壳 | 与 Vigilon 产品无关 |
| 企业账号体系 | 个人开发者项目不需要多用户组织系统 |
| 组织权限矩阵 | 本地权限 gate 足够，不需要 enterprise admin |
| Billing / License / Subscription | 非商业化阶段无意义 |
| 商业遥测 / Growth / Datadog | 不服务任务闭环，且增加噪音和风险 |
| Managed Enterprise Policy | 只保留本地 settings / project config |
| Remote / Bridge | 当前不需要跨机器控制；先做好本地 runtime |
| Desktop / Mobile / Slack 多端产品面 | 不是 Phase 1 任务闭环前提 |
| Marketplace | MCP / skills 先本地加载，不做生态分发 |
| 完整 Plugin Governance | 当前只需要轻量 hooks / MCP / skills |
| 企业 CI/CD 集成产品面 | 可通过 Bash/GitHub 工具完成具体任务，不做公司级集成面 |
| 自动更新 / 官方分发链路 | 本地开发阶段无意义 |
| 趣味化 companion / 品牌装饰 | 不提高任务完成率或可验证性 |

## 6. Phase 1 验收任务

Phase 1 的验收不看模块数量，而看能否完成真实本地代码任务。

标准验收场景：

1. 给 Vigilon 一个陌生 TypeScript / JavaScript 仓库。
2. 用户提出一个真实 bugfix 或小功能任务。
3. Vigilon 能读 README、搜索代码、定位相关实现。
4. Vigilon 能进入 plan mode，并在需要时等待用户确认。
5. Vigilon 能编辑文件并展示 diff。
6. Vigilon 能运行测试、typecheck 或复现命令。
7. 高风险 shell 或写操作会触发权限确认。
8. 所有消息、工具调用、权限决定、错误、验证结果进入 transcript。
9. 退出后能 resume，并继续该任务。
10. 最终报告说明改动、验证、未验证项和剩余风险。

如果这条验收链路稳定，Phase 1 才算成立。

## 7. 后续排序建议

### Slice 1：主循环与工具调用

- DeepSeek V4 model client
- Agent loop
- Tool schema / tool call parsing
- Tool result 回填
- 基础错误回填
- 对照 Claude Code 的 `processUserInput -> QueryEngine -> query loop`

### Slice 2：核心工具与权限

- Read / Write / Edit / Grep / Glob / Bash / Todo
- ToolUseContext
- Permission gate
- Bash timeout / interrupt
- 对照 Claude Code 的 FileReadTool / GrepTool / GlobTool / FileEditTool / FileWriteTool / BashTool / TodoWriteTool

### Slice 3：计划、记录与恢复

- Plan Mode
- Transcript
- Resume
- Session list
- Result Report
- 对照 Claude Code 的 EnterPlanMode / ExitPlanMode / sessionStorage

### Slice 4：上下文与编辑安全

- Context governance
- Diff rendering
- Staleness check
- Output truncation / summarization
- Content replacement / compact boundary / resume consistency

### Slice 5：轻量扩展

- Local settings
- Project config
- PreToolUse hook
- MCP loading
- Skill loading

## 8. 实现准则

任何 Phase 1 开发任务都必须回答：

- 它属于 Must Have、Solo Simplified，还是 Explicitly Excluded？
- 它对照的 Claude Code 源码机制和研究文档是什么？
- 它推进了哪条任务闭环？
- 它是否进入 transcript？
- 它是否尊重 permission gate？
- 它失败时用户和模型是否都能看到原因？
- 它是否有可运行验收方式？

如果一个功能无法回答这些问题，默认不进入 Phase 1。
