# 用户 04：集成商与自动化流水线

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`用户卷首页`](./01-terminal-and-power-users.md) | [`上一站：扩展开发者`](./03-extension-developers.md)

## 目标

- 把 Claude Code 的探索、编辑、执行、验证能力嵌入现有自动化工作流。
- 通过 headless、bridge、daemon、remote-control 等入口进行跨进程或跨网络调度。
- 在弱监督或无人值守场景下，仍然保持权限最小化授权与完整审计。

## 主要能力

- 多路 fast-path 入口，避免每次都装配完整 TUI。
- 会话级 API 风格入口，可程序化提交消息与接收结果。
- 后台会话管理，支持异步 attach、logs、ps 与状态检索。
- 输入预处理可在进入模型循环前做 bridge-safe 判定与 hooks 拦截。

## 关键摩擦

- 交互式审批在自动化环境中容易变成阻塞点。
- 本地工作区与远端 agent 状态同步容易隐式漂移。
- 集成方式偏 CLI wrapper / JSON 解析，缺少稳定 SDK。
- 预算与退出条件如果设计不好，容易出现 token 黑洞或死循环。

## 关键源码支撑

- [`../sources/claude-code/src/entrypoints/cli.tsx`](../../sources/claude-code/src/entrypoints/cli.tsx)：处理 `bridge`、`daemon`、`remote-control` 等非交互入口。
- [`../sources/claude-code/src/QueryEngine.ts`](../../sources/claude-code/src/QueryEngine.ts)：`submitMessage()` 是不依赖 TUI 的会话入口。
- [`../sources/claude-code/src/utils/processUserInput/processUserInput.ts`](../../sources/claude-code/src/utils/processUserInput/processUserInput.ts)：在模型请求前做命令判定、钩子与输入治理。
- [`../sources/claude-code/src/utils/sessionStorage.ts`](../../sources/claude-code/src/utils/sessionStorage.ts)：保存 transcript、subagent 记录与恢复元数据。
- [`../sources/claude-code/src/services/api/claude.ts`](../../sources/claude-code/src/services/api/claude.ts)：承接流式 API、预算控制与 tracing。

## 对 Vigilon 的启发

- 集成场景应优先暴露稳定协议，而不是逼集成方模拟终端行为。
- 自动化权限要有任务级或会话级预授权方案。
- Agent 决策、工具执行与状态变更要默认支持结构化审计输出。
