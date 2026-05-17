# Review 与 GitHub Workflow Integration

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Remote Review / Workflow / Monitor`](./14-remote-review-workflow-and-monitor-surfaces.md) | [`下一站：产品卷`](../product/01-positioning-and-surface.md)

本文补的是 Claude Code 的“审查与 GitHub 集成工作流面”，重点覆盖 `security-review`、`pr-comments`、`install-github-app` / `setupGitHubActions` 这几条链。它们和上一卷的 `/ultrareview` 一起，构成了 Claude Code 从本地 diff 审阅、PR 评论消费到 GitHub Actions 工作流落地的完整产品面。

## 1. 这组能力的共同点不是“都跟 GitHub 有关”，而是“把审查工作流产品化”

源码镜像：[`../../sources/claude-code/src/commands/security-review.ts`](../../sources/claude-code/src/commands/security-review.ts), [`../../sources/claude-code/src/commands/pr_comments/index.ts`](../../sources/claude-code/src/commands/pr_comments/index.ts), [`../../sources/claude-code/src/commands/install-github-app/install-github-app.tsx`](../../sources/claude-code/src/commands/install-github-app/install-github-app.tsx), [`../../sources/claude-code/src/commands/install-github-app/setupGitHubActions.ts`](../../sources/claude-code/src/commands/install-github-app/setupGitHubActions.ts)

这几条链分别解决不同问题：

- `security-review`：把 pending diff 压缩成一个高约束安全审查 prompt
- `pr-comments`：把 GitHub PR 评论线程拉回本地终端
- `install-github-app`：把 GitHub App、Secrets、workflow file、PR 页面串成安装向导

但它们的共同点是：都不是“底层工具能力本身”，而是围绕一个高频开发工作流做了产品化编排。

## 2. `security-review` 不是原生工具，而是 Markdown 命令模板 + shell 扩展执行器

源码镜像：[`../../sources/claude-code/src/commands/security-review.ts`](../../sources/claude-code/src/commands/security-review.ts)

这份命令实现最重要的事实是：它不是手写一个 command handler 去拼上下文，而是内置了一整段 `SECURITY_REVIEW_MARKDOWN`。

里面同时包含：

- frontmatter：`allowed-tools`
- prompt body：角色、目标、方法论、输出格式
- shell placeholders：`!\`git status\``, `!\`git diff ...\``, `!\`git log ...\``

然后运行时再依次经过：

- `parseFrontmatter`
- `parseSlashCommandToolsFromFrontmatter`
- `executeShellCommandsInPrompt`

这说明 Claude Code 的某些复杂 slash command 已经不是代码里硬拼 prompt，而是“可执行 markdown command spec”。

## 3. `security-review` 的关键不是 prompt 长，而是误报过滤被硬编码成协议

源码镜像：[`../../sources/claude-code/src/commands/security-review.ts`](../../sources/claude-code/src/commands/security-review.ts)

这条命令比普通审查 prompt 更像一个受约束审计框架，因为它把下面几层都直接写死在命令模板里：

- 明确的 threat categories
- 只看当前分支改动，不谈既有问题
- 大量 hard exclusions
- confidence threshold
- 输出格式
- “先找漏洞，再并行做 false-positive filter”的子任务流程

也就是说，这里不只是告诉模型“请做安全审查”，而是在命令层就给出一套高度程序化的审查协议。

## 4. `allowed-tools` 会在运行时反写进 permission context

源码镜像：[`../../sources/claude-code/src/commands/security-review.ts`](../../sources/claude-code/src/commands/security-review.ts)

`executeShellCommandsInPrompt()` 调用时，并不是简单给 context 原样透传，而是覆盖了：

- `toolPermissionContext.alwaysAllowRules.command = allowedTools`

所以 `security-review` 的 Markdown frontmatter 不是只给人读的元数据，而是会在运行时影响工具权限边界。

这说明 Claude Code 的 slash command frontmatter 已经具备半声明式的运行时治理作用。

## 5. `pr-comments` 代表另一种命令风格：prompt 极薄，工作流极明确

源码镜像：[`../../sources/claude-code/src/commands/pr_comments/index.ts`](../../sources/claude-code/src/commands/pr_comments/index.ts)

和 `security-review` 相比，`pr-comments` 的实现非常薄：

- 先 `gh pr view --json`
- 再拉 issue comments
- 再拉 review comments
- 必要时按 path + ref 取源码上下文
- 最后只返回格式化评论结果

这里几乎没有复杂分析规则，重点在于：

- 明确要求只输出 comments
- 同时覆盖 PR-level 和 code-review comments
- 要保留 thread/reply 结构
- 要展示 file / line / diff hunk context

因此 `pr-comments` 更像一个“GitHub review thread adapter”，把 API 输出转成适合终端阅读的统一文本。

## 6. `pr-comments` 证明 Claude Code 对 GitHub 的一部分集成仍然走 CLI 编排，而不是专有 API client

源码镜像：[`../../sources/claude-code/src/commands/pr_comments/index.ts`](../../sources/claude-code/src/commands/pr_comments/index.ts)

这里不是内置一个 GitHub SDK，而是直接把 `gh` CLI 当成数据面：

- `gh pr view`
- `gh api issues/.../comments`
- `gh api pulls/.../comments`
- 必要时 `gh api contents/... | base64 -d`

这和上一卷远端 review 里对 `gh` / repo metadata 的依赖一脉相承，说明 Claude Code 在 GitHub 集成上经常采用：

- 命令层定义工作流
- `gh` 提供 repo / PR / secret / workflow 操作能力
- 本地 UI 只负责引导和结果呈现

## 7. `install-github-app` 不是单次命令，而是一个多步骤向导状态机

源码镜像：[`../../sources/claude-code/src/commands/install-github-app/install-github-app.tsx`](../../sources/claude-code/src/commands/install-github-app/install-github-app.tsx)

这份文件的状态机很明确。`INITIAL_STATE` 就已经暴露了整个流程图：

- `check-gh`
- `warnings`
- `choose-repo`
- `check-existing-workflow`
- `select-workflows`
- `creating`
- `success`
- `error`

再配上多个 step 组件：

- `CheckGitHubStep`
- `ChooseRepoStep`
- `ExistingWorkflowStep`
- `CheckExistingSecretStep`
- `ApiKeyStep`
- `OAuthFlowStep`
- `CreatingStep`
- `SuccessStep`

这说明 GitHub 集成安装在 Claude Code 里并不是“执行几条命令然后输出说明”，而是一个完整的交互式向导。

## 8. 这个向导首先检查的是 `gh` 环境和 scope，而不是直接问用户仓库名

源码镜像：[`../../sources/claude-code/src/commands/install-github-app/install-github-app.tsx`](../../sources/claude-code/src/commands/install-github-app/install-github-app.tsx)

`checkGitHubCLI()` 会依次检查：

- `gh --version` 是否可用
- `gh auth status -a`
- token scopes 里是否包含 `repo` 和 `workflow`
- 当前目录是否能解析出 GitHub repo

如果 scope 缺失，它不是只给 warning，而是直接切到 error step，并明确提示：

- `gh auth refresh -h github.com -s repo,workflow`

这说明安装向导把“先把 CLI 环境修好”视为先决条件，而不是出错时再兜底。

## 9. `setupGitHubActions()` 不是“创建一个 workflow file”，而是一整条 repo mutation pipeline

源码镜像：[`../../sources/claude-code/src/commands/install-github-app/setupGitHubActions.ts`](../../sources/claude-code/src/commands/install-github-app/setupGitHubActions.ts)

它至少包含这些阶段：

- 校验 repo 是否存在
- 获取默认分支
- 获取默认分支 SHA
- 新建 branch
- 根据用户选择创建一个或多个 workflow file
- 设置 GitHub Actions secret
- 打开 compare URL，让用户去 GitHub 完成 PR

而且这些步骤都带埋点和失败分型，不是一个大 try/catch 笼统报错。

所以这里的本质不是“写文件”，而是“在 GitHub 仓库上跑一条受控安装流水线”。

## 10. workflow file 创建逻辑已经考虑了 update 与 custom secret 名称

源码镜像：[`../../sources/claude-code/src/commands/install-github-app/setupGitHubActions.ts`](../../sources/claude-code/src/commands/install-github-app/setupGitHubActions.ts)

`createWorkflowFile()` 并不是永远新建：

- 先查 workflow path 是否已经存在
- 如果存在，就拿 `.sha` 走更新路径
- 如果 secret 不是默认 `ANTHROPIC_API_KEY`，会重写 workflow 模板里的 secret 引用
- 如果用的是 OAuth token，还会把参数名从 `anthropic_api_key` 改成 `claude_code_oauth_token`

这说明安装向导并不是只适配“最标准的 API key 情况”，而是已经把模板层参数替换做成可编排逻辑。

## 11. `selectedWorkflows` 说明它支持的不只是一个 Claude workflow

源码镜像：[`../../sources/claude-code/src/commands/install-github-app/install-github-app.tsx`](../../sources/claude-code/src/commands/install-github-app/install-github-app.tsx), [`../../sources/claude-code/src/commands/install-github-app/setupGitHubActions.ts`](../../sources/claude-code/src/commands/install-github-app/setupGitHubActions.ts)

当前默认就带两个 workflow 选项：

- `claude`
- `claude-review`

在真正创建阶段，它会按选择生成：

- `.github/workflows/claude.yml`
- `.github/workflows/claude-code-review.yml`

因此 GitHub 集成这里并不是“一键开通 Claude”，而是已经开始把不同自动化能力拆成多个 workflow surface。

## 12. PR 创建本身被故意设计成“打开 compare 页面”，而不是直接写 PR

源码镜像：[`../../sources/claude-code/src/commands/install-github-app/setupGitHubActions.ts`](../../sources/claude-code/src/commands/install-github-app/setupGitHubActions.ts)

这一点很关键。workflow 和 secret 都配好之后，它并没有直接 `gh pr create`，而是：

- 生成 compare URL
- 预填 `PR_TITLE`
- 预填 `PR_BODY`
- `openBrowser(compareUrl)`

这说明 Claude Code 在这条安装工作流上，选择的是：

- 自动完成 repo mutation 的重活
- 但把最终 PR 提交保留在 GitHub 页面，由用户确认

这是一个非常典型的“高自动化 + 人工最后确认”的产品边界。

## 13. 这条链和上一卷的 `/ultrareview` 共同构成“GitHub 工作流双面”

可以把这两篇放在一起看：

- `/ultrareview`：从本地 repo / PR 发起远端 code review 任务
- `pr-comments`：把已有 PR 讨论线程拉回本地
- `install-github-app`：把 GitHub App、secret、workflow file、PR 页面串成安装向导
- `security-review`：对当前 pending diff 做本地安全审查

这四条链分别覆盖了：

- review 生产
- review 消费
- review 基础设施安装
- review 专项变体

因此 Claude Code 在 GitHub 审查工作流上，已经不仅是“能调 GitHub”，而是有一套从安装到运行到反馈的产品闭环。

## 14. 当前镜像里 `ReviewArtifactTool` 主体未挂载，不能硬写成已拆明白

源码入口：`packages/claude-code/src/tools/ReviewArtifactTool/**`, `packages/claude-code/src/components/permissions/ReviewArtifactPermissionRequest/**`

`PermissionRequest.tsx` 里确实还保留了 `ReviewArtifactTool` 和它的 permission request 分支，但当前工作区镜像里主体文件没有挂载出来。

所以这篇文档不会声称：

- review artifact 的工具内部执行已经完整掌握

只能确认：

- 它在权限系统里曾被当成一等 tool type 预留过位置
- 但当前证据不足以写成功能级实现卷

这和前面 workflow/monitor 的处理原则一致：可见多少写多少，不拿缺失镜像脑补实现。

## 15. 这一卷的结论

Claude Code 的审查与 GitHub 集成面至少已经包含三种不同工程风格：

- `security-review`：声明式 markdown command spec + prompt shell execution
- `pr-comments`：轻量 CLI orchestration + formatter
- `install-github-app`：多步骤向导 + GitHub repo mutation pipeline

再加上上一卷的 `/ultrareview` 远端任务链，可以看出它并不是只提供“和 GitHub 聊天”的能力，而是在逐步形成一套完整的代码审查与自动化落地工作面。
