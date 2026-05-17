# ConfigTool / Supported Settings / Source Routing / Immediate Effect Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：WebFetchTool / Domain Gates / Redirects / Secondary Model Runtime`](./74-webfetch-tool-domain-gates-redirects-and-secondary-model-runtime.md) | [`下一站：SendMessageTool / Peer Routing / Mailbox / Cross-Session Runtime`](./76-sendmessage-tool-peer-routing-mailbox-and-cross-session-runtime.md)

本文把 `ConfigTool` 从 settings/UI 总述里单独抽出来。重点不是“能改配置”，而是它怎样把一部分 Claude Code 设置表编译成一个受支持的 tool surface，并把一次设置操作拆成 `registry lookup -> source routing -> validate/coerce -> disk write -> immediate AppState effect` 这条运行时。

## 1. `ConfigTool` 不是通用 settings editor，而是一个只在 ant 宿主暴露的受限配置控制面

源码镜像：[`../../sources/claude-code/src/tools.ts`](../../sources/claude-code/src/tools.ts), [`../../sources/claude-code/src/tools/ConfigTool/ConfigTool.ts`](../../sources/claude-code/src/tools/ConfigTool/ConfigTool.ts)

它在工具池里的注册条件是：

- `...(process.env.USER_TYPE === 'ant' ? [ConfigTool] : [])`

所以它不是所有 Claude Code 宿主都能看到的通用设置工具，而是 ant-native 构建里才暴露的一等 runtime surface。

## 2. `ConfigTool` 的真实配置面不是“所有 settings”，而是 `SUPPORTED_SETTINGS` 注册表

源码镜像：[`../../sources/claude-code/src/tools/ConfigTool/supportedSettings.ts`](../../sources/claude-code/src/tools/ConfigTool/supportedSettings.ts)

它支持的 setting 不是动态遍历整个 settings schema，而是人工登记在：

- `SUPPORTED_SETTINGS`

每一项都会携带：

- `source: 'global' | 'settings'`
- `type: 'boolean' | 'string'`
- `description`
- `options` 或 `getOptions`
- `appStateKey?`
- `validateOnWrite?`
- `formatOnRead?`

因此 `ConfigTool` 本质上是“从大 settings 世界里裁出来的一小张可操作白名单”。

## 3. prompt 不是手写静态文案，而是从注册表和动态 model options 即时生成

源码镜像：[`../../sources/claude-code/src/tools/ConfigTool/prompt.ts`](../../sources/claude-code/src/tools/ConfigTool/prompt.ts), [`../../sources/claude-code/src/tools/ConfigTool/supportedSettings.ts`](../../sources/claude-code/src/tools/ConfigTool/supportedSettings.ts)

`generatePrompt()` 会：

- 遍历 `SUPPORTED_SETTINGS`
- 按 `global` / `project(settings)` 分组
- 对有 options 的项列枚举值
- 单独生成 model 段

这意味着模型看到的配置说明不是易陈旧的手写手册，而是由 runtime registry 自己投影出来的最新工具文档。

## 4. voice setting 虽然编进了注册表，但仍然会在 prompt 生成和运行时入口双重隐藏

源码镜像：[`../../sources/claude-code/src/tools/ConfigTool/prompt.ts`](../../sources/claude-code/src/tools/ConfigTool/ConfigTool.ts), [`../../sources/claude-code/src/voice/voiceModeEnabled.ts`](../../sources/claude-code/src/voice/voiceModeEnabled.ts)

这条链有两层 gate：

- prompt 生成时：
  - `voiceEnabled` 在 growthbook kill-switch 打开时直接从说明里隐藏
- tool call 时：
  - 就算 setting 名传进来，也会再次检查 `isVoiceGrowthBookEnabled()`
  - 不通过就返回 `Unknown setting`

所以 voice 不是只在 UI 上被隐藏，而是工具层也会做 runtime concealment，避免泄露 feature-specific strings。

## 5. `ConfigTool` 的 schema 极小，说明它故意只暴露“单键 get/set”而不是批量 patch

源码镜像：[`../../sources/claude-code/src/tools/ConfigTool/ConfigTool.ts`](../../sources/claude-code/src/tools/ConfigTool/ConfigTool.ts)

input 只有：

- `setting`
- `value?`

省略 `value` 就表示 `get`

这说明它不是 settings JSON 编辑器，也不支持 multi-key transaction，而是一个单键控制台。

## 6. read-only 判定直接取决于有没有 `value`，所以同一个工具同时承担读和写两种权限语义

源码镜像：[`../../sources/claude-code/src/tools/ConfigTool/ConfigTool.ts`](../../sources/claude-code/src/tools/ConfigTool/ConfigTool.ts)

关键行为：

- `isReadOnly(input) { return input.value === undefined }`
- `checkPermissions(...)` 对 get 自动 allow
- set 则 ask

也就是说，`ConfigTool` 不是读写分成两个工具，而是把 mode 分义编码进同一 schema。

## 7. 权限层并不按 setting 白名单再细分，写操作统一进入 “ask once” 模式

源码镜像：[`../../sources/claude-code/src/tools/ConfigTool/ConfigTool.ts`](../../sources/claude-code/src/tools/ConfigTool/ConfigTool.ts)

它的权限策略很朴素：

- get: `allow`
- set: `ask`
- message: `Set <setting> to <value>`

所以 `ConfigTool` 的细粒度控制不在 permission rule 层，而在后面的 supported-settings registry 和每个 setting 自己的 runtime 校验分支。

## 8. 首先经过的不是写盘，而是 `isSupported(setting)` 的显式白名单判定

源码镜像：[`../../sources/claude-code/src/tools/ConfigTool/ConfigTool.ts`](../../sources/claude-code/src/tools/ConfigTool/supportedSettings.ts)

运行时第一关就是：

- `if (!isSupported(setting)) return Unknown setting`

所以这个工具不会把任意 settings path 透传到底层配置系统；只有注册表里明确声明过的键才允许被模型触达。

## 9. setting key 到真实配置位置的映射由 `getPath()` 决定，不依赖工具调用方自己拼嵌套对象

源码镜像：[`../../sources/claude-code/src/tools/ConfigTool/supportedSettings.ts`](../../sources/claude-code/src/tools/ConfigTool/ConfigTool.ts)

路径解析规则是：

- 有 `path` 就用显式 path
- 否则 `key.split('.')`

因此像：

- `permissions.defaultMode`

这种嵌套 setting，不是靠调用方自己传对象，而是工具内部统一转成 path。

## 10. GET 操作不是盲读磁盘，而是按 source 走两套不同读链

源码镜像：[`../../sources/claude-code/src/tools/ConfigTool/ConfigTool.ts`](../../sources/claude-code/src/utils/config.ts), [`../../sources/claude-code/src/utils/settings/settings.ts`](../../sources/claude-code/src/utils/settings/settings.ts)

`getValue(source, path)` 分成：

- `global`:
  - `getGlobalConfig()`
- `settings`:
  - `getInitialSettings()`

所以它天然跨了两套配置后端：

- `~/.claude.json`
- merged settings world

而不是假装这些 source 是一个统一文件。

## 11. `formatOnRead` 说明 “读到的值” 也允许是衍生态，而不是原始存储值

源码镜像：[`../../sources/claude-code/src/tools/ConfigTool/supportedSettings.ts`](../../sources/claude-code/src/tools/ConfigTool/ConfigTool.ts)

两个最典型例子：

- `model`:
  - `null` 读出来会格式化成 `default`
- `remoteControlAtStartup`:
  - 读时走 `getRemoteControlAtStartup()`

因此 ConfigTool 的 get 语义是“返回用户应该理解的有效值”，不是“把底层文件字面量照抄出来”。

## 12. `remoteControlAtStartup = "default"` 是一个专门的 unset 分支，不走普通 set 路线

源码镜像：[`../../sources/claude-code/src/tools/ConfigTool/ConfigTool.ts`](../../sources/claude-code/src/utils/config.ts)

这条特例非常关键：

- 如果 setting 是 `remoteControlAtStartup`
- 且 value 是字符串 `"default"`

就会：

- `delete next.remoteControlAtStartup`
- 再用 `getRemoteControlAtStartup()` 算有效值

也就是说，这个 setting 的写入语义不是简单布尔 set，而是：

- `true`
- `false`
- `default/unset`

三态。

## 13. boolean coercion 是工具层自己做的，说明它允许模型用字符串布尔值交互

源码镜像：[`../../sources/claude-code/src/tools/ConfigTool/ConfigTool.ts`](../../sources/claude-code/src/tools/ConfigTool/supportedSettings.ts)

如果某项被声明成 `type === 'boolean'`，工具会接受：

- `"true"`
- `"false"`

并自动转成布尔值。说明它的输入协议对模型比较宽容，不要求模型始终严格输出 JSON boolean。

## 14. 枚举值校验统一走 `getOptionsForSetting(...)`，而不是每个 setting 自己单写 if/else

源码镜像：[`../../sources/claude-code/src/tools/ConfigTool/supportedSettings.ts`](../../sources/claude-code/src/tools/ConfigTool/ConfigTool.ts)

对于：

- theme
- editorMode
- preferredNotifChannel
- teammateMode
- permissions.defaultMode
- model

这类有枚举空间的设置，统一通过：

- `getOptionsForSetting(setting)`

做白名单校验。说明 registry 不只是拿来生成 prompt，也承担实际输入约束。

## 15. `model` 的 options 和校验都是动态的，ConfigTool 本身不硬编码模型表

源码镜像：[`../../sources/claude-code/src/tools/ConfigTool/supportedSettings.ts`](../../sources/claude-code/src/tools/ConfigTool/prompt.ts)

`model` 这个 setting：

- options 来自 `getModelOptions()`
- 写入校验走 `validateModel(...)`
- 读取时 `null -> default`

所以模型切换逻辑不是写死在 ConfigTool 里，而是把模型系统的真实能力面投影过来。

## 16. `voiceEnabled` 的 set 路线是整篇里最重的 preflight，说明它其实更像 capability enrollment

源码镜像：[`../../sources/claude-code/src/tools/ConfigTool/ConfigTool.ts`](../../sources/claude-code/src/voice/voiceModeEnabled.ts)

当尝试：

- `voiceEnabled = true`

时，会连续检查：

- `isVoiceModeEnabled()`
- `checkRecordingAvailability()`
- `isVoiceStreamAvailable()`
- `checkVoiceDependencies()`
- `requestMicrophonePermission()`

这说明 `voiceEnabled` 并不是普通配置开关，而是一个需要 auth、依赖、系统权限都满足后才能 enrollment 的 capability gate。

## 17. 真正写盘时，`global` 和 `settings` 走的是两套不同写后端

源码镜像：[`../../sources/claude-code/src/tools/ConfigTool/ConfigTool.ts`](../../sources/claude-code/src/utils/config.ts), [`../../sources/claude-code/src/utils/settings/settings.ts`](../../sources/claude-code/src/utils/settings/settings.ts)

写入阶段分成：

- `global`:
  - `saveGlobalConfig(prev => ...)`
- `settings`:
  - `updateSettingsForSource('userSettings', update)`

因此它不是一个 JSON writer，而是一个 source router：

- 全局配置进 global config store
- 项目/用户设置进 settings merge world

## 18. `buildNestedObject(path, value)` 说明嵌套 settings 写入是“最小更新对象”而不是全量重写

源码镜像：[`../../sources/claude-code/src/tools/ConfigTool/ConfigTool.ts`](../../sources/claude-code/src/tools/ConfigTool/supportedSettings.ts)

例如：

- `permissions.defaultMode = "plan"`

会被构造成：

- `{ permissions: { defaultMode: "plan" } }`

然后交给 `updateSettingsForSource(...)`

这意味着 ConfigTool 的职责是把单键操作变成局部更新对象，而不是自己处理整个深层 merge。

## 19. 部分 setting 写完以后必须立即回流 AppState，否则前台行为不会立刻变

源码镜像：[`../../sources/claude-code/src/tools/ConfigTool/supportedSettings.ts`](../../sources/claude-code/src/tools/ConfigTool/ConfigTool.ts)

注册表里有：

- `appStateKey?: 'verbose' | 'mainLoopModel' | 'thinkingEnabled'`

写入成功后，如果配置项声明了 `appStateKey`，工具会：

- `context.setAppState(...)`

这说明 ConfigTool 不只是改磁盘，它还承担一部分即时 UI/runtime resync。

## 20. `remoteControlAtStartup` 又是另一条专门的即时生效支路，会直接改 bridge 相关 AppState

源码镜像：[`../../sources/claude-code/src/tools/ConfigTool/ConfigTool.ts`](../../sources/claude-code/src/hooks/useReplBridge.tsx)

这个 setting 写完后不会只等 settings 热更新，而是直接：

- 计算 `resolved = getRemoteControlAtStartup()`
- 设置：
  - `replBridgeEnabled`
  - `replBridgeOutboundOnly = false`

注释里也说明了原因：bridge hook 要立即响应，否则 `/remote-control` 和 config tool 会出现“设置改了但桥没动”的不一致。

## 21. `voiceEnabled` 则走第三种即时生效路径：主动 `notifyChange('userSettings')`

源码镜像：[`../../sources/claude-code/src/tools/ConfigTool/ConfigTool.ts`](../../sources/claude-code/src/utils/settings/changeDetector.ts), [`../../sources/claude-code/src/voice/voiceModeEnabled.ts`](../../sources/claude-code/src/voice/voiceModeEnabled.ts)

它不是直接改 AppState 某个字段，而是：

- `settingsChangeDetector.notifyChange('userSettings')`

原因注释也写了：

- 让 `applySettingsChange` 重同步 `AppState.settings`
- 让下一次 `/voice` 读缓存时是最新值

所以 ConfigTool 对不同 setting 的“立即生效”策略是分层的，不是统一一招。

## 22. 前台 UI 故意极简，说明它的重点不是交互，而是把配置变更结果压成一句可继续推理的状态语句

源码镜像：[`../../sources/claude-code/src/tools/ConfigTool/UI.tsx`](../../sources/claude-code/src/tools/ConfigTool/ConfigTool.ts)

UI 协议只有三种：

- getting `<setting>`
- `<setting> = value`
- `Set <setting> to <newValue>`
- 失败时 `Failed: error`

对应的 `tool_result` 也是同样风格：

- `setting = value`
- `Set setting to value`
- `Error: ...`

这说明 ConfigTool 的前台面不是设置面板，而是一个可以嵌入 agent loop 的最小状态回执器。

## 23. 结论：ConfigTool 是一个 registry-driven、source-aware、带即时副作用分流的配置运行时

把整条链收起来，它的真实角色是：

- 用 `SUPPORTED_SETTINGS` 把可暴露的配置空间裁成受控白名单
- 用动态 prompt/option 让工具说明与真实能力面保持同步
- 用 source routing 分开 global config 与 merged settings 写路径
- 用 value coercion / option check / async validation 保护设置写入
- 用 `appStateKey`、bridge 特例、voice change detector 三种路径实现立即生效

所以 `ConfigTool` 不是“给模型一个改设置的后门”，而是一条被严格编目、严格分流、并对即时运行时效果负责的配置控制面。
