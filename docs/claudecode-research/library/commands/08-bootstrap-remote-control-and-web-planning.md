# Bootstrap、Remote Control 与 Web Planning 命令链

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Memory / Skills / Plan / Tasks / Compact`](./07-memory-skills-plan-tasks-and-compact.md) | [`下一站：Local Review / Security Review / PR Comments`](./09-local-review-security-and-pr-comment-workflows.md)

本文拆的是另一组之前还散在总述里的命令：`/init`、`init-verifiers`、`/web-setup`、`/ultraplan`、`/remote-control`，以及只用于 ant 调试的 `/bridge-kick`。它们共同特点不是“都很高级”，而是都在做 bootstrap 或 remote orchestration，而不是普通本地助手命令。

## 1. 这组命令覆盖的是两类产品面：仓库初始化和远端协作接入

源码镜像：[`../../sources/claude-code/src/commands/init.ts`](../../sources/claude-code/src/commands/init.ts), [`../../sources/claude-code/src/commands/init-verifiers.ts`](../../sources/claude-code/src/commands/init-verifiers.ts), [`../../sources/claude-code/src/commands/remote-setup/remote-setup.tsx`](../../sources/claude-code/src/commands/remote-setup/remote-setup.tsx), [`../../sources/claude-code/src/commands/ultraplan.tsx`](../../sources/claude-code/src/commands/ultraplan.tsx), [`../../sources/claude-code/src/commands/bridge/bridge.tsx`](../../sources/claude-code/src/commands/bridge/bridge.tsx)

它们大致分成两类：

- repo bootstrap：`/init`、`init-verifiers`
- remote/web orchestration：`/web-setup`、`/ultraplan`、`/remote-control`

也就是说，这不是“又一批 slash commands”，而是两组把 Claude Code 的外围工作面产品化的入口。

## 2. `/init` 在当前版本里不是固定模板，而是 feature-gated prompt spec

源码镜像：[`../../sources/claude-code/src/commands/init.ts`](../../sources/claude-code/src/commands/init.ts)

`/init` 不是手写 `call()`，而是一个 `type: 'prompt'` 的 builtin command。最关键的是它内置了两套 prompt：

- `OLD_INIT_PROMPT`
- `NEW_INIT_PROMPT`

并通过：

- `feature('NEW_INIT')`
- `process.env.USER_TYPE === 'ant'`
- `CLAUDE_CODE_NEW_INIT`

做选择。

所以 `/init` 的真实实现不是“一个固定 repo 文档生成器”，而是一个可以按 rollout/feature flag 切换的 bootstrap prompt program。

## 3. 新版 `/init` 已经不是“写 CLAUDE.md”，而是一个多阶段仓库上手流程

源码镜像：[`../../sources/claude-code/src/commands/init.ts`](../../sources/claude-code/src/commands/init.ts)

`NEW_INIT_PROMPT` 已经把流程写成多阶段规范：

- Phase 1：问用户要 setup 哪些 CLAUDE 文件，以及是否要 skills/hooks
- Phase 2：探索代码库和现有 AI tool config
- Phase 3：对代码无法回答的缺口再做 AskUserQuestion
- Phase 4/5：分别写 `CLAUDE.md` 与 `CLAUDE.local.md`
- Phase 6：创建 skills
- Phase 7：补 lint/GitHub CLI/hook 等优化
- Phase 8：总结与后续建议

这说明新版 `/init` 已经不是“文档脚手架”，而是 Claude Code 对仓库 onboarding 的完整 productized interview-and-synthesis workflow。

## 4. `/init` 的关键变化是：把 hook、skill、note 三种 artifact 合并进一条决策队列

源码镜像：[`../../sources/claude-code/src/commands/init.ts`](../../sources/claude-code/src/commands/init.ts)

新版 prompt 明确要求先建立 preference queue，再根据 Phase 1 选择过滤：

- `hook`
- `skill`
- `note`

而且会把用户选择的 “Skills only / Hooks only / Neither” 当成硬约束，决定建议最终落到哪里。

这说明 `/init` 不只是帮你写启动文档，而是在为 Claude Code 的三个长期配置面做统一 artifact routing。

## 5. `/init` 还把 worktree、personal local file 和 imports 规则纳入了 repo bootstrap

源码镜像：[`../../sources/claude-code/src/commands/init.ts`](../../sources/claude-code/src/commands/init.ts)

新版 prompt 还显式处理：

- multiple git worktrees
- `CLAUDE.local.md` 的私有性
- sibling/external worktree 时用 `@~/.claude/<project>-instructions.md` 的 import stub

这说明 `/init` 已经不是只关心 repo 根目录，而是在处理 Claude Code instructions 在多工作树环境里的分发协议。

## 6. `init-verifiers` 不是泛化 skill 生成器，而是专门给 Verify agent 建 verifier skills

源码镜像：[`../../sources/claude-code/src/commands/init-verifiers.ts`](../../sources/claude-code/src/commands/init-verifiers.ts)

这条命令同样是 `type: 'prompt'`，但目标更窄：

- 专门创建 verifier skills
- 只面向 Verify agent 的自动验证能力
- 明确排除 unit test / typecheck verifier
- 聚焦 web UI、CLI、HTTP API 三类功能验证

因此它不是“再跑一次 /init”，而是把 verification surface 独立成单独的 bootstrap workflow。

## 7. `init-verifiers` 其实在做多项目区域探测，而不是单应用假设

源码镜像：[`../../sources/claude-code/src/commands/init-verifiers.ts`](../../sources/claude-code/src/commands/init-verifiers.ts)

它的 prompt 先要求：

- 扫描 top-level 目录
- 找不同 package manifests
- 判断每个 area 是 web、CLI 还是 API
- 再决定是 Playwright、Tmux 还是 HTTP verifier

因此这条命令默认假设 repo 可能是 monorepo / multi-area，而不是把整个仓库当成单项目。

## 8. `init-verifiers` 把 verification tool setup 也纳入 prompt，而不是只写 skill 文件

源码镜像：[`../../sources/claude-code/src/commands/init-verifiers.ts`](../../sources/claude-code/src/commands/init-verifiers.ts)

它不仅要写 `.claude/skills/<verifier>/SKILL.md`，还会先处理：

- Playwright 是否已安装
- MCP browser tools 是否已配置
- 是否需要安装 Playwright
- 是否需要写 `.mcp.json`
- CLI/API 验证工具是否可用

也就是说，`init-verifiers` 是 “verification capability bootstrap”，而不是“仅生成 markdown 技能”。

## 9. `/web-setup` 是 GitHub token import 向导，不是单纯打开浏览器

源码镜像：[`../../sources/claude-code/src/commands/remote-setup/index.ts`](../../sources/claude-code/src/commands/remote-setup/index.ts), [`../../sources/claude-code/src/commands/remote-setup/remote-setup.tsx`](../../sources/claude-code/src/commands/remote-setup/remote-setup.tsx), [`../../sources/claude-code/src/commands/remote-setup/api.ts`](../../sources/claude-code/src/commands/remote-setup/api.ts)

`/web-setup` 的产品语义是：

- 检查用户是否已登录 Claude
- 检查本机 `gh` 是否安装、是否认证
- 如已有 `gh auth token`，导入到 CCR backend
- best-effort 创建默认 cloud environment
- 然后打开 `claude.ai/code`

这说明 `/web-setup` 的真实职责是“把本地 GitHub 身份桥接到 Claude Code on the web”，而不是“打开 web 版首页”。

## 10. `remote-setup.tsx` 明确区分了四种前置状态

源码镜像：[`../../sources/claude-code/src/commands/remote-setup/remote-setup.tsx`](../../sources/claude-code/src/commands/remote-setup/remote-setup.tsx)

`checkLoginState()` 会先把当前状态分类成：

- `not_signed_in`
- `gh_not_installed`
- `gh_not_authenticated`
- `has_gh_token`

然后命令再据此决定：

- 直接报 `/login` 前置
- 打开 `.../onboarding?step=alt-auth`
- 或进入 “Connect Claude on the web to GitHub?” 确认框

所以 `/web-setup` 不是线性 happy path，而是一个前置条件分流器。

## 11. `RedactedGithubToken` 说明 web setup 在实现层就处理了 token 泄露风险

源码镜像：[`../../sources/claude-code/src/commands/remote-setup/api.ts`](../../sources/claude-code/src/commands/remote-setup/api.ts)

这里没有直接把 token 当字符串传来传去，而是用 `RedactedGithubToken` 包装：

- `String(token)` 只显示 `[REDACTED:gh-token]`
- `JSON.stringify(token)` 也不会暴露真实值
- 只有 `.reveal()` 才返回原始 token

这说明 `/web-setup` 不是粗糙地把 `gh auth token` 发上去，而是在命令实现层就做了 telemetry/log-safe token handling。

## 12. `/ultraplan` 的本质不是 plan mode 本地扩展，而是一个远端 planning session launcher

源码镜像：[`../../sources/claude-code/src/commands/ultraplan.tsx`](../../sources/claude-code/src/commands/ultraplan.tsx)

`/ultraplan` 并不是本地生成更长的计划。它会：

- 组装 `buildUltraplanPrompt()`
- 走 `teleportToRemote()`
- 注册 `RemoteAgentTask`
- 后台轮询 `pollForApprovedExitPlanMode()`

这说明它本质上是 “Claude Code on the web 的远端计划会话发起器”。

## 13. `/ultraplan` 同时管理了 launch、poll、approval、execution-target 分叉

源码镜像：[`../../sources/claude-code/src/commands/ultraplan.tsx`](../../sources/claude-code/src/commands/ultraplan.tsx)

启动后它不是只等结果，而是显式处理：

- session launch guard：避免重复 launching/polling
- detached polling
- 浏览器里 approval / reject 次数
- `executionTarget === 'remote'` 时继续在 CCR 执行
- 否则回到本地 `ultraplanPendingChoice`

因此 `/ultraplan` 不是一个一次性远端调用，而是一条完整的 remote planning state machine。

## 14. `/ultraplan` 的 prompt 还专门规避了自触发问题

源码镜像：[`../../sources/claude-code/src/commands/ultraplan.tsx`](../../sources/claude-code/src/commands/ultraplan.tsx)

源码里明确写了：

- `prompt.txt` 会被包进 `<system-reminder>`
- 文案故意避免直接出现 feature name

原因是 remote CCR CLI 会对原始输入做 keyword detection，如果 prompt 里裸写 `ultraplan`，可能把自己再次识别成 `/ultraplan`。

这说明这条命令已经处理到了“远端命令解析器会不会被 prompt 本身误伤”的实现细节。

## 15. `/remote-control` 不是状态查看，而是本地终端桥接开关

源码镜像：[`../../sources/claude-code/src/commands/bridge/index.ts`](../../sources/claude-code/src/commands/bridge/index.ts), [`../../sources/claude-code/src/commands/bridge/bridge.tsx`](../../sources/claude-code/src/commands/bridge/bridge.tsx)

`/remote-control` 的命令定义非常明确：

- 命令名是 `remote-control`
- alias 是 `rc`
- 只有 `BRIDGE_MODE` + `isBridgeEnabled()` 才启用

而进入 `bridge.tsx` 后，它真正做的是切换：

- `replBridgeEnabled`
- `replBridgeExplicit`
- `replBridgeOutboundOnly`
- `replBridgeInitialName`

这说明 `/remote-control` 本质上是 REPL <-> claude.ai 双向桥接的本地入口，而不是“看一下远端状态”。

## 16. `/remote-control` 已连接时会切到断开对话框，而不是盲目重连

源码镜像：[`../../sources/claude-code/src/commands/bridge/bridge.tsx`](../../sources/claude-code/src/commands/bridge/bridge.tsx)

如果 bridge 已连接，它不会再执行 connect，而是弹出 `BridgeDisconnectDialog`：

- 显示 session/connect URL
- 支持 disconnect
- 支持 show QR
- 支持 continue

因此这条命令的 operator 语义是“管理现有 bridge session”，而不是单向 connect command。

## 17. `/bridge-kick` 是 ant-only 的故障注入器，不应被当成普通用户命令

源码镜像：[`../../sources/claude-code/src/commands/bridge-kick.ts`](../../sources/claude-code/src/commands/bridge-kick.ts)

这条命令只在：

- `process.env.USER_TYPE === 'ant'`

时启用，而且功能是：

- 人工触发 ws close
- 注入 poll/register/reconnect-session/heartbeat 故障
- 直接 force reconnect
- 打印 bridge debug status

所以它属于 bridge recovery testing tool，而不是用户产品面。文档库应该把它当成调试辅助链，而不是常规功能。

## 18. 这一页的结论

这组命令展示了 Claude Code 命令层另外三类重要角色：

- `/init`、`init-verifiers`：prompt-driven repo bootstrap orchestrators
- `/web-setup`、`/ultraplan`：Claude Code on the web 接入与远端 planning launchers
- `/remote-control`：本地终端桥接 operator surface

再加上 ant-only 的 `/bridge-kick`，可以看到 Claude Code 的命令层已经不只是“本地 agent 操作面”，而是在直接编排 onboarding、remote sessions、browser-side planning 和 bridge recovery 这些外围系统。
