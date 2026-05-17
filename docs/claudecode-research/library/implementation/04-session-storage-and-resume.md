# Session Storage 与恢复

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Query Loop`](./03-query-loop-and-recovery.md) | [`下一站：工具池与 ToolUseContext`](../mechanisms/02-tool-pool-and-tool-use-context.md)

本文聚焦 `sessionStorage.ts` 如何把一次会话写成可恢复、可分叉、可承载子代理的 transcript。

## 1. Transcript 不是日志附属物，而是运行时底座

源码镜像：[`../../sources/claude-code/src/utils/sessionStorage.ts`](../../sources/claude-code/src/utils/sessionStorage.ts)

从 `getTranscriptPath()`、`getTranscriptPathForSession()`、`getAgentTranscriptPath()` 可以看出，Claude Code 把 session transcript 当成核心数据结构，而不是简单调试日志。

它负责承载：

- 主会话消息链
- subagent transcript
- compact boundary
- content replacement
- file history snapshot
- attribution snapshot
- worktree session 与 resume 元数据

## 2. 写什么，不写什么，是一个显式设计

`isTranscriptMessage()` 与 `isChainParticipant()` 非常关键：

- user / assistant / attachment / system 才算 transcript message
- progress message 不参与 parentUuid chain

注释里明确写了原因：把 progress 写进链会造成 resume 时真实消息被 orphan。

这说明 session storage 不是“能存就都存”，而是严格区分：

- 长期会话真相
- UI 临时态

## 3. 路径与项目目录为什么这么复杂

`getSessionProjectDir()`、`getOriginalCwd()`、`sessionProjectDir` 的注释表明，Claude Code 专门处理了：

- symlink / realpath 导致的目录漂移
- resume / branch / worktree 后 transcript 目录不一致
- 当前 session 与其他 session 查询路径不同

这类细节如果不处理，会直接导致“文件明明存在，但恢复路径找不到”。

## 4. Subagent transcript 不是拼在主文件里

`agentTranscriptSubdirs`、`getAgentTranscriptPath()`、`writeAgentMetadata()` 表明：

- 子代理可以拥有独立 transcript
- transcript 路径可按工作流分组到不同子目录
- agent metadata 用 sidecar 文件保存 agent type、worktreePath、description

这比简单把子代理消息串回主链更适合恢复、通知和异步任务巡检。

## 5. 为什么这层是“实现库”的必修课

如果不理解 session storage，很容易误判 Claude Code：

- 以为它只是一个前台对话器
- 以为 subagent 只是 prompt delegation
- 以为 compact 只是模型输入摘要

实际上 transcript 设计把这些能力串成了一个可恢复的长期会话系统。
