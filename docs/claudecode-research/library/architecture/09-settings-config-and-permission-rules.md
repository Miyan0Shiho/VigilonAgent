# Settings、Config 与 Permission Rules

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Tasks / Remote / Agent UI`](./08-tasks-remote-and-agent-detail-ui.md) | [`下一站：命令体系`](../commands/01-command-registry-and-dispatch.md)

本文聚焦 `components/Settings/**` 与 `components/permissions/rules/**`，说明 Claude Code 的治理面为什么不是“一个设置页”，而是一套多来源配置、运行时状态和权限规则编辑系统。

## 1. `Config.tsx` 是设置控制台，不是普通偏好页

源码镜像：[`../../src/components/Settings/Config.tsx`](../../src/components/Settings/Config.tsx)

这个组件从一开始就在同时维护多种状态源：

- `getGlobalConfig()` 返回的全局配置
- `getInitialSettings()` 与 `getSettingsForSource()` 返回的 settings 文件视图
- `AppState` 里的即时运行态，例如 model、verbose、thinking、fast mode
- bootstrap 层的 `userMsgOptIn`
- tab header focus、search mode、submenu、scroll offset

所以 Config 页不是“读一个 JSON 再改几项”，而是在协调持久配置、会话态和 UI 导航态。

## 2. 它自带一套搜索驱动的设置导航

源码镜像：[`../../src/components/Settings/Config.tsx`](../../src/components/Settings/Config.tsx), [`../../src/hooks/useSearchInput.ts`](../../src/hooks/useSearchInput.ts)

`Config` 会直接嵌入 `useSearchInput()`，并维护：

- `searchQuery`
- `searchCursorOffset`
- `isSearchMode`
- `selectedIndex`
- `scrollOffset`

这意味着设置页本身就是一个可搜索的终端列表界面，而不是靠鼠标点击的静态菜单。

## 3. Config 页修改的往往不只是磁盘，还会立刻改运行时

在 `onChangeMainModelConfig()`、`onChangeVerbose()` 这类处理函数里能直接看到三类动作同时发生：

- 写入 global config / settings
- 更新 `AppState`，让当前 UI 立即生效
- 记录 `changes` 以支持可见的变更反馈和后续 revert

这说明 Config 的产品语义是“改完立刻生效，同时尽量可撤销”，而不是“下次重启再应用”。

## 4. `PermissionRuleList` 是权限治理工作台

源码镜像：[`../../src/components/permissions/rules/PermissionRuleList.tsx`](../../src/components/permissions/rules/PermissionRuleList.tsx)

这个文件暴露了权限规则系统的完整治理面：

- 把规则按 `recent / allow / ask / deny / workspace` 分成多个 tab
- 支持搜索、筛选、删除和查看 rule details
- 区分 `policySettings` 这类受管来源与可编辑来源
- 直接使用 `applyPermissionUpdate()` 与 `persistPermissionUpdate()`
- 纳入 recent denials 和 auto mode denials 这些反向证据

所以它不是“显示当前允许了什么”，而是整个 permission policy 的 operator workbench。

## 5. Rule detail 视图体现了“规则来源”是一级语义

源码镜像：[`../../src/components/permissions/rules/PermissionRuleList.tsx`](../../src/components/permissions/rules/PermissionRuleList.tsx)

`RuleDetails` 这一段很关键，因为它明确区分了：

- 来自 `policySettings` 的规则只能查看，不能删
- 来自本地/项目/用户设置的规则才允许删除
- 每条规则都带有 source display string

这说明 Claude Code 的权限模型不是“所有规则都平等”，而是有明确的治理层级。

## 6. `AddPermissionRules` 暴露了规则保存目的地的产品选择

源码镜像：[`../../src/components/permissions/rules/AddPermissionRules.tsx`](../../src/components/permissions/rules/AddPermissionRules.tsx)

添加权限规则时，系统不会默认偷偷落盘，而是让用户显式选择：

- `localSettings`
- `projectSettings`
- `userSettings`

并且在保存后立即：

- `applyPermissionUpdate()` 到内存上下文
- `persistPermissionUpdate()` 到对应设置源
- 运行 `detectUnreachableRules()` 检查新规则是否被遮蔽

这说明添加权限规则本身就是一个小型治理流程，而不只是 append 一行配置。

## 7. `WorkspaceTab` 管的是额外工作目录，而不是浏览文件树

源码镜像：[`../../src/components/permissions/rules/WorkspaceTab.tsx`](../../src/components/permissions/rules/WorkspaceTab.tsx)

这个 tab 的职责很明确：

- 展示当前 original working directory
- 展示 `additionalWorkingDirectories`
- 允许添加或移除额外目录
- 与 tab header focus、Select 导航联动

这说明工作区权限在 Claude Code 里是“允许哪些目录成为合法工作上下文”，而不是通用文件管理器。

## 8. 为什么这条链值得单独成卷

如果只看表面，很容易把这些文件理解成“设置 UI”。但拆开后能看到三层结构：

- `Config.tsx` 负责多源配置与运行时即时切换
- `PermissionRuleList.tsx` 负责权限规则治理与审计
- `AddPermissionRules` / `WorkspaceTab` 负责规则落盘与工作目录边界

这共同定义了 Claude Code 如何把“模型该被允许做什么”做成可搜索、可分层、可解释的治理面。
