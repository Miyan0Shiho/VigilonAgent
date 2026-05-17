# Remote Host Modes / History / Command Filtering

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Remote Agent Task Polling / Restore / Archive Runtime`](./30-remote-agent-task-polling-restore-and-archive-runtime.md) | [`下一站：Remote Interactive Host Adapters / Failure Semantics`](./36-remote-interactive-host-adapters-and-failure-semantics.md)

本文拆的是另一条容易被忽略的 remote 运行时链：`useRemoteSession.ts + useDirectConnect.ts + useSSHSession.ts + directConnectManager.ts + useAssistantHistory.ts + REPL.tsx`。它讲的不是“一个 remote 模式怎么工作”，而是 Claude Code 怎么让同一个 REPL 外壳挂接多种远端宿主，并在 transcript 恢复、permission ask、slash command catalog 和滚动历史分页上维持一致体验。

## 1. Claude Code 的 remote 不是单一模式，而是三个宿主共用一套 REPL 回调面

源码镜像：[`../../src/hooks/useRemoteSession.ts`](../../src/hooks/useRemoteSession.ts), [`../../src/hooks/useDirectConnect.ts`](../../src/hooks/useDirectConnect.ts), [`../../src/hooks/useSSHSession.ts`](../../src/hooks/useSSHSession.ts)

在当前源码里，REPL 最终只关心一组统一返回值：

- `isRemoteMode`
- `sendMessage`
- `cancelRequest`
- `disconnect`

但底下至少接了三种宿主：

- CCR session viewer：`useRemoteSession`
- `claude connect` 直连：`useDirectConnect`
- `claude ssh`：`useSSHSession`

这说明 Claude Code 的 remote 设计不是每种宿主都写一套 REPL，而是先统一一层“远端会话控制面”。

## 2. `activeRemote` 选择器说明 REPL 不区分 transport，只在最外层择一挂接

源码镜像：`packages/claude-code/src/screens/REPL.tsx`

`REPL.tsx` 的接法很直接：

- 先建 `remoteSession`
- 再建 `directConnect`
- 再建 `sshRemote`
- 最后 `activeRemote = sshRemote ? directConnect ? remoteSession`

也就是说，真正的 transport 差异都被压进 hook 里面，REPL 只接收“当前激活的是哪一个 remote host adapter”。

## 3. 这三条 hook 共享的不是 UI，而是 `sdkMessageAdapter + remotePermissionBridge` 这两块协议底座

源码镜像：[`../../src/remote/sdkMessageAdapter.ts`](../../src/remote/sdkMessageAdapter.ts), [`../../src/remote/remotePermissionBridge.ts`](../../src/remote/remotePermissionBridge.ts), [`../../src/hooks/useDirectConnect.ts`](../../src/hooks/useDirectConnect.ts), [`../../src/hooks/useSSHSession.ts`](../../src/hooks/useSSHSession.ts)

`useDirectConnect` 和 `useSSHSession` 跟 `useRemoteSession` 的真正共用层是：

- `convertSDKMessage()`
- `isSessionEndMessage()`
- `createSyntheticAssistantMessage()`
- `createToolStub()`

这意味着 Claude Code 并没有为 direct connect/SSH 重新发明 transcript 和 permission surface。它只是换了宿主 transport，尽量复用同一套：

- SDK message -> 本地 message
- remote permission ask -> 本地 `ToolUseConfirm`

## 4. `useDirectConnect` 和 `useSSHSession` 都固定打开 `convertToolResults`，因为它们不是 viewer replay，而是实时把远端工具结果折回本地 transcript

源码镜像：[`../../src/hooks/useDirectConnect.ts`](../../src/hooks/useDirectConnect.ts), [`../../src/hooks/useSSHSession.ts`](../../src/hooks/useSSHSession.ts)

这两条 hook 调 `convertSDKMessage()` 时都传：

- `{ convertToolResults: true }`

但没有像 viewer-only 那样开 `convertUserTextMessages`。这对应了它们的宿主语义：

- 本地实时输入仍由 REPL 自己先写入 transcript
- 远端回来的 tool results 需要本地补渲染
- 没有历史 replay 分页责任

## 5. `useDirectConnect` 的本质是“stream-json over WebSocket”，不是 Sessions API subscriber

源码镜像：[`../../src/server/directConnectManager.ts`](../../src/server/directConnectManager.ts), [`../../src/hooks/useDirectConnect.ts`](../../src/hooks/useDirectConnect.ts)

`DirectConnectSessionManager` 跟 `RemoteSessionManager` 差别很大：

- 直接连 `config.wsUrl`
- 把每条 message 当换行分隔 JSON 逐行 parse
- `sendMessage()` 直接发 SDK-style `type:'user'`
- `respondToPermissionRequest()` 直接发 `control_response`

所以它不是 Claude.ai Sessions API 的 viewer 变体，而更像“本地 REPL 直接对接一个 `--input-format stream-json` 远端 agent”。

## 6. direct connect 明确过滤 `keep_alive`、`streamlined_text`、`streamlined_tool_use_summary` 和 `post_turn_summary`

源码镜像：[`../../src/server/directConnectManager.ts`](../../src/server/directConnectManager.ts)

这条链说明 direct connect 宿主发来的内容比 CCR viewer 更“靠近 agent 原始 stdout”。因此 manager 要主动忽略一些不该进 transcript 的帧：

- `keep_alive`
- `control_response`
- `control_cancel_request`
- `streamlined_text`
- `streamlined_tool_use_summary`
- `system:post_turn_summary`

这也是为什么 direct connect 不能只拿 `sdkMessageAdapter` 单独工作，还需要一个 transport-level filter。

## 7. 对未知 control request subtype，它和 CCR manager 一样主动回 error，说明“不要让远端挂住”等级高于 transport 差异

源码镜像：[`../../src/server/directConnectManager.ts`](../../src/server/directConnectManager.ts), [`../../src/remote/RemoteSessionManager.ts`](../../src/remote/RemoteSessionManager.ts)

`DirectConnectSessionManager` 也复制了那条重要原则：

- 识别 `can_use_tool`
- 不认识的 subtype 立刻 `sendErrorResponse()`

这表明 Claude Code 已经把“控制面 request 必须有回执”固化成跨宿主 invariant，而不是 CCR 专属策略。

## 8. `useDirectConnect` 的连接失败语义是“进程级失败”，不是“会话内重连”

源码镜像：[`../../src/hooks/useDirectConnect.ts`](../../src/hooks/useDirectConnect.ts)

它的断开策略很硬：

- 若从未连上：打印 `Failed to connect`
- 若连上后断开：打印 `Server disconnected`
- 然后 `gracefulShutdown(1)`

这说明 direct connect 被建模成“当前 REPL 的主宿主进程”。它不像 CCR viewer 那样默认有长寿会话可重新 attach。

## 9. `useSSHSession` 明确说自己是 `useDirectConnect` 的 sibling，而不是它的泛化版

源码镜像：[`../../src/hooks/useSSHSession.ts`](../../src/hooks/useSSHSession.ts)

文件头注释直接给出设计意图：

- callback shape 和 `useDirectConnect` 一样
- 但生命周期不同
- ssh process 与 auth proxy 在 hook 外部就已创建好

所以 Claude Code 没把这两条链硬抽象成一个超级 remote hook，而是承认 transport setup 阶段差异太大，只共享中后段回调面。

## 10. SSH 模式在当前镜像里只有 hook 表面是完整可见的；底层 `createSSHSession / SSHSessionManager` 主体未展开

源码证据：[`../../src/hooks/useSSHSession.ts`](../../src/hooks/useSSHSession.ts)；相关调用点：`packages/claude-code/src/main.tsx`

当前工作区能直接读到：

- `useSSHSession.ts`
- `main.tsx` 里 `await import('./ssh/createSSHSession')`

但底层这两个文件本体当前镜像未挂出：

- `./ssh/createSSHSession`
- `./ssh/SSHSessionManager`

所以这块不能伪装成“已经完全拆到 transport 内部”。当前可确认的，只是 hook 所依赖的公开 contract：

- `session.createManager(...)`
- `session.getStderrTail()`
- `session.proc.exitCode`
- `session.proxy.stop()`

## 11. 即便底层主体缺失，hook 已经暴露出 SSH 宿主跟 direct connect 的两个关键差异：可重连提示和 stderr 收尾

源码镜像：[`../../src/hooks/useSSHSession.ts`](../../src/hooks/useSSHSession.ts)

跟 direct connect 相比，SSH hook 额外明确了两层行为：

- `onReconnecting(attempt, max)`：往 transcript 注入系统警告消息
- `onDisconnected()`：根据是否曾连接成功、exit code、stderr tail 生成更具体的最终报错

这说明 SSH 宿主被视为“底层链路可能暂断但仍有机会续上”的 transport，而不是一断就只剩黑盒报错。

## 12. `cancelRequest()` 在 direct connect 和 SSH 里都退化成 `sendInterrupt()`，说明本地没有 viewer-only 这类更细控制面

源码镜像：[`../../src/hooks/useDirectConnect.ts`](../../src/hooks/useDirectConnect.ts), [`../../src/hooks/useSSHSession.ts`](../../src/hooks/useSSHSession.ts)

这两条 hook 的取消语义都非常简单：

- 发 interrupt
- 本地 `setIsLoading(false)`

没有 viewer-only、title update、timeout/reconnect timer 这类附加控制。这再次说明它们更像“当前 REPL 直接绑定的远端宿主”，而不是可脱附观察的外部 session。

## 13. `handleRemoteInit()` 证明 remote 模式连 slash command catalog 都不是本地真相，而要被远端 capability 裁剪

源码镜像：`packages/claude-code/src/screens/REPL.tsx`

`useRemoteSession` 独有的 `onInit` 会把远端给出的 `slash_commands` 回传给 REPL，然后：

- 建 `remoteCommandSet`
- 仅保留远端列出的命令
- 再额外保留 `REMOTE_SAFE_COMMANDS`

这说明一旦进入 remote session，本地命令目录不再是权限真相。真正的 capability catalog 来自远端宿主。

## 14. `REMOTE_SAFE_COMMANDS` 的存在说明“命令过滤”不是纯从众，而是保留少量本地无害控制面

源码证据：`packages/claude-code/src/screens/REPL.tsx`, `packages/claude-code/src/commands`

过滤策略不是“远端没列就全删”，而是：

- 远端列出的命令保留
- 本地安全命令也可保留

这体现出 Claude Code 对 remote 命令目录的判断是：

- 真实执行能力以远端为准
- 但少量本地 UI / help / control 命令可以继续存在

## 15. `useAssistantHistory()` 则是另一条完全不同的 remote transcript 补图路径：不是 live stream，而是惰性分页 prepend

源码镜像：[`../../src/hooks/useAssistantHistory.ts`](../../src/hooks/useAssistantHistory.ts)

这个 hook 只在 `config.viewerOnly === true` 时工作，核心责任是：

- mount 时抓 newest page
- 向上滚动接近顶部时抓 older page
- prepend 进 transcript
- 保持 scroll anchoring

所以它不是 remote stream adapter，而是 viewer-only 的历史分页器。

## 16. 历史分页和 viewer live stream 复用同一个 `convertSDKMessage()` 选项组合，说明 transcript 语义必须一致

源码镜像：[`../../src/hooks/useAssistantHistory.ts`](../../src/hooks/useAssistantHistory.ts), [`../../src/hooks/useRemoteSession.ts`](../../src/hooks/useRemoteSession.ts)

`useAssistantHistory.pageToMessages()` 明确使用：

- `convertUserTextMessages: true`
- `convertToolResults: true`

而 `useRemoteSession` 在 viewer-only 模式也用这一组。意思很明确：

- live attach 期间看到的 transcript
- 上滚补出来的历史 transcript

必须遵守同一套“什么该显示”的语义，不然前后页会变成两种不同世界。

## 17. 历史分页用 sentinel + layout anchoring，而不是粗暴 prepend，因为 remote transcript 很长且滚动体验必须稳定

源码镜像：[`../../src/hooks/useAssistantHistory.ts`](../../src/hooks/useAssistantHistory.ts)

这个 hook 的实现很讲究：

- `SENTINEL_LOADING / FAILED / START`
- prepend 前记录 `beforeHeight`
- `useLayoutEffect` 里按 `height delta` 补 scroll
- 首屏还会自动连拉多页直到填满 viewport

这说明 assistant history 在 Claude Code 里不是“有空再补一页”，而是正式的长会话漫游基础设施。

## 18. 真正应该把这条链理解成“远端宿主适配层”，而不是几条零散 hook

综合起来，当前源码已经足够说明这是一套成体系设计：

- `useRemoteSession`：CCR session viewer / controller
- `useDirectConnect`：stream-json over WebSocket 直连宿主
- `useSSHSession`：ssh child + auth proxy 宿主，当前仅 hook 面完整可见
- `useAssistantHistory`：viewer-only transcript 分页补图
- `REPL activeRemote + handleRemoteInit`：统一宿主切换和命令目录裁剪

所以这块不该被看成“remote 下面又多了两个 hook”，而应该被看成 Claude Code 的多宿主 remote transcript/runtime 适配层。

## 交叉参考

- CCR remote viewer 主链：[`./29-remote-sdk-message-adaptation-websocket-and-permission-bridges.md`](./29-remote-sdk-message-adaptation-websocket-and-permission-bridges.md)
- 远端后台任务内核：[`./30-remote-agent-task-polling-restore-and-archive-runtime.md`](./30-remote-agent-task-polling-restore-and-archive-runtime.md)
- 远端 UI 工作面：[`../architecture/08-tasks-remote-and-agent-detail-ui.md`](../architecture/08-tasks-remote-and-agent-detail-ui.md)
