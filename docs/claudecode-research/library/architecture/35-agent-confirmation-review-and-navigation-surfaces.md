# Agent Confirmation / Review / Navigation Surfaces

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Agent Creation Wizard / Generation / Confirmation Flow`](./34-agent-creation-wizard-generation-and-confirmation-flow.md) | [`下一站：Agent Generation / Memory Injection / Materialization Runtime`](../mechanisms/56-agent-generation-memory-injection-and-materialization-runtime.md)

`architecture/34` 已经把新建 agent 的向导图拆开了，但它把最后一层“怎么 review、怎么保存、怎么显示键位导航”压在了同一卷里。这一卷只往下钻创建流末端和共享导航壳：

- `components/agents/new-agent-creation/wizard-steps/ConfirmStep.tsx`
- `components/agents/new-agent-creation/wizard-steps/ConfirmStepWrapper.tsx`
- `components/wizard/WizardDialogLayout.tsx`
- `components/wizard/WizardNavigationFooter.tsx`
- `components/agents/AgentNavigationFooter.tsx`
- `components/agents/AgentsMenu.tsx`

重点不是再讲“有哪些 step”，而是讲 agent authoring 最后如何变成一个可审计、可取消、可保存、可跳回的 operator surface。

## 1. `ConfirmStep` 是 review console，不是被动摘要页

源码镜像：[`../../sources/claude-code/src/components/agents/new-agent-creation/wizard-steps/ConfirmStep.tsx`](../../sources/claude-code/src/components/agents/new-agent-creation/wizard-steps/ConfirmStep.tsx)

`ConfirmStep` 不只是把字段打印出来，而是把 `wizardData.finalAgent` 重新做一轮前台审计：

- `Name`
- `Location`
- `Tools`
- `Model`
- 可选 `Memory`
- `Description`
- `System prompt`
- `Warnings`
- `Errors`

而且这里不是复用前面 step 的局部校验，而是直接再跑：

- `validateAgent(agent, tools, existingAgents)`

这说明创建流在提交前会做一次完整 definition assemble，然后在一个统一 review surface 里重放结果。前面每一步是 authoring，`ConfirmStep` 才是总装配后的 operator 审核面。

## 2. 最终路径不是保存后推断，而是在确认页显式可见

源码镜像：[`../../sources/claude-code/src/components/agents/new-agent-creation/wizard-steps/ConfirmStep.tsx`](../../sources/claude-code/src/components/agents/new-agent-creation/wizard-steps/ConfirmStep.tsx), [`../../sources/claude-code/src/components/agents/agentFileUtils.ts`](../../sources/claude-code/src/components/agents/agentFileUtils.ts)

确认页用：

- `getNewRelativeAgentFilePath({ source, agentType })`

把目标落盘路径直接展示出来。也就是说 agent authoring 的最后一公里不是“先存再告诉你在哪”，而是保存前就把 source governance 和 file materialization 公开给操作者。

这和普通配置表单很不一样。这里 review 的对象不仅是 prompt 和模型，还包括：

- 将落到 `project` 还是 `user` 范围
- 最终 markdown 文件名如何规范化
- 当前 `agentType` 会生成哪条相对路径

## 3. `ConfirmStep` 的键位协议不是表单提交，而是双提交通道

源码镜像：[`../../sources/claude-code/src/components/agents/new-agent-creation/wizard-steps/ConfirmStep.tsx`](../../sources/claude-code/src/components/agents/new-agent-creation/wizard-steps/ConfirmStep.tsx)

确认页把键盘协议显式切成三种：

- `Esc` / `confirm:no` -> `goBack`
- `s` / `Enter` -> `onSave`
- `e` -> `onSaveAndEdit`

这里最关键的不是快捷键本身，而是创建流最后一页并没有把“提交”收敛成单一动作。Claude Code 把 agent authoring 的收尾明确分成：

- 只保存
- 保存并立刻进入外部编辑器继续深改

所以最后一步仍然承认“wizard 只负责第一次 materialize，不负责覆盖全部高级编辑需求”。

## 4. `ConfirmStepWrapper` 才是真正的 commit boundary

源码镜像：[`../../sources/claude-code/src/components/agents/new-agent-creation/wizard-steps/ConfirmStepWrapper.tsx`](../../sources/claude-code/src/components/agents/new-agent-creation/wizard-steps/ConfirmStepWrapper.tsx)

`ConfirmStep` 本身不写盘，只暴露 `onSave/onSaveAndEdit`。真正的提交边界在 `ConfirmStepWrapper.saveAgent(openInEditor)`：

1. `saveAgentToFile(...)`
2. `setAppState(...)` 把 `finalAgent` 追加到 `allAgents`
3. 用 `getActiveAgentsFromList(allAgents)` 重算 `activeAgents`
4. 如果 `openInEditor=true`，再 `editFileInEditor(filePath)`
5. 打 `tengu_agent_created` analytics
6. `onComplete(message)`

这意味着创建向导的“完成”不是 wizard provider 的 `onComplete`，而是一个显式的 side-effect pipeline。换句话说，`WizardProvider` 只托管 step 生命周期，真正的业务完成由 wrapper 接管。

## 5. `save + edit` 不是 UI 装饰，而是持久化后的二段式 authoring

源码镜像：[`../../sources/claude-code/src/components/agents/new-agent-creation/wizard-steps/ConfirmStepWrapper.tsx`](../../sources/claude-code/src/components/agents/new-agent-creation/wizard-steps/ConfirmStepWrapper.tsx)

`openInEditor` 分支先保存，再打开编辑器，而不是反过来。这个顺序很重要：

- editor 打开的永远是 canonical file path
- 打开前，定义已经被 materialize 到磁盘
- AppState 也已经先更新，所以前台 roster 立即知道这个 agent 存在

因此 “save and edit” 不是草稿模式，而是“先落成正式 definition，再跳出 wizard 做深改”的二段式 authoring。

## 6. `WizardDialogLayout` 把 wizard step 统一包成 cancel-driven dialog

源码镜像：[`../../sources/claude-code/src/components/wizard/WizardDialogLayout.tsx`](../../sources/claude-code/src/components/wizard/WizardDialogLayout.tsx)

所有 wizard steps 最终都走同一个壳：

- 标题来自 `titleOverride || providerTitle || 'Wizard'`
- 默认附加 step suffix：`(current/total)`
- `Dialog.onCancel = goBack`
- `hideInputGuide = true`
- `isCancelActive = false`
- footer 一律交给 `WizardNavigationFooter`

这层说明 wizard runtime 的核心假设是：

- `Esc` 不等于“关闭整个窗口”
- cancel 是“退回上一步”
- 真正的输入提示不由 `Dialog` 默认指南负责，而由每一步自己提供精确 footer

## 7. `WizardNavigationFooter` 和 `AgentNavigationFooter` 不是一个组件的两种皮肤

源码镜像：[`../../sources/claude-code/src/components/wizard/WizardNavigationFooter.tsx`](../../sources/claude-code/src/components/wizard/WizardNavigationFooter.tsx), [`../../sources/claude-code/src/components/agents/AgentNavigationFooter.tsx`](../../sources/claude-code/src/components/agents/AgentNavigationFooter.tsx)

这两个 footer 表面长得相似，但责任不同：

- `WizardNavigationFooter`
  - 接受 `ReactNode instructions`
  - 默认文案是 `Byline + shortcut hints`
  - 专门服务 wizard dialog
- `AgentNavigationFooter`
  - 接受纯文本 `instructions?: string`
  - 默认文案是 agents menu 的列表导航说明
  - 专门服务 `/agents` 工作台

它们共享的只有一件事：

- 都叠加 `useExitOnCtrlCDWithKeybindings()`

也就是说 Ctrl+C/Ctrl+D 的二次确认是跨 agent UI 的共享宿主规则，但 wizard 和 `/agents` 菜单各自维护不同的导航话语体系。

## 8. `ConfirmStep` 用 `WizardDialogLayout`，而 `/agents` 主工作台用 `AgentNavigationFooter`

源码镜像：[`../../sources/claude-code/src/components/agents/new-agent-creation/wizard-steps/ConfirmStep.tsx`](../../sources/claude-code/src/components/agents/new-agent-creation/wizard-steps/ConfirmStep.tsx), [`../../sources/claude-code/src/components/agents/AgentsMenu.tsx`](../../sources/claude-code/src/components/agents/AgentsMenu.tsx)

创建流最后一页和 `/agents` 主菜单看起来都像“一个 dialog + 一个底部提示”，但宿主完全不同：

- 创建流：
  - `WizardDialogLayout`
  - `WizardNavigationFooter`
  - `goBack` 指向上一个 step
- `/agents` 工作台：
  - `Dialog`
  - `AgentNavigationFooter`
  - `onCancel` 指向 mode-state 回退

所以 agent authoring 的向导态和 `/agents` 浏览态虽然共享同一视觉语法，但它们实际跑在两套状态机上：

- wizard step machine
- agents menu mode machine

## 9. `AgentNavigationFooter` 在 `/agents` 里承担 mode-specific 文案切换

源码镜像：[`../../sources/claude-code/src/components/agents/AgentsMenu.tsx`](../../sources/claude-code/src/components/agents/AgentsMenu.tsx), [`../../sources/claude-code/src/components/agents/AgentNavigationFooter.tsx`](../../sources/claude-code/src/components/agents/AgentNavigationFooter.tsx)

`AgentsMenu` 不是处处复用同一行提示，而是按 mode 切不同说明：

- list/menu/edit：默认 `↑↓ / Enter / Esc`
- view-agent：`Press Enter or Esc to go back`
- delete-confirm：`Press ↑↓ to navigate, Enter to select, Esc to cancel`

这说明 footer 在 `/agents` 里不是装饰，而是 mode machine 的可见表面。操作者看到的底部文案，就是当前 mode 的合法动作集合。

## 10. `ConfirmStep` 的上下文切换解释了为什么前面很多 step 用 `Settings`，这里却回到 `Confirmation`

源码镜像：[`../../sources/claude-code/src/components/agents/new-agent-creation/wizard-steps/TypeStep.tsx`](../../sources/claude-code/src/components/agents/new-agent-creation/wizard-steps/MethodStep.tsx), [`../../sources/claude-code/src/components/agents/new-agent-creation/wizard-steps/ConfirmStep.tsx`](../../sources/claude-code/src/components/agents/new-agent-creation/wizard-steps/ConfirmStep.tsx)

前面的文本输入 step 往往把 `confirm:no` 放在 `Settings` context，目的是避免用户输入普通字符时误触取消。`MethodStep` 这种选择面则留在 `Confirmation` context。

`ConfirmStep` 又回到了 `Confirmation`，因为这时已经不是文本 authoring，而是提交决策面。这里的重点不是保护字母输入，而是把：

- `Esc`
- `s`
- `Enter`
- `e`

都变成高优先级 operator command。

## 11. 这一层把 agent 创建链拆成了三个清晰阶段

结合 `34 + 35 + 56`，现在创建 agent 可以更稳定地拆成三段：

1. `34`：step graph 与各 authoring step 的前台流程
2. `35`：review/save/navigation 的最终操作表面
3. `56`：generation、memory injection、materialization 的后台提交机制

这样一来，“创建新 agent”不再只是一个大向导，而是：

- 前面多步采集定义
- 中间统一 review 决策
- 后面显式写盘与状态同步

## 12. 当前边界

这一卷不继续往下拆：

- `saveAgentToFile()` 的 markdown 物化细节
- `validateAgent()` 的语义校验细则
- `generateAgent()` 的 prompt/compiler 细节

这些分别已经或应该由：

- [`../mechanisms/55-agent-definition-editing-validation-and-persistence-runtime.md`](../mechanisms/55-agent-definition-editing-validation-and-persistence-runtime.md)
- [`../mechanisms/56-agent-generation-memory-injection-and-materialization-runtime.md`](../mechanisms/56-agent-generation-memory-injection-and-materialization-runtime.md)

继续承接。
