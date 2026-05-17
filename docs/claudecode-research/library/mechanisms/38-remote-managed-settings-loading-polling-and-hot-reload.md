# Remote Managed Settings Loading / Polling / Hot Reload

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Scheduled Remote Agent Triggers / Bundled Skill / OAuth Tool Runtime`](./50-scheduled-remote-agent-triggers-bundled-skill-and-oauth-tool-runtime.md) | [`下一站：Settings Change Detection / Hot Reload Consumers`](./39-settings-change-detection-and-hot-reload-consumers.md)

本文只拆 `remoteManagedSettings` 自己的运行时，不再重复上一卷的 onboarding 和环境选择。主问题是：Claude Code 怎样把远端托管设置拉进本地 settings 栈，同时做到：

- eligible 时异步加载，不阻塞 CLI
- 有磁盘缓存时 cache-first 启动
- mid-session 能热更新
- 拉取失败时 fail-open
- 危险设置变化时 fail-closed

对应源码主链是：`services/remoteManagedSettings/index.ts + syncCache.ts + syncCacheState.ts + securityCheck.tsx + utils/settings/changeDetector.ts`，以及 `main.tsx / cli/print.ts` 的挂载点。

## 1. `remoteManagedSettings` 的目标不是“再来一种配置文件”，而是注入一层远端 policySettings

源码镜像：[`../../src/services/remoteManagedSettings/index.ts`](../../src/services/remoteManagedSettings/index.ts), [`../../src/utils/settings/changeDetector.ts`](../../src/utils/settings/changeDetector.ts)

这套服务的真正位置不是独立配置系统，而是 Claude Code settings pipeline 的一层：

- 拉到的设置最终作为 `policySettings`
- 变更后通过 `settingsChangeDetector.notifyChange('policySettings')`
- 触发 settings cache 失效和监听器热更新

所以它不是“本地文件下载器”，而是正式参与 merged settings truth 的远端策略层。

## 2. eligibility gate 的作用不是授权，而是避免无意义地打远端 API

源码镜像：[`../../src/services/remoteManagedSettings/syncCache.ts`](../../src/services/remoteManagedSettings/syncCache.ts)

`isRemoteManagedSettingsEligible()` 先做一轮本地预筛：

- provider 必须是 `firstParty`
- base URL 必须是 first-party Anthropic
- `CLAUDE_CODE_ENTRYPOINT !== 'local-agent'`
- enterprise/team OAuth 用户允许
- externally injected OAuth token 允许
- 有真实 API key 的 console 用户也允许

关键点是：这不是最终授权判定。它只是本地 pre-check，用来决定“值不值得请求 API”。真正没有远端设置或无权限的用户，服务端仍会通过 204/404/401 等结果兜底。

## 3. eligibility 状态被镜像进 leaf cache，是为了解循环依赖和同步读取

源码镜像：[`../../src/services/remoteManagedSettings/syncCache.ts`](../../src/services/remoteManagedSettings/syncCache.ts), [`../../src/services/remoteManagedSettings/syncCacheState.ts`](../../src/services/remoteManagedSettings/syncCacheState.ts)

这里有个很不显眼但很重要的设计：

- `syncCache.ts` 保留 auth-touching 的 eligibility 逻辑
- `syncCacheState.ts` 只保留 leaf state：`sessionCache + eligible`

原因不是代码洁癖，而是要切断：

- `settings.ts -> syncCache.ts -> auth.ts -> settings.ts`

同时也让同步读取路径 `getRemoteManagedSettingsSyncFromCache()` 能在不引入 auth 依赖的前提下工作。

## 4. `initializeRemoteManagedSettingsLoadingPromise()` 说明这套服务有明确的“其他系统可等待”的启动门

源码镜像：[`../../src/services/remoteManagedSettings/index.ts`](../../src/services/remoteManagedSettings/index.ts)

服务在真正 fetch 前就可以先建一个 promise：

- `loadingCompletePromise`
- `loadingCompleteResolve`

这让其他系统可以通过：

- `waitForRemoteManagedSettingsToLoad()`

显式等待远端托管设置完成首次加载。它不是单纯 background side effect，而是可被系统其它部分 join 的 startup gate。

## 5. 这条 loading promise 自带 30s 超时，是为了防止非 CLI 上下文死锁

源码镜像：[`../../src/services/remoteManagedSettings/index.ts`](../../src/services/remoteManagedSettings/index.ts)

`initializeRemoteManagedSettingsLoadingPromise()` 不只是 new Promise，还会设置：

- `LOADING_PROMISE_TIMEOUT_MS = 30000`

超时后即使 `loadRemoteManagedSettings()` 根本没被调用，也会主动 resolve。注释里已经点明用途：

- Agent SDK tests
- 非 CLI / 非 main.tsx 初始化路径

这说明 Claude Code 明确知道“远端托管设置是可选启动能力”，不能让缺失挂载点变成全局死锁。

## 6. 启动路径是 cache-first，而不是 fetch-first

源码镜像：[`../../src/services/remoteManagedSettings/index.ts`](../../src/services/remoteManagedSettings/syncCacheState.ts)

`loadRemoteManagedSettings()` 的启动顺序非常关键：

1. 若 eligible 且 promise 未建立，先建 promise
2. 立即尝试 `getRemoteManagedSettingsSyncFromCache()`
3. 如果磁盘缓存存在，立刻 `loadingCompleteResolve()`
4. 再异步去 fetch 最新版本

这意味着它不是“先等网络，再让系统继续”，而是“能用本地缓存就先解锁系统，网络刷新随后再补”。

## 7. `getRemoteManagedSettingsSyncFromCache()` 自带 merged settings cache 失效副作用

源码镜像：[`../../src/services/remoteManagedSettings/syncCacheState.ts`](../../src/services/remoteManagedSettings/syncCacheState.ts)

当磁盘缓存首次被读出来时，这个函数不只返回值，还会：

- `sessionCache = cachedSettings`
- `resetSettingsCache()`

理由很具体：如果 merged settings 之前在“remote layer 不可见”时已经被缓存，等远端策略层第一次变得可见时，旧 merged result 必须作废。也就是说，remote managed settings 的“出现”本身就是一次设置拓扑变化，不只是数据值更新。

## 8. `fetchRemoteManagedSettings()` 的 HTTP 协议是 checksum-aware 的，不是盲拉全量 JSON

源码镜像：[`../../src/services/remoteManagedSettings/index.ts`](../../src/services/remoteManagedSettings/types.ts)

每次请求时，客户端会：

- 从 cached settings 本地算 checksum
- 把它放进 `If-None-Match`
- 接受 `200 / 204 / 304 / 404`

返回语义被压成 `RemoteManagedSettingsFetchResult`：

- `settings: null` 表示 304，缓存仍有效
- `settings: {}` 表示 204/404，无远端设置

这套协议说明远端托管设置的同步目标不是“拿到完整文件”，而是“和本地缓存做低成本一致性确认”。

## 9. checksum 实现刻意对齐 Python 服务端，而不是只要稳定 hash 就行

源码镜像：[`../../src/services/remoteManagedSettings/index.ts`](../../src/services/remoteManagedSettings/types.ts)

`computeChecksumFromSettings()` 做的是：

- `sortKeysDeep()`
- `jsonStringify(sorted)`
- `sha256:${hash}`

正文注释明确要求匹配 Python 的：

- `json.dumps(sort_keys=True, separators=(",", ":"))`

所以这里不是“前端随便算个 etag-like hash”，而是把客户端缓存协商协议和服务端实现绑成严格兼容。

## 10. 拉取失败时的主策略是 stale cache fallback，而不是重置成空

源码镜像：[`../../src/services/remoteManagedSettings/index.ts`](../../src/services/remoteManagedSettings/index.ts)

`fetchAndLoadRemoteManagedSettings()` 的失败路径优先级是：

- 如果有旧缓存：继续用 stale cache
- 没缓存：返回 `null`
- 从不因为 fetch 失败而主动把远端设置清空

这就是 fail-open 的真实落地：网络坏了时，本地优先保住之前已经接受过的策略，而不是把策略层瞬间蒸发。

## 11. 但 204/404 会主动删掉磁盘缓存，因为这代表“远端真没有这层设置了”

源码镜像：[`../../src/services/remoteManagedSettings/index.ts`](../../src/services/remoteManagedSettings/index.ts)

当服务端明确返回“没有设置”时：

- `newSettings = {}`
- `setSessionCache(newSettings)`
- 删除 `remote-settings.json`

这和普通 fetch failure 完全不同。意思是：

- 请求失败：保留 stale policy
- 服务端明确说不存在：清掉 stale policy

这是一条重要的语义边界，避免远端管理员删除设置后，本地机器永远继续吃旧策略。

## 12. 危险设置审批发生在“应用新设置之前”，不是应用后回滚

源码镜像：[`../../src/services/remoteManagedSettings/index.ts`](../../src/services/remoteManagedSettings/securityCheck.tsx)

当拉到非空新设置时，流程是：

1. `checkManagedSettingsSecurity(cachedSettings, newSettings)`
2. 若 `handleSecurityCheckResult()` 返回 false
3. 则不应用新设置，回退到 cached settings

所以安全审批不是 post-apply warning，而是 pre-apply gate。用户拒绝后，新设置根本不会进入 session cache 或磁盘。

## 13. `securityCheck.tsx` 的 fail-closed 是进程级的，不是仅禁用某几个字段

源码镜像：[`../../src/services/remoteManagedSettings/securityCheck.tsx`](../../src/services/remoteManagedSettings/securityCheck.tsx)

若结果是 `rejected`，处理逻辑直接：

- `gracefulShutdownSync(1)`

这说明危险托管设置被用户拒绝时，Claude Code 不是“跳过危险字段继续跑”，而是把整个运行视为不可信配置状态，直接停机。这和拉取失败时的 fail-open 形成了极鲜明的对比。

## 14. 背景轮询并不无脑广播，而是比较 JSON 序列化前后是否真的变了

源码镜像：[`../../src/services/remoteManagedSettings/index.ts`](../../src/services/remoteManagedSettings/index.ts)

`pollRemoteSettings()` 会：

- 先取当前 cache 的 `jsonStringify(prevCache)`
- 再执行 `fetchAndLoadRemoteManagedSettings()`
- 重新读 cache，再 `jsonStringify(newCache)`
- 仅当字符串不同才 `notifyChange('policySettings')`

这说明 background poll 的目标不是“每小时强制 reapply 一次”，而是尽量只在真实变化时触发热更新。

## 15. `startBackgroundPolling()` 有 `unref()`，说明它绝不能把进程强留住

源码镜像：[`../../src/services/remoteManagedSettings/index.ts`](../../src/services/remoteManagedSettings/index.ts)

轮询是：

- 每小时一次
- 仅 eligible 时启动
- `pollingIntervalId.unref()`

`unref()` 这个细节很重要：remote managed settings 是增强能力，不是主循环。Claude Code 明确不允许它因为后台 timer 存在就阻止 CLI 退出。

## 16. `settingsChangeDetector.fanOut()` 的 cache reset 集中化，是 remote settings 热更新能成立的前提

源码镜像：[`../../src/utils/settings/changeDetector.ts`](../../src/utils/settings/changeDetector.ts)

`fanOut(source)` 现在会先：

- `resetSettingsCache()`

再：

- `settingsChanged.emit(source)`

注释里已经写明这条改动是为了解决 N 个 listener 各自重置 cache 造成的 thrash，甚至直接点到 “remote managed settings resolved at startup” 的真实性能问题。换句话说，remote settings 的热更新之所以没有把 settings pipeline 拖成多次磁盘重读，是因为 cache reset 已经被提升成单点生产者逻辑。

## 17. `notifyChange('policySettings')` 是这套系统接入所有宿主的统一接口

源码镜像：[`../../src/services/remoteManagedSettings/index.ts`](../../src/utils/settings/changeDetector.ts)

无论是：

- 首次加载成功
- auth 变化后的 refresh
- background poll 检测到变化

最终都通过：

- `settingsChangeDetector.notifyChange('policySettings')`

来传播。这意味着 remote managed settings 没有发明第二套 event bus，而是主动走现成 settings change 通道。

## 18. TUI 和 headless 宿主用同一个 notify，但消费方式不同

源码镜像：[`../../src/main.tsx`](../../src/cli/print.ts)

`main.tsx` 在 preAction 里：

- `void loadRemoteManagedSettings()`

把它作为非阻塞启动 side effect 挂上。

而 `print.ts` 由于没有 React tree 中的 `useSettingsChange`，会：

- 直接 `settingsChangeDetector.subscribe(...)`
- 手动 `applySettingsChange(source, setAppState)`

这说明远端托管设置的热更新不是默认只对 TUI 生效，而是通过 host-specific 订阅路径同时覆盖了 headless 模式。

## 19. 这套系统的真实分层是：eligibility -> cache -> fetch -> security gate -> notify -> host apply

把实现链串起来后，可以看到一个很完整的分层：

- eligibility
  - 本地判断是否值得请求
- cache
  - session cache + disk cache
- fetch
  - checksum-aware，带 retry
- security gate
  - 危险设置变更时阻塞审批
- notify
  - `notifyChange('policySettings')`
- host apply
  - TUI hook 或 print.ts 订阅器各自消费

这已经不是“远端设置同步脚本”，而是一套完整的设置分发运行时。

## 20. 所以 `remoteManagedSettings` 真正解决的是“远端策略层如何进入本地长期运行中的设置真相”

这套设计的核心价值不在“从服务器拿到一个 JSON”，而在于：

- 本地可以先用缓存启动
- 网络失败不炸
- 真删除远端设置时不会保留脏旧值
- 危险策略不会偷偷落地
- 设置变化能 mid-session 推进到 CLI/TUI/headless 各宿主

这就是 Claude Code 把远端托管设置做成一等运行时能力，而不是一次性初始化脚本的原因。

## 交叉参考

- 远端治理面总览：[`./37-remote-web-onboarding-environments-and-managed-settings.md`](./37-remote-web-onboarding-environments-and-managed-settings.md)
- Settings / Config / Permission Rules：[`../architecture/09-settings-config-and-permission-rules.md`](../architecture/09-settings-config-and-permission-rules.md)
- Remote interactive adapters：[`./36-remote-interactive-host-adapters-and-failure-semantics.md`](./36-remote-interactive-host-adapters-and-failure-semantics.md)
