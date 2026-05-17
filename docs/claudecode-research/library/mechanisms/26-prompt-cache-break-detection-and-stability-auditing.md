# Prompt Cache Break Detection / Stability Auditing

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：API Request / Streaming / Retry / Telemetry`](./25-api-request-streaming-retry-and-telemetry.md) | [`下一站：API Provider / Auth / Client / Error Taxonomy`](./27-api-provider-auth-client-and-error-taxonomy.md)

本文拆的是 Claude Code 里一个很容易被忽略、但工程含量很高的子系统：`promptCacheBreakDetection.ts`。它不是简单打日志，而是在客户端维护一份“哪些 request 维度可能导致服务端 prompt cache 断裂”的状态快照，然后再用真实返回的 cache read tokens 做二阶段判定。重点拆的是 `recordPromptState -> checkResponseForCacheBreak -> notifyCacheDeletion / notifyCompaction` 这条稳定性审计闭环。

## 1. 这不是缓存实现本身，而是“缓存断裂原因解释器”

源码镜像：[`../../src/services/api/promptCacheBreakDetection.ts`](../../src/services/api/promptCacheBreakDetection.ts), [`../../src/services/api/claude.ts`](../../src/services/api/claude.ts)

这层最重要的边界是：

- 它不负责真正的 prompt cache 命中
- 它不修改 API 请求内容
- 它负责解释“为什么上一次还命中的前缀，这一次突然掉了”

所以它本质上不是缓存层，而是缓存稳定性观测层。Claude Code 把它做成独立子系统，说明 prompt cache 对 agentic runtime 的成本和响应时间已经足够关键，值得专门维护一套 break audit 逻辑。

## 2. 它跟踪的不是单一全局状态，而是按 `querySource/agentId` 分桶的 request lineage

源码镜像：[`../../src/services/api/promptCacheBreakDetection.ts`](../../src/services/api/promptCacheBreakDetection.ts)

`getTrackingKey()` 暴露了这层的第一原则：cache break 不能按全局进程状态追，否则 main thread、subagent、teammate 会互相污染。

它的具体策略是：

- `compact` 共享 `repl_main_thread`
- 只跟踪少量固定前缀，例如 `repl_main_thread`、`sdk`、`agent:*`
- 若是 tracked subagent，则用 `agentId` 进一步隔离
- 短命 query source 直接不跟踪

这说明 Claude Code 关注的不是“全局 cache 是否稳定”，而是“对同一条会话链来说，cache key 是否被自己打破了”。

## 3. `recordPromptState()` 是第一阶段，只记录“可能导致断裂的变化”，并不立即判定 break

源码镜像：[`../../src/services/api/promptCacheBreakDetection.ts`](../../src/services/api/promptCacheBreakDetection.ts)

`recordPromptState()` 的作用不是告警，而是做 snapshot diff。它会先把当前请求的关键维度抽出来：

- `systemHash`
- `toolsHash`
- `cacheControlHash`
- `toolNames`
- `perToolHashes`
- `systemCharCount`
- `model`
- `fastMode`
- `globalCacheStrategy`
- `betas`
- `autoModeActive`
- `isUsingOverage`
- `cachedMCEnabled`
- `effortValue`
- `extraBodyHash`

然后只把“上一版和这一版有什么变了”写进 `pendingChanges`。这意味着 Claude Code 把“潜在根因收集”和“真实命中下降检测”明确拆成了两相，而不是看到参数变动就直接误报 cache break。

## 4. 它会同时保留 stripped hash 和 `cache_control` hash，说明“文本没变但 TTL/scope 变了”是第一类公民问题

源码镜像：[`../../src/services/api/promptCacheBreakDetection.ts`](../../src/services/api/promptCacheBreakDetection.ts)

这层有个很关键的设计：

- `systemHash / toolsHash` 会先 strip `cache_control`
- 但又单独保留 `cacheControlHash`

这解决的是一个非常实际的问题：如果 system prompt 文本一模一样，但：

- global ↔ org/none scope 变了
- 1h TTL ↔ 5min TTL 变了

那传统“只 hash 文本”的检测会说 prompt 没变，但服务端 cache key 实际已经变了。Claude Code 明确把这种“语义不变、缓存元信息变了”的情况单独建模了。

## 5. 工具变化不只看工具数量，还会追到“同名工具 schema 变了”

源码镜像：[`../../src/services/api/promptCacheBreakDetection.ts`](../../src/services/api/promptCacheBreakDetection.ts)

另一处做得很细的是 tool diff：

- 不只记录 added/removed tool count
- 还会在 aggregate tool hash 变化时重算 `perToolHashes`
- 最终产出 `changedToolSchemas`

这解决的是一种很常见但很难解释的 break：

- 工具集没增没减
- 但某个 tool description / input schema / dynamic agent list 变了

也就是说，Claude Code 已经把“same tool set, different prompt surface”当成独立根因，而不是把所有工具变化都粗暴归结为“tool count changed”。

## 6. 第二阶段 `checkResponseForCacheBreak()` 只在看到真实 cache read token 掉幅后才认定 break

源码镜像：[`../../src/services/api/promptCacheBreakDetection.ts`](../../src/services/api/promptCacheBreakDetection.ts)

真正的 break 判定在 `checkResponseForCacheBreak()`，而且条件并不激进：

- 首次调用不判定
- cache read 没掉超过 5% 不判定
- 绝对 token drop 小于阈值不判定

也就是说，只有“读缓存明显少了，而且不是小抖动”时，这条链才会用前一阶段记录下来的 `pendingChanges` 来解释原因。这个设计避免了把正常波动、不同回答长度、轻微 usage 抖动误当成 cache break。

## 7. 它能区分“客户端确实改坏了 key”和“看起来更像服务端驱逐/TTL 过期”

源码镜像：[`../../src/services/api/promptCacheBreakDetection.ts`](../../src/services/api/promptCacheBreakDetection.ts)

`checkResponseForCacheBreak()` 的 reason 组装有三层：

- 有 `pendingChanges`：优先报告客户端可见改动
- 无改动但时间超过 1h / 5min：归因为可能 TTL expiry
- 无改动且时间没过 TTL：归因为 likely server-side

这非常重要，因为它说明 Claude Code 并不把所有 cache drop 都算成本地 bug。它已经内建了“服务端 eviction、routing、billed/inference disagreement”这类非客户端根因的解释出口。

## 8. cached microcompact 和 compaction 都被当成“预期性 cache read 下降”，不是 break

源码镜像：[`../../src/services/api/promptCacheBreakDetection.ts`](../../src/services/api/promptCacheBreakDetection.ts)

这里有两条专门的豁免路径：

- `notifyCacheDeletion()` -> `cacheDeletionsPending = true`
- `notifyCompaction()` -> `prevCacheReadTokens = null`

这说明 Claude Code 很明确地区分了两种“缓存读少了”的场景：

- 非预期下降：真的 cache break
- 预期下降：因为 cached microcompact 删除了 prefix，或者 compaction 让上下文合法缩短了

如果没有这两条旁路，系统会频繁把自己主动做的 cache-optimization 当成回归。

## 9. 它不是只发埋点，还会生成可读 diff 文件给开发者追根因

源码镜像：[`../../src/services/api/promptCacheBreakDetection.ts`](../../src/services/api/promptCacheBreakDetection.ts)

当 break 被认定后，这层不仅会打 `tengu_prompt_cache_break`，还会：

- 用 `buildPrevDiffableContent()` 和当前 `buildDiffableContent()` 拼出可 diff 的文本
- `createPatch(...)`
- 写到临时目录下的 `cache-break-xxxx.diff`

这意味着它不是只有统计用途，还兼顾了工程调试。开发者可以直接看到：

- system prompt 哪段变了
- 哪些 tool schema 变了
- model / betas / cache strategy 如何变化

它已经是一套本地可调查的审计系统，不只是线上事件。

## 10. 它跟 `claude.ts` 的关系不是 loose coupling，而是“请求前埋快照、请求后读 usage”的双向闭环

源码镜像：[`../../src/services/api/claude.ts`](../../src/services/api/claude.ts), [`../../src/services/api/promptCacheBreakDetection.ts`](../../src/services/api/promptCacheBreakDetection.ts)

这条链要成立，必须满足两个条件：

- `claude.ts` 在请求发出前调用 `recordPromptState(...)`
- 请求完成后再把实际 `cache_read_input_tokens` 等 usage 回传给 `checkResponseForCacheBreak(...)`

所以它不是一个离线分析脚本，而是已经嵌在主 API transport 里的在线闭环。换句话说，Claude Code 每次主请求都在顺手审计“这次有没有把 prompt cache 稳定性打坏”。

## 11. 它追踪的很多 flag 本身就是为了验证此前修过的“session-stable latch”是否真的不再打爆 cache

源码镜像：[`../../src/services/api/promptCacheBreakDetection.ts`](../../src/services/api/claude.ts)

像这些字段：

- `autoModeActive`
- `isUsingOverage`
- `cachedMCEnabled`
- `fastMode`
- `betas`
- `globalCacheStrategy`

在注释里都明确写了“应该不再 break cache”或“用来验证修复”。这说明这套审计系统还有一个角色：不是只找新 bug，也用来回归验证之前为了 cache stability 做的 sticky latch / session-stable 策略是否真的生效。

## 12. 这层真正的价值是把“prompt cache 命中变差”从玄学变成可归因事件

当前这篇拆明白的不是 Anthropic prompt cache 内部怎么工作，而是 Claude Code 如何把客户端可见的所有关键维度系统化：

- prompt 文本变了吗
- cache_control 变了吗
- tool 集或 schema 变了吗
- model / betas / effort / fast mode 变了吗
- 是不是 compaction 或 cache deletion 的预期结果
- 如果都没变，是不是更像服务端原因

所以它的工程价值不在“优化 cache”本身，而在“把 cache regression 从模糊体感变成结构化、可调试、可埋点、可写 diff 的事件”。

## 交叉参考

- API transport 主链：[`./25-api-request-streaming-retry-and-telemetry.md`](./25-api-request-streaming-retry-and-telemetry.md)
- Query loop 如何消费 usage 与错误：[`../implementation/03-query-loop-and-recovery.md`](../implementation/03-query-loop-and-recovery.md)
- Tool schema 与 cache key 关系：[`./02-tool-pool-and-tool-use-context.md`](./02-tool-pool-and-tool-use-context.md)
- Session memory / compaction 相关上下文裁剪：[`./12-memdir-and-session-memory.md`](./12-memdir-and-session-memory.md)
