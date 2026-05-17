# GitHub Workflow Installation 与 Setup 命令链

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Plugin / MCP Operator 命令`](./05-plugin-and-mcp-operator-commands.md) | [`下一站：Permission / MCP UI`](../architecture/06-permission-and-mcp-ui-systems.md)

本文只拆一条命令链：`install-github-app`。它不是普通 slash command，也不是单个 `gh` 包装器，而是一套本地 JSX 向导，加上一条真实修改 GitHub 仓库状态的安装流水线。

## 1. 这条链的本质不是“安装 App”，而是把 GitHub Actions 接入做成产品向导

源码镜像：[`../../sources/claude-code/src/commands/install-github-app/install-github-app.tsx`](../../sources/claude-code/src/commands/install-github-app/install-github-app.tsx), [`../../sources/claude-code/src/commands/install-github-app/setupGitHubActions.ts`](../../sources/claude-code/src/commands/install-github-app/setupGitHubActions.ts)

从 `INITIAL_STATE` 和 step 组件就能看出，它在管理一条多阶段产品流程，而不是一条命令：

- 环境检查：`check-gh`
- 告警兜底：`warnings`
- 仓库选择：`choose-repo`
- 已有 workflow 冲突：`check-existing-workflow`
- workflow 选择：`select-workflows`
- secret 决策：`check-existing-secret`
- 凭证路径：`api-key` / `oauth-flow`
- 实际变更：`creating`
- 结束态：`success` / `error`

所以这里真正被产品化的是一条“仓库接入 Claude 工作流”的 operator journey。

## 2. `install-github-app.tsx` 是本地状态机，不是壳命令

源码镜像：[`../../sources/claude-code/src/commands/install-github-app/install-github-app.tsx`](../../sources/claude-code/src/commands/install-github-app/install-github-app.tsx)

这份文件自己就承担了几层关键职责：

- 保存整个安装状态：仓库、secret、auth type、selected workflows、workflow action
- 在不同 step 间切换，并把下一步决策编码进 state
- 先做 `gh`、repo、permissions、existing workflow、existing secret 检查
- 再决定是走 API key、OAuth token，还是只复用已有 secret
- 最后调用 `setupGitHubActions()`

这说明 Claude Code 在这条链上并没有把核心逻辑都下沉到服务层，命令 UI 自己就是 orchestration runtime。

## 3. 第一层 gate 是 `gh` 环境，而不是仓库配置

源码镜像：[`../../sources/claude-code/src/commands/install-github-app/install-github-app.tsx`](../../sources/claude-code/src/commands/install-github-app/install-github-app.tsx), [`../../sources/claude-code/src/commands/install-github-app/CheckGitHubStep.tsx`](../../sources/claude-code/src/commands/install-github-app/CheckGitHubStep.tsx)

`checkGitHubCLI()` 依次检查：

- `gh --version`
- `gh auth status -a`
- token scopes 是否包含 `repo` 和 `workflow`
- 当前目录是否可解析为 GitHub repo

其中最重要的不是“有检查”，而是 scope 缺失会直接切到 `error`，并给出明确修复命令：

- `gh auth refresh -h github.com -s repo,workflow`

也就是说，这条安装链把 GitHub CLI 权限视为硬前置条件，不把它留到后面失败时再解释。

## 4. `choose-repo` 阶段不是收字符串，而是在做 repo 归一化和权限预审

源码镜像：[`../../sources/claude-code/src/commands/install-github-app/install-github-app.tsx`](../../sources/claude-code/src/commands/install-github-app/install-github-app.tsx)

仓库选择阶段至少做了四件事：

- 把 `https://github.com/owner/repo` 归一化成 `owner/repo`
- 校验输入是否符合 `owner/repo` 语义
- 通过 `gh api repos/<repo> --jq .permissions.admin` 预审 admin 权限
- 预查 `.github/workflows/claude.yml` 是否已存在

这说明 Claude Code 不等到真正写 branch / workflow 时才发现仓库不可写，而是在 UI 前半段就先做 operator-level feasibility 检查。

## 5. 已有 workflow 不是简单报错，而是进入分支策略选择

源码镜像：[`../../sources/claude-code/src/commands/install-github-app/ExistingWorkflowStep.tsx`](../../sources/claude-code/src/commands/install-github-app/ExistingWorkflowStep.tsx), [`../../sources/claude-code/src/commands/install-github-app/install-github-app.tsx`](../../sources/claude-code/src/commands/install-github-app/install-github-app.tsx)

如果发现 `.github/workflows/claude.yml` 已存在，向导不是直接退出，而是进入 `ExistingWorkflowStep`，给三个动作：

- `update`
- `skip`
- `exit`

这三个动作分别代表：

- `update`：继续让流水线更新 workflow 文件
- `skip`：只处理 secrets，不改 workflow 文件
- `exit`：整条安装链终止

也就是说，“已有文件冲突”在这里已经被产品化成策略分支，而不是裸错误。

## 6. workflow 选择层说明它安装的不是单一能力

源码镜像：[`../../sources/claude-code/src/components/WorkflowMultiselectDialog.tsx`](../../sources/claude-code/src/components/WorkflowMultiselectDialog.tsx), [`../../sources/claude-code/src/commands/install-github-app/setupGitHubActions.ts`](../../sources/claude-code/src/commands/install-github-app/setupGitHubActions.ts)

`WorkflowMultiselectDialog` 当前暴露两个能力面：

- `claude`
- `claude-review`

而且它不是普通单选，而是多选器，并且禁止空选择继续。这对应到后端流水线，就是按选择生成：

- `.github/workflows/claude.yml`
- `.github/workflows/claude-code-review.yml`

因此这条链的真实语义不是“一键开通 Claude”，而是“选择要在仓库里落哪些 GitHub automation surfaces”。

## 7. secret 决策层已经是一个小型权限与命名协议

源码镜像：[`../../sources/claude-code/src/commands/install-github-app/CheckExistingSecretStep.tsx`](../../sources/claude-code/src/commands/install-github-app/CheckExistingSecretStep.tsx), [`../../sources/claude-code/src/commands/install-github-app/install-github-app.tsx`](../../sources/claude-code/src/commands/install-github-app/install-github-app.tsx)

如果仓库里已有 `ANTHROPIC_API_KEY`，向导不会默认覆盖，而是给两条路：

- 复用已有 secret
- 新建一个不同名称的 secret

`CheckExistingSecretStep` 还明确限制新 secret 名只能是字母、数字和下划线，并把这一步接入键盘确认上下文。说明它不是简单输入框，而是在执行一套仓库 secret 命名与覆盖治理协议。

## 8. API key 和 OAuth token 在这条链里是两条不同安装语义

源码镜像：[`../../sources/claude-code/src/commands/install-github-app/install-github-app.tsx`](../../sources/claude-code/src/commands/install-github-app/install-github-app.tsx), [`../../sources/claude-code/src/commands/install-github-app/setupGitHubActions.ts`](../../sources/claude-code/src/commands/install-github-app/setupGitHubActions.ts)

向导不只支持传统 API key：

- `selectedApiKeyOption === 'existing'`：复用本地已有 key
- `selectedApiKeyOption === 'new'`：输入新的 key
- `selectedApiKeyOption === 'oauth'`：走 OAuth flow

如果是 OAuth token，后端还会把 workflow 模板里的参数从：

- `anthropic_api_key`

替换成：

- `claude_code_oauth_token`

所以“凭证来源”不是 UI 小选项，而是会真正改变 workflow 模板参数语义和 secret 命名。

## 9. `setupGitHubActions()` 是真实的 repo mutation pipeline

源码镜像：[`../../sources/claude-code/src/commands/install-github-app/setupGitHubActions.ts`](../../sources/claude-code/src/commands/install-github-app/setupGitHubActions.ts)

它至少串了这些阶段：

1. 确认 repo 存在
2. 读取默认分支
3. 读取默认分支 SHA
4. 如未 `skipWorkflow`，创建新 branch
5. 按选择创建或更新 workflow 文件
6. 设置 GitHub Actions secret
7. 打开 compare URL，引导用户完成 PR

所以这里不是“把模板写到本地磁盘”，而是直接在 GitHub 仓库 API 上执行受控变更。

## 10. workflow 文件写入逻辑支持 update，不只支持 create

源码镜像：[`../../sources/claude-code/src/commands/install-github-app/setupGitHubActions.ts`](../../sources/claude-code/src/commands/install-github-app/setupGitHubActions.ts)

`createWorkflowFile()` 先查目标路径的 `.sha`。如果文件已存在：

- 走 GitHub contents API 的更新路径
- 把 `sha` 带回 `PUT`

如果不存在：

- 走新建路径

这说明前面的 `update` 选项不是 UI 假动作，后端真的支持“同路径 workflow 文件升级”。

## 11. `CreatingStep` 把后端变更流水线回投成可见进度协议

源码镜像：[`../../sources/claude-code/src/commands/install-github-app/CreatingStep.tsx`](../../sources/claude-code/src/commands/install-github-app/CreatingStep.tsx)

`CreatingStep` 不是单纯 spinner，而是根据当前策略拼进度列表：

- 获取仓库信息
- 创建 branch
- 创建一个或多个 workflow 文件
- 设置或复用 secret
- 打开 pull request 页面

如果是 `skipWorkflow`，进度列表会缩短；如果选了多个 workflows，文案也会切成复数。这说明 UI 在表达的不是“正在忙”，而是“当前仓库接入协议执行到哪一步了”。

## 12. PR 创建被故意留给 GitHub 页面，而不是 CLI 直接提交

源码镜像：[`../../sources/claude-code/src/commands/install-github-app/setupGitHubActions.ts`](../../sources/claude-code/src/commands/install-github-app/setupGitHubActions.ts)

这条链最后没有直接 `gh pr create`，而是：

- 生成 compare URL
- 预填 `PR_TITLE`
- 预填 `PR_BODY`
- `openBrowser(compareUrl)`

这条边界非常清楚：

- 自动化负责 branch、workflow、secret 这些高机械性变更
- 最终 PR 仍然留在 GitHub 页面由人确认

这是 Claude Code 在“仓库自动变更”场景里非常典型的 human-in-the-loop 收口方式。

## 13. 当前镜像里 `./types` 源文件缺失，但类型边界仍能从调用侧恢复

源码入口：`packages/claude-code/src/commands/install-github-app/types`

`install-github-app.tsx`、`setupGitHubActions.ts`、`WorkflowMultiselectDialog.tsx`、`CreatingStep.tsx` 都在引用 `./types` 或相邻导入，但当前工作区镜像里这个文件没有挂载出来。

因此这篇文档不会硬写那份源文件的完整定义，只确认当前已能从调用面恢复出关键边界：

- `Workflow` 至少包含 `claude` 与 `claude-review`
- state 至少包含 step、repo、secret、authType、workflowAction、selectedWorkflows

这属于“证据足够支持行为边界，但不足以逐行还原缺失文件”的情况。

## 14. 这一页的结论

`install-github-app` 这条命令链已经不是普通 slash command，而是一个完整的 GitHub automation onboarding runtime：

- 前段是本地 JSX 向导状态机
- 中段是 repo / secret / workflow / auth 策略分流
- 后段是 GitHub API 变更流水线
- 末端以 compare 页面保留人工确认

如果把它和 [`../mechanisms/15-review-and-github-workflow-integration.md`](../mechanisms/15-review-and-github-workflow-integration.md) 一起读，会更清楚：Claude Code 不只是“能接 GitHub”，而是在把 GitHub 上的 review 与 automation 落地过程产品化。
