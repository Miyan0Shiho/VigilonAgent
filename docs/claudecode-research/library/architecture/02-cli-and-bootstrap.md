# CLI 分发与启动装配

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：架构总卷`](./01-04.md) | [`下一站：REPL 与 UI`](./03-repl-and-ui-runtime.md)

本文聚焦 Claude Code 如何从一个单独的 CLI 入口，分发到 bridge、daemon、后台会话、runner、完整 TUI 主程序等多种运行形态。

## 1. 物理入口：`entrypoints/cli.tsx`

源码镜像：[`../../src/entrypoints/cli.tsx`](../../src/entrypoints/cli.tsx)

这里不是“简单调用 `main.tsx`”，而是一层强分流器：

- 顶层先做环境变量修补，例如 remote 环境的 `NODE_OPTIONS` 和某些 ablation 开关。
- `main()` 先处理 fast-path，再决定是否动态导入重模块。
- `--version` 这类命令走零依赖路径，避免装配 React/Ink、配置和 analytics。

这意味着 Claude Code 的启动设计目标之一就是把“冷启动成本”留给真正需要完整会话能力的路径。

## 2. Fast-path 家族

在 `cli.tsx` 里可以直接看到几类 fast-path：

- prompt 导出路径：`--dump-system-prompt`
- Chrome / Computer Use 相关 MCP server
- daemon worker
- `remote-control` / `bridge`
- daemon supervisor
- background sessions：`ps`、`logs`、`attach`、`kill`、`--bg`
- 模板任务、environment runner、自托管 runner
- `--worktree --tmux` 组合路径

这些路径有几个共性：

- 大量使用 `await import(...)` 延迟加载。
- 有些只开启 config，不开启完整 sinks。
- 有些必须在主程序前完成权限、auth、policy limits 检查。

所以“Claude Code 是一个 TUI”这个说法只对一部分场景成立。更准确的说法是：它是一个以 CLI 为统一表面、内部承载多种执行模式的 agent runtime。

## 3. 完整主程序：`main.tsx`

源码镜像：[`../../src/main.tsx`](../../src/main.tsx)

`main.tsx` 负责完整环境装配，典型内容包括：

- settings / config 读取
- policy limits 初始化
- analytics / sinks / logging 装配
- plugins / skills / MCP 连接管理
- LSP、UI、任务、会话恢复、主题等会话级依赖

这个文件的角色不是“执行任务逻辑”，而是“把一个可运行的 agent 工作台搭起来”。

## 4. 为什么要分成两层

`cli.tsx` 和 `main.tsx` 的分层是 Claude Code 很关键的工程决策：

- CLI 层负责低成本判定“到底要不要进入完整主程序”。
- 主程序层负责把完整 session runtime 装起来。
- 这让 bridge、daemon、runner、后台会话等路径可以跳过大量无关依赖。

如果把所有逻辑都塞进一个 `main()`，会带来两个直接问题：

- 启动变慢，尤其是自动化或远端控制场景。
- 非交互路径也会被迫耦合大量 UI/TUI 初始化。

## 5. 相关链路

- 输入进入真正的会话处理前，下一站读 [`../implementation/02-input-processing-and-command-dispatch.md`](../implementation/02-input-processing-and-command-dispatch.md)
- 想看完整 UI 装配承载，下一站读 [`./03-repl-and-ui-runtime.md`](./03-repl-and-ui-runtime.md)
- 想看 bridge / daemon / remote-control 的执行面，下一站读 [`./04-bridge-remote-and-daemon.md`](./04-bridge-remote-and-daemon.md)
