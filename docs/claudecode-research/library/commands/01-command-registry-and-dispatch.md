# 命令注册表与分发机制

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Components / Hooks / Ink`](../architecture/05-components-hooks-and-ink.md) | [`下一站：工作区与会话命令`](./02-workspace-session-and-config-commands.md)

本文聚焦 `commands/**` 目录的总机制：本地 slash commands 如何被发现、注册、解释并接入 prompt 处理链。

## 1. `commands/init.ts` 说明命令不是固定字符串映射

源码镜像：[`../../sources/claude-code/src/commands/init.ts`](../../sources/claude-code/src/commands/init.ts)

`/init` 这个例子已经足够说明命令系统的复杂度：

- 命令可以返回动态 prompt，而不是静态文本
- 命令受 feature gate 和环境变量影响
- 命令可以定义 `progressMessage`
- 命令内容可以是完整工作流说明，而不是简单动作描述

这意味着命令系统不是“把 `/foo` 翻译成一段 prompt”，而是一个本地工作流注册表。

## 2. `processUserInput()` 是命令分发入口

命令不会直接从 REPL 被调用模型，而是先经过：

- slash command 解析
- bridge-safe command 判定
- 本地 JSX command / prompt command / 非交互 command 的分流

所以 `commands/**` 与 `processUserInput()` 是强耦合关系。

## 3. 命令大致可以分成几类

从目录看，至少有这些命令族：

- 会话与导航：`clear`、`compact`、`resume`、`rewind`、`session`
- 工作区与 Git：`add-dir`、`branch`、`diff`、`files`
- 配置与模式：`config`、`model`、`permissions`、`output-style`、`theme`
- 集成与平台：`mcp`、`plugin`、`remote-setup`、`bridge`、`desktop`
- 产品工作流：`review`、`plan`、`skills`、`memory`、`tasks`

这些命令不是平铺罗列的，它们本质上在扩展 Claude Code 的本地控制面。

## 4. 为什么命令体系必须单独成卷

如果只写 query loop 和 tools，会漏掉 Claude Code 很多“产品功能是怎么进入系统”的关键事实：

- 不是所有功能都通过模型调用工具触发
- 很多功能首先是 slash command
- 有些 slash command 只是本地状态机入口，有些则会进一步进入 agent loop

这正是命令体系需要单独拆开的原因。
