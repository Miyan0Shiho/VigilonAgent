# Local Review、Security Review 与 PR Comments 命令链

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Bootstrap / Remote Control / Web Planning`](./08-bootstrap-remote-control-and-web-planning.md) | [`下一站：Account Auth / Upgrade / Release Info`](./10-account-auth-upgrade-and-release-info.md)

本文把 Claude Code 里另外四条容易被混写的审查命令单独拆开：

- `/review`
- `/ultrareview`
- `security-review`
- `pr-comments`

它们都服务于 code review，但工程形态完全不同：本地 prompt、feature-gated remote launch、声明式安全审查模板、GitHub 评论线程适配器。

## 1. 这四条链不能再被写成“一个 review 命令族”

源码镜像：[`../../sources/claude-code/src/commands/review.ts`](../../sources/claude-code/src/commands/review.ts), [`../../sources/claude-code/src/commands/review/ultrareviewCommand.tsx`](../../sources/claude-code/src/commands/review/ultrareviewCommand.tsx), [`../../sources/claude-code/src/commands/security-review.ts`](../../sources/claude-code/src/commands/security-review.ts), [`../../sources/claude-code/src/commands/pr_comments/index.ts`](../../sources/claude-code/src/commands/pr_comments/index.ts)

这四条命令分别代表四种不同实现风格：

- `/review`：`type: 'prompt'` 的本地 PR 审查提示词
- `/ultrareview`：`type: 'local-jsx'` 的远端 bughunter 启动门
- `security-review`：内嵌 Markdown command spec，经 frontmatter 和 shell expansion 运行
- `pr-comments`：极薄 prompt，显式编排 `gh` CLI 去拉评论

所以“review”在 Claude Code 里不是单一能力，而是多个工作面的统称。

## 2. `/review` 仍然是本地 prompt 命令，不是 CCR 远端路径

源码镜像：[`../../sources/claude-code/src/commands/review.ts`](../../sources/claude-code/src/commands/review.ts)

`review.ts` 自己已经把边界写死了：

- `review`：`type: 'prompt'`
- `ultrareview`：`type: 'local-jsx'`

而且注释明确说：

- `/ultrareview is the ONLY entry point to the remote bughunter path`
- `/review stays purely local`

这意味着 `/review` 的职责很克制：

- 没给 PR 号时先 `gh pr list`
- 给 PR 号时 `gh pr view <number>`
- 再 `gh pr diff <number>`
- 最后基于 diff 生成常规 code review

它是本地审查 prompt，不负责 quota、teleport、CCR session、remote polling。

## 3. `/ultrareview` 不是 prompt 别名，而是一个受 feature gate 控制的 JSX 启动器

源码镜像：[`../../sources/claude-code/src/commands/review.ts`](../../sources/claude-code/src/commands/review.ts), [`../../sources/claude-code/src/commands/review/ultrareviewEnabled.ts`](../../sources/claude-code/src/commands/review/ultrareviewEnabled.ts)

`ultrareview` 的可见性不是静态的，而是：

- `isEnabled: () => isUltrareviewEnabled()`
- `isUltrareviewEnabled()` 再读取 GrowthBook 的 `tengu_review_bughunter_config.enabled`

这说明 `/ultrareview` 连“是否出现在命令表里”都是 rollout 控制的一部分，而不是每个用户默认都看得到。

## 4. `/ultrareview` 命令壳真正做的是 billing gate dispatch

源码镜像：[`../../sources/claude-code/src/commands/review/ultrareviewCommand.tsx`](../../sources/claude-code/src/commands/review/ultrareviewCommand.tsx)

`ultrareviewCommand.tsx` 本身不做审查分析，它做三件事：

- 先 `checkOverageGate()`
- 必要时渲染 `UltrareviewOverageDialog`
- 最后把实际远端发起委托给 `launchRemoteReview()`

而且它明确处理了两个产品细节：

- 如果用户在 launch 过程中按 `Escape`，`signal.aborted` 会阻止 `onDone` 写回“死掉的 transcript slot”
- 只有非 aborted launch 成功后，才 `confirmOverage()`

所以这份命令壳真正承担的是“本地交互门控 + launch 生命周期防抖”。

## 5. `checkOverageGate()` 把 ultrareview 的免费额度和 Extra Usage 政策编码成显式状态机

源码镜像：[`../../sources/claude-code/src/commands/review/reviewRemote.ts`](../../sources/claude-code/src/commands/review/reviewRemote.ts), [`../../sources/claude-code/src/services/api/ultrareviewQuota.ts`](../../sources/claude-code/src/services/api/ultrareviewQuota.ts)

这条 gate 至少区分四种状态：

- `proceed`
- `not-enabled`
- `low-balance`
- `needs-confirm`

它的判断顺序也很明确：

- team / enterprise 直接放行
- 再并行取 `fetchUltrareviewQuota()` 与 `fetchUtilization()`
- 免费 review 没用完就进入 `proceed`
- 免费 quota 用尽后，再看 Extra Usage 是否打开、余额是否够、是否已经 session 级确认过 overage

因此 ultrareview 的计费面不是“失败后弹一句话”，而是一套显式的会话级状态协议。

## 6. `launchRemoteReview()` 不是 review 本体，而是 teleported review session 的装配器

源码镜像：[`../../sources/claude-code/src/commands/review/reviewRemote.ts`](../../sources/claude-code/src/commands/review/reviewRemote.ts)

这条链已经在远端机制卷里展开过，但从命令角度看，关键是它如何把 `/ultrareview` 编造成一个可启动产品面：

- 先跑 `checkRemoteAgentEligibility()`
- 再区分 PR 模式和 branch 模式
- 给 CCR session 注入 `BUGHUNTER_*` 环境变量
- 调 `teleportToRemote()`
- 注册 `RemoteAgentTask`
- 把启动结果回灌成本地会话可继续追问的 content blocks

所以 `/ultrareview` 在命令层的本质不是“审查 prompt”，而是“远端审查任务发起协议”。

## 7. `security-review` 属于完全不同的一类：可执行 Markdown command spec

源码镜像：[`../../sources/claude-code/src/commands/security-review.ts`](../../sources/claude-code/src/commands/security-review.ts)

这份命令最关键的结构不是函数，而是内嵌的 `SECURITY_REVIEW_MARKDOWN`：

- frontmatter：`allowed-tools`
- prompt body：威胁类别、误报过滤、输出格式
- shell placeholders：`!\`git status\``, `!\`git diff ...\``, `!\`git log ...\``

运行时再依次经过：

- `parseFrontmatter`
- `parseSlashCommandToolsFromFrontmatter`
- `executeShellCommandsInPrompt`

也就是说，`security-review` 不是在 TS 里硬拼 prompt，而是在执行一份半声明式命令规范。

## 8. `security-review` 的 frontmatter 不只是注释，它会真的改写工具权限

源码镜像：[`../../sources/claude-code/src/commands/security-review.ts`](../../sources/claude-code/src/commands/security-review.ts)

执行 `executeShellCommandsInPrompt()` 时，代码会覆盖：

- `toolPermissionContext.alwaysAllowRules.command = allowedTools`

所以 `allowed-tools: Bash(...), Read, Glob, Grep, LS, Task` 不是“给读者看的说明”，而是命令运行时真实生效的 permission 边界。

这说明 Claude Code 的 slash command frontmatter 已经具备了：

- prompt 输入配置
- 工具白名单配置
- shell expansion 执行边界

三层混合职责。

## 9. `security-review` 还把 false-positive filtering 直接写成了多子任务协议

源码镜像：[`../../sources/claude-code/src/commands/security-review.ts`](../../sources/claude-code/src/commands/security-review.ts)

这条命令不是只说“做安全审查”，而是把过程写成了三步：

1. 先用 sub-task 找漏洞
2. 再为每个漏洞启动并行 sub-task 去做 false-positive filter
3. 过滤掉置信度低于 8 的结果

这和普通 slash command 很不一样。它已经不是单轮提示，而是在命令文本层明确要求 agent 做一轮“发现 -> 并行复审 -> 过滤”的程序化审查。

## 10. `pr-comments` 走的是第四种路线：极薄 prompt + 显式 GitHub CLI 编排

源码镜像：[`../../sources/claude-code/src/commands/pr_comments/index.ts`](../../sources/claude-code/src/commands/pr_comments/index.ts)

`pr-comments` 的 prompt 非常薄，但工作流非常清楚：

1. `gh pr view --json number,headRepository`
2. `gh api /issues/{number}/comments`
3. `gh api /pulls/{number}/comments`
4. 必要时再按 `path + ref` 拉源码内容
5. 最后只输出格式化后的 comments

这说明它的重点不是推理协议，而是把 GitHub API 的多种评论对象统一翻译成终端可读结果。

## 11. `pr-comments` 最重要的产品约束是“只输出 comments，不要二次解释”

源码镜像：[`../../sources/claude-code/src/commands/pr_comments/index.ts`](../../sources/claude-code/src/commands/pr_comments/index.ts)

这条命令在 prompt 里硬编码了几个结果约束：

- 只返回格式化评论
- 同时覆盖 PR-level comment 和 review comment
- 保留 thread / reply 嵌套
- 展示 `file#line`
- 展示 `diff_hunk`

因此它不是“让模型总结 PR 讨论”，而是“把 GitHub review thread 搬运回本地终端，并保持结构”。

## 12. 这一卷的结论

Claude Code 当前至少有四种不同审查命令形态：

- `/review`：本地 prompt 审查
- `/ultrareview`：feature-gated 远端审查任务发起
- `security-review`：可执行 Markdown 安全审查 spec
- `pr-comments`：GitHub 评论线程适配器

把它们混成“一个 review 命令族”会直接降低文档准确度。真正合理的拆法，是先承认它们共用 review 语义，再分别按本地 prompt、remote gate、declarative command、CLI adapter 四种实现风格去理解。
