# Scheduled Remote Agent Triggers / Bundled Skill / OAuth Tool Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Remote Web Onboarding / Environments / Managed Settings`](./37-remote-web-onboarding-environments-and-managed-settings.md) | [`下一站：Remote Managed Settings Loading / Polling / Hot Reload`](./38-remote-managed-settings-loading-polling-and-hot-reload.md)

本文把之前只在 remote governance 卷里顺带提到的 scheduled remote agents 独立拆开。主问题不是“Claude Code 能不能调一个 triggers API”，而是它怎样把这块能力做成：

- 一个真正可被 slash 调起的 bundled skill `/schedule`
- 一个不会把 OAuth token 暴露到 shell 的 first-party tool `RemoteTrigger`
- 一套带 repo / connector / environment 补数的 setup prompt runtime
- 一个刻意保留 raw HTTP surface 的 operator UI

对应源码主链是：`skills/bundled/index.ts + skills/bundled/scheduleRemoteAgents.ts + tools/RemoteTriggerTool/{prompt,RemoteTriggerTool,UI}.ts[x] + tools.ts`。

## 1. scheduled remote agents 不是独立命令，而是 “bundled skill + tool” 双层接入

源码镜像：[`../../src/skills/bundled/index.ts`](../../src/skills/bundled/index.ts), [`../../src/tools.ts`](../../src/tools.ts)

这条能力不是直接在 `commands.ts` 里挂一个 builtin slash command，而是走两层：

- `initBundledSkills()` 在 `feature('AGENT_TRIGGERS_REMOTE')` 打开时注册 `registerScheduleRemoteAgentsSkill()`
- `tools.ts` 在同一个 feature gate 下把 `RemoteTriggerTool` 接进全局工具池

这说明 `/schedule` 在产品形态上不是“命令自己完成所有工作”，而是：

- skill 负责做 operator workflow、补上下文、问问题、拼 prompt
- tool 负责做真正的 API side effect

也就是说，它本质上是一个 productized orchestration surface，不是简单命令壳。

## 2. `/schedule` 的 visibility 不是只看 feature flag，还要同时过 remote policy gate

源码镜像：[`../../src/skills/bundled/scheduleRemoteAgents.ts`](../../src/skills/bundled/scheduleRemoteAgents.ts), [`../../src/tools/RemoteTriggerTool/RemoteTriggerTool.ts`](../../src/tools/RemoteTriggerTool/RemoteTriggerTool.ts)

skill 和 tool 都不是只看 `AGENT_TRIGGERS_REMOTE`：

- bundled skill 的 `isEnabled()` 要求：
  - `getFeatureValue_CACHED_MAY_BE_STALE('tengu_surreal_dali', false)`
  - `isPolicyAllowed('allow_remote_sessions')`
- `RemoteTriggerTool.isEnabled()` 也是同样两层 gate

所以 scheduled remote agents 在 Claude Code 里不是“本地构建出来就能用”的能力，而是明确服从：

- growth/feature rollout
- enterprise policy limits

这和普通 local slash command 很不一样，更接近 Claude Code on the web 的受控远端能力。

## 3. `/schedule` 不是硬编码命令体，而是一个 user-invocable bundled skill

源码镜像：[`../../src/skills/bundled/scheduleRemoteAgents.ts`](../../src/skills/bundled/scheduleRemoteAgents.ts)

`registerBundledSkill()` 里给出的形态是：

- `name: 'schedule'`
- `userInvocable: true`
- `allowedTools: [REMOTE_TRIGGER_TOOL_NAME, ASK_USER_QUESTION_TOOL_NAME]`
- `getPromptForCommand(args, context)`

这意味着 `/schedule` 不是 local-jsx command，也不是纯 prompt snippet，而是：

- 先在 slash catalog 里作为 skill 暴露
- 被调用时即时生成针对当前环境的长 prompt
- 再交给模型使用两把特定工具完成交互

因此它更像一个受限 agent recipe，而不是静态命令。

## 4. 它故意把可用工具压到两把：`AskUserQuestion` 和 `RemoteTrigger`

源码镜像：[`../../src/skills/bundled/scheduleRemoteAgents.ts`](../../src/skills/bundled/scheduleRemoteAgents.ts)

`allowedTools` 只给：

- `AskUserQuestion`
- `RemoteTrigger`

这是一条很强的产品约束。它明确禁止模型在 `/schedule` 流程里随手退回：

- `Bash` 去跑 `curl`
- `WebFetch`
- 通用文件/网络工具

所以这条链的设计目标不是“让模型自己想办法配 trigger”，而是“让模型被锁进一条可信 operator workflow”。

## 5. skill prompt 的首步不是建议，而是强制先走 `AskUserQuestion`

源码镜像：[`../../src/skills/bundled/scheduleRemoteAgents.ts`](../../src/skills/bundled/scheduleRemoteAgents.ts)

`buildPrompt()` 会生成一个非常强的 first-step contract：

- 如果用户没带参数调用 `/schedule`
- 模型第一步必须发出一个 `AskUserQuestion` tool call
- `question` 字段必须使用精确字符串，不允许改写
- `header` 必须是 `"Action"`
- 选项固定是 `create / list / update / run`

这说明这套 skill 不是“告诉模型一个建议流程”，而是在 prompt 层把入口动作钉成一个小状态机。

## 6. 如果用户带了参数，skill 会直接跳过首问，但不会丢掉 setup notes

源码镜像：[`../../src/skills/bundled/scheduleRemoteAgents.ts`](../../src/skills/bundled/scheduleRemoteAgents.ts)

`buildPrompt()` 最容易漏看的点是：

- 无参数路径：setup notes 被嵌进首个 `AskUserQuestion` 的 question 文案
- 有参数路径：首问被跳过，但 setup notes 会进入 `## Setup Notes` 段

源码里的注释明确写了这是为了防回归：如果用户直接 `/schedule every weekday ...`，前置风险信息不能因为跳过首问就被静默吃掉。

所以 setup notes 在这里不是 UI 装饰，而是 prompt-body 级 safety contract。

## 7. repo / GitHub / MCP 检查都是 soft gate，不会像本地命令一样直接 hard fail

源码镜像：[`../../src/skills/bundled/scheduleRemoteAgents.ts`](../../src/skills/bundled/scheduleRemoteAgents.ts), [`../../src/utils/background/remote/preconditions.ts`](../../src/utils/background/remote/preconditions.ts), [`../../src/utils/detectRepository.ts`](../../src/utils/detectRepository.ts)

这条 skill 在真正生成 prompt 前会做几类检查：

- 当前目录是否在 git repo 里
- 如果是 `github.com` repo，Claude GitHub App 或 `/web-setup` 权限是否具备
- 当前是否有可用 MCP connectors

但它不会在这些条件失败时直接退出，而是把结果写成 heads-up：

- 不在 repo：提醒需要手填 repo URL，或可以完全不带 repo
- GitHub 权限不足：提醒跑 `/web-setup` 或安装 GitHub App
- 没 connector：提醒去 `https://claude.ai/settings/connectors`

源码注释说得很清楚：触发器并不一定需要 git source，也可能只是 Slack-only / Datadog-only 轮询任务。所以这里必须是 soft setup check，而不是“没有 repo 就禁止继续”。

## 8. environment 是 create-time 必填，但 skill 会先尝试自动补齐

源码镜像：[`../../src/skills/bundled/scheduleRemoteAgents.ts`](../../src/utils/teleport/environments.ts)

`getPromptForCommand()` 会先：

- `fetchEnvironments()`
- 如果一个都没有，调用 `createDefaultCloudEnvironment('claude-code-default')`
- 只有连自动创建也失败时，才返回文本错误让用户去 `https://claude.ai/code` 手建环境

这说明 `/schedule` 的实际体验不是“先去 web 端配好所有东西再回来”，而是：

- 能本地自动补就自动补
- 真补不了再把用户送回 claude.ai/code

它是明显的 operator-first 设计。

## 9. connector 列表不是直接透传 MCP config，而是先做 claude.ai connector 归一化

源码镜像：[`../../src/skills/bundled/scheduleRemoteAgents.ts`](../../src/skills/bundled/scheduleRemoteAgents.ts)

skill 不会把所有 MCP client 都当成可挂到 trigger 上的 connector。它先做三层筛选：

- `client.type === 'connected'`
- `client.config.type === 'claudeai-proxy'`
- `client.config.id` 能通过 `taggedIdToUUID()` 从 `mcpsrv_...` tagged ID 解回真实 UUID

之后还会把 connector 名做 `sanitizeConnectorName()`，只保留：

- 字母
- 数字
- `_`
- `-`

这条链说明 scheduled remote agents 不是拿本地 MCP state 直接复用，而是要先转成 claude.ai triggers API 所要求的 connector contract。

## 10. prompt body 明确把 `RemoteTrigger` 放在 `ToolSearch select:` 之后，而不是默认假设工具已加载

源码镜像：[`../../src/skills/bundled/scheduleRemoteAgents.ts`](../../src/tools/RemoteTriggerTool/prompt.ts)

生成出来的 prompt 明确要求：

- 先 `ToolSearch select:RemoteTrigger`
- 再调用 `RemoteTrigger`
- 不要用 `curl`
- token 由 in-process auth 自动补

这和 `RemoteTriggerTool` 自己的 `PROMPT` 配合在一起，形成了两层约束：

- skill 层告诉模型先把工具挑出来
- tool 层再次强调“用我，不要 shell”

所以 Claude Code 在这里实际上把 “工具发现” 和 “工具使用” 都写成了强引导。

## 11. `RemoteTriggerTool` 的动作面故意极小，而且没有 delete

源码镜像：[`../../src/tools/RemoteTriggerTool/RemoteTriggerTool.ts`](../../src/tools/RemoteTriggerTool/prompt.ts)

工具输入 schema 只有：

- `action: list | get | create | update | run`
- `trigger_id`
- `body`

没有 `delete`。skill prompt 也明确要求：

- 如果用户要删除，直接引导去 `https://claude.ai/code/scheduled`

这透露出一个产品边界：

- 读、建、改、手动触发 可以进 Claude Code
- 删除仍然保留在 claude.ai 的控制台里

这不是技术缺失，而是有意收窄 destructive surface。

## 12. update 不是 PATCH，而是 `POST /{trigger_id}` 的 partial update 协议

源码镜像：[`../../src/tools/RemoteTriggerTool/RemoteTriggerTool.ts`](../../src/tools/RemoteTriggerTool/prompt.ts)

`RemoteTriggerTool` 对五个动作的 HTTP 映射是：

- `list -> GET /v1/code/triggers`
- `get -> GET /v1/code/triggers/{id}`
- `create -> POST /v1/code/triggers`
- `update -> POST /v1/code/triggers/{id}`
- `run -> POST /v1/code/triggers/{id}/run`

尤其是 `update`：

- 不是 `PATCH`
- 不是 `PUT`
- prompt 明写是 partial update

这意味着 Claude Code 在这里没有做 REST 语义重塑，而是老老实实暴露后端 API 的真实 contract。

## 13. 这把工具是真正的 first-party OAuth tool，不让 token 出现在 shell

源码镜像：[`../../src/tools/RemoteTriggerTool/RemoteTriggerTool.ts`](../../src/tools/RemoteTriggerTool/prompt.ts)

工具调用前会：

- `checkAndRefreshOAuthTokenIfNeeded()`
- 从 `getClaudeAIOAuthTokens()` 取 access token
- `getOrganizationUUID()`
- 组装 `Authorization`、`anthropic-beta`、`x-organization-uuid` 等头

然后直接 `axios.request(...)`。

它的 `DESCRIPTION` 和 `PROMPT` 都反复强调同一句话：auth 在进程内处理，token 永远不会进入 shell。

这说明 `RemoteTrigger` 的核心价值不是“少打一段 curl”，而是：

- 保持 subscriber OAuth 凭据只在进程里流转
- 把 claude.ai remote governance API 纳入正式 tool permission/runtime 体系

## 14. 结果 schema 故意只保留 `status + json`，不帮用户做业务摘要

源码镜像：[`../../src/tools/RemoteTriggerTool/RemoteTriggerTool.ts`](../../src/tools/RemoteTriggerTool/UI.tsx)

输出 schema 只有：

- `status: number`
- `json: string`

`mapToolResultToToolResultBlockParam()` 也只是把结果拼成：

```text
HTTP <status>
<raw json>
```

UI 层进一步收敛成：

- tool use：只显示 `action trigger_id`
- tool result：只显示 `HTTP 200 (N lines)`

原始 JSON 则留在 tool result block 里。

这说明这个工具的前台哲学不是“把 triggers API 重新包装成产品摘要”，而是保留一个接近原始 API 的 operator surface。

## 15. 这把工具被明确标成 defer-safe、concurrency-safe、read-only-aware

源码镜像：[`../../src/tools/RemoteTriggerTool/RemoteTriggerTool.ts`](../../src/tools/RemoteTriggerTool/RemoteTriggerTool.ts)

`RemoteTriggerTool` 上有几条很典型的 runtime 标注：

- `shouldDefer: true`
- `isConcurrencySafe() -> true`
- `isReadOnly()` 对 `list/get` 返回 true
- `toAutoClassifierInput()` 生成 `RemoteTrigger <action> <id>` 文本

这几项说明它不是仓促加进来的 API wrapper，而是完整接入了 Claude Code 的：

- deferred tool loading
- 权限分类
- 只读 / 可变更语义
- 并发安全声明

## 16. skill prompt 实际上在教模型如何当一个远端任务调度 operator

源码镜像：[`../../src/skills/bundled/scheduleRemoteAgents.ts`](../../src/skills/bundled/scheduleRemoteAgents.ts)

这份 prompt 不是只给字段示例，而是写了完整 operator procedure：

- create：先理解目标，再写 prompt，再定 cron，再定 model，再校验 connector/repo，再 review，再 create
- update：先 list，再比较 current vs proposed，再确认
- list：要转成人类可读 schedule，并显示 next run / repo
- run：先确认具体 trigger，再执行

还额外灌入了几条高价值产品规则：

- remote agent 完全拿不到本地文件、本地服务、本地 env
- cron 表达式总是 UTC，但用户说的通常是本地时间
- 默认 `enabled: true`
- repo URL 要归一化到 HTTPS
- 远端 agent 从零上下文启动，prompt 必须自包含

所以 `/schedule` 实际上是把“远端自动化运维顾问”产品化了。

## 17. 这条链的真正产物不是 trigger 本身，而是一个 repo-aware / connector-aware / environment-aware 的调度会话

把 skill 和 tool 合起来看，会看到四层信息被融合进同一次调度会话：

- 当前 repo 上下文
- 当前 claude.ai connector inventory
- 当前远端 environments inventory
- 当前 subscriber OAuth / org 身份

最后模型才被允许调用 `RemoteTrigger` 去落地 API。

所以 Claude Code 在这里真正做的不是“暴露了一个 triggers endpoint”，而是把 scheduled remote agents 变成了一条受控、补数充分、不会泄露凭据的 operator workflow。

## 交叉参考

- remote 接入、环境与 managed settings 总述：[`./37-remote-web-onboarding-environments-and-managed-settings.md`](./37-remote-web-onboarding-environments-and-managed-settings.md)
- remote managed settings 深拆：[`./38-remote-managed-settings-loading-polling-and-hot-reload.md`](./38-remote-managed-settings-loading-polling-and-hot-reload.md)
- remote viewer / permission bridge：[`./29-remote-sdk-message-adaptation-websocket-and-permission-bridges.md`](./29-remote-sdk-message-adaptation-websocket-and-permission-bridges.md)
- remote 多宿主交互适配：[`./36-remote-interactive-host-adapters-and-failure-semantics.md`](./36-remote-interactive-host-adapters-and-failure-semantics.md)
- `/web-setup` 与 `/remote-env` 命令侧入口：[`../commands/08-bootstrap-remote-control-and-web-planning.md`](../commands/08-bootstrap-remote-control-and-web-planning.md)
