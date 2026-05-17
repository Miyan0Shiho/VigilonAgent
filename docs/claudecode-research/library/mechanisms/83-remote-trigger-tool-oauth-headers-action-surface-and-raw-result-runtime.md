# RemoteTriggerTool / OAuth Headers / Action Surface / Raw Result Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：SleepTool / Proactive Tick / Interruptible Wait Runtime`](./82-sleep-tool-proactive-tick-and-interruptible-wait-runtime.md) | [`下一站：MCPTool / Dynamic Tool Synthesis / Progress / Elicitation / Result Runtime`](./84-mcp-tool-dynamic-tool-synthesis-progress-elicitation-and-result-runtime.md)

本文把 `RemoteTriggerTool` 从 [50 号卷册](./50-scheduled-remote-agent-triggers-bundled-skill-and-oauth-tool-runtime.md) 里的“双层接入总述”再往下拆到工具本体。`50` 讲的是：

- `/schedule` 作为 bundled skill 的 operator workflow
- `RemoteTrigger` 作为 first-party OAuth tool 的产品定位

而这篇只讲 `RemoteTriggerTool` 自己的实现级运行时：

- feature/policy gate
- in-process OAuth refresh
- organization-scoped headers
- five-action HTTP surface
- raw status/json result contract
- intentionally minimal UI receipt

也先说明一个边界：当前仓库里没有 `remoteTriggerApi.ts` 之类的独立 helper，逻辑集中写在 [`../../sources/claude-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts`](../../sources/claude-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts) 里。所以这里讨论的是“当前可见的一体化工具实现”，不是某个被隐藏的 service layer。

## 1. 这把工具的暴露 gate 和 `/schedule` skill 完全对齐，说明它不是底层通用 HTTP client

源码镜像：[`../../sources/claude-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts`](../../sources/claude-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts), [`../../sources/claude-code/src/skills/bundled/scheduleRemoteAgents.ts`](../../sources/claude-code/src/skills/bundled/scheduleRemoteAgents.ts)

`RemoteTriggerTool.isEnabled()` 要求同时满足：

- `getFeatureValue_CACHED_MAY_BE_STALE('tengu_surreal_dali', false)`
- `isPolicyAllowed('allow_remote_sessions')`

这和 `/schedule` bundled skill 的 gate 完全一致。

这说明 `RemoteTriggerTool` 不是“任何 remote code path 都能顺手复用的 CCR API shell”，而是专门服务 remote scheduled agents 这条受控产品线的 first-party tool。

## 2. 它是并发安全的，但只在 `list/get` 上声明 read-only

源码镜像：[`../../sources/claude-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts`](../../sources/claude-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts)

工具声明：

- `isConcurrencySafe() => true`
- `isReadOnly(input) => action === 'list' || action === 'get'`

这有两个含义：

- 它被允许和其他工具并行存在，不像 shell/foreground tool 那样要独占宿主
- 但 mutation 面也被产品层精确标出来了：`create/update/run` 都是 side-effecting action

所以在 Claude Code 的工具 taxonomy 里，它更接近一把“受限控制 API 工具”，不是纯查询器。

## 3. 输入 schema 被故意压到三字段，action surface 很小

源码镜像：[`../../sources/claude-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts`](../../sources/claude-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts)

输入只有：

- `action`
- `trigger_id`
- `body`

其中 `action` 只允许：

- `list`
- `get`
- `create`
- `update`
- `run`

没有：

- `delete`
- `pause`
- `enable/disable`
- 单独的 environment discovery 动作

这说明 `RemoteTriggerTool` 的目标非常克制：只覆盖 `/schedule` workflow 需要的最小 API 面。

## 4. `trigger_id` 的正则也很刻意：它允许常见标识符，但先挡掉明显不该入 URL path 的内容

源码镜像：[`../../sources/claude-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts`](../../sources/claude-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts)

`trigger_id` 必须匹配：

- `/^[\\w-]+$/`

这不是完整业务校验，但足以在工具层先挡住：

- 空白
- 斜杠
- querystring 拼接
- 大量特殊字符

因此它在当前实现里承担的是“路径拼接前的轻量 shape validation”，而不是“远端对象存在性验证”。

## 5. `body` 被刻意定义成 `record<string, unknown>`，说明这把工具不替用户建高层 domain model

源码镜像：[`../../sources/claude-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts`](../../sources/claude-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts)

`create` 和 `update` 都只要求：

- `body` 存在

并不在工具层定义：

- cron 字段结构
- repo/environment/connector 的具体 shape
- 哪些字段是 required vs optional

这和 `ScheduleCronTool` 那种本地强 schema 风格正好相反。`RemoteTriggerTool` 在这里明显选择了：

- 让 skill/operator prompt 负责组织业务语义
- 让 tool 只负责把 JSON 原样送往 claude.ai triggers API

## 6. 这把工具的第一个真正运行时动作不是发请求，而是强制刷新 subscriber OAuth

源码镜像：[`../../sources/claude-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts`](../../sources/claude-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts), [`../../sources/claude-code/src/utils/auth.ts`](../../sources/claude-code/src/utils/auth.ts)

调用开头就是：

- `await checkAndRefreshOAuthTokenIfNeeded()`

然后才：

- `getClaudeAIOAuthTokens()?.accessToken`

也就是说，这把工具并不信任内存里现成 token 一定可用，而是先走一次显式 refresh guard。这和 `RemoteTrigger` 的产品定位完全一致：它是 in-process OAuth tool，不是 “拿到旧 token 就直接 axios”。

## 7. 它明确拒绝 API-key-only 宿主，要求 `claude.ai` subscriber OAuth 身份

源码镜像：[`../../sources/claude-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts`](../../sources/claude-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts)

如果 `accessToken` 为空，直接抛：

- `Not authenticated with a claude.ai account. Run /login and try again.`

这说明即便其他宿主可能能跑 Claude Code，本工具依然强依赖：

- claude.ai OAuth identity

它不是 generic remote trigger API client，也不会尝试退回 API key、shell helper、或别的 bearer source。

## 8. organization UUID 也是 hard requirement，不是可选增强头

源码镜像：[`../../sources/claude-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts`](../../sources/claude-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts), [`../../sources/claude-code/src/services/oauth/client.ts`](../../sources/claude-code/src/services/oauth/client.ts)

工具接着还会：

- `await getOrganizationUUID()`

失败就直接抛：

- `Unable to resolve organization UUID.`

而不是继续尝试不带 org header 的请求。

这说明 triggers API 在 Claude Code 的 worldview 里是：

- org-scoped CCR surface

不是“只要有 subscriber token 就能随便碰”的个人 API。

## 9. 请求头里有三类信息：auth、version/beta、organization scope

源码镜像：[`../../sources/claude-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts`](../../sources/claude-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts)

headers 固定包含：

- `Authorization: Bearer <accessToken>`
- `Content-Type: application/json`
- `anthropic-version: 2023-06-01`
- `anthropic-beta: ccr-triggers-2026-01-30`
- `x-organization-uuid: <orgUUID>`

这说明当前工具并不是在调一个完全 GA、无 feature header 的稳定 surface，而是在调一个：

- versioned
- beta-gated
- org-scoped

的 CCR API。

## 10. `TRIGGERS_BETA` 被硬编码在工具里，说明这条面向用户的能力仍和后端 rollout 强绑定

源码镜像：[`../../sources/claude-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts`](../../sources/claude-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts)

常量：

- `const TRIGGERS_BETA = 'ccr-triggers-2026-01-30'`

不是从 settings、feature flag 或 prompt 中注入，而是直接作为 transport contract 的一部分固化在工具里。

这进一步说明 `RemoteTriggerTool` 是“产品级面向后端专线”的 wrapper，而不是 generic REST bridge。

## 11. action 到 URL/method 的映射是显式 switch，而不是资源表驱动

源码镜像：[`../../sources/claude-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts`](../../sources/claude-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts)

映射规则是：

- `list` → `GET /v1/code/triggers`
- `get` → `GET /v1/code/triggers/{id}`
- `create` → `POST /v1/code/triggers`
- `update` → `POST /v1/code/triggers/{id}`
- `run` → `POST /v1/code/triggers/{id}/run`

写成显式 switch 的好处是：

- 每个 action 的 `trigger_id/body` 依赖关系一眼可见
- 工具层可以在发请求前做语义性报错

代价则是：这把工具不会自动扩展到 future endpoints，必须手工加 action。

## 12. `update` 的语义很重要：它是 partial update，但 transport 仍然是 `POST`

源码镜像：[`../../sources/claude-code/src/tools/RemoteTriggerTool/prompt.ts`](../../sources/claude-code/src/tools/RemoteTriggerTool/prompt.ts), [`../../sources/claude-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts`](../../sources/claude-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts)

tool prompt 已经直接告诉模型：

- `update` 是 partial update

而实现侧又明确把它发成：

- `POST /v1/code/triggers/{id}`

Claude Code 没有把它包装成更“规范”的 `PATCH` 表象。它选择暴露后端 API 的真实 transport contract，这能减少模型和后端语义错位。

## 13. `run` 动作用空对象 `{}` 作为 body，而不是省略 body

源码镜像：[`../../sources/claude-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts`](../../sources/claude-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts)

`run` 分支设置的是：

- `data = {}`

而不是 `undefined`。

这透露出一个小但真实的 transport 决策：

- 这条 endpoint 在当前客户端实现里被视为 JSON POST，而不是“无 body 的 POST trigger”

这类细节通常不会写进总述，但对理解 tool-runtime contract 很有价值。

## 14. 工具没有自己定义“成功”的业务标准，而是把所有 HTTP 状态都回传

源码镜像：[`../../sources/claude-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts`](../../sources/claude-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts)

`axios.request(...)` 用了：

- `validateStatus: () => true`

所以：

- 4xx/5xx 不会在 axios 层 throw
- tool 结果统一返回 `status + json`

这说明 `RemoteTriggerTool` 故意把“这次操作业务上算不算成功”的判断上抛给：

- 模型
- operator
- 或更上层 skill workflow

而不是在工具层强行把非 2xx 变成异常。

## 15. 真的会抛异常的只有 transport / identity / input contract 级错误

当前实现里真正 throw 的是：

- 缺 OAuth token
- org UUID 解析失败
- `get/update/run` 缺 `trigger_id`
- `create/update` 缺 `body`

而不是：

- 远端返回 404
- 远端返回 validation error
- 远端返回 500

所以这把工具在错误分层上区分得很清楚：

- 本地无法构造合法请求：throw
- 远端给出的业务失败：返回 raw HTTP receipt

## 16. output schema 只保留 `status + json`，没有任何 trigger-specific projection

源码镜像：[`../../sources/claude-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts`](../../sources/claude-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts)

输出是：

- `status: number`
- `json: string`

没有：

- `trigger_id`
- `next_run_at`
- `name`
- `enabled`
- `environment_id`

这些都不会在 tool 层被再结构化。

这意味着 `RemoteTriggerTool` 的 contract 本质上是：

- “我给你一个带 org-scoped auth 的 raw API portal”

而不是：

- “我给你一个高层 trigger domain object”

## 17. `mapToolResultToToolResultBlockParam()` 也故意不做总结，只是原样拼成 HTTP receipt

源码镜像：[`../../sources/claude-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts`](../../sources/claude-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts)

tool_result 内容只有：

```text
HTTP <status>
<json>
```

这和很多会主动总结 “Created X” / “Updated Y” 的工具完全不同。它说明 Claude Code 在这条面上更重视：

- 可审计
- 不丢字段
- 不和后端 schema 漂移

而不是更漂亮的自然语言摘要。

## 18. UI 层也进一步贯彻了这个“薄回执”策略

源码镜像：[`../../sources/claude-code/src/tools/RemoteTriggerTool/UI.tsx`](../../sources/claude-code/src/tools/RemoteTriggerTool/UI.tsx)

`renderToolUseMessage(...)` 只显示：

- `action`
- 可选 `trigger_id`

`renderToolResultMessage(...)` 只显示：

- `HTTP <status>`
- `(<lines> lines)`

它甚至不尝试：

- 展示 trigger name
- 展示 cron / next run
- 解析 JSON 中的重要字段

这和 `RemoteTriggerTool` 输出 raw JSON 的设计完全一致：UI 只负责告诉 operator “请求发了，返回了几百行”，不负责解读结果。

## 19. 它的 `toAutoClassifierInput(...)` 也故意压得极窄，说明安全判断主要看动作类别而不是 body 内容

源码镜像：[`../../sources/claude-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts`](../../sources/claude-code/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts)

classifier input 只有：

- `RemoteTrigger <action> [trigger_id]`

而没有把 `body` 序列化进去。

这说明对 auto-mode / permission classifier 而言，这把工具的风险分层主要在：

- list/get
- create/update/run

这种 coarse action level，而不是逐字段审查 trigger payload。

## 20. 这也解释了为什么它会把复杂业务引导放到 `/schedule` skill，而不是让工具自己变胖

结合 [50 号卷册](./50-scheduled-remote-agent-triggers-bundled-skill-and-oauth-tool-runtime.md) 可以看出，Claude Code 刻意把职责拆成：

- skill
  - 解释 setup notes
  - 收集 create/list/update/run 意图
  - 组装 payload
  - 解释原始结果
- tool
  - 管理 OAuth
  - 加组织头
  - 调五个 endpoint
  - 回 `status + json`

所以 `RemoteTriggerTool` 的“瘦”不是没做完，而是架构设计本来就把业务语义上移到了 bundled skill。

## 21. 与 `RemoteSetup` / `Teleport` 之类 remote utilities 对比，它更像控制面薄代理，而不是状态机

从当前可见实现看，`RemoteTriggerTool` 没有：

- 本地 polling
- session restore
- retry state machine
- sidecar metadata
- persistent cache

这些都是 `RemoteAgentTask`、`teleport`、`remote managed settings` 一类工具的典型特征。

它真正提供的是：

- synchronous request/response
- first-party auth injection
- org-scoped header assembly

因此它更像远端调度控制面的“薄代理”。

## 22. 当前最准确的分层结论应该是：

`RemoteTriggerTool` 在 Claude Code 里不是“远端自动化系统的完整 runtime”，而是那个系统暴露给模型的最小可信 API portal：

- 对外只有五个 action
- 对内把 OAuth / org header / beta header 做干净
- 不让 token 进 shell
- 不让业务失败在 axios 层被吞掉
- 不把后端 schema 过度重塑成前端对象

所以如果说 [50 号卷册](./50-scheduled-remote-agent-triggers-bundled-skill-and-oauth-tool-runtime.md) 解释的是 “为什么 `/schedule` 能成为一个产品功能”，那么这篇解释的就是 “为什么 `RemoteTriggerTool` 自身被故意设计成这么薄、这么 raw、这么可信”。 
