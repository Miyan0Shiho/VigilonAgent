# API Provider / Auth / Client / Error Taxonomy

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Prompt Cache Break Detection / Stability Auditing`](./26-prompt-cache-break-detection-and-stability-auditing.md) | [`下一站：Tool Search / Deferred Tools / MCP Instruction Deltas`](./28-tool-search-deferred-tools-and-mcp-instruction-deltas.md)

本文拆的是 API 子系统里另一条很重的链：`client.ts + errors.ts + errorUtils.ts + baseUrl.ts`。它不是简单的“构造 SDK client”和“把异常转成字符串”，而是 Claude Code 对多 provider 适配、认证策略选择、header 策略、错误分类和用户可行动提示的统一控制面。

## 1. `getAnthropicClient()` 不是单一构造器，而是 Claude Code 的 provider router

源码镜像：[`../../sources/claude-code/src/services/api/client.ts`](../../sources/claude-code/src/services/api/client.ts)

`getAnthropicClient()` 最核心的事实是：它并不总返回同一种 client，而是按环境与 provider 走四条分支：

- first-party `Anthropic`
- `AnthropicBedrock`
- `AnthropicFoundry`
- `AnthropicVertex`

也就是说，Claude Code 的上层 query/runtime 基本不需要知道 provider 细节，因为 provider 选择、region/baseURL、token/header 组装、debug logger 注入都被集中封装在这层。

## 2. 它先统一装配一层“宿主身份 headers”，再进入 provider-specific auth

源码镜像：[`../../sources/claude-code/src/services/api/client.ts`](../../sources/claude-code/src/services/api/client.ts)

无论最终走哪种 provider，`getAnthropicClient()` 都先构造一组宿主 headers：

- `x-app=cli`
- `User-Agent`
- `X-Claude-Code-Session-Id`
- remote container / remote session headers
- `x-client-app` for SDK consumers
- `ANTHROPIC_CUSTOM_HEADERS`
- 可选的 `x-anthropic-additional-protection`

这说明 Claude Code 在 provider 之上先定义了一个自己的 transport identity layer。服务端和观测系统看到的不只是“某个 API key”，还会看到是哪个 session、是不是 remote container、是不是 SDK consumer。

## 3. first-party auth 不是简单二选一，而是 subscriber OAuth、API key、Bearer helper 三路混合

源码镜像：[`../../sources/claude-code/src/services/api/client.ts`](../../sources/claude-code/src/services/api/client.ts)

first-party 分支里的认证策略并不简单：

- 若走 Claude subscription，主路径是 `authToken = OAuth access token`
- 若非 subscriber 或显式 base URL，主路径是 API key
- 另有 `ANTHROPIC_AUTH_TOKEN` / api-key-helper 通过 `configureApiKeyHeaders()` 注入 `Authorization: Bearer ...`

这里能看出 Claude Code 在 first-party API 上其实支持两种逻辑平面：

- Claude.ai 订阅身份
- Console/API key 身份

而且它们可能和环境变量、staging OAuth、自定义 base URL 发生叠加。这也是为什么登录、升级、provider gating、错误提示都必须在 API 层统一处理。

## 4. Bedrock / Foundry / Vertex 不是“同一套代码换 endpoint”，而是三套不同认证模型

源码镜像：[`../../sources/claude-code/src/services/api/client.ts`](../../sources/claude-code/src/services/api/client.ts)

三条 3P provider 分支差异很明显：

- Bedrock：AWS region + credential refresh，可选 bearer token，支持 skip auth
- Foundry：API key 或 Azure AD bearer token provider，支持 skip auth
- Vertex：GoogleAuth + region resolution + project ID fallback，支持 skip auth

Claude Code 不是试图把这些 provider 强行压成“统一 API key 配置项”，而是把每家的 auth/runtime peculiarities 正式编码进 client factory。这也是为什么 `getAnthropicClient()` 文件本身这么长，因为它承担的是 provider compatibility matrix。

## 5. Vertex 分支里最值得注意的是：它专门防 `metadata server` 超时，而不是只做 happy path

源码镜像：[`../../sources/claude-code/src/services/api/client.ts`](../../sources/claude-code/src/services/api/client.ts)

Vertex 那段代码最工程化的地方不在“怎么拿 GoogleAuth”，而在它专门处理了 project discovery 的 fallback：

- 先看标准 project env vars
- 再看 credential file
- 最后才用 `ANTHROPIC_VERTEX_PROJECT_ID` 作为 fallback

注释直接点出了目标：避免在非 GCP 环境里触发 metadata server 超时。这说明 Claude Code 的 client 层并不是只做功能适配，也在为“开发机 / 企业环境下的 auth 探测卡死”兜底。

## 6. `normalizeAnthropicBaseUrl()` 说明 base URL 不是自由字符串，而是要被标准化进 transport contract

源码镜像：[`../../sources/claude-code/src/services/api/client.ts`](../../sources/claude-code/src/services/api/client.ts)

`normalizeAnthropicBaseUrl()` 这段虽然短，但意义不小：

- 自动去掉尾部 `/v1`
- 去掉末尾 `/`
- 支持 URL 解析失败时的字符串兜底

这说明 Claude Code 不希望上层到处记“有的地方要传 host，有的地方要传 `/v1/messages` 前缀”。它把 base URL 先规范成统一 contract，再交给 SDK/client 使用，减少 staging、proxy、自定义网关下的路径抖动。

## 7. `buildFetch()` 不是简单透传 fetch override，而是 first-party request correlation 的注入点

源码镜像：[`../../sources/claude-code/src/services/api/client.ts`](../../sources/claude-code/src/services/api/client.ts)

`buildFetch()` 这层有两个重要职责：

- 包装 `fetchOverride ?? globalThis.fetch`
- 仅在 first-party + 真正 Anthropic base URL 下自动注入 `x-client-request-id`

这个 client request ID 的目的不是业务功能，而是让“超时但没有 server request ID”的请求仍然能和服务端日志关联。也就是说，Claude Code 的 transport correlation 不完全依赖 Anthropic 返回的 request ID，而是在客户端先放一个自带 ID 进去。

## 8. `errors.ts` 不是单纯文案表，而是“底层错误 -> 用户动作建议”的翻译器

源码镜像：[`../../sources/claude-code/src/services/api/errors.ts`](../../sources/claude-code/src/services/api/errors.ts)

`getAssistantMessageFromError()` 这条函数链的核心价值，是把底层 provider / SDK / validation error 统一翻译成用户可行动的 assistant API error message，例如：

- prompt too long
- PDF/image/request too大
- 429 rate limit
- OAuth token revoked
- org not allowed
- extra usage required for 1M context
- Bedrock model entitlement rejection
- generic connection/API errors

也就是说，Claude Code 并不把 transport error 原样冒泡给 UI，而是把每类错误映射成“用户下一步应该做什么”的产品消息。

## 9. 这层明确区分了“显示给用户的内容”和“给恢复逻辑继续解析的 raw errorDetails”

源码镜像：[`../../sources/claude-code/src/services/api/errors.ts`](../../sources/claude-code/src/services/api/errors.ts)

像 prompt-too-long 和 media-size 这些分支，都会同时做两件事：

- `content` 给用户看的短消息
- `errorDetails` 保留原始 API error

原因很明确：像 reactive compact 这样的恢复逻辑还要继续从 raw text 里提 token gap、媒体错误模式。这意味着错误层不是单向 UI adapter，而是同时服务于：

- 用户交互提示
- 自动恢复/重试策略

## 10. `errorUtils.ts` 说明 Claude Code 专门为“代理/企业网络/HTML 错页”这些非标准失败模式做了清洗

源码镜像：[`../../sources/claude-code/src/services/api/errorUtils.ts`](../../sources/claude-code/src/services/api/errorUtils.ts)

`errorUtils.ts` 里至少有三层非常现实的兼容逻辑：

- 从 `cause` 链里抽出 SSL/TLS/timeout 根错误码
- 把 Cloudflare/代理返回的 HTML 页面裁成可读标题
- 兼容 JSONL round-trip 后丢失 `.message` 的反序列化 APIError

这说明 Claude Code 已经把“错误不是规范 JSON，而是代理页、TLS 拦截、plain object 反序列化残骸”的情况当成常态，而不是边缘偶发。

## 11. SSL/TLS 错误不只做分类，还会生成企业网络场景下可执行的修复建议

源码镜像：[`../../sources/claude-code/src/services/api/errorUtils.ts`](../../sources/claude-code/src/services/api/errorUtils.ts)

`getSSLErrorHint()` 和 `formatAPIError()` 都体现出一个特点：Claude Code 没有停留在“证书错误”这一级，而是进一步给出动作级提示：

- 可能是 corporate proxy / TLS intercept
- 设置 `NODE_EXTRA_CA_CERTS`
- allowlist `*.anthropic.com`
- 运行 `/doctor`

这说明 API client/error 子系统不仅理解技术错误，还编码了典型企业部署场景下的支持知识。

## 12. `classifyAPIError()` 和 `categorizeRetryableAPIError()` 说明错误层还在为 retry / control flow 提供结构化标签

源码镜像：[`../../sources/claude-code/src/services/api/errors.ts`](../../sources/claude-code/src/services/api/errors.ts)

这层并不只负责生成一条 message。它还提供了结构化分类结果，供上游控制流使用，例如：

- 是否属于 prompt-too-long / media-size / auth / connection / rate-limit
- 是否可重试
- 是否该走 compact / fallback / 登录引导

因此 `errors.ts` 的真正角色更像 error policy table，而不是静态文案仓库。

## 13. 这条链把 remote/CCR、subscriber、3P provider 三个维度交叉编码进错误 UX

源码镜像：[`../../sources/claude-code/src/services/api/errors.ts`](../../sources/claude-code/src/services/api/errors.ts), [`../../sources/claude-code/src/services/api/client.ts`](../../sources/claude-code/src/services/api/client.ts)

最容易被忽略的一点是：同一类 auth 错误，在不同宿主里处理不同。

- CCR mode：auth 由基础设施 JWT 处理，不该盲目提示 `/login`
- subscriber OAuth：更倾向于 token revoked / org not allowed 语义
- 3P provider：更倾向于 entitlement/model access/base URL/proxy 语义

这说明 Claude Code 的错误 UX 不是“按异常类统一提示”，而是把宿主模式和 provider 身份都纳入判定。

## 14. 真正应该把这层理解成“provider control plane + auth policy + error taxonomy”

如果只看文件名，容易误判成：

- `client.ts` = SDK 构造器
- `errors.ts` = 字符串常量

但源码真实显示的是另一套结构：

- `client.ts`：provider/router/auth/header/fetch correlation
- `baseUrl.ts`：endpoint normalization
- `errorUtils.ts`：底层异常解包、TLS/HTML/JSONL 兼容
- `errors.ts`：API/user/recovery 三方都要消费的错误策略表

所以这块不是附属实现细节，而是 Claude Code 在多 provider、多身份、多宿主模式下维持“同一套产品行为”的关键控制面。

## 交叉参考

- API transport 主链：[`./25-api-request-streaming-retry-and-telemetry.md`](./25-api-request-streaming-retry-and-telemetry.md)
- Prompt cache 稳定性审计：[`./26-prompt-cache-break-detection-and-stability-auditing.md`](./26-prompt-cache-break-detection-and-stability-auditing.md)
- 登录 / OAuth 前台工作面：[`../architecture/17-login-oauth-and-trusted-device-ui.md`](../architecture/17-login-oauth-and-trusted-device-ui.md)
- 账号 / 升级 / release-notes 命令侧：[`../commands/10-account-auth-upgrade-and-release-info.md`](../commands/10-account-auth-upgrade-and-release-info.md)
