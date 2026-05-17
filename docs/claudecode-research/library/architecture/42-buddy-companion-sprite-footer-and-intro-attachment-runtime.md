# Buddy / Companion / Sprite / Footer / Intro Attachment Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：State Management / Store / Provider / Selector / Sync Runtime`](./41-state-management-store-provider-selector-and-sync-runtime.md) | [`下一站：Product / 01 Positioning and Surface`](../product/01-positioning-and-surface.md)

前面的卷册已经分析过 footer、PromptInput、REPL surface 和 prompt attachment，但 Claude Code 里还有一条很特别的产品表面没有被单独收束出来：Buddy/Companion。它看上去像一个可爱的 UI 彩蛋，实际却跨了 identity 生成、配置持久化、intro attachment、footer 导航、REPL sprite 渲染和全局状态反应，是一个完整的运行时子系统。

## 1. Buddy 不是零散彩蛋，而是被正式接入到主交互面的产品表面

源码镜像：[`../../sources/claude-code/src/buddy/companion.ts`](../../sources/claude-code/src/buddy/companion.ts), [`../../sources/claude-code/src/components/PromptInput/PromptInput.tsx`](../../sources/claude-code/src/components/PromptInput/PromptInput.tsx), [`../../sources/claude-code/src/screens/REPL.tsx`](../../sources/claude-code/src/screens/REPL.tsx)

从接线位置就能看出 Claude Code 并没有把 Buddy 当作边角挂件：

- PromptInput 的 footer items 直接把 `companion` 当成一等 pill
- `footer:openSelected` 选中它时走正式 `/buddy` 提交流程
- REPL 在主布局底部为它预留独立 surface
- AppState 里为它预留 `companionReaction`、`companionPetAt` 这种正式字段

如果它只是视觉趣味，完全没必要占用 footer、command、global state 和 REPL layout 这些正式资源。现在这条接线说明它被视为“CLI 里可导航、可对话、可反应的 companion surface”。

## 2. 这套系统先把 companion 拆成“骨架可重建、灵魂可持久化”的两层身份

源码镜像：[`../../sources/claude-code/src/buddy/types.ts`](../../sources/claude-code/src/buddy/types.ts), [`../../sources/claude-code/src/buddy/companion.ts`](../../sources/claude-code/src/buddy/companion.ts)

`types.ts` 和 `companion.ts` 最有意思的一点，是它没有把整只 companion 当成一坨任意 JSON 持久化，而是拆成：

- `CompanionCore`
  - species、variant、palette、personality、rarity、phase 这类可重建骨架
- `Companion`
  - 在 core 之上再带 `name`
- `CompanionSoul`
  - `custom_name`、`custom_short_description`、`companionMuted`

然后用 `userId + storage soul` 共同生成最终 companion。

这里的设计含义很强：

- companion 的“身份骨架”由 `userId` 确定性 roll 出来
- 用户只持久化少量允许覆盖的“灵魂层”字段
- 即使 species/variant 名称未来变更，也可以靠 `regenerateCompanionFromUserIdAndStorageSoul()` 重新生长出稳定的 companion

所以它不是传统意义上的“把一整份宠物数据写入配置文件”，而是通过 deterministic generation + minimal persisted soul，实现“可恢复、可演化、不易伪造”的 companion identity。

## 3. `getCompanion()` 把确定性生成、异常回退和 soul 兼容收口成一个单入口

源码镜像：[`../../sources/claude-code/src/buddy/companion.ts`](../../sources/claude-code/src/buddy/companion.ts)

`getCompanion({ userId, configCompanion })` 基本上是这套子系统的 identity resolver：

- 先读取 storage soul
- 再用 `userId` 做 seeded deterministic roll
- 如果本地已有旧 companion 配置，就尝试迁移其 soul
- 如果迁移异常，回退到重新生成
- 最终再把 soul 合并进 companion

这样做的价值是：

- 用户换机器、重装、升级后仍有大概率拿回“同一只” companion
- 配置 schema 变化时不必相信旧整对象绝对可用
- companion 身份生成逻辑可以演进，但持久层只保留少量稳定字段

这是一种很少见但很工程化的趣味系统做法。

## 4. Prompt 层没有让 companion 抢戏，而是只在合适时机追加一段 intro attachment

源码镜像：[`../../sources/claude-code/src/buddy/prompt.ts`](../../sources/claude-code/src/buddy/prompt.ts), [`../../sources/claude-code/src/utils/attachments.ts`](../../sources/claude-code/src/utils/attachments.ts), [`../../sources/claude-code/src/utils/messages.ts`](../../sources/claude-code/src/utils/messages.ts)

Buddy 对模型的影响不是“每轮都塞一大段 persona prompt”，而是一条控制得很克制的 intro attachment 链：

- `getCompanionIntroAttachment()` 生成一句极短的 companion 提示
- `attachments.ts` 只在满足条件时把它加进 attachment 列表
- `messages.ts` 再把这种 attachment 翻译成 `system-reminder`

这条链的价值在于：

- companion 具备被模型感知的存在感
- 但不需要每轮都挤占大段上下文预算
- attachment 语义仍然保持和其他系统提示一致

也就是说，Buddy 既进入了 prompt runtime，又没有破坏 Claude Code 一贯克制的 system-reminder 结构。

## 5. Footer 集成证明它是一个“可聚焦 surface”，不是被动装饰物

源码镜像：[`../../sources/claude-code/src/components/PromptInput/PromptInput.tsx`](../../sources/claude-code/src/components/PromptInput/PromptInput.tsx)

PromptInput 里有三处证据特别关键：

- `companionFooterVisible = !!_companion && !companionMuted`
- `footerItems` 把 `companion` 与 `tasks/tmux/bagel/teams/bridge` 放在同一层
- `footer:openSelected` 选中 `companion` 时直接提交 `/buddy`

这说明 companion 的交互定位非常明确：

- 它不是永远强行出现，而是尊重 mute 状态
- 它和 tasks、bridge 一样属于 footer 可导航对象
- 它有正式命令入口，而不是只有鼠标 hover 或动画彩蛋

把它放进 footer 的意义，是让 companion 成为 REPL 主循环里可被键盘访问、可被 focus、可被命令触发的标准交互面。

## 6. REPL 不是简单“画一个小宠物”，而是按屏幕模式把 companion 挂到不同布局层

源码镜像：[`../../sources/claude-code/src/screens/REPL.tsx`](../../sources/claude-code/src/screens/REPL.tsx), [`../../sources/claude-code/src/buddy/CompanionSprite.tsx`](../../sources/claude-code/src/buddy/CompanionSprite.tsx)

REPL 至少做了两层和 companion 相关的运行时决策：

- 在事件侧，通过 `fireCompanionObserver(...)` 根据工具执行结果和用户输入触发反应
- 在布局侧，通过 `CompanionSprite` 把它挂到主 REPL 底部 surface，并根据 `isNarrowMode`、`!isFullscreen`、`!isCompactMode` 决定是否显示和如何浮动

这说明 companion 不是某个局部组件私下绘制的一张图，而是 REPL runtime 按全局布局条件正式管理的一块 surface。它要同时考虑：

- 窄终端能不能放下
- 全屏模式是否需要隐藏
- 浮动位置会不会和主内容冲突

所以 `CompanionSprite` 更像 REPL surface runtime 的一个子层，而不是静态装饰组件。

## 7. `CompanionSprite` 里真正被建模的是“可感知状态”，不是单向动画

源码镜像：[`../../sources/claude-code/src/buddy/CompanionSprite.tsx`](../../sources/claude-code/src/buddy/CompanionSprite.tsx)

`CompanionSprite` 会基于多种输入决定当前表现：

- `isSleeping`
- `isThinking`
- `isTyping`
- `isBusy`
- `showBubble`
- `isPetting`

再把这些状态映射成不同的 ASCII sprite、气泡文案和动画节奏。

换句话说，Buddy 的 UI 本质上不是“随机播几个可爱帧”，而是把 REPL 当前活动状态翻译成 companion 可感知的情绪和动作。它在产品上承担的是“把抽象的 agent/system activity 变得可见、可亲近”的角色。

## 8. `companionReaction` / `companionPetAt` 证明 Buddy 深度依赖全局状态架构，而不是独立自转

源码镜像：[`../../sources/claude-code/src/state/AppStateStore.ts`](../../sources/claude-code/src/state/AppStateStore.ts), [`../../sources/claude-code/src/screens/REPL.tsx`](../../sources/claude-code/src/screens/REPL.tsx), [`../../sources/claude-code/src/buddy/CompanionSprite.tsx`](../../sources/claude-code/src/buddy/CompanionSprite.tsx)

上一卷刚补完的 State Management 在这里直接派上用场。

`AppState` 专门为 Buddy 预留了：

- `companionReaction`
- `companionPetAt`

REPL 在用户输入和工具执行阶段会更新这些字段，`CompanionSprite` 再把它们解释成展示状态。也就是说：

- 反应不是组件本地 `useState` 硬凑出来的
- 抚摸时间戳不是 DOM 事件的私有变量
- Buddy 和主循环之间通过全局状态层显式同步

这让 Buddy 能在 REPL、footer、command、layout 多个表面之间维持一致反应，而不是各自表演各自的动画。

## 9. Config 层只开放很少的 companion 控制面，说明这套系统强调“存在感稳定”而不是“高度可编排”

源码镜像：[`../../sources/claude-code/src/utils/config.ts`](../../sources/claude-code/src/utils/config.ts), [`../../sources/claude-code/src/buddy/types.ts`](../../sources/claude-code/src/buddy/types.ts)

当前配置里真正对外暴露的 companion 控制面很有限，核心就是：

- muted 与否
- 少量 soul 覆盖字段

这跟它的生成架构是一致的。Claude Code 并不鼓励用户把 companion 深度改造成另一套自定义角色系统，而是更偏向：

- companion 身份尽量稳定
- 用户只做轻量命名和静音控制
- 视觉与个性主要由系统生成

因此 Buddy 更像“产品化 companion presence”，而不是“开放式可编程宠物框架”。

## 10. 这条子系统说明 Claude Code 对 CLI 体验的理解，不止是效率，还包括陪伴感和状态可视化

源码镜像：[`../../sources/claude-code/src/buddy/companion.ts`](../../sources/claude-code/src/buddy/companion.ts), [`../../sources/claude-code/src/buddy/prompt.ts`](../../sources/claude-code/src/buddy/prompt.ts), [`../../sources/claude-code/src/buddy/CompanionSprite.tsx`](../../sources/claude-code/src/buddy/CompanionSprite.tsx), [`../../sources/claude-code/src/components/PromptInput/PromptInput.tsx`](../../sources/claude-code/src/components/PromptInput/PromptInput.tsx), [`../../sources/claude-code/src/screens/REPL.tsx`](../../sources/claude-code/src/screens/REPL.tsx)

Buddy/Companion 之所以值得单独成卷，不是因为它“可爱”，而是因为它非常集中地体现了 Claude Code 的产品判断：

- 终端产品也可以有长期身份感
- 陪伴感可以通过 deterministic identity 和轻量 soul 持久化来建立
- 模型层存在感可以通过 intro attachment 克制地注入
- 键盘导向的 CLI 里，companion 依然应该能被 footer focus 和正式命令访问
- REPL 的系统活动可以被翻译成用户看得懂的表情、动作和气泡

如果说前面的卷册更多在解释 Claude Code 怎样高效完成任务，这一卷解释的就是：它怎样把“系统正在工作”转译成一个更有温度、但又没有喧宾夺主的终端体验表面。这正是 D 这一缺口真正缺失的部分。
