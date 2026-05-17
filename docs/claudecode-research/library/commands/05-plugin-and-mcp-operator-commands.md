# Plugin 与 MCP Operator 命令族

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Review / Release / Upgrade`](./04-review-release-and-upgrade-commands.md) | [`下一站：Permission / MCP UI`](../architecture/06-permission-and-mcp-ui-systems.md)

本文聚焦一组真正承担“运维控制面”职责的命令：`/plugin`、`/mcp`、`/doctor`，以及 CLI 侧的 `claude mcp add`。这一组命令不是单纯列设置项，而是在管理扩展能力、连接状态和可信边界。

## 1. `/plugin` 本身几乎只是入口壳

源码镜像：[`../../sources/claude-code/src/commands/plugin/plugin.tsx`](../../sources/claude-code/src/commands/plugin/plugin.tsx), [`../../sources/claude-code/src/commands/plugin/PluginSettings.tsx`](../../sources/claude-code/src/commands/plugin/PluginSettings.tsx)

`plugin.tsx` 的 `call()` 几乎不做业务逻辑，只把 `args` 交给 `PluginSettings`。真正重要的是它把插件系统定义成一个显式产品控制台，而不是隐藏在配置文件里的旁路功能。

这意味着 `/plugin` 这一层的职责是：

- 统一进入已安装插件、市场、配置和信任提示
- 承接 `pluginOperations.ts` 与 `PluginInstallationManager.ts` 暴露出来的运行时动作
- 把“扩展能力管理”变成可交互工作流，而不是命令行碎片集合

## 2. `/mcp` 是“连接运营面”，不是静态设置页

源码镜像：[`../../sources/claude-code/src/commands/mcp/mcp.tsx`](../../sources/claude-code/src/commands/mcp/mcp.tsx), [`../../sources/claude-code/src/components/mcp/MCPSettings.tsx`](../../sources/claude-code/src/components/mcp/MCPSettings.tsx)

`mcp.tsx` 暴露了几个很关键的语义分支：

- `/mcp reconnect <server>` 进入重连流程
- `/mcp enable [name|all]` 与 `/mcp disable [name|all]` 直接改连接启用状态
- 裸 `/mcp` 进入 `MCPSettings`
- 在特定产品变体下，裸 `/mcp` 会重定向到 `/plugin` 的 installed tab

这里最关键的事实不是“有一个 MCP 页面”，而是：

- MCP server 的启停是命令级动作，不是只能手改配置
- `/mcp` 已经和插件体系开始合流
- `MCPSettings` 会从 `mcp.clients`、`mcp.tools`、agent 定义中重新拼一张当前能力图

所以 `/mcp` 的真实角色更接近“运行中的连接控制台”。

## 3. `MCPSettings` 在重建一张服务拓扑图

源码镜像：[`../../sources/claude-code/src/components/mcp/MCPSettings.tsx`](../../sources/claude-code/src/components/mcp/MCPSettings.tsx)

这个组件至少在做四件事：

- 从 `mcp.clients` 过滤出真正应该展示的 server
- 结合 `mcp.tools` 计算每个 server 当前暴露了哪些工具
- 区分 `stdio`、`sse`、`http`、`claudeai-proxy` 四类 transport
- 对 HTTP/SSE server 进一步判断认证状态，而不是只展示“连上/没连上”

也就是说，`/mcp` 看到的并不是 config 文件原样回显，而是“配置 + 当前连接状态 + 工具暴露结果 + 授权状态”综合后的运行时视图。

## 4. `claude mcp add` 是配置写入器，不是 UI 命令包装

源码镜像：[`../../sources/claude-code/src/commands/mcp/addCommand.ts`](../../sources/claude-code/src/commands/mcp/addCommand.ts)

`registerMcpAddCommand()` 直接展示了 CLI 子命令层的真实复杂度：

- `--scope` 控制 local / user / project 写入位置
- `--transport` 决定 stdio / sse / http 三套配置分支
- `--env`、`--header`、`--client-id`、`--client-secret`、`--callback-port` 把认证与进程配置一起收进来
- `--xaa` 触发一套单独的 XAA fail-fast 校验
- 当用户把 URL 当作 stdio 命令传进来时，会显式给出 transport 误用警告

这说明 MCP 在 Claude Code 里不是“插件发现机制”的附属，而是一套完整的本地配置协议。

## 5. `/doctor` 负责把“为什么不能用”讲清楚

源码镜像：[`../../sources/claude-code/src/commands/doctor/doctor.tsx`](../../sources/claude-code/src/commands/doctor/doctor.tsx), [`../../sources/claude-code/src/screens/Doctor.tsx`](../../sources/claude-code/src/screens/Doctor.tsx)

`/doctor` 并不只做环境探测，它还会合并：

- settings validation errors
- MCP parsing warnings
- 当前 active agents 与 agent 目录状态
- `toolPermissionContext` 驱动的 context warnings
- 版本锁、输出长度 env、auto-update channel 等运维信息

所以 `/doctor` 的产品语义不是“打印诊断文本”，而是给整个扩展运行时做一次状态审计。

## 6. 这一组命令为什么要单独成卷

它们共同覆盖的是 Claude Code 最容易被低估的一层：

- `/plugin` 管插件市场与信任边界
- `/mcp` 管 server 连接、授权和工具暴露
- `claude mcp add` 管配置写入与 transport 协议
- `/doctor` 管诊断与解释性输出

这已经不是普通 slash command 目录，而是一整套 operator surface。
