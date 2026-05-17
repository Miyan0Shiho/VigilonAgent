# OpenSpec（Fission-AI/OpenSpec）深度调研

仓库：<https://github.com/Fission-AI/OpenSpec>  
npm：`@fission-ai/openspec`  

## 1. 一句话总结
OpenSpec 是一个 **面向 AI 编程助手的 Spec-Driven Development（SDD）框架与 CLI**：通过在代码库中引入 `openspec/` 目录，把“规格（specs）”与“变更（changes）”结构化落盘，并用 `/opsx:*` 工作流（OPSX）驱动 AI 先产出可验证的规格与任务，再进入实现与归档，从而降低“只靠聊天记录写代码”的不确定性。

## 2. OpenSpec 解决的核心问题
AI 编程助手强在生成与执行，但弱在：
- **需求漂移**：聊天上下文长、易忘、反复改口；
- **可复核性差**：缺少“可审计的意图/范围/验收”；
- **并行工作难**：多条需求/多条分支在 chat 里互相污染；
- **交付不可控**：没有结构化任务清单，容易遗漏边界与回归点。

OpenSpec 的定位是：用最轻的结构把“需求→设计→任务→实现”外化为文件，并让 AI 的行为围绕这些文件运转。

## 3. 设计哲学（官方主张）
OpenSpec README/Concepts 反复强调四个原则：
- fluid not rigid：不靠阶段门控，把“动作”当成一等公民  
- iterative not waterfall：实现中发现问题可回改 artifacts  
- easy not complex：最小仪式感，快速接入  
- brownfield-first：优先服务存量代码库（delta specs）而不是只服务从 0 开始

## 4. 核心概念与数据模型（你需要记住的 4 个实体）
OpenSpec 的“数据模型”本质是 **文件/目录约定 + 语义标记**，而不是复杂数据库。

### 4.1 Specs：系统“现状行为”的事实来源（source of truth）
目录：`openspec/specs/<domain>/spec.md`  
内容：以“Requirement + Scenario”的方式描述外部可观察行为（偏契约，不是实现细节）。  
规范建议使用 RFC 2119 关键词（MUST/SHALL/SHOULD/MAY）。

### 4.2 Changes：一次变更的“打包单元”
目录：`openspec/changes/<change-name>/`  
每个 change 是一个文件夹，聚合：
- `proposal.md`：为什么做、做什么、范围、影响
- `specs/**`：delta specs（相对主 specs 的增量）
- `design.md`：怎么做（架构/权衡/风险）
- `tasks.md`：可追踪的实现清单（checkbox）

### 4.3 Delta Specs：面向 brownfield 的关键机制
与其重写整份 spec，OpenSpec 推崇 **“描述变化”**：
- `## ADDED Requirements`：新增
- `## MODIFIED Requirements`：修改（强调：需要拷贝完整 requirement block 再改）
- `## REMOVED Requirements`：删除（需说明 Reason/Migration）
- `## RENAMED Requirements`：重命名（FROM/TO）

其价值：
- **审阅高效**：reviewer 关注变化；
- **并行友好**：多个 change 可在不同 requirement 上并行；
- **归档可合并**：archive/sync 时把 delta 语义合到主 specs。

### 4.4 Artifacts & Schemas：把“工作流”做成可配置依赖图
OpenSpec 将 proposal/specs/design/tasks 视为 artifacts，并用 schema 定义它们的依赖关系（而不是写死在代码里）。

默认 schema（`schemas/spec-driven/schema.yaml`）定义了：
- `proposal` → `specs` & `design` → `tasks` → `apply`

并且每个 artifact 都有：
- `template`：模板文件
- `instruction`：生成指令（会与项目 context/rules 组装成 prompt）
- `requires`：依赖列表（形成 DAG）

## 5. OPSX：从“阶段”到“动作”的工作流设计
OpenSpec 将核心 workflow 称为 OPSX，并用 slash commands 表达（通常由你使用的 AI 工具识别为命令/技能）。

### 5.1 默认快速路径（core profile）
适合“需求较清晰”的小中型改动：
1) `/opsx:propose`：一键创建 change 并生成 planning artifacts  
2) `/opsx:apply`：按 tasks 实现并勾选  
3) `/opsx:archive`：归档（可选 sync delta specs）

### 5.2 扩展工作流（custom profile 选择更多动作）
当你希望更细粒度控制：
- `/opsx:new`：只创建 change scaffold  
- `/opsx:continue`：按依赖逐个生成 artifact  
- `/opsx:ff`：一次性生成所有 planning artifacts  
- `/opsx:verify`：校验实现是否符合 artifacts  
- `/opsx:sync`：把 delta specs 合并回主 specs  
- `/opsx:bulk-archive`：批量归档并处理冲突  
- `/opsx:onboard`：引导式上手

OpenSpec 的核心观点是：**actions not phases**。你可以在 apply 过程中回头改 proposal/specs/design/tasks，然后继续执行。

## 6. CLI 能力面：OpenSpec “如何落地到工程里”
OpenSpec 本质上是一个 Node.js CLI（TypeScript），入口是：
- `bin/openspec.js`：执行 `dist/cli/index.js`
- `src/cli/index.ts`：用 `commander` 注册命令
- `src/core/init.ts`：初始化（生成目录结构 + 技能/命令文件）
- `src/core/update.ts`：更新（按 profile/delivery/workflows 重新生成并清理）

### 6.1 init：做了什么？
`openspec init` 主要产出三类东西：
1) `openspec/` 目录结构（specs/changes/archive/config.yaml）  
2) 给不同 AI 工具的 **skills**（例如 `.claude/skills/openspec-*/SKILL.md`）  
3) 给不同 AI 工具的 **commands**（可选；不同工具路径不同）

同时它会做：
- **工具目录自动检测**：扫描 `.claude/`、`.cursor/` 等决定是否预选
- **legacy 清理/迁移**：升级旧版生成物并清理（可 `--force`）
- **profile 覆盖**：`--profile core|custom`

### 6.2 update：做了什么？
`openspec update` 用来在你升级 npm 包后刷新本地工程的生成物：
- 读取 global config（profile/delivery/workflows）
- 判断哪些工具需要更新（版本漂移/配置漂移）
- 重新生成技能/命令文件，并移除“未选 workflow”对应的文件，保持工程干净

### 6.3 profile 与 delivery
从 README/CLI 文档可见两类关键开关：
- **profile**：`core`（默认 4 个动作） vs `custom`（自选 workflow 集合）
- **delivery**：skills、commands、both（决定生成 SKILL.md 还是命令文件或两者）

## 7. 工具适配与生态：它如何支持 20+ 编程助手？
OpenSpec 的策略是：对每个“AI 工具/IDE/Agent”实现适配器，映射到其可识别的：
- skills 路径模式
- commands 路径模式

文档给出了大量工具的目录约定（例如 Claude Code、Cursor、Windsurf、Copilot、Kiro、OpenCode、Trae 等）。  
这意味着 OpenSpec 并不是绑定某一 IDE，而是 **把“workflow 指令”分发到各工具能够消费的位置**。

## 8. 可定制性：从“写死模板”到“用户可编辑”
OpenSpec 当前主推 OPSX 的原因之一是：它把工作流从“硬编码在 TS”变为“schema.yaml + templates”：

### 8.1 最推荐的定制方式：项目级 config
`openspec/config.yaml` 支持：
- `schema`：默认 schema
- `context`：注入项目背景（会包在 `<context>...</context>` 里进入 prompt）
- `rules`：按 artifact id 注入约束（会包在 `<rules>...</rules>`）

这本质上是一个 **prompt 注入层**，用来让 AI 生成的 artifacts 更贴合你的代码库。

### 8.2 自定义 schemas：定义你自己的 artifact DAG
你可以把工作流变成：
- `research → proposal → tasks`  
或增加 `review` 节点、增加安全检查节点等。

配套命令：
- `openspec schema init|fork|validate|which`

## 9. Telemetry（匿名统计）与隐私边界
OpenSpec 明确声明收集匿名使用数据，并提供 opt-out：
- `OPENSPEC_TELEMETRY=0` 或 `DO_NOT_TRACK=1` 禁用
- CI 环境自动禁用

从实现看（`src/telemetry/index.ts`）：
- 事件是 `command_executed`，只带 `command` 与 `version`（并显式 `$ip: null`）
- 使用 PostHog SDK，host 为 `https://edge.openspec.dev`
- “静默失败”策略：网络异常不影响 CLI，且不输出噪声

## 10. 风险点 / 局限（工程视角）
### 10.1 依赖“人类愿意维护 specs”
OpenSpec 的价值来自 specs 的持续维护；如果团队只把它当“一次性文档生成”，specs 很快会陈旧，反而造成误导。

### 10.2 Delta specs 的合并语义依赖格式纪律
从 schema 指令看，OpenSpec 对格式有硬要求（例如 scenario 标题必须用 `####`，checkbox 必须 `- [ ]`）。  
这类“约定式解析”优点是轻量，缺点是：
- 轻微格式偏差会造成工具无法正确追踪/合并；
- 需要配合 `openspec validate` 或 CI 校验。

### 10.3 对复杂变更仍需要更强的验证闭环
`/opsx:verify` 主要做一致性检查与提示，仍可能需要结合：
- 测试与覆盖率  
- 性能/安全扫描  
- 变更评审流程

## 11. 对你最有用的落地建议（结合你现有的研究/产出习惯）
1) **把你最关心的“可复核”当成第一目标**：要求每个 Requirement 至少一个可验证 Scenario，并明确“怎么验证”（对应 tasks/test）。  
2) **对 brownfield 重构/修 bug 尤其合适**：用 delta specs 聚焦变化，比写大而全的 PRD 更经济。  
3) **先从 core profile 起步**：`propose → apply → archive`，避免一上来把流程做重。  
4) **用 config.yaml 注入你的硬约束**：比如语言（中文）、命名风格、异常处理、图表风格等，让 artifacts 与实现更一致。

## 12. 参考链接（建议你后续优先阅读）
- README（总览 + quick start）：<https://github.com/Fission-AI/OpenSpec/blob/main/README.md>
- Concepts（核心概念/Delta specs/Schemas）：<https://github.com/Fission-AI/OpenSpec/blob/main/docs/concepts.md>
- OPSX 工作流（为什么要从 legacy 迁移到 OPSX）：<https://github.com/Fission-AI/OpenSpec/blob/main/docs/opsx.md>
- Commands（/opsx:* 参考）：<https://github.com/Fission-AI/OpenSpec/blob/main/docs/commands.md>
- CLI（终端命令全集）：<https://github.com/Fission-AI/OpenSpec/blob/main/docs/cli.md>
- Customization（config/schema/template）：<https://github.com/Fission-AI/OpenSpec/blob/main/docs/customization.md>
- 默认 schema 定义：<https://github.com/Fission-AI/OpenSpec/blob/main/schemas/spec-driven/schema.yaml>

