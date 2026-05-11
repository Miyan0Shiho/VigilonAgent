# 开发者体验与文档机制专题（Claude Code / OpenClaw / Hermes Agent）

> 范围：CLI help/命令注册与可发现性、onboarding/doctor、自检与失败提示、schema/help 文档化、DX 质量护栏测试、文档站点配置（CONFIG 证据）。  
> 证据规范：每条结论必须包含 Evidence ID（DXD-CC/OC/HA-###），并落到“文件 + 符号（函数/类型/常量）”；证据类型标注 CODE/TEST/CONFIG。

## TL;DR
- **Claude Code**：Help UI/命令发现与 onboarding 组件化，存在“指导/帮助型内置 agent”作为 DX 的一部分。
- **OpenClaw**：把配置 schema 的 help/文档化做成强工程化资产，并用质量测试护栏保证可读性一致。
- **Hermes Agent**：CLI 命令体系与 tips/提示机制较丰富，文档站点配置可作为“文档工程化”证据。

## 对齐维度
| 子维度 | 关注点 |
|---|---|
| CLI help/命令注册 | 信息架构、分类、可发现性、提示 |
| Onboarding/doctor | 环境探测、失败提示、修复路径 |
| 配置自解释 | schema help、默认值说明、模板生成 |
| DX 护栏 | help 质量测试、命令一致性测试、lint gate |
| 文档工程化 | docs site 配置、侧边栏/索引、构建配置（CONFIG） |

---

## Evidence-backed Findings（按项目）

### Claude Code（CC）
> 代码根：`research/sources/claude-code/`

- **DXD-CC-001（CODE）**：Help UI 采用 Tabs 信息架构，把帮助内容拆为 general/commands/custom-commands 三类视图。  
  - 证据：`sources/claude-code/src/components/HelpV2/HelpV2.tsx` → `HelpV2()`：`<Tabs ... defaultTab="general">` + `<Tab key="commands">` + `<Tab key="custom">`

- **DXD-CC-002（CODE）**：Help 会基于 `builtInCommandNames()` 将命令列表分为“内置命令”与“自定义命令”，并隐藏 `isHidden` 命令，保证可发现性与噪声控制。  
  - 证据：`sources/claude-code/src/components/HelpV2/HelpV2.tsx` → `builtinCommands = commands.filter(...)` / `customCommands = commands.filter(...)`

- **DXD-CC-003（CODE）**：Help 对“关闭/取消”提供统一快捷键绑定与显示（esc、Ctrl+C 双击退出等），属于成熟 TUI 的交互细节。  
  - 证据：`sources/claude-code/src/components/HelpV2/HelpV2.tsx` → `useKeybinding("help:dismiss", close, ...)`、`useExitOnCtrlCDWithKeybindings(close)`、`useShortcutDisplay("help:dismiss", ..., "esc")`

- **DXD-CC-004（CODE）**：Help 标题包含版本号，并提供官方文档入口链接，降低“从 UI 找文档”的摩擦。  
  - 证据：`sources/claude-code/src/components/HelpV2/HelpV2.tsx` → `Claude Code v${MACRO.VERSION}`、`Link url="https://code.claude.com/docs/en/overview"`

- **DXD-CC-005（CODE）**：启动阶段对 Node 版本有硬门禁（<18 直接报错退出），避免隐性运行时不兼容。  
  - 证据：`sources/claude-code/src/setup.ts` → `setup(...)`：`process.version ... < 18` → `console.error('requires Node.js 18+')` → `process.exit(1)`

- **DXD-CC-006（CODE）**：启动时支持 UDS messaging server，但受 `--bare`/feature gate 约束，并提供显式 `--messaging-socket-path` 作为“逃生阀”配置。  
  - 证据：`sources/claude-code/src/setup.ts` → `feature('UDS_INBOX')` + `startUdsMessaging(...)`；注释说明 escape hatch

- **DXD-CC-007（CODE）**：启动会捕获 hooks 配置快照并初始化文件变更 watcher，避免“隐式 hook 修改”难以诊断。  
  - 证据：`sources/claude-code/src/setup.ts` → `captureHooksConfigSnapshot()`、`initializeFileChangedWatcher(cwd)`

- **DXD-CC-008（CODE）**：对终端配置（iTerm2/Terminal.app）提供“中断恢复”逻辑，且仅在交互会话执行（避免 print mode 干扰）。  
  - 证据：`sources/claude-code/src/setup.ts` → `if (!getIsNonInteractiveSession()) { checkAndRestoreITerm2Backup(); checkAndRestoreTerminalBackup(); }`

- **DXD-CC-009（CODE）**：worktree 作为 DX 功能，有明确的前置条件：必须在 git repo 或配置 WorktreeCreate hook；错误信息直接指导用户如何修复。  
  - 证据：`sources/claude-code/src/setup.ts` → `if (!hasHook && !inGit) ... "Configure a WorktreeCreate hook in settings.json" ... process.exit(1)`

- **DXD-CC-010（CODE）**：Guide 内置 agent 把“官方文档优先”写入 system prompt，并通过 docs map（URL 列表）引导用 WebFetch 查找最相关页面。  
  - 证据：`sources/claude-code/src/tools/AgentTool/built-in/claudeCodeGuideAgent.ts` → `CLAUDE_CODE_DOCS_MAP_URL` / `CDP_DOCS_MAP_URL`；prompt 中 “Use WebFetch to fetch docs map…”

- **DXD-CC-011（CODE）**：Guide agent 对本地搜索工具做平台兼容适配：embedded search builds 用 `find/grep` 替代 Glob/Grep。  
  - 证据：`sources/claude-code/src/tools/AgentTool/built-in/claudeCodeGuideAgent.ts` → `hasEmbeddedSearchTools()` 分支：tool list 选择 `BASH_TOOL_NAME` vs `GLOB_TOOL_NAME/GREP_TOOL_NAME`

- **DXD-CC-012（CODE）**：Guide agent 会把用户环境“可用自定义技能/自定义 agents/MCP servers/插件技能/用户 settings.json”注入为“当前配置上下文”，提升回答的针对性。  
  - 证据：`sources/claude-code/src/tools/AgentTool/built-in/claudeCodeGuideAgent.ts` → `contextSections` 构建：custom skills、custom agents、mcpClients、pluginCommands、`getSettings_DEPRECATED()` 注入

---

### OpenClaw（OC）
> 代码根：`research/sources/openclaw/`

- **DXD-OC-001（CODE）**：配置文档化以 `FIELD_HELP: Record<string,string>` 作为单一事实源，覆盖 meta/env/wizard/diagnostics/logging/cli/update 等关键域。  
  - 证据：`sources/openclaw/src/config/schema.help.ts` → `export const FIELD_HELP = { ... }`

- **DXD-OC-002（CODE）**：help 文案包含“可操作的运维建议”（例如超时/生产建议/安全建议），体现文档不仅是字段释义而是操作指南。  
  - 证据：`sources/openclaw/src/config/schema.help.ts` 中多处段落式 guidance（例如 `env.shellEnv.timeoutMs`、`logging.redactSensitive`、`update.auto.*`）

- **DXD-OC-003（CODE）**：update 配置项具有明确的字段级帮助（channel/checkOnStart/auto.enabled/stableDelayHours 等），把升级策略直接文档化到 schema。  
  - 证据：`sources/openclaw/src/config/schema.help.ts` → `"update.*"` 系列 keys

- **DXD-OC-004（CODE）**：对敏感字段使用“secret allowlist pragma”注释，提示读者这是密钥类字段，应通过 secret/env 注入管理。  
  - 证据：`sources/openclaw/src/config/schema.help.ts` → `"talk.providers.*.apiKey" ... // pragma: allowlist secret`

- **DXD-OC-005（TEST）**：help/labels 的“根分区完整性”有测试护栏：每个 ROOT_SECTIONS 都必须有 label 与 help。  
  - 证据：`sources/openclaw/src/config/schema.help.quality.test.ts` → `ROOT_SECTIONS` + `it("keeps root section labels and help complete", ...)`

- **DXD-OC-006（TEST）**：help keys 与 labels 必须一一对应（help/label parity），避免文档与 UI 展示脱节。  
  - 证据：`sources/openclaw/src/config/schema.help.quality.test.ts` → `it("keeps labels in parity for all help keys", ...)`

- **DXD-OC-007（TEST）**：对“易混淆字段”强制非短文本解释（minLength gate），保证 DX 质量基线。  
  - 证据：`sources/openclaw/src/config/schema.help.quality.test.ts` → `it("covers the target confusing fields with non-trivial explanations", ...)`（使用 `TARGET_KEYS`）

- **DXD-OC-008（TEST）**：对 enum 类字段，测试要求 help 文案必须包含所有选项 token（避免只给字段名不讲可选值）。  
  - 证据：`sources/openclaw/src/config/schema.help.quality.test.ts` → `it("documents option behavior for enum-style fields", ...)`

- **DXD-OC-009（TEST）**：help 文案必须给出具体示例（path glob、interval），以降低用户试错成本。  
  - 证据：`sources/openclaw/src/config/schema.help.quality.test.ts` → `it("includes concrete examples on path and interval fields", ...)`（断言 `**/*.md`、`5m`、`60m` 等）

- **DXD-OC-010（TEST）**：对 deprecation/migration 也有文档质量测试（例如 cron webhook 迁移与 retention 格式），体现“升级路径可解释”。  
  - 证据：`sources/openclaw/src/config/schema.help.quality.test.ts` → `it("documents cron deprecation, migration, and retention formats", ...)`

- **DXD-OC-011（CODE）**：usage/cost 展示格式化是独立模块，包含 token 计数的人类可读缩写（k/m）与 USD 小额精度策略。  
  - 证据：`sources/openclaw/src/utils/usage-format.ts` → `formatTokenCount(...)`、`formatUsd(...)`

- **DXD-OC-012（CODE）**：模型成本解析强调“热路径避免拖入插件/发现”，通过 `models.json` mtime 缓存与“先本地、后归一化、最后网关 cache”优先级减少 DX 抖动。  
  - 证据：`sources/openclaw/src/utils/usage-format.ts` → `modelsJsonCostCache`、`loadModelsJsonCostIndex()`；`resolveModelCostConfig(...)` 中注释 “do not drag plugin/provider discovery into the hot path”

---

### Hermes Agent（HA）
> 代码根：`research/sources/hermes-agent/`

- **DXD-HA-001（CODE）**：slash commands 以 `COMMAND_REGISTRY` 为单一事实源，CLI help、gateway dispatch、各平台 bot 命令、autocomplete 都从此派生。  
  - 证据：`sources/hermes-agent/hermes_cli/commands.py` 顶部 docstring（single source of truth）+ `COMMAND_REGISTRY`

- **DXD-HA-002（CODE）**：命令定义结构化为 `CommandDef`（category/aliases/args_hint/subcommands/cli_only/gateway_only/config gate），保证可发现性与多表面一致。  
  - 证据：`sources/hermes-agent/hermes_cli/commands.py` → `@dataclass(frozen=True) class CommandDef`

- **DXD-HA-003（CODE）**：允许 prompt_toolkit 缺失的环境仍可 import commands 模块（gateway/test 不依赖 prompt_toolkit），体现 DX 的“可降级可运行”。  
  - 证据：`sources/hermes-agent/hermes_cli/commands.py` → `try import prompt_toolkit ... except ImportError: AutoSuggest=object ...`

- **DXD-HA-004（CODE）**：别名/大小写/是否带斜杠统一在 `resolve_command` 中处理，提升用户输入容错。  
  - 证据：`sources/hermes-agent/hermes_cli/commands.py` → `resolve_command(name)`：`name.lower().lstrip("/")`

- **DXD-HA-005（CODE）**：为兼容旧接口，生成扁平 `COMMANDS` 与分类 `COMMANDS_BY_CATEGORY`，减少外部调用方改造成本。  
  - 证据：`sources/hermes-agent/hermes_cli/commands.py` → `COMMANDS` / `COMMANDS_BY_CATEGORY` 构建循环

- **DXD-HA-006（CODE）**：subcommands 既支持显式枚举，也支持从 `args_hint` 的 pipe 语法自动提取（便于 tab completion）。  
  - 证据：`sources/hermes-agent/hermes_cli/commands.py` → `SUBCOMMANDS` 构建 + `_PIPE_SUBS_RE` fallback

- **DXD-HA-007（CODE）**：gateway 侧“可用命令集合”支持 config gate（`gateway_config_gate`），避免把 CLI-only 命令直接暴露到 gateway。  
  - 证据：`sources/hermes-agent/hermes_cli/commands.py` → `_resolve_config_gates()` / `_is_gateway_available(...)` / `GATEWAY_KNOWN_COMMANDS`

- **DXD-HA-008（CODE）**：gateway help 文案由 registry 生成，并对内部 alias（如 reload_mcp 的 underscore 变体）做过滤，提升帮助信息可读性。  
  - 证据：`sources/hermes-agent/hermes_cli/commands.py` → `gateway_help_lines()`：alias filter `a.replace("-", "_") == cmd.name...`

- **DXD-HA-009（CODE）**：提供“随机 tips”语料库，覆盖 slash commands/flags/config/tools/gateway 等，作为持续 onboarding 机制。  
  - 证据：`sources/hermes-agent/hermes_cli/tips.py` → `TIPS = [...]` 顶部注释（覆盖面声明）

- **DXD-HA-010（CODE）**：tips 抽取函数保留 `exclude_recent` 参数用于未来跨会话去重，体现 UX/DX 的前瞻设计。  
  - 证据：`sources/hermes-agent/hermes_cli/tips.py` → `get_random_tip(exclude_recent: int = 0)` docstring “reserved for future deduplication”

- **DXD-HA-011（CONFIG）**：文档站点使用 docusaurus，启用本地搜索（hashed）、mermaid、sidebars、editUrl，体现文档工程化与可维护性。  
  - 证据：`sources/hermes-agent/website/docusaurus.config.ts` → `themes: @easyops-cn/docusaurus-search-local (hashed)`、`markdown.mermaid`、`sidebarPath`、`editUrl`

- **DXD-HA-012（CONFIG）**：文档信息架构支持可折叠侧边栏与多语言框架（当前 en），并在 navbar/footer 暴露关键入口（Docs/Skills/Community）。  
  - 证据：`sources/hermes-agent/website/docusaurus.config.ts` → `docs.sidebar.hideable/autoCollapseCategories`、`i18n.locales`、`navbar.items`、`footer.links`

---

## Evidence Index（按 ID）
### Claude Code（CC）
- DXD-CC-001：`components/HelpV2/HelpV2.tsx` → Tabs/Tab 结构
- DXD-CC-002：`components/HelpV2/HelpV2.tsx` → builtin/custom 过滤（`builtInCommandNames`）
- DXD-CC-003：`components/HelpV2/HelpV2.tsx` → `useKeybinding` / `useExitOnCtrlCDWithKeybindings`
- DXD-CC-004：`components/HelpV2/HelpV2.tsx` → `Claude Code v${MACRO.VERSION}` + docs Link
- DXD-CC-005：`setup.ts` → Node>=18 gate
- DXD-CC-006：`setup.ts` → `startUdsMessaging` feature gate + bare escape hatch
- DXD-CC-007：`setup.ts` → `captureHooksConfigSnapshot` / `initializeFileChangedWatcher`
- DXD-CC-008：`setup.ts` → terminal backups restore（iTerm2/Terminal.app）
- DXD-CC-009：`setup.ts` → worktree gate（git 或 WorktreeCreate hook）
- DXD-CC-010：`AgentTool/built-in/claudeCodeGuideAgent.ts` → docs map URLs + WebFetch guidance
- DXD-CC-011：`claudeCodeGuideAgent.ts` → embedded search tools 分支（Bash find/grep vs Glob/Grep）
- DXD-CC-012：`claudeCodeGuideAgent.ts` → contextSections（skills/agents/MCP/settings.json）

### OpenClaw（OC）
- DXD-OC-001：`config/schema.help.ts` → `FIELD_HELP`
- DXD-OC-002：`config/schema.help.ts` → 运维指导型 help 文案
- DXD-OC-003：`config/schema.help.ts` → `update.*` help keys
- DXD-OC-004：`config/schema.help.ts` → secret allowlist pragma
- DXD-OC-005：`config/schema.help.quality.test.ts` → ROOT_SECTIONS 完整性测试
- DXD-OC-006：`config/schema.help.quality.test.ts` → help/label parity
- DXD-OC-007：`config/schema.help.quality.test.ts` → TARGET_KEYS 非短解释
- DXD-OC-008：`config/schema.help.quality.test.ts` → enum options 必须在 help 中出现
- DXD-OC-009：`config/schema.help.quality.test.ts` → path/interval 具体示例
- DXD-OC-010：`config/schema.help.quality.test.ts` → deprecation/migration 文档质量测试
- DXD-OC-011：`utils/usage-format.ts` → `formatTokenCount` / `formatUsd`
- DXD-OC-012：`utils/usage-format.ts` → `resolveModelCostConfig`（避免热路径引入插件发现）

### Hermes Agent（HA）
- DXD-HA-001：`hermes_cli/commands.py` → `COMMAND_REGISTRY`（single source of truth）
- DXD-HA-002：`hermes_cli/commands.py` → `CommandDef`
- DXD-HA-003：`hermes_cli/commands.py` → prompt_toolkit optional import fallback
- DXD-HA-004：`hermes_cli/commands.py` → `resolve_command`
- DXD-HA-005：`hermes_cli/commands.py` → `COMMANDS` / `COMMANDS_BY_CATEGORY`
- DXD-HA-006：`hermes_cli/commands.py` → `SUBCOMMANDS` + `_PIPE_SUBS_RE`
- DXD-HA-007：`hermes_cli/commands.py` → `_resolve_config_gates` / `_is_gateway_available`
- DXD-HA-008：`hermes_cli/commands.py` → `gateway_help_lines`
- DXD-HA-009：`hermes_cli/tips.py` → `TIPS`
- DXD-HA-010：`hermes_cli/tips.py` → `get_random_tip(exclude_recent=0)`
- DXD-HA-011：`website/docusaurus.config.ts` → local search + mermaid + editUrl
- DXD-HA-012：`website/docusaurus.config.ts` → sidebar/navbar/footer 信息架构
