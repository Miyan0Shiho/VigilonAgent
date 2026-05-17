# 产品 01：定位与产品表面

## 研究问题

- Claude Code 在官方叙事里究竟被定义成什么产品？
- 它的第一性产品表面是单一 CLI，还是跨终端、IDE、桌面、Web 与移动的统一 agent runtime？
- 当前仓库源码能直接证明哪些表面，哪些仍主要来自官方资料台账？

## 一句话结论

Claude Code 的产品定位不是“一个终端聊天框”，而是一个以本地 agent runtime 为核心、以多表面接入为分发方式、以权限与会话治理为护栏的 coding agent 系统。

## 官方主张 -> 用户可见行为 -> 源码实现

| 官方主张 | 用户可见行为 | 源码实现 |
| --- | --- | --- |
| Overview 将 Claude Code 定义为可在 terminal、IDE、desktop app、browser 使用的 agentic coding tool | 用户不会只在 CLI 中遇到 Claude Code，而会在多入口间切换同一任务 | `packages/claude-code/src/entrypoints/cli.tsx` 的 `main()` 先分流 remote-control、daemon、background、runner、worktree/tmux 等入口；`packages/claude-code/src/main.tsx` 承担完整交互 runtime 初始化 |
| How Claude Code Works 强调“same underlying engine, different interfaces” | 用户感知到的是不同界面，但底层能力是统一的工具、上下文与会话机制 | `packages/claude-code/src/Tool.ts` 的 `ToolUseContext` 汇总 tools、commands、MCP、状态与通知；`packages/claude-code/src/tools.ts` 统一装配 built-in tools 与 MCP tools |
| Remote Control 文档强调“继续本地会话，而不是把任务迁到云端” | 用户能从浏览器/手机继续一台本地机器上的会话，且保留本地文件系统、MCP 和项目配置 | `packages/claude-code/src/entrypoints/cli.tsx` 对 `remote-control` / `bridge` 走 fast-path，并显式检查登录态、最小版本与 `allow_remote_control` policy |
| Overview 把“CLI、IDE、Desktop、Web、Slack、CI/CD”都列为 Claude Code 的产品表面 | 用户把它当成跨工作位面的任务执行器，而不是局限于单次问答 | `packages/claude-code/src/main.tsx` 同时装配 IDE、MCP、plugins、skills、session、remote/session ingress 等能力；`packages/claude-code/src/screens/REPL.tsx` 承接交互式表面 |

## 第一类判断：什么是第一性产品表面

### 一等表面

- 本地交互式会话：`cli.tsx -> main.tsx -> REPL.tsx` 是当前仓库最直接、证据最强的产品主链。
- Headless / SDK / print 模式：`main.tsx` 暴露大量 `--print`、`--output-format`、`--permission-mode`、`--resume`、`--mcp-config`、`--agents` 等参数，`QueryEngine.submitMessage()` 明确承担非交互会话执行。
- Remote Control / bridge：`cli.tsx` 中的 fast-path 不只是别名，而是一条带 auth、policy 与版本检查的独立入口。
- 后台与恢复：`cli.tsx` 处理 `ps/logs/attach/kill` 与 `--bg`，`sessionStorage.ts` 用 JSONL transcript 和 sidecar metadata 支撑恢复。

### 二等表面

- Desktop / Web / Mobile：官方文档明确把它们列为表面，但当前仓库内没有对应完整前端代码；本仓主要证明“本地 runtime 如何被这些表面接入”。
- Slack / CI / GitHub Actions / Channels：官方把它们列为接入面；当前仓库更能证明底层任务、print 模式、Remote Control、MCP 与 session persistence，而不是所有外部产品壳层。

## 第一性能力与次级能力

### 第一性能力

- 在代码库里读、改、跑、验：这是 Overview 与 How Claude Code Works 的共同主张，也正是 `tools.ts` 中 `Read/Edit/Write/Bash/WebFetch/WebSearch/TodoWrite` 等工具池的核心组合。
- 会话连续性：`QueryEngine.ts` 在进入 `query()` 前就会写入 transcript，`sessionStorage.ts` 明确围绕 JSONL、compact boundary、subagent transcript、remote hydrate 设计。
- 多模式治理：权限模式、plan mode、hooks、managed settings、policy limits 共同决定“能不能做”和“怎么做”。
- 扩展生态：skills、subagents、MCP、plugins 不是补丁，而是被官方文档和源码共同承认为一级能力面。

### 次级能力

- 某个单独 UI 壳层本身并不是护城河。真正的一致性来自同一个 runtime 在不同表面下复用工具池、会话持久化和权限治理。
- 单个命令或 slash command 不是产品定义中心，它们只是进入同一 agent harness 的交互皮层。

## 官方资料与仓库证据的对照

### 一致之处

- 官方强调“terminal + IDE + desktop + browser”的统一产品叙事，源码则用 `cli.tsx` 的多 fast-path 与 `main.tsx` 的重装配层证明这并非营销修辞。
- 官方强调“work from anywhere”“continue sessions”，源码则在 remote-control、background sessions、JSONL transcript、remote hydrate 上给出实现支撑。
- 官方强调“tools make Claude agentic”，源码中 `ToolUseContext`、`getAllBaseTools()`、`assembleToolPool()` 正是这层 agent harness 的直接实现。

### 漂移与保留意见

- 官方文档把 Desktop、Web、Mobile 叙述得很完整，但当前仓库只能直接证明本地 runtime 与 bridge/remote 接入层，不能单仓证明全部客户端壳层细节。
- 官方把 Slack、CI/CD、Chrome extension、Computer use 都纳入产品表面；本轮正文应将其视为“外部接入面”，而不是与本地 REPL 等量齐观的核心表面。

## 关键源码锚点

- `packages/claude-code/src/entrypoints/cli.tsx`：多 fast-path 产品面入口。
- `packages/claude-code/src/main.tsx`：完整主程序的装配与模式入口。
- `packages/claude-code/src/screens/REPL.tsx`：交互式表面的状态承接层。
- `packages/claude-code/src/Tool.ts`：统一工具执行上下文。
- `packages/claude-code/src/tools.ts`：工具池与 MCP 合流。
- `packages/claude-code/src/utils/sessionStorage.ts`：会话持久化与恢复。

## 当前缺口

- 仍需补读 `packages/claude-code/src/bridge/**` 与 `packages/claude-code/src/remote/**`，把 Remote Control 的连接生命周期写实。
- 仍缺 Desktop/Web/Mobile 表面在本仓之外的对照材料，当前更多依赖官方台账。
- 仍未把 `REPL.tsx` 的 UI 交互与 `QueryEngine`/`query.ts` 的内核边界画成图。
