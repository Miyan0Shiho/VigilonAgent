# WebFetchTool / Domain Gates / Redirects / Secondary Model Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：EnterPlanMode / Gating / Transition / Read-Only Runtime`](./73-enter-plan-mode-gating-transition-and-read-only-runtime.md) | [`下一站：FileRead / Grep / WebSearch Runtime`](./32-file-read-grep-and-websearch-runtime.md)

本文把 `WebFetchTool` 从旧的 `Read/Search/Web` 总述里单独抽出来。重点不是“它能抓网页”，而是它怎样把一个 URL 访问请求拆成 `domain gate -> redirect policy -> fetch/cache -> markdown transform -> secondary model summarization -> permission surface` 这条完整运行时。

## 1. `WebFetchTool` 不是 `WebSearchTool` 的替身，而是“用户定点抓取网页并再加工”的二级处理管线

源码镜像：[`../../sources/claude-code/src/tools/WebFetchTool/WebFetchTool.ts`](../../sources/claude-code/src/tools/WebFetchTool/WebFetchTool.ts), [`../../sources/claude-code/src/tools/WebFetchTool/prompt.ts`](../../sources/claude-code/src/tools/WebFetchTool/prompt.ts)

它的输入不是 query，而是：

- `url`
- `prompt`

因此它的产品心智是：

- 先抓指定页面
- 再把内容交给一个小模型按 prompt 提炼

这和 `WebSearchTool` 的“先让 provider 找结果，再返回 hits/summary”完全不是一回事。

## 2. prompt 已经明确把它降级成“authenticated URL 不适用”的后备工具

源码镜像：[`../../sources/claude-code/src/tools/WebFetchTool/WebFetchTool.ts`](../../sources/claude-code/src/tools/WebFetchTool/WebFetchTool.ts), [`../../sources/claude-code/src/tools/WebFetchTool/prompt.ts`](../../sources/claude-code/src/tools/WebFetchTool/prompt.ts)

真正返回给模型的 prompt 由两段拼成：

- 动态前缀：
  - authenticated/private URL 会失败
  - 先找 specialized MCP tool
- 静态 DESCRIPTION：
  - GitHub URL 优先 `gh`
  - HTTP 会升级到 HTTPS
  - 大内容会摘要
  - 有 15 分钟缓存

所以 Claude Code 从一开始就在把 `WebFetchTool` 定义成“无认证公开网页抓取”的 fallback surface，而不是通用浏览器替代品。

## 3. 这个工具是 concurrency-safe + read-only，但权限核心不是路径，而是域名

源码镜像：[`../../sources/claude-code/src/tools/WebFetchTool/WebFetchTool.ts`](../../sources/claude-code/src/tools/WebFetchTool/WebFetchTool.ts)

它声明：

- `isConcurrencySafe() => true`
- `isReadOnly() => true`

但真正的审批内容不是文件路径，而是：

- `domain:${hostname}`

`webFetchToolInputToPermissionRuleContent(...)` 会从 input 中抽 hostname，后续 allow/ask/deny 规则都围绕这个域名 token 运作。

## 4. preapproved host 不是 sandbox 网络白名单，而是只对 WebFetch 生效的更窄例外

源码镜像：[`../../sources/claude-code/src/tools/WebFetchTool/preapproved.ts`](../../sources/claude-code/src/tools/WebFetchTool/preapproved.ts)

这个文件最重要的不是 host 列表本身，而是头部注释的安全边界：

- 这些 preapproved domain 只给 WebFetch GET 请求用
- sandbox 网络策略故意不继承这份列表
- 因为某些域支持上传，放宽到任意网络访问会造成外流风险

也就是说，`isPreapprovedHost()` 是 WebFetch 内部的产品例外，不是全局网络豁免。

## 5. preapproved host 还支持 path-scoped trust，而不是只有整域白名单

源码镜像：[`../../sources/claude-code/src/tools/WebFetchTool/preapproved.ts`](../../sources/claude-code/src/tools/WebFetchTool/preapproved.ts)

实现里把列表拆成：

- `HOSTNAME_ONLY`
- `PATH_PREFIXES`

因此像：

- `github.com/anthropics`

这种条目不是整个 `github.com` 都放行，而是只允许某条 path prefix。说明 trust boundary 已经细化到 host/path 二级。

## 6. permission 流程是四段式：preapproved -> deny -> ask -> allow，而不是只要没规则就弹框

源码镜像：[`../../sources/claude-code/src/tools/WebFetchTool/WebFetchTool.ts`](../../sources/claude-code/src/tools/WebFetchTool/WebFetchTool.ts)

`checkPermissions(...)` 的优先级非常明确：

1. preapproved host 直接 allow
2. 查 tool-specific deny rule
3. 查 ask rule
4. 查 allow rule
5. 默认 ask

所以默认行为并不是“先看 allow，不行就问”，而是把 deny/ask/allow 三类显式规则全部当成一等公民。

## 7. 本地审批 UI 也以域名为中心组织，而不是把整 URL 当权限粒度

源码镜像：[`../../sources/claude-code/src/components/permissions/WebFetchPermissionRequest/WebFetchPermissionRequest.tsx`](../../sources/claude-code/src/components/permissions/WebFetchPermissionRequest/WebFetchPermissionRequest.tsx)

审批 UI 会：

- 从 URL 里抽出 `hostname`
- 显示 `Yes`
- 可选显示：
  - `Yes, and don't ask again for <hostname>`
- `No, and tell Claude what to do differently`

说明 WebFetch 的持久化权限边界被正式定义成“域名级权限”，不是单个 URL 级。

## 8. “永不再问”并不是私有 side effect，而是标准 permission update 写回 `localSettings`

源码镜像：[`../../sources/claude-code/src/components/permissions/WebFetchPermissionRequest/WebFetchPermissionRequest.tsx`](../../sources/claude-code/src/components/permissions/WebFetchPermissionRequest/WebFetchPermissionRequest.tsx)

用户选择 “don't ask again” 时，UI 会构造：

- `type: 'addRules'`
- `behavior: 'allow'`
- `destination: 'localSettings'`
- `toolName: WebFetchTool.name`
- `ruleContent: domain:<hostname>`

也就是说，这条持久授权走的是统一 permission rule 管线，不是 WebFetch 自己偷偷写一份配置。

## 9. URL 校验并不只是 `new URL()`，还带了“不能含用户名密码、必须像公网域名”的初步过滤

源码镜像：[`../../sources/claude-code/src/tools/WebFetchTool/utils.ts`](../../sources/claude-code/src/tools/WebFetchTool/utils.ts)

`validateURL(...)` 额外限制了：

- 长度上限 `MAX_URL_LENGTH = 2000`
- `username/password` 禁止
- hostname 至少像一个公开域名

注释也提到了原因：这条工具被视为潜在数据外流通道之一，所以要在入口先砍掉一批明显危险输入。

## 10. `http -> https` 自动升级说明它会主动收紧传输层，而不是忠实照抄用户输入

源码镜像：[`../../sources/claude-code/src/tools/WebFetchTool/utils.ts`](../../sources/claude-code/src/tools/WebFetchTool/utils.ts)

在真正 fetch 前：

- 如果是 `http:`
- 会直接改成 `https:`

所以它不是一个低层 HTTP client wrapper，而是一个带默认安全升级策略的 higher-level fetch runtime。

## 11. 抓取前还有一层 domain preflight 到 `api.anthropic.com`，用来判定域名是否允许被取回

源码镜像：[`../../sources/claude-code/src/tools/WebFetchTool/utils.ts`](../../sources/claude-code/src/tools/WebFetchTool/utils.ts)

默认情况下会做：

- `GET https://api.anthropic.com/api/web/domain_info?domain=...`

结果分成：

- `allowed`
- `blocked`
- `check_failed`

这意味着真正的域名安全判定不只靠本地 allowlist/denylist，还会经过服务端 blocklist preflight。

## 12. 这条 preflight 也有独立缓存，说明设计者明确在优化“同域多路径重复抓取”的成本

源码镜像：[`../../sources/claude-code/src/tools/WebFetchTool/utils.ts`](../../sources/claude-code/src/tools/WebFetchTool/utils.ts)

除了 URL 级 `URL_CACHE`，还有一个：

- `DOMAIN_CHECK_CACHE`

原因写得很直白：

- URL 缓存是按完整 URL key
- 同域不同 path 会重复打 preflight
- 所以再补一层 hostname 级缓存

这说明 WebFetch 的缓存设计从一开始就是双层：

- domain trust cache
- URL content cache

## 13. enterprise 可以通过 `skipWebFetchPreflight` 跳过域名预检，说明这条链已经考虑到受限网络宿主

源码镜像：[`../../sources/claude-code/src/tools/WebFetchTool/utils.ts`](../../sources/claude-code/src/utils/settings/settings.ts)

如果：

- `settings.skipWebFetchPreflight`

就不再访问 `claude.ai/api` 预检。注释明确说这是给安全策略很重、出站访问受限的企业客户准备的逃生门。

所以 WebFetch 的域名治理并不是“一刀切强预检”，而是允许宿主按安全环境降级。

## 14. redirect 不是自动乱跟，而是只允许非常窄的同源变体

源码镜像：[`../../sources/claude-code/src/tools/WebFetchTool/utils.ts`](../../sources/claude-code/src/tools/WebFetchTool/utils.ts)

`isPermittedRedirect(...)` 允许的情况只有：

- 同协议
- 同端口
- 不带用户名密码
- hostname 只在 `www.` 上加减

换句话说，`example.com -> www.example.com/foo` 可以，
但跨真正不同 host 的跳转不行。

## 15. 遇到跨 host redirect，它不会偷偷继续，而是把 redirect 当成显式结果返回给模型

源码镜像：[`../../sources/claude-code/src/tools/WebFetchTool/WebFetchTool.ts`](../../sources/claude-code/src/tools/WebFetchTool/WebFetchTool.ts), [`../../sources/claude-code/src/tools/WebFetchTool/utils.ts`](../../sources/claude-code/src/tools/WebFetchTool/utils.ts)

如果拿到的是 redirect info：

- 输出一段结构化说明
- 列出 `Original URL`
- `Redirect URL`
- `Status`
- 明确要求模型重新用新 URL 调一次 WebFetch

所以 redirect 在产品上不是 transport 细节，而是用户批准边界的一部分。

## 16. egress proxy block 有专门错误语义，不会被伪装成普通 403

源码镜像：[`../../sources/claude-code/src/tools/WebFetchTool/utils.ts`](../../sources/claude-code/src/tools/WebFetchTool/utils.ts)

如果发现：

- `403`
- `x-proxy-error: blocked-by-allowlist`

就抛 `EgressBlockedError`

而这个错误里会带：

- `error_type: EGRESS_BLOCKED`
- `domain`

说明 WebFetch 已经把企业网络出口封锁视作一等故障类型，而不是泛化成抓取失败。

## 17. HTML 不是直接送模型，而是先 turndown 成 markdown；binary 内容则走“双轨保留”

源码镜像：[`../../sources/claude-code/src/tools/WebFetchTool/utils.ts`](../../sources/claude-code/src/tools/WebFetchTool/utils.ts)

内容处理链是：

- HTML:
  - turndown -> markdown
- 非 HTML:
  - 原样 decode
- binary:
  - 额外 `persistBinaryContent(...)`
  - 但仍继续把 decode 后内容送到后续小模型

所以 PDF/二进制不是“保存文件就结束”，而是：

- 保存原文件供后续 inspection
- 同时继续做一轮文本级摘要

## 18. 二级模型不是泛模型调用，而是专门的 `queryHaiku(...)` content distillation stage

源码镜像：[`../../sources/claude-code/src/tools/WebFetchTool/utils.ts`](../../sources/claude-code/src/tools/WebFetchTool/prompt.ts)

`applyPromptToMarkdown(...)` 会：

- 截断到 `MAX_MARKDOWN_LENGTH`
- 拼成 `makeSecondaryModelPrompt(...)`
- 调 `queryHaiku(...)`
- `querySource: 'web_fetch_apply'`

这说明 WebFetch 的核心不是“直接返回网页正文”，而是内建了一层小模型蒸馏器。

## 19. preapproved domain 与普通 domain 的二级提示词也不一样，体现了版权/引用约束分层

源码镜像：[`../../sources/claude-code/src/tools/WebFetchTool/prompt.ts`](../../sources/claude-code/src/tools/WebFetchTool/prompt.ts)

`makeSecondaryModelPrompt(...)` 里：

- preapproved domain:
  - 可以更自由地给细节、代码例子、文档片段
- 非 preapproved:
  - 引文总长限制
  - 不评论 legality
  - 不输出歌词

所以 preapproved 不只是绕开 permission ask，它还决定了二级模型的引用纪律。

## 20. 返回结果不总是 model 摘要：preapproved markdown 小页面可以直接透传原内容

源码镜像：[`../../sources/claude-code/src/tools/WebFetchTool/WebFetchTool.ts`](../../sources/claude-code/src/tools/WebFetchTool/WebFetchTool.ts), [`../../sources/claude-code/src/tools/WebFetchTool/utils.ts`](../../sources/claude-code/src/tools/WebFetchTool/utils.ts)

如果满足：

- preapproved
- `contentType` 是 markdown
- `content.length < MAX_MARKDOWN_LENGTH`

那就：

- 直接 `result = content`

不再跑 Haiku。说明它会在“可信 + 已结构化 + 不太长”的情况下跳过二级模型，避免不必要的再加工和 cache 噪声。

## 21. 前台 UI 也明确把它设计成“收到多少、状态码多少”的 I/O 事件，而不是浏览器式页面查看器

源码镜像：[`../../sources/claude-code/src/tools/WebFetchTool/UI.tsx`](../../sources/claude-code/src/tools/WebFetchTool/UI.tsx)

它的 UI 重点是：

- use message:
  - 简洁模式只显示 URL
  - verbose 才带 prompt
- progress:
  - `Fetching…`
- result:
  - `Received <size> (<code> <codeText>)`
  - verbose 才展示完整 result 正文

所以 WebFetch 的前台语法是“抓取 I/O + 结果摘要”，不是一个网页阅读器。

## 22. 结论：WebFetch 是 Claude Code 的“受治理网页抓取 + 小模型提炼”专用运行时

把整条链收起来，它的真实角色是：

- 用域名级 permission rule 和 preapproved/path-scoped trust 控制能抓什么
- 用 preflight/blocklist/egress 错误把企业网络与安全边界编码进抓取层
- 用窄 redirect policy 避免 open redirect 变成跨域越权
- 用 HTML->markdown / binary persist / cache 双层结构控制资源开销
- 用 `queryHaiku(...)` 把抓回的公开网页再加工成任务所需信息

所以 `WebFetchTool` 不是网络版 `Read`，而是一条独立的 domain-governed fetch-and-distill runtime。
