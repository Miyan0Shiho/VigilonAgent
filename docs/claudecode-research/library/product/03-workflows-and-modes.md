# 产品 03：工作流与模式

## 研究问题

- Claude Code 把哪些工作流做成了一等路径？
- 官方说的 plan、resume、parallel、remote-control，在源码里是怎样落成不同模式与入口的？
- 用户体验上的“流畅感”主要来自哪些工作流秩序，而不是哪些模型能力？

## 一句话结论

Claude Code 的产品完成度主要来自工作流编排：正常交互路径负责高频任务，fast-path 负责专门入口，background/resume 负责连续性，permission mode 与 policy path 负责风险约束。

## 官方主张 -> 用户可见行为 -> 源码实现

| 官方主张 | 用户可见行为 | 源码实现 |
| --- | --- | --- |
| Common Workflows 强调 understand/fix/refactor/test/PR/doc/resume/worktree/subagent/headless | 用户把 Claude Code 当成任务工作台，而非一次性对话框 | `packages/claude-code/src/entrypoints/cli.tsx` 暴露 `--print`、`--resume`、`--continue`、`--fork-session`、`--worktree`、`--agents`、`--mcp-config` 等入口 |
| Permission Modes 把 default/acceptEdits/plan/auto/dontAsk/bypass 视为核心控制面 | 用户在同一个任务里切换“探索、审批、自动执行”的节奏 | `packages/claude-code/src/types/permissions.ts` 与 `utils/permissions/PermissionMode.ts` 提供 mode 枚举与标题映射；`main.tsx` 接收 `--permission-mode` |
| Remote Control 强调“继续本地会话” | 用户可以跨设备继续任务，但仍依赖本地环境 | `cli.tsx` 对 `remote-control` fast-path 做 auth、version、policy 校验；`main.tsx` 还支持 `--remote-control`/`--rc` 作为交互模式 |
| Common Workflows 强调 background sessions 与 worktrees | 用户可以把长任务挂后台、恢复、并行工作而不冲突 | `cli.tsx` 的 `ps/logs/attach/kill` 与 `--bg`，`LocalMainSessionTask.ts` 的 background task transcript 与通知逻辑，`sessionStorage.ts` 的 resume/fork 支撑 |

## 正常交互路径

### 路径概述

- `claude` 进入 `cli.tsx`，在没有命中 fast-path 时进入 `main.tsx`。
- `main.tsx` 装配 settings、plugins、skills、MCP、session ingress、policy limits、IDE/REPL 上下文。
- `REPL.tsx` 承接输入、消息、权限弹窗、后台任务、远端会话、IDE 集成与 hook/mcp dialog。
- 用户输入进入 `processUserInput()`，再进入 `QueryEngine` / `query()` 主循环。

### 为什么这是第一主路径

- 这是源码里最完整的一条“人类在环”路径。
- 权限模式、hook、prompt dialog、task list、remote banner 都在这条链上被具体 UI 化。

## Fast paths

### 已确认的 fast paths

- `--version` / `--dump-system-prompt`
- `--claude-in-chrome-mcp` / `--chrome-native-host` / `--computer-use-mcp`
- `--daemon-worker` / `daemon`
- `remote-control` / `rc` / `remote` / `sync` / `bridge`
- `ps` / `logs` / `attach` / `kill` / `--bg` / `--background`
- `new` / `list` / `reply` templates
- `environment-runner` / `self-hosted-runner`
- `--tmux` + `--worktree`

### 产品意义

- 这说明 Claude Code 不是把所有场景都塞进一个 REPL，而是对高价值场景提供专门入口。
- fast-path 让一些工作流在完整 runtime 前就能完成调度，从而降低启动成本和认知成本。

## Background / resume 路径

### 背景会话

- `cli.tsx` 对 background session 提供专门管理命令。
- `LocalMainSessionTask.ts` 明确把主会话后台化，给每个 task 单独 transcript，并用通知回传结果。
- 这意味着“长任务可后台执行”不是实验玩法，而是被 task framework 吸收的一等路径。

### Resume / fork

- Common Workflows 把 `--continue`、`--resume`、`--fork-session` 视为日常工作流。
- `sessionStorage.ts` 明确处理 JSONL transcript、content replacement、compact boundary、remote hydrate、subagent transcript 与 sidecar metadata。
- `QueryEngine.submitMessage()` 还会在 query loop 前先写入用户消息，降低恢复断点丢失的风险。

## 企业 / policy-limited 路径

### 受限路径的产品意义

- Remote Control 会在入口层检查 `allow_remote_control` policy。
- Settings 文档里的 Managed/User/Project/Local scope，在源码中对应 `utils/settings/**` 与 managed settings 读取逻辑。
- `types/permissions.ts`、`PermissionMode.ts`、`utils/settings/types.ts` 共同表明管理员能限制 defaultMode、disableAutoMode、disableBypassPermissionsMode、allowedMcpServers、managed-only hooks/permissions。

### 为什么它重要

- Claude Code 并没有把“企业治理”放到产品外部，而是把它写进会话装配与模式切换路径本身。
- 对企业用户来说，模式不是 UX 皮肤，而是合规边界的一部分。

## 官方资料与仓库证据的对照

### 一致之处

- Common Workflows 的多数叙述都能在当前仓库找到入口或基建支撑。
- Permission Modes 中对 plan/resume/auto/dontAsk 的叙事，与本地 mode 类型、settings 字段和 CLI 参数相互印证。

### 需要谨慎表述的地方

- 官方对 auto mode 的 classifier 细节描述较多，但当前仓库更适合证明“mode 与入口存在”，对 classifier 服务端细节只能部分确认。
- 官方把很多高级流程写成对所有表面一致可用；当前源码更直接证明 CLI/REPL 与 headless/remote，而非每个表面的等价 UX。

## 当前缺口

- 仍需补读 `query.ts` 中 plan mode 与 stop hooks 的更细粒度协作。
- 仍需补 `sessionRestore.ts` 与 `remote/**`，把 resume、fork、remote hydrate 画成完整生命周期图。
