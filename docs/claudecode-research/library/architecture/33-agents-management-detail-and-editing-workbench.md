# Agents Management / Detail / Editing Workbench

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Footer Steering / Pill Navigation Runtime`](./32-footer-steering-and-pill-navigation-runtime.md) | [`下一站：Agent Creation Wizard / Generation / Confirmation Flow`](./34-agent-creation-wizard-generation-and-confirmation-flow.md)

前面的 agent 卷册已经把定义加载、spawn、memory、task host 拆开了，但 `/agents` 这条 operator UI 还没有独立成卷。实际上它不是一个简单列表，而是一套完整的 definition workbench：

- `commands/agents/agents.tsx`
- `components/agents/AgentsMenu.tsx`
- `components/agents/AgentsList.tsx`
- `components/agents/AgentDetail.tsx`
- `components/agents/AgentEditor.tsx`
- `components/agents/ToolSelector.tsx`
- `components/agents/agentFileUtils.ts`
- `components/agents/validateAgent.ts`

这一卷只讲前台工作面，不重复前面几篇已经写过的 agent runtime。

## 1. `/agents` 是 local-JSX command，不是只读帮助页

源码镜像：[`../../sources/claude-code/src/commands/agents/agents.tsx`](../../sources/claude-code/src/commands/agents/agents.tsx)

`commands/agents/agents.tsx` 做的事情很短，但很关键：

- 从当前 `toolPermissionContext` 重新取 `getTools(...)`
- 渲染 `AgentsMenu`

这说明 `/agents` 不是静态 catalog dump，而是：

- 当前会话权限态下的活跃 definition 管理台
- 工具选择、校验、详情展示都依赖实时 merged tool set

也就是说 agent workbench 看的不是“磁盘上可能存在的理论能力”，而是当前宿主允许它看到的能力面。

## 2. `AgentsMenu` 是一个模式机，而不是单页列表

源码镜像：[`../../sources/claude-code/src/components/agents/AgentsMenu.tsx`](../../sources/claude-code/src/components/agents/AgentsMenu.tsx)

`modeState` 明确分成多种模式：

- `list-agents`
- `create-agent`
- `agent-menu`
- `agent-detail`
- `agent-edit`

这意味着 `/agents` 从一开始就被设计成一个小型工作台，具备：

- 浏览
- 创建
- 详情查看
- 编辑
- 删除

而不是一个只支持跳出外部编辑器的入口。

## 3. 来源分组不是展示花活，而是和 override 真相绑定的 inventory router

源码镜像：[`../../sources/claude-code/src/components/agents/AgentsMenu.tsx`](../../sources/claude-code/src/components/agents/AgentsMenu.tsx), [`../../sources/claude-code/src/tools/AgentTool/agentDisplay.ts`](../../sources/claude-code/src/tools/AgentTool/agentDisplay.ts)

`AgentsMenu` 会先按 source 把 `allAgents` 拆成：

- `built-in`
- `userSettings`
- `projectSettings`
- `policySettings`
- `localSettings`
- `flagSettings`
- `plugin`
- `all`

再对选中子集做：

- `resolveAgentOverrides(...)`

所以 `/agents` 的来源分组并不是“按目录看看”，而是：

- inventory 切片器
- override 可见性前置整理器

当前台显示 “shadowed by ...” 时，背后不是简单字符串，而是 override 解析后的真实定义关系。

## 4. 删除 agent 时不是只删文件，还会立即重算 `activeAgents`

源码镜像：[`../../sources/claude-code/src/components/agents/AgentsMenu.tsx`](../../sources/claude-code/src/components/agents/agentFileUtils.ts)

`handleAgentDeleted()` 的顺序是：

1. `deleteAgentFromFile(agent)`
2. 从 `allAgents` 中移除同 `(agentType, source)` 项
3. `activeAgents: getActiveAgentsFromList(allAgents_0)`

这说明 `/agents` 删除不是“等重启生效”的离线操作，而是：

- 文件系统变更
- AppState inventory 热更新
- active roster 同步重算

因此它已经是运行时 definition 管理面，而不只是文件浏览器壳。

## 5. `AgentsList` 把 built-in 和 non-built-in 故意分开，说明可选中性本身就是产品语义

源码镜像：[`../../sources/claude-code/src/components/agents/AgentsList.tsx`](../../sources/claude-code/src/components/agents/AgentsList.tsx)

列表层有两个关键规则：

- built-in agents 会展示，但不进入 selectable inventory
- 可导航顺序只建立在 non-built-in agents 上，再加可选的 `Create new agent`

这说明 `/agents` 不是“所有 agent 都同权编辑”的前台：

- built-in 是可见、可理解、不可像普通自定义 agent 那样管理的参照物
- 自定义来源才是操作对象

## 6. `Create new agent` 是导航状态的一等成员，而不是按钮附属物

源码镜像：[`../../sources/claude-code/src/components/agents/AgentsList.tsx`](../../sources/claude-code/src/components/agents/AgentsList.tsx)

键盘导航时：

- `Create new agent` 参与 `up/down` 循环
- 当 `hasCreateOption` 时占据 position 0

这说明创建能力被设计成和 agent 条目同级的工作流入口，而不是页脚按钮。这样 `/agents` 的工作面体验更像：

- inventory + action row + details

而不是普通 CRUD 表单页。

## 7. `AgentDetail` 不只展示 metadata，还会真正重算 agent 的 resolved tool face

源码镜像：[`../../sources/claude-code/src/components/agents/AgentDetail.tsx`](../../sources/claude-code/src/components/agents/AgentDetail.tsx)

详情页不是只打印 frontmatter。它会：

- `resolveAgentTools(agent, tools, false)`
- 展示 valid / invalid / wildcard tool 状态

所以 detail 页在做两层事情：

- 展示 agent 原始定义
- 用当前会话 merged tools 重新求出它此刻的真实工具脸

这让详情页不只是 definition viewer，而是 definition-vs-runtime surface 的对照面。

## 8. 文件路径展示特意区分 built-in / plugin / CLI / disk-backed agents

源码镜像：[`../../sources/claude-code/src/components/agents/agentFileUtils.ts`](../../sources/claude-code/src/components/agents/AgentDetail.tsx)

`getActualRelativeAgentFilePath()` 的返回值不是统一磁盘路径：

- built-in: `Built-in`
- plugin: `Plugin: <name>`
- flagSettings: `CLI argument`
- 其他 source 才落到真实 `.md` 路径

这说明详情页的 file path 行本身就是来源语义的一部分，不是单纯定位文件。

## 9. `AgentDetail` 展示的 color 不是装饰字段，而是连到 `agentColorManager` 的稳定身份色协议

源码镜像：[`../../sources/claude-code/src/components/agents/AgentDetail.tsx`](../../sources/claude-code/src/components/agents/AgentDetail.tsx), [`../../sources/claude-code/src/tools/AgentTool/agentColorManager.ts`](../../sources/claude-code/src/tools/AgentTool/agentColorManager.ts)

详情页会调用：

- `getAgentColor(agent.agentType)`

然后把结果渲染成背景色 chip。

这说明 color 在 `/agents` 前台里不是只有编辑器能改的配置，而是 agent 身份的一部分，且用的正是运行时稳定色协议，不是独立 UI token。

## 10. `AgentEditor` 是 menu-driven editor shell，不是直接嵌表单

源码镜像：[`../../sources/claude-code/src/components/agents/AgentEditor.tsx`](../../sources/claude-code/src/components/agents/AgentEditor.tsx)

编辑器先进入一个 menu：

- `Open in editor`
- `Edit tools`
- `Edit model`
- `Edit color`

然后才分流到：

- 外部编辑器
- `ToolSelector`
- `ModelSelector`
- `ColorPicker`

所以 `/agents` 的编辑面不是“所有字段堆一个表单里”，而是 command-palette 风格的分步编辑 workbench。

## 11. `Open in editor` 是真实文件 handoff，不是内嵌 markdown editor

源码镜像：[`../../sources/claude-code/src/components/agents/AgentEditor.tsx`](../../sources/claude-code/src/components/agents/agentFileUtils.ts)

`handleOpenInEditor()` 直接：

- `getActualAgentFilePath(agent)`
- `editFileInEditor(filePath)`

成功后只提示：

- 如果你做了修改，需要 restart 才会加载最新版本

这说明外部编辑路径不是热更新式 editor integration，而是一个 deliberate handoff：

- 复杂修改走用户熟悉的编辑器
- 当前 TUI 只负责发起定位与提示后续 reload 语义

## 12. `AgentEditor.handleSave()` 只允许 custom/plugin agents 落盘，built-in 永远不进入这条路径

源码镜像：[`../../sources/claude-code/src/components/agents/AgentEditor.tsx`](../../sources/claude-code/src/components/agents/AgentEditor.tsx)

保存前明确检查：

- `isCustomAgent(agent) || isPluginAgent(agent)`

否则直接拒绝。

这再次说明 `/agents` 前台并没有把 builtin definitions 当成可变实体，它们是 catalog 参考，不是普通设置项。

## 13. 保存不是只写文件，还会同步更新颜色注册和 `activeAgents`

源码镜像：[`../../sources/claude-code/src/components/agents/AgentEditor.tsx`](../../sources/claude-code/src/components/agents/agentFileUtils.ts)

`handleSave()` 的关键顺序是：

1. `updateAgentFile(...)`
2. 如果颜色改了，`setAgentColor(agentType, finalColor)`
3. 改写 `allAgents`
4. `activeAgents: getActiveAgentsFromList(allAgents)`

这说明 `/agents` 前台在做三层同步：

- 磁盘定义
- bootstrap-level identity color state
- AppState active roster

它不是单纯的 frontmatter editor。

## 14. `ToolSelector` 的目标不是自由选字符串，而是把 agent 的工具权限压进一个有产品语义的 bucket 模型

源码镜像：[`../../sources/claude-code/src/components/agents/ToolSelector.tsx`](../../sources/claude-code/src/components/agents/ToolSelector.tsx)

它把工具切成：

- `READ_ONLY`
- `EDIT`
- `EXECUTION`
- `MCP`
- `OTHER`

而不是按源码目录或字母顺序列工具。

这说明 agent 工具编辑面在产品上希望用户思考的是：

- 这个 agent 能读什么
- 能不能改
- 能不能执行
- 能不能碰 MCP

而不是“它具体勾选了哪几个 class 名”。

## 15. `ToolSelector` 的 “all tools” 语义不是显式 `*`，而是 `undefined`

源码镜像：[`../../sources/claude-code/src/components/agents/ToolSelector.tsx`](../../sources/claude-code/src/components/agents/agentFileUtils.ts)

初始阶段：

- `initialTools === undefined` 或包含 `*`
  - 会展开成所有 custom-agent-allowed tools

提交阶段：

- 如果最终选择覆盖全部工具
  - `onComplete(undefined)`

再配合 `formatAgentAsMarkdown()`：

- `tools` 为 `undefined` 时，frontmatter 里直接省略 `tools:` 行

所以 “all tools” 的真正定义不是磁盘上的 `*`，而是：

- 运行时全选
- 落盘时省略字段

## 16. `TaskOutputTool` 被纳入 read-only bucket，说明 `/agents` 的工具分类在意的是 agent capability semantics，而不是工具新旧程度

源码镜像：[`../../sources/claude-code/src/components/agents/ToolSelector.tsx`](../../sources/claude-code/src/components/agents/ToolSelector.tsx)

尽管 `TaskOutputTool` 已经 deprecated，它仍被归入：

- `READ_ONLY`

这说明 bucket 分类反映的是能力性质，不是“是否推荐新项目使用”。对 agent 前台而言，这个工具仍然是：

- 读取后台任务结果的只读能力

## 17. MCP tools 在 `ToolSelector` 里按 serverName 二次分桶，说明 agent 工具前台把 connector surface 当独立生态

源码镜像：[`../../sources/claude-code/src/components/agents/ToolSelector.tsx`](../../sources/claude-code/src/components/agents/ToolSelector.tsx)

MCP 不是混进通用 bucket，而是：

- `isMcpTool(tool)`
- 再按 `serverName` 聚类

所以 `/agents` 工具编辑面对 MCP 的思路不是“又一批工具”，而是：

- 若 agent 能碰 MCP，就应该看到它具体会碰哪台 server

这是 capability governance 的重要细节。

## 18. `validateAgent()` 不是 schema 校验器，而是 definition ergonomics + runtime sanity 的混合检查器

源码镜像：[`../../sources/claude-code/src/components/agents/validateAgent.ts`](../../sources/claude-code/src/components/agents/validateAgent.ts)

它同时检查：

- `agentType` 规则和重名冲突
- `whenToUse` 太短/太长
- tools 数组是否合法
- `resolveAgentTools(...)` 后是否有 invalid tools
- system prompt 长度下限

所以这层不是纯 frontmatter schema，而是把：

- 命名规范
- 运行时工具可解析性
- 描述和 prompt 的可用性

一起揉进 definition validation。

## 19. duplicate 检查故意允许“同 source 自我编辑”，但不允许跨 source 重名无感覆盖

源码镜像：[`../../sources/claude-code/src/components/agents/validateAgent.ts`](../../sources/claude-code/src/components/agents/validateAgent.ts)

重名判断条件是：

- `a.agentType === agent.agentType`
- 且 `a.source !== agent.source`

这说明前台校验非常在意“跨 source 同名”这种 override/shadow 关系，因为这会改变 active roster 语义；但同源编辑自己不应被误判成冲突。

## 20. `/agents` 这条前台链的真实分层是：command launcher、inventory router、definition viewer、editing shell、capability selector、filesystem bridge

把这些源码连起来看，`/agents` 现在可以被清楚拆成：

- `commands/agents/agents.tsx`
  - local-JSX command launcher
- `AgentsMenu + AgentsList`
  - inventory router 和 navigation state machine
- `AgentDetail`
  - definition viewer + runtime tool face projection
- `AgentEditor`
  - menu-driven editing shell
- `ToolSelector`
  - capability governance selector
- `agentFileUtils + validateAgent`
  - filesystem bridge + semantic validation

所以 `/agents` 不是“小工具页面”，而是 Claude Code 把 agent definitions 产品化后的完整 operator workbench。
