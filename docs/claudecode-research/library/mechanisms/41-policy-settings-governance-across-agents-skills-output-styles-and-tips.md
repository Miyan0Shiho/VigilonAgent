# Policy Settings Governance Across Agents / Skills / Output Styles / Tips

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Policy Settings Runtime Governance`](./40-policy-settings-runtime-governance-across-env-hooks-permissions-mcp-and-plugins.md) | [`下一站：Policy Settings Governance Across Command Discovery / Marketplaces / Recommendation Surfaces`](./42-policy-settings-governance-across-command-discovery-marketplaces-and-recommendation-surfaces.md)

上一卷拆的是 `policySettings` 怎样改写 env、hooks、permissions、MCP、plugins。这一卷继续补它在剩余 capability surface 上的渗透面，重点是：

- managed agents 怎样进入 agent precedence 和 agent-specific MCP gate
- managed skills 怎样进入 skills loader 与 `/skills` 能力目录
- managed output styles 怎样参与 output style 解析
- `statusLine` / `fileSuggestion` 这类 hook-adjacent command surface 怎样受 managed hook policy 控制
- tips / effort nudge 怎样把 `policySettings` 当成 suppressor 或 override

对应源码主链是：`tools/AgentTool/loadAgentsDir.ts + tools/AgentTool/runAgent.ts + tools/AgentTool/agentDisplay.ts + skills/loadSkillsDir.ts + components/skills/SkillsMenu.tsx + constants/outputStyles.ts + utils/hooks.ts + services/tips/tipRegistry.ts`。

## 1. managed agents 不是“额外分类”，而是 agent precedence 链中的正式来源

源码镜像：[`../../src/tools/AgentTool/loadAgentsDir.ts`](../../src/tools/AgentTool/loadAgentsDir.ts), [`../../src/tools/AgentTool/agentDisplay.ts`](../../src/tools/AgentTool/agentDisplay.ts)

`getActiveAgentsFromList()` 会先分组：

- built-in
- plugin
- user
- project
- managed
- flag

然后按这组顺序把同 `agentType` 的定义塞进 map，后写覆盖先写。结果就是：

- managed agents 会覆盖 user/project/plugin/built-in
- flag agents 还可以继续覆盖 managed

这说明 managed agents 在系统里的地位不是“展示层标签”，而是真正参与 active agent 选主链的正式 source。

## 2. `agentDisplay` 把 managed agents 明确建成一等显示组，说明 `/agents` 也承认这层治理来源

源码镜像：[`../../src/tools/AgentTool/agentDisplay.ts`](../../src/tools/AgentTool/agentDisplay.ts)

`AGENT_SOURCE_GROUPS` 里显式有：

- `Managed agents`

并且排在：

- local 之后
- plugin 之前

这意味着 `/agents` 不是把 managed source 混进“custom agents”，而是把它当成 operator 应该看见的独立能力来源层。

## 3. `strictPluginOnlyCustomization('mcp')` 会在 agent-specific MCP 装配时再次仲裁来源

源码镜像：[`../../src/tools/AgentTool/runAgent.ts`](../../src/tools/AgentTool/runAgent.ts), [`../../src/utils/settings/pluginOnlyPolicy.ts`](../../src/utils/settings/pluginOnlyPolicy.ts)

agent frontmatter 里的 `mcpServers` 不是只靠 loader 决定。运行到 `runAgent.ts` 真正装配 agent-specific MCP client 时，还会再判断：

- 当前 surface 是否被 `strictPluginOnlyCustomization('mcp')` 锁住
- 当前 agent source 是否是 admin-trusted

结论是：

- user/project/local agent：会被跳过自己的 frontmatter MCP
- plugin/built-in/policySettings agent：仍被视为 admin-trusted，可以继续装自己的 MCP

也就是说，managed agent 不只是能“被加载”，它在 plugin-only MCP 政策下还会保留 agent-specific MCP 装配权。

## 4. managed skills 不走普通 `~/.claude/skills`，而是走 managed file tree 的专门路径

源码镜像：[`../../src/skills/loadSkillsDir.ts`](../../src/skills/loadSkillsDir.ts)

`getSkillsPath('policySettings', dir)` 返回的不是用户目录，而是：

- `join(getManagedFilePath(), '.claude', dir)`

这说明 managed skills 在磁盘拓扑上就已经与 user/project skills 分层，不是靠 frontmatter 标个 source 就算 managed。

## 5. skills loader 会在正常 skills 加载阶段正式插入 managed skills，而不是事后 merge 补进去

源码镜像：[`../../src/skills/loadSkillsDir.ts`](../../src/skills/loadSkillsDir.ts)

`loadAllSkills` 主链里，managed skills 是跟 user/project/legacy commands 一起并行加载的一个正式分支：

- `loadSkillsFromSkillsDir(managedSkillsDir, 'policySettings')`

并且还有一个独立 gate：

- `CLAUDE_CODE_DISABLE_POLICY_SKILLS`

说明 managed skills 在 Claude Code 里已经被视为 first-class skill source，而不是某种外部补丁目录。

## 6. `strictPluginOnlyCustomization` 也会切断 user/project skills 的目录发现，而 managed skills 不受影响

源码镜像：[`../../src/skills/loadSkillsDir.ts`](../../src/skills/loadSkillsDir.ts), [`../../src/utils/settings/pluginOnlyPolicy.ts`](../../src/utils/settings/pluginOnlyPolicy.ts)

loader 里会先算：

- `skillsLocked = isRestrictedToPluginOnly('skills')`

然后：

- user/project/additional dirs 在 locked 时直接不发现
- legacy `commands` 也一起被阻断
- managed skills 仍然照常加载

所以对 skills 来说，plugin-only policy 的真实语义不是“只允许 plugin skills”，而是“切断 user/project/legacy 自定义来源，但保留 managed source”。

## 7. `/skills` 前台把 managed skills 单独成组，说明当前会话能力目录会直接暴露这层治理来源

源码镜像：[`../../src/components/skills/SkillsMenu.tsx`](../../src/components/skills/SkillsMenu.tsx)

`SkillsMenu` 分组时显式保留：

- `policySettings`

这意味着用户在 `/skills` 里看到的并不是“当前有哪些 prompt command”，而是能直接分辨：

- 哪些能力来自 managed source
- 哪些来自 user/project/plugin/mcp

因此 managed skills 不是隐藏治理层，而是公开可巡航的 capability source。

## 8. output styles 也有 managed source，但它们的优先级不是注释里那句口号，而是实际 group 顺序

源码镜像：[`../../src/constants/outputStyles.ts`](../../src/constants/outputStyles.ts)

`getAllOutputStyles()` 会把 custom styles 分成：

- managed
- user
- project

然后按 `styleGroups = [pluginStyles, userStyles, projectStyles, managedStyles]` 合并。

实际效果是后写覆盖先写，因此：

- managed styles 最终优先级高于 project 和 user
- plugin styles 反而最早写入

这说明 output style 的 managed source 不是展示标签，而是真正参与 style name 冲突解析的覆盖层。

## 9. `statusLine` 和 `fileSuggestion` 不是 generic hook；它们走的是受 managed hook policy 约束的命令面

源码镜像：[`../../src/utils/hooks.ts`](../../src/utils/hooks.ts), [`../../src/utils/hooks/hooksConfigSnapshot.ts`](../../src/utils/hooks/hooksConfigSnapshot.ts)

执行逻辑里先看两层 gate：

- `shouldDisableAllHooksIncludingManaged()`：managed disableAllHooks 直接停
- `shouldAllowManagedHooksOnly()`：只从 `policySettings` 读取 `statusLine` / `fileSuggestion`

也就是说，`statusLine` / `fileSuggestion` 虽然不是 session hook 列表的一部分，但在运行时依然服从同一套 managed hook policy 分义：

- managed disable：全部停
- non-managed disable：只剩 managed command 继续跑

## 10. `statusLine` 和 `fileSuggestion` 说明 managed hook policy 会渗透到“非显式 hooks UI”的交互面

源码镜像：[`../../src/utils/hooks.ts`](../../src/utils/hooks.ts)

这两条命令面本来更像 UI 能力：

- status line：短超时 command，产出一段状态文本
- file suggestion：短超时 command，产出一组候选文件

但它们仍然复用了 managed hook gating。说明 `policySettings` 并不是只控制 `/hooks` 菜单能看到什么，而是会深入影响 REPL 辅助交互面本身。

## 11. tips 系统把 `policySettings.effortLevel` 当成 suppression gate，而不是推荐文案来源

源码镜像：[`../../src/services/tips/tipRegistry.ts`](../../src/services/tips/tipRegistry.ts)

`effort-high-nudge` 的 relevance 判断里非常明确：

- 如果 `getSettingsForSource('policySettings')?.effortLevel !== undefined`
- 直接不提示

这说明 tips 系统把 managed effort 视为“管理员已经决定了默认 effort 策略”，因此不再对用户弹出 `/effort high` 的增长型引导。也就是说，managed source 会 suppress 某些 built-in nudges。

## 12. `statusLine` 的 tips relevance 也在绕开已配置状态，managed settings 可以间接改变 tips 表面

源码镜像：[`../../src/services/tips/tipRegistry.ts`](../../src/services/tips/tipRegistry.ts)

虽然这里直接判断的是：

- `getSettings_DEPRECATED().statusLine === undefined`

但由于 `policySettings.statusLine` 会进入 merged settings，这意味着管理员只要下发 `statusLine`，对应 tips 就会自然被压掉。这里没有专门写 `policySettings` gate，但最终效果仍然是 managed source 改写 tips surface。

## 13. 这组 consumer 共同说明：`policySettings` 还在重写“默认产品提示与目录可见性”

源码镜像：[`../../src/tools/AgentTool/loadAgentsDir.ts`](../../src/tools/AgentTool/loadAgentsDir.ts), [`../../src/skills/loadSkillsDir.ts`](../../src/skills/loadSkillsDir.ts), [`../../src/components/skills/SkillsMenu.tsx`](../../src/components/skills/SkillsMenu.tsx), [`../../src/constants/outputStyles.ts`](../../src/constants/outputStyles.ts), [`../../src/utils/hooks.ts`](../../src/utils/hooks.ts), [`../../src/services/tips/tipRegistry.ts`](../../src/services/tips/tipRegistry.ts)

和上一卷相比，这一组 consumer 更偏“产品面”：

- agents/skills：决定哪些能力来源会出现在目录和 precedence 链里
- output styles：决定同名风格最后谁赢
- statusLine/fileSuggestion：决定 REPL 辅助命令面是否只剩 managed 版本
- tips：决定默认增长提示是否还应该出现

因此 `policySettings` 在这里不只是治理后台安全边界，而是在直接重写用户可见的能力目录、默认引导和交互反馈。

## 14. 为什么这条链值得单独成卷

如果只看上一卷，会以为 `policySettings` 主要影响安全/权限/扩展加载。但这一卷补出来的事实是：它同样深度介入了产品层面的 capability presentation。

具体来说：

- managed agents 和 managed skills 会成为正式的能力来源层
- plugin-only policy 会切掉 user/project 自定义能力，但保留 managed/admin-trusted 能力
- managed output styles 会在同名冲突中最终胜出
- managed hook policy 会继续控制 statusLine / fileSuggestion 这种 hook-adjacent surface
- managed effort/statusLine 会反过来 suppress 内建 tips

所以 `policySettings` 的真实范围不只是一组“管理员限制”，而是已经深到 Claude Code 怎样展示能力、怎样推荐默认动作、以及哪些辅助交互还会出现。
