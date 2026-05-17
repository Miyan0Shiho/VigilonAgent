# Plugin Runtime 与 Marketplace

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Review / Release / Upgrade`](../commands/04-review-release-and-upgrade-commands.md) | [`下一站：读、搜、Web 与 Task 工具族`](./08-read-search-web-and-task-tools.md)

本文聚焦 Claude Code 的插件运行时：内建插件、marketplace、后台安装、启停状态、以及 `/plugin` 命令 UI 是如何连接到底层的。

## 1. Built-in plugin 和 bundled skill 不是一回事

源码镜像：[`../../src/plugins/builtinPlugins.ts`](../../src/plugins/builtinPlugins.ts)

文件头的注释已经把差异说得很清楚：

- built-in plugin 会出现在 `/plugin` UI 里
- 用户可以启用/禁用它们，状态持久化到 settings
- 它们可以提供 skills、hooks、MCP servers 等多个组件

而 bundled skill 更像总是随 CLI 提供的一类技能资产。

这意味着“插件”在 Claude Code 里是产品级可管理对象，不是单纯代码打包方式。

## 2. built-in plugin 注册表解决了什么

`registerBuiltinPlugin()`、`getBuiltinPlugins()`、`getBuiltinPluginSkillCommands()` 说明它在做三件事：

- 维护内建插件定义集合
- 根据用户设置和默认启用策略生成 enabled / disabled 视图
- 把启用的插件技能投影回命令系统

所以插件系统并不脱离命令层和 skill 层，而是在它们上面再加一个“可管理开关层”。

## 3. marketplace 安装是后台任务，不阻塞启动

源码镜像：[`../../src/services/plugins/PluginInstallationManager.ts`](../../src/services/plugins/PluginInstallationManager.ts)

这个模块的设计目标非常明确：

- 后台 reconcile marketplaces
- 把安装状态映射进 AppState，供 REPL UI 显示
- 新 marketplace 安装完成后自动 refresh active plugins
- 更新已有 marketplace 时只置 `needsRefresh`，让用户手动 `/reload-plugins`

这说明插件和市场不是一次性启动加载，而是一个持续维护的动态系统。

## 4. `pluginOperations.ts` 是纯库层

源码镜像：[`../../src/services/plugins/pluginOperations.ts`](../../src/services/plugins/pluginOperations.ts)

这里的注释很有代表性：同一套核心插件操作要同时服务于 CLI 和交互式 UI，因此这些函数：

- 不 `process.exit()`
- 不写 console
- 返回结构化结果
- 允许把不可预期异常抛给上层

这说明插件系统被认真分成了：

- 核心操作库
- UI / command 适配层

而不是所有逻辑都塞在 `/plugin` 命令里。

## 5. `/plugin` 命令本质上是插件控制台

源码镜像：[`../../src/commands/plugin/plugin.tsx`](../../src/commands/plugin/plugin.tsx)

虽然入口文件本身很薄，只是把 `PluginSettings` 挂进本地 JSX command，但目录结构已经暴露出完整产品面：

- 浏览市场
- 管理市场
- 管理已安装插件
- 信任警告
- 选项流与分页
- 校验插件

所以 `/plugin` 不是一个开关命令，而是整个插件平台的交互前台。

## 6. 为什么插件运行时必须单独成卷

如果不单独拆出来，很容易把插件误解成 “skill 的另一种来源”。实际并不是：

- skill 只是插件能提供的一个组件
- plugin 还可以提供 hooks、MCP servers、settings 与信任边界
- marketplace 还引入了安装、更新、缓存、依赖和 policy 问题

也就是说，插件系统已经是 Claude Code 里的一个小型平台。
