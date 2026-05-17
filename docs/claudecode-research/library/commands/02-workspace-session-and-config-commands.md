# 工作区、会话与配置命令

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：命令注册表`](./01-command-registry-and-dispatch.md) | [`下一站：集成与产品工作流命令`](./03-integration-and-product-workflow-commands.md)

本文聚焦最基础、也最影响日常使用的命令簇：工作区切换、会话操作、配置与运行模式切换。

## 1. 工作区命令不是“帮助用户输路径”

从 `add-dir`、`branch`、`files`、`context` 等命令可以推断，这一层在解决：

- 当前工作目录与附加目录如何进入 system prompt
- worktree / branch / 目录范围如何影响权限和文件可见性
- 当前上下文有哪些文件、路径和项目边界

这些命令的价值在于“重构 agent 所处的世界”，而不是只给用户一个便捷菜单。

## 2. 会话命令是在操控 transcript 生命周期

像 `clear`、`compact`、`resume`、`rewind`、`session` 这类命令，本质上是在操作：

- 当前消息链
- compact boundary
- 可恢复状态
- 会话名称和可见历史

因此它们和 `sessionStorage.ts`、`sessionRestore.ts`、REPL 恢复逻辑是强耦合的。

## 3. 配置命令是在修改运行模式

像 `config`、`permissions`、`model`、`output-style`、`theme`、`effort`、`sandbox-toggle` 并不只是设置项 UI，它们实质上会影响：

- 当前可用模型和 thinking 策略
- 当前 permission mode
- 当前输出与交互风格
- 当前 sandbox / auto mode 语义

也就是说，这些命令在修改“运行时解释器参数”。

## 4. 为什么这类命令优先级高

这些命令决定 Claude Code 当前会话的边界条件。没有这层理解，就无法解释：

- 为什么同一个 prompt 在不同 mode 下行为不同
- 为什么 resume 后某些能力面发生变化
- 为什么 branch/worktree/额外目录会改变 prompt 与权限语义
