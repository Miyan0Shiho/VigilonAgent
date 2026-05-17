# 用户 01：终端与重度使用者

## 目标

- 用最少切换成本在代码库里完成探索、修改、验证、提交与恢复。
- 在长期任务中保持上下文连续性，而不是每轮重新解释项目状态。
- 根据风险大小切换模式，而不是始终手工审批每一步。

## 主要能力

- 通过 CLI 与 REPL 直接发起任务，使用 `default`、`acceptEdits`、`plan`、`dontAsk`、`bypassPermissions` 等模式控制节奏。
- 使用 `--continue`、`--resume`、`--fork-session`、`--worktree`、`--bg`、`ps/logs/attach/kill` 组织长任务与并行任务。
- 使用 slash command、skills、subagents、attachments、`@agent-*` 以及 headless/print 模式把日常工作固化为套路。

## 关键摩擦

- 模式过多，尤其是 default / acceptEdits / plan / auto / dontAsk / bypass 之间的心理模型对新重度用户不够直观。
- fast-path 很强，但入口碎片化，用户需要知道什么时候该走 `remote-control`、什么时候该走 `--worktree`、什么时候该走 `--print`。
- 长会话强依赖 transcript、compact、resume 语义；一旦用户不了解 compact boundary、fork-session 与 background task 的差异，容易混淆上下文来源。
- REPL、CLI flag、slash command、agent mention 同时存在，说明力很强，但也提高了学习门槛。

## 关键源码支撑

- `packages/claude-code/src/entrypoints/cli.tsx`：高频 power workflow 入口都在这里被显式建模。
- `packages/claude-code/src/screens/REPL.tsx`：终端用户的真实交互承接层，包含 prompt、permission、task list、remote/session 状态。
- `packages/claude-code/src/utils/processUserInput/processUserInput.ts`：slash command、attachments、hooks、bridge-safe command、`@agent-*` 都在这层汇流。
- `packages/claude-code/src/utils/sessionStorage.ts`：resume/fork/background/subagent transcript 的持久化底座。
- `packages/claude-code/src/tasks/LocalMainSessionTask.ts`：后台主会话任务与通知机制。

## 对 Vigilon 的启发

- 面向 power user，最重要的不是“更聪明的回答”，而是更稳的任务连续性和更低的工作流切换成本。
- 所有高频动作都应有一条短路径，但需要给出更强的路径引导，否则强大入口会反过来变成摩擦。
- session、worktree、background task 不应是高级黑话，而要被产品显式解释成几种可预期的工作方式。
