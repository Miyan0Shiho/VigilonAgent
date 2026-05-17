# GitHub Install 与 Review Gates

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Memory、Skills、Tasks 与 Bridge Operator Dialogs`](./15-memory-skills-tasks-and-bridge-operator-dialogs.md) | [`下一站：Login / OAuth / Trusted Device UI`](./17-login-oauth-and-trusted-device-ui.md)

这一卷继续补前台工作面，但聚焦在另外两类高影响 operator surface：

- `install-github-app` 这一整套 GitHub 安装向导
- `UltrareviewOverageDialog` 这个远端 review 的计费门控

它们都不是“大而全的运行时”，却都处在真正执行前的最后一道 gate 上，所以产品意义很重。一个决定 GitHub 自动化能否落地，另一个决定远端 code review 能否继续发出。

## 1. 这两条链的共同点是“不是能力本身，而是能力前面的最终决策面”

源码镜像：[`../../src/commands/install-github-app/install-github-app.tsx`](../../src/commands/install-github-app/install-github-app.tsx), [`../../src/components/WorkflowMultiselectDialog.tsx`](../../src/components/WorkflowMultiselectDialog.tsx), [`../../src/commands/review/UltrareviewOverageDialog.tsx`](../../src/commands/review/UltrareviewOverageDialog.tsx)

前者的职责是把：

- `gh` 环境检查
- 仓库选择
- workflow 是否已存在
- secret 是否冲突
- API key / OAuth token 决策
- workflow 选择

串成一个可操作状态机。

后者的职责是把：

- “免费 ultrareview 用完了”

翻译成：

- 继续付费发起
- 取消
- 如果用户取消或 launch 失败，撤回正在进行的 side effect

所以这两块都处在真正执行前的“最后门槛”位置。

## 2. `install-github-app` 在前台上是一个显式 step 状态机，不是单个大对话框

源码镜像：[`../../src/commands/install-github-app/install-github-app.tsx`](../../src/commands/install-github-app/install-github-app.tsx)

`INITIAL_STATE` 和最终 `switch(state.step)` 已经把状态图暴露得很清楚：

- `check-gh`
- `warnings`
- `choose-repo`
- `install-app`
- `check-existing-workflow`
- `select-workflows`
- `check-existing-secret`
- `api-key`
- `oauth-flow`
- `creating`
- `success`
- `error`

这说明 Claude Code 对 GitHub 接入的产品理解不是“一次命令完成安装”，而是“一路通过多个可失败、可分叉、可恢复的门”。

## 3. `check-gh` 和 `warnings` 把环境问题做成了“可继续但不隐身”的前置层

源码镜像：[`../../src/commands/install-github-app/install-github-app.tsx`](../../src/commands/install-github-app/install-github-app.tsx), [`../../src/commands/install-github-app/CheckGitHubStep.tsx`](../../src/commands/install-github-app/CheckGitHubStep.tsx), [`../../src/commands/install-github-app/WarningsStep.tsx`](../../src/commands/install-github-app/WarningsStep.tsx)

这两步的设计不是简单报错：

- `check-gh` 只负责显示“正在检查”
- 真正的 `gh --version`、`gh auth status -a`、scope 检查在主状态机里跑
- 非致命问题会积累成 `warnings`
- `WarningsStep` 允许 `Enter` 强行继续，但明确保留手工文档入口

因此这里不是“预检查失败就硬退出”，而是区分：

- 致命 gate：例如 scope 缺失，直接进 `error`
- 非致命 gate：例如没装 gh、没登录、权限可能不足，进 `warnings`

这是典型的 operator-first 风格。

## 4. `ChooseRepoStep` 不是文本框，而是“当前仓库 vs 手输仓库”二选一模式机

源码镜像：[`../../src/commands/install-github-app/ChooseRepoStep.tsx`](../../src/commands/install-github-app/ChooseRepoStep.tsx)

这一步明确把 repo 选择分成两条路径：

- `Use current repository: <currentRepo>`
- `Enter a different repository`

而不是默认只让用户输文本。组件里甚至把键位上下文专门做成：

- 当文本输入不可见时，`confirm:previous / next / yes` 控制模式切换与提交
- 当文本输入可见时，拿掉 `confirm:yes`，避免裸 `y` 被误识别成提交

这说明 repo 选择不是普通表单，而是“列表模式”和“输入模式”并置的双态工作面。

## 5. repo 选择后的规范化和权限预审仍然留在主状态机，而不是塞给 UI

源码镜像：[`../../src/commands/install-github-app/install-github-app.tsx`](../../src/commands/install-github-app/install-github-app.tsx)

`ChooseRepoStep` 只负责表达选择；真正的 repo 处理发生在 `handleSubmit()`：

- `github.com/owner/repo(.git)` 归一化到 `owner/repo`
- 检查是否缺 `/`
- 调 `checkRepositoryPermissions()`
- 查 admin 权限
- 查 `.github/workflows/claude.yml` 是否存在

这说明这个向导的结构很清楚：

- step 组件负责交互与可见状态
- 主状态机负责验证与跨步分流

不是让每个 step 自己处理业务。

## 6. `install-app` 是故意拆出来的中间站，而不是浏览器 side effect 的隐式副产物

源码镜像：[`../../src/commands/install-github-app/install-github-app.tsx`](../../src/commands/install-github-app/InstallAppStep.tsx)

在 `choose-repo` 之后，不是立即进入 workflow/secret 配置，而是单独进入 `install-app`：

- 展示即将打开浏览器安装 Claude GitHub App
- 真正 `openBrowser()` 用 `setTimeout` 异步触发
- 用户再按一次确认，才进入后续 workflow 检查

这让“打开外部浏览器并安装 GitHub App”被明确建模成一个独立步骤，而不是向导内部的隐式副作用。

## 7. `ExistingWorkflowStep` 说明已有 `.github/workflows/claude.yml` 时，系统不是报冲突，而是给策略分支

源码镜像：[`../../src/commands/install-github-app/ExistingWorkflowStep.tsx`](../../src/commands/install-github-app/ExistingWorkflowStep.tsx)

这一步给出的不是 yes/no，而是三种策略：

- `update`
- `skip`
- `exit`

并明确解释：

- update：用最新模板更新 workflow
- skip：保留 workflow，只继续 secrets
- exit：完全不改

这说明 Claude Code 对“仓库里已有自动化”采取的是协商策略，而不是强覆盖。

## 8. `WorkflowMultiselectDialog` 说明 GitHub 安装面已经开始把自动化能力拆成多个产品面

源码镜像：[`../../src/components/WorkflowMultiselectDialog.tsx`](../../src/components/WorkflowMultiselectDialog.tsx)

这个组件把 workflow 选择做成了一个正式的多选对话框，而不是两三个布尔开关。当前内建选项是：

- `claude`
- `claude-review`

而且它有两个很明确的产品信号：

- 选择不能为空，否则报 `You must select at least one workflow`
- 文案里直接指向 examples 目录，暗示将来这不是封闭集合

因此这一步已经不是“要不要装 Claude workflow”，而是“安装哪组 GitHub automation surface”。

## 9. `CheckExistingSecretStep` 把 secret 冲突处理成“复用 vs 旁路新 secret”决策面

源码镜像：[`../../src/commands/install-github-app/CheckExistingSecretStep.tsx`](../../src/commands/install-github-app/CheckExistingSecretStep.tsx)

当发现 `ANTHROPIC_API_KEY` 已存在时，它不是直接失败，而是给两条路径：

- `Use the existing API key`
- `Create a new secret with a different name`

并且如果选择第二条，就露出文本输入框要求自定义 secret 名称。这里依然沿用了和 repo 选择类似的双态键位协议：

- 列表态可以 `↑/↓` 切换 + `Enter`
- 文本态保留输入，不让 confirmation 直接吞字

这说明 secret 冲突在 Claude Code 里被视为一等 UX 问题，而不是仅仅让用户去 GitHub 自己修。

## 10. `ApiKeyStep` 把 credential 策略做成了三态选择，而不是只有粘贴 key

源码镜像：[`../../src/commands/install-github-app/ApiKeyStep.tsx`](../../src/commands/install-github-app/ApiKeyStep.tsx)

这个步骤当前实际上支持三种 credential path：

- `existing`
- `oauth`
- `new`

也就是：

- 用本地已有 Claude Code API key
- 用 Claude 订阅创建一个 long-lived token
- 手输新的 API key

所以它的本质不是“输入 key”，而是“为 GitHub Actions 选一种长期凭证供给方式”。

## 11. `OAuthFlowStep` 是整个向导里最像独立微应用的一步

源码镜像：[`../../src/commands/install-github-app/OAuthFlowStep.tsx`](../../src/commands/install-github-app/OAuthFlowStep.tsx)

它自己维护了一套小状态机：

- `starting`
- `waiting_for_login`
- `processing`
- `success`
- `error`
- `about_to_retry`

并且还处理了几件很细的事：

- 3 秒后才显示 `Paste code here if prompted >`
- 输入的是 `authorizationCode#state`
- `c` 可以复制 URL 到剪贴板
- 失败后允许 retry，而不是把整个安装向导打回起点
- `saveOAuthTokensIfNeeded()` 只保存 inference-only token，不破坏当前登录会话

这说明 OAuth 不是“调个外部 helper”，而是向导里的一个完整子流程。

## 12. `creating` / `success` / `error` 三步把“repo mutation pipeline”的结果重新产品化

源码镜像：[`../../src/commands/install-github-app/CreatingStep.tsx`](../../src/commands/install-github-app/CreatingStep.tsx), [`../../src/commands/install-github-app/SuccessStep.tsx`](../../src/commands/install-github-app/SuccessStep.tsx), [`../../src/commands/install-github-app/ErrorStep.tsx`](../../src/commands/install-github-app/ErrorStep.tsx)

最后三步不是简单 toast：

- `CreatingStep` 展示当前安装流水线进度，并区分 skip workflow 与正常创建
- `SuccessStep` 会根据 `skipWorkflow` 和 secret 复用状态给不同的 next steps
- `ErrorStep` 会尽量展示 `errorReason`、`errorInstructions`，并始终保留手工文档入口

这意味着后台的 GitHub repo mutation pipeline 已经被翻译成一组面向操作者的可解释结果页。

## 13. 整个安装向导最重要的结构特征是“主状态机控流，step 组件控交互”

源码镜像：[`../../src/commands/install-github-app/install-github-app.tsx`](../../src/commands/install-github-app/install-github-app.tsx)

可以把它压成两层：

1. 主状态机
   负责：
   - 调 `gh`
   - 规范化 repo
   - 查权限、workflow、secret
   - 决定跳哪个 step
   - 驱动 `setupGitHubActions()`
2. step 组件
   负责：
   - 展示当前分叉
   - 提供键位与输入体验
   - 把用户选择交回状态机

这是一种很清楚的 architecture choice：避免把控制逻辑和交互逻辑揉进一个超级组件。

## 14. `UltrareviewOverageDialog` 是另一种极小但极关键的 review gate

源码镜像：[`../../src/commands/review/UltrareviewOverageDialog.tsx`](../../src/commands/review/UltrareviewOverageDialog.tsx)

和安装向导相反，这个组件非常小，但门很重。它只处理一个问题：

- 免费 ultrareviews 用完后，用户要不要继续按 Extra Usage 计费发起 review

当前只有两项：

- `Proceed with Extra Usage billing`
- `Cancel`

但它的实现有一个比表面更重要的点：`onProceed` 接受 `AbortSignal`。

## 15. `UltrareviewOverageDialog` 的重点不是选择器，而是“取消必须能撤回 in-flight launch”

源码镜像：[`../../src/commands/review/UltrareviewOverageDialog.tsx`](../../src/commands/review/UltrareviewOverageDialog.tsx)

它内部显式创建 `AbortController`，并在 `handleCancel()` 里：

- `abortControllerRef.current.abort()`
- `onCancel()`

注释也写得很直白：如果 launch 是 fire-and-forget，用户即使“取消”，远端 review 仍可能继续跑并继续计费。

所以这个 gate 真正守住的不是 UI，而是：

- 取消应当中止 billing side effect
- launch 失败时要把 Select 恢复出来，允许 retry

这是一条非常典型的“产品文案很短，但实现约束很强”的门控面。

## 16. 这篇和前面几卷的边界

- [`commands/06-github-workflow-installation-and-setup.md`](../commands/06-github-workflow-installation-and-setup.md)
  讲命令链和 repo mutation pipeline。
- [`mechanisms/14-remote-review-workflow-and-monitor-surfaces.md`](../mechanisms/14-remote-review-workflow-and-monitor-surfaces.md)
  讲远端 review / workflow / monitor 的工作面和后台任务面。
- [`mechanisms/15-review-and-github-workflow-integration.md`](../mechanisms/15-review-and-github-workflow-integration.md)
  讲审查与 GitHub 集成的产品闭环。
- 本文
  专门讲安装与 review 之前的最终 gate surfaces，以及这些 gate 如何被做成交互状态机。

## 17. 这一层为什么值得单独成卷

如果没有这篇，很容易把这两条链误读成：

- `install-github-app` 只是一个命令加几个步骤页
- `UltrareviewOverageDialog` 只是一个二选一确认框

但源码显示不是这样：

- GitHub 安装面已经是一套完整的 step-driven operator wizard
- 每个 step 都在认真处理输入模式、键位上下文、冲突分叉和失败恢复
- ultrareview 的计费 gate 则把 abortable launch 明确建模成产品边界

这说明 Claude Code 不只是有很多功能，而是已经把“功能前的决策门”也当成正式产品面来做。
