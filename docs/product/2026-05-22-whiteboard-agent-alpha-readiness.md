# Whiteboard Agent Alpha Readiness

- 日期：2026-05-22
- 状态：Alpha 收尾判断
- 新阶段口径：不再证明 Vigilon 等于 Claude Code；把 Vigilon 从 Claude Code 参考工程切成一个干净、可运行、可扩展的白板 Agent Alpha。

## 1. 阶段定义

Whiteboard Agent Alpha 的目标不是成熟产品级对标，而是得到一个基础能力接近 Claude Code 形态的独立本地 Agent：

- 能理解用户目标并进入 agent loop。
- 能读、搜、改、写、执行命令。
- 能处理 plan / todo / result handoff。
- 能保留 transcript、resume、memory、compact。
- 能通过 permission / sandbox 控制本地执行风险。
- 能托管基础 subagent / task host。
- 能通过 settings / skills / MCP / project instructions 扩展。

这个阶段之后，Vigilon 才进入不同方向的 specialist Agent 演化，例如搜索特化 Agent、持续干活 Agent、代码维护 Agent 或更高层的超级 Agent。

## 2. 与 Claude Code 的对比口径

Claude Code 只作为基础功能 checklist，不再作为成熟度验收标准：

- 要看“有没有基础能力、能不能用、能不能扩展”。
- 不追求 Claude Code 大量真实数据迭代后的体验稳定性。
- 不继续把 closure 绑定到源码机制级深度对照。
- 开源 Alpha 已将 Claude Code / research 源码镜像从 Git 工作树移除，并压缩归档到本机 `.local-archives/`，避免叙事与许可证风险。

## 3. 当前可收尾能力

当前 runtime 已经覆盖白板 Agent Alpha 的主要基础面：

- CLI / TUI task entry。
- DeepSeek provider。
- Read / Grep / Glob / LSP。
- Write / Edit / Bash。
- WebFetch / Notebook。
- Todo / Plan / ResultReport。
- Transcript / sessions / resume。
- Session memory / long-term memory promotion。
- Manual compact / memory readiness / provider-grounded validation。
- Permission modes / Bash safety policy / macOS read-only sandbox。
- Subagent / AgentInventory / task inspect-resume-stop-apply。
- Worktree task host and source apply lifecycle。
- Skills / MCP loading。
- Provider cache usage and provider-backed cache probe。

本轮为 Alpha 补齐了三个更偏“基础 Agent 可用性”的缺口：

- `vigilon init`：初始化 `.vigilon/settings.json`、`AGENTS.md`、agents / skills 目录，并自动探测 package scripts 作为 default commands。
- `vigilon tools`：输出当前 core tools、MCP tools、skills 和 effective tool count。
- Project instructions：运行时读取 `AGENTS.md`、`VIGILON.md`、`.vigilon/instructions.md`，并注入 CLI / TUI 的模型上下文。

## 4. 不作为 Alpha 阻塞的缺口

以下能力重要，但不是 Whiteboard Agent Alpha 开源前阻塞：

- Claude Code 级别的真实任务稳定性。
- 大规模 prompt cache break diagnosis。
- 完整跨平台 sandbox adapter。
- 完整 shell AST。
- 完整 TUI daily-driver 体验。
- 自动 memory -> skill / agent 整理。
- Specialist Agent 自动评估和演化系统。

## 5. 开源前阻塞

当前代码能力可以进入 Alpha，但仓库形态还不能直接公开发布。开源前必须先做 Open Source Alpha Cut：

1. 已移除并本机归档 `packages/claude-code/`、`docs/claudecode-research/`、`docs/archived-research/sources/`。
2. 已重写根 README：从“对标 Claude Code/Codex”改成“experimental local whiteboard Agent runtime”。
3. 已加 LICENSE 和公开 package metadata，workspace packages 不再标记 private。
4. 清理 product docs 中过重的 Claude Code closure 口径，仅保留必要历史说明或移入 archive。
5. 固化 Alpha gate：`pnpm build`、runtime tests、TUI tests、`pnpm phase2.5:baseline`、必要 smoke。
6. 提交当前大改动后再切 `v0.1.0` 或等价 tag。

## 6. 收尾判断

可以收掉“Claude Code 参考工程阶段”，进入 Alpha 清理阶段。

下一阶段建议命名为：

**Open Source Alpha Cut**

目标是仓库清理、开源口径、安装文档、license、quickstart 和 release gate，而不是继续追 Claude Code 深层对照。
