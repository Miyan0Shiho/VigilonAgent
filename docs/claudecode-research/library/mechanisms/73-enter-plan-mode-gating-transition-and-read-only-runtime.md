# EnterPlanMode / Gating / Transition / Read-Only Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：TodoWriteTool / Session Checklist / Verification Nudge Runtime`](./72-todowrite-tool-session-checklist-and-verification-nudge-runtime.md) | [`下一站：ExitPlanMode / Partially Visible ReviewArtifact Operator Loops`](./69-exit-plan-mode-and-partially-visible-review-artifact-operator-loops.md)

本文把 `EnterPlanModeTool` 从 `commands/07`、permission UI 总述、以及产品卷里的零散描述里单独抽出来。重点不是“它能切到 plan mode”，而是它怎样把一个普通工具调用变成受 gate 约束的 phase transition runtime，并和 `/plan` 命令、本地审批 dialog、interview-phase 变体、以及 permission context 共享同一条切换主链。

## 1. `EnterPlanModeTool` 不是普通开关，而是“读写相位切换工具”

源码镜像：[`../../src/tools/EnterPlanModeTool/EnterPlanModeTool.ts`](../../src/tools/EnterPlanModeTool/EnterPlanModeTool.ts)

这个工具最关键的几条声明是：

- `shouldDefer: true`
- `isConcurrencySafe() => true`
- `isReadOnly() => true`

这三条合在一起说明它不是为了直接产出内容，而是为了安全地把会话推进到一个新的操作相位：

- 可以并发安全暴露
- 自己不写文件
- 但会改 session 的 permission/runtime mode

因此它的真实身份是“运行时相位迁移器”。

## 2. 它的产品定义不是“复杂任务前总要计划”，而是“当实现路径有真实歧义时，先申请进入只读规划相位”

源码镜像：[`../../src/tools/EnterPlanModeTool/prompt.ts`](../../src/tools/EnterPlanModeTool/prompt.ts)

prompt 里其实有两套话术：

- external 用户：明显偏“宁可多计划也别乱写”
- `USER_TYPE === 'ant'`：更保守，只在 genuine ambiguity 时才建议进 plan

这说明 Claude Code 没把 plan mode 当成一个固定强制流程，而是按用户画像动态调整进入阈值。

## 3. `isPlanModeInterviewPhaseEnabled()` 决定的不是单一文案，而是整个进入协议的形态

源码镜像：[`../../src/utils/planModeV2.ts`](../../src/utils/planModeV2.ts), [`../../src/tools/EnterPlanModeTool/prompt.ts`](../../src/tools/EnterPlanModeTool/prompt.ts)

这个 gate 的来源是三层：

- `USER_TYPE === 'ant'` 永远开
- `CLAUDE_CODE_PLAN_MODE_INTERVIEW_PHASE`
- growthbook `tengu_plan_mode_interview_phase`

而它影响的不只是 prompt 某一句提示，而是：

- 进入前 prompt 里是否显示完整 “What Happens in Plan Mode”
- tool_result 里是给完整六步规划说明，还是只给 “详细 workflow instructions will follow”
- 审批 analytics 里是否记录 `interviewPhaseEnabled`

所以 interview phase 是一套协议变体，而不是文案实验。

## 4. `EnterPlanModeTool` 的宿主边界非常硬：agent context 直接报错

源码镜像：[`../../src/tools/EnterPlanModeTool/EnterPlanModeTool.ts`](../../src/tools/EnterPlanModeTool/EnterPlanModeTool.ts)

调用时第一条硬边界就是：

- `if (context.agentId) throw new Error('EnterPlanMode tool cannot be used in agent contexts')`

这意味着：

- main thread 可以进入 plan mode
- subagent / teammate 不行

原因很直接：plan mode 是用户与主线程之间的工作相位协商，不是任意 worker 都能擅自切换的局部状态。

## 5. `--channels` 打开时，这个工具会整体失效，因为 plan mode 不能变成“进得去、出不来”的 trap

源码镜像：[`../../src/tools/EnterPlanModeTool/EnterPlanModeTool.ts`](../../src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts)

`isEnabled()` 里有一条特别关键的 gate：

- `KAIROS/KAIROS_CHANNELS`
- `getAllowedChannels().length > 0`

满足时直接返回 `false`

注释也讲得很明白：当 channels 模式下 exit dialog 不可用时，连 enter 都要一起禁掉，不然 plan mode 会成为 trap。也就是说，进入 gate 是按“能否安全退出”倒推设计的。

## 6. 真正的相位切换不是只改 `mode='plan'`，而是两段式：先打 attachment 信号，再改 permission context

源码镜像：[`../../src/bootstrap/state.ts`](../../src/bootstrap/state.ts), [`../../src/tools/EnterPlanModeTool/EnterPlanModeTool.ts`](../../src/tools/EnterPlanModeTool/EnterPlanModeTool.ts)

工具主链是：

1. `handlePlanModeTransition(fromMode, 'plan')`
2. `prepareContextForPlanMode(prev.toolPermissionContext)`
3. `applyPermissionUpdate(... { type: 'setMode', mode: 'plan', destination: 'session' })`

第一步处理的是 attachment-level side effects：

- 清理 pending exit attachment

第二三步才是真正把 session mode 切到 `plan`。

所以 plan mode 进入是 “transition signaling + permission context mutation” 的两段式协议。

## 7. `prepareContextForPlanMode(...)` 才是这条链最复杂的核心，不是简单写个 `prePlanMode`

源码镜像：[`../../src/utils/permissions/permissionSetup.ts`](../../src/utils/permissions/permissionSetup.ts)

这个函数除了记录：

- `prePlanMode: currentMode`

还会处理 auto-mode 的特殊分支：

- 如果当前是 `auto` 且 plan 不允许继续 auto：
  - 关掉 auto-mode active
  - 设置 `needsAutoModeExitAttachment`
  - 恢复危险权限
- 如果当前不是 `auto`，但 plan 期间应该启 auto：
  - 激活 auto-mode
  - strip 掉危险权限

所以 plan entry 的真实工作不是“记住来路”，而是把 auto-mode 与 dangerous permissions 一并重整。

## 8. `prePlanMode` 不是元数据装饰，而是 exit 时能否恢复原宿主语义的唯一锚点

源码镜像：[`../../src/utils/permissions/permissionSetup.ts`](../../src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts)

`prepareContextForPlanMode` 里所有分支都要保留 `prePlanMode`，因为退出时需要知道：

- 原来是不是 `auto`
- 原来是不是 `bypassPermissions`
- 原来是不是普通 `default`

这说明 plan mode 在 Claude Code 里不是一个独立平铺的新 mode，而是“覆盖在原 mode 之上的可逆 planning phase”。

## 9. tool_result 本身也承担了强只读约束传播

源码镜像：[`../../src/tools/EnterPlanModeTool/EnterPlanModeTool.ts`](../../src/tools/EnterPlanModeTool/EnterPlanModeTool.ts)

返回给模型的内容不是一句成功确认，而是明确告知：

- 现在只做探索和设计
- 不要写文件
- 准备好后用 `ExitPlanMode`
- interview phase 开启时还会强调 “except the plan file”

这说明 plan mode 的只读纪律并不是只靠 permission context 限制，也会被重新写回模型对话上下文。

## 10. `renderToolUseMessage() => null`，但 `renderToolResultMessage()` 有专属 UI，说明它更像状态切换横幅而不是工具气泡

源码镜像：[`../../src/tools/EnterPlanModeTool/UI.tsx`](../../src/tools/EnterPlanModeTool/UI.tsx)

前台渲染协议是：

- tool use 本身不显示普通调用气泡
- 成功时显示：
  - `Entered plan mode`
  - `Claude is now exploring and designing...`
- 拒绝时显示：
  - `User declined to enter plan mode`

也就是说，前台展示的重点不是“工具做了什么输入输出”，而是“当前 session 相位已经切换”。

## 11. 本地审批 UI 不是简单 yes/no 确认，而是正式的 permission-request surface

源码镜像：[`../../src/components/permissions/EnterPlanModePermissionRequest/EnterPlanModePermissionRequest.tsx`](../../src/components/permissions/EnterPlanModePermissionRequest/EnterPlanModePermissionRequest.tsx), [`../../src/components/permissions/PermissionRequest.tsx`](../../src/components/permissions/PermissionRequest.tsx)

进入 plan mode 会落到专门的 `EnterPlanModePermissionRequest`：

- 标题：`Enter plan mode?`
- 文案明确说明：
  - explore codebase
  - identify patterns
  - design strategy
  - present plan for approval
- 明确提示：
  - `No code changes will be made until you approve the plan`

所以 `EnterPlanMode` 在本地不是抽象 mode flip，而是一个显式的 operator contract。

## 12. 这个审批 UI 还会把“同意进入”编码成标准 permission updates，而不是私有 side effect

源码镜像：[`../../src/components/permissions/EnterPlanModePermissionRequest/EnterPlanModePermissionRequest.tsx`](../../src/components/permissions/EnterPlanModePermissionRequest/EnterPlanModePermissionRequest.tsx)

当用户选择 yes：

- `handlePlanModeTransition(...)`
- `toolUseConfirm.onAllow({}, [{ type: 'setMode', mode: 'plan', destination: 'session' }])`

这很关键，说明 plan mode entry 不是 UI 直接乱改全局状态，而是复用标准 permission update 协议，把 mode 改动注入回主循环。

## 13. `/plan` 命令和 `EnterPlanModeTool` 走的是同一条切换主链

源码镜像：[`../../src/commands/plan/plan.tsx`](../../src/commands/plan/plan.tsx)

`/plan` 在“不在 plan mode”时做的事情和工具版几乎同构：

- `handlePlanModeTransition(currentMode, 'plan')`
- `applyPermissionUpdate(prepareContextForPlanMode(...), setMode(plan))`

区别只是命令面多了两件事：

- 如果带描述参数，可 `shouldQuery: true`
- 如果已经在 plan mode，就显示/打开 plan file

所以 `/plan` 不是另一套 plan runtime，只是同一条 plan-entry protocol 的 operator command 外壳。

## 14. `EnterPlanModeTool` 的只读语义是“探索可写、代码不可写”的混合相位，不是绝对禁止一切写入

源码镜像：[`../../src/tools/EnterPlanModeTool/EnterPlanModeTool.ts`](../../src/tools/EnterPlanModeTool/EnterPlanModeTool.ts), [`../../src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts`](../../src/utils/plans.ts)

interview phase 分支里已经明确保留了一个例外：

- `DO NOT write or edit any files except the plan file`

这说明 Claude Code 定义的 plan mode 不是“完全无写入”，而是：

- 代码与实现文件：禁止
- plan artifact：允许

因此它更准确地说是 “implementation-read-only, planning-artifact-writable” 的受限相位。

## 15. 这条链的分析与 telemetry 也是单独埋点的，说明 plan entry 是一等产品事件

源码镜像：[`../../src/components/permissions/EnterPlanModePermissionRequest/EnterPlanModePermissionRequest.tsx`](../../src/services/analytics/index.ts)

同意进入时会打：

- `tengu_plan_enter`
- `interviewPhaseEnabled`
- `entryMethod: 'tool'`

说明对产品来说，plan mode entry 不是辅助日志，而是会被单独测量、分 cohort 对比的关键行为。

## 16. 结论：EnterPlanMode 是 Claude Code 的 planning phase controller，不是一个“先想想再做”的提示词

把整条链收起来，它的真实角色是：

- 用 prompt 决定何时值得进入 planning phase
- 用 host gates 避免进入不可退出的 trap
- 用 `prepareContextForPlanMode` 重整 auto-mode 与危险权限
- 用 permission update 协议正式切 session mode
- 用专属审批 dialog 与 result banner 把状态切换显性化
- 用 `/plan` 命令共享同一套 runtime

所以 `EnterPlanModeTool` 不是一条建议，而是 Claude Code 把“探索-设计-审批-再实现”编码成运行时控制面的核心工具。
