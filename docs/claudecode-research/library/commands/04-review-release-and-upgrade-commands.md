# Review、Release 与 Upgrade 命令族

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：集成与工作流命令`](./03-integration-and-product-workflow-commands.md) | [`下一站：Plugin Runtime`](../mechanisms/09-plugin-runtime-and-marketplace.md)

本文聚焦一组更“产品运营化”的命令：`/review`、`/ultrareview`、`/release-notes`、`/upgrade`。它们体现的是 Claude Code 如何把本地审查、远端审查、发行说明消费和订阅升级做成显式工作流。

## 1. `/review` 和 `/ultrareview` 不是同一条实现链

源码镜像：[`../../src/commands/review.ts`](../../src/commands/review.ts), [`../../src/commands/review/ultrareviewCommand.tsx`](../../src/commands/review/ultrareviewCommand.tsx), [`../../src/commands/review/reviewRemote.ts`](../../src/commands/review/reviewRemote.ts)

`review.ts` 自己已经把边界分开了：

- `/review`：`type: 'prompt'`
- `/ultrareview`：`type: 'local-jsx'`

而且源码注释明确说：

- `/ultrareview is the ONLY entry point to the remote bughunter path`
- `/review stays purely local`

所以 `/review` 仍然是本地 prompt 审查；远端 code-review 工作流是 `/ultrareview`，不是 `/review`。

## 2. `/ultrareview` 才暴露了真正的远端产品语义

源码镜像：[`../../src/commands/review/ultrareviewCommand.tsx`](../../src/commands/review/ultrareviewCommand.tsx), [`../../src/commands/review/reviewRemote.ts`](../../src/commands/review/reviewRemote.ts)

从 `ultrareviewCommand.tsx` 和 `reviewRemote.ts` 可以直接看到：

- 启动前要检查 overage gate
- 可能进入确认对话框
- 远端 eligibility 检查
- quota / utilization / extra usage 计费路径
- PR 模式与 branch 模式两套执行路径
- `teleportToRemote()` 启动 CCR 会话
- `RemoteAgentTask` 注册与本地轮询回流

这说明 ultrareview 是一个完整的远端产品能力，而不是普通本地 prompt。

## 3. `/release-notes` 是“缓存优先”的外部信息命令

源码镜像：[`../../src/commands/release-notes/release-notes.ts`](../../src/commands/release-notes/release-notes.ts)

这个命令的设计目标不是复杂，但很典型：

- 尝试快速抓取最新 changelog
- 500ms 超时后自动退回缓存
- 缓存也没有时，再退到 changelog URL

这体现了 Claude Code 对“用户想快速看发行说明”这一场景的产品化处理：先快，再新，最后才是外部跳转。

## 4. `/upgrade` 是订阅升级 + 登录切换工作流

源码镜像：[`../../src/commands/upgrade/upgrade.tsx`](../../src/commands/upgrade/upgrade.tsx)

它处理的不是简单打开网页：

- 先检查当前账号是否已经是最高 Max 层级
- 必要时读取 OAuth profile 补充判断
- 打开升级页面后，再接一个新的 login 流程
- 成功后调用 `context.onChangeAPIKey()`

所以 `/upgrade` 实际上在承接“升级订阅并切换当前 CLI 身份”的产品路径。

## 5. 为什么这一组命令必须单独成簇

它们共同说明一件事：Claude Code 的命令层不只是本地开发辅助，还直接承载：

- 远端 review 产品
- 发行说明消费
- 订阅与账号升级

这已经超出“IDE agent”常规范围，属于产品运营能力面的一部分。
