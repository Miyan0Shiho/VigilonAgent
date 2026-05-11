# 扩展与生态专题（Claude Code / OpenClaw / Hermes Agent）

> 范围：插件/MCP/skills/providers/channels 等扩展单元，及其边界、生命周期与治理策略。  
> 证据规范：每条结论必须包含 Evidence ID，并落到“文件 + 符号（函数/类型/常量）”。

## TL;DR
- **Claude Code**：以“tools/agents/skills + MCP 动态工具面”形成扩展体系，ToolUseContext 作为统一注入点；Plan Mode/权限体系与扩展面强耦合。
- **OpenClaw**：manifest-first + plugin-sdk/contracts 把扩展边界做成“硬约束”，并以 runtime seam 懒加载控制扩展污染面。
- **Hermes Agent**：工具通过 registry 自注册，toolsets 做能力门控；插件 hook + skills hub/guard 形成“可扩展但受控”的生态。

## 对齐维度
| 子维度 | 关注点 |
|---|---|
| 扩展单元 | plugin/MCP/skills/providers/channels |
| 边界与隔离 | SDK 合同、禁止反向依赖、shadowing 防护 |
| 生命周期 | 发现→加载→注册→启用/禁用→更新 |
| 分发形态 | manifest/entrypoints/目录约定 |
| 治理 | 权限/扫描/allowlist/兼容性策略 |

---

## Evidence-backed Findings（按项目）

### Claude Code（CC）
> 代码根：`research/sources/claude-code/`

- **ECO-CC-001**：MCP 作为一等扩展面，动态连接后可注入工具与资源。  
  - 定义点：`sources/claude-code/src/Tool.ts` → `ToolUseContext.options.mcpClients/mcpResources`  
  - 扩展面：`sources/claude-code/src/services/mcp/`（连接/类型/资源）  

- **ECO-CC-002**：skills 扩展支持 fork 子代理执行，降低主会话上下文污染，并可携带遥测/执行上下文。  
  - 执行点：`sources/claude-code/src/tools/SkillTool/SkillTool.ts` → `executeForkedSkill(...)`  
  - 定义点：`sources/claude-code/src/tools/SkillTool/SkillTool.ts` → `getAllCommands(...)`（含 MCP skills 过滤）  

- **ECO-CC-003**：AgentTool 是扩展入口之一，支持从 agents 目录加载定义（可作为“团队/子代理/内置 agent”生态基础）。  
  - 定义点：`sources/claude-code/src/tools/AgentTool/loadAgentsDir.js`（以实际导出为准）  
  - 执行点：`sources/claude-code/src/tools/AgentTool/agentToolUtils.ts`（工具组装/白名单逻辑）  

- **ECO-CC-004**：ToolUseContext 提供 `refreshTools` 回调用于 MCP 连接后刷新工具面，避免“工具面静态化”。  
  - 定义点：`sources/claude-code/src/Tool.ts` → `ToolUseContext.options.refreshTools?`  
  - 执行点：`sources/claude-code/src/tools.ts`（工具集合组装，结合 refreshTools）  

- **ECO-CC-005**：权限上下文内含“自动化检查/避免弹窗”等字段，扩展面（含 agent/skills）可通过统一权限模型被约束。  
  - 定义点：`sources/claude-code/src/Tool.ts` → `ToolPermissionContext.shouldAvoidPermissionPrompts?` / `awaitAutomatedChecksBeforeDialog?`  
  - 扩展关联：`sources/claude-code/src/tools/AgentTool/agentToolUtils.ts`（含对 plan/exitPlan 允许逻辑）  

- **ECO-CC-006**：SkillTool 仅把“可发现的 MCP skills”纳入命令集合，显式过滤掉普通 MCP prompts，防止模型通过猜测名称绕过 discoverability。  
  - 决策点：`sources/claude-code/src/tools/SkillTool/SkillTool.ts` → `getAllCommands(...)`（`cmd.type === 'prompt' && cmd.loadedFrom === 'mcp'` 过滤）  
  - 执行点：同文件 → `getCommands(getProjectRoot())` 与 `uniqBy([...localCommands, ...mcpSkills], 'name')`  

- **ECO-CC-007**：远程 skill 搜索/加载模块采用 feature gate + conditional require，避免模块级副作用初始化污染主 bundle。  
  - 定义点：`sources/claude-code/src/tools/SkillTool/SkillTool.ts` → `feature('EXPERIMENTAL_SKILL_SEARCH')` / `remoteSkillModules = feature(...) ? require(...) : null`  
  - 设计意图：同文件注释（避免 remoteSkillLoader 引入 module-level memoize/lazySchema 常量导致 side effects）  

- **ECO-CC-008**：skills 通过 fork 子代理执行，并把工具进度（tool_use/tool_result）转译为 `skill_progress`，实现“扩展执行可观测”。  
  - 执行点：`sources/claude-code/src/tools/SkillTool/SkillTool.ts` → `executeForkedSkill(...)` / `onProgress({ type: 'skill_progress', ... })`  
  - 复用：同文件 → `runAgent(...)`（以子代理形式执行 skill）  

- **ECO-CC-009**：agents 的扩展定义支持 JSON/Markdown，并使用 zod schema 校验；agent 还能在 frontmatter 定义专属 MCP server（引用或 inline）。  
  - 定义点：`sources/claude-code/src/tools/AgentTool/loadAgentsDir.ts` → `AgentMcpServerSpec` / `AgentMcpServerSpecSchema` / `AgentJsonSchema`  
  - 执行点：同文件 → `parseAgentFromJson(...)` / `parseAgentFromMarkdown(...)`（agent 定义解析入口）  

- **ECO-CC-010**：agent 级 MCP server 初始化具备“plugin-only customization”锁定策略：对用户自定义 agent 可跳过 MCP，但对 admin-trusted agent 允许。  
  - 决策点：`sources/claude-code/src/tools/AgentTool/runAgent.ts` → `isRestrictedToPluginOnly('mcp')` / `isSourceAdminTrusted(...)`  
  - 执行点：同文件 → `initializeAgentMcpServers(...)`（处理 string 引用与 inline 定义 + cleanup）  

- **ECO-CC-011**：fork subagent 通过构造“字节级一致”的 prompt prefix 最大化缓存命中（扩展执行的性能/成本治理）。  
  - 定义点：`sources/claude-code/src/tools/AgentTool/forkSubagent.ts` → `FORK_PLACEHOLDER_RESULT` / `buildForkedMessages(...)`  
  - 安全护栏：同文件 → `isInForkChild(...)`（防递归 forking）  

- **ECO-CC-012**：agent 可用性与 MCP 配置依赖显式建模（required MCP servers），避免出现“扩展依赖缺失但仍可被选择”的隐性失败。  
  - 定义点：`sources/claude-code/src/tools/AgentTool/loadAgentsDir.ts` → `requiredMcpServers?: string[]`（AgentDefinition 字段）  
  - 执行点：同文件 → `hasRequiredMcpServers(...)` / `filterAgentsByMcpRequirements(...)`  

---

### OpenClaw（OC）
> 代码根：`research/sources/openclaw/`

- **ECO-OC-001**：扩展边界由 repo 级规则显式约束：扩展只能通过 `src/plugin-sdk/*` 与 manifest/contract 进入 core（禁止深导入 core internals）。  
  - 定义点：`sources/openclaw/AGENTS.md`（Plugin and extension boundary 规则）  
  - 执行/护栏：`sources/openclaw/src/plugins/contracts/*.test.ts`（合同测试守护边界）  

- **ECO-OC-002**：runtime registry loader 负责确保 plugin registry 按 scope 被加载，体现“运行时装配”的生态治理策略。  
  - 决策/执行点：`sources/openclaw/src/plugins/runtime/runtime-registry-loader.ts` → `ensurePluginRegistryLoaded(...)`  
  - 定义点：同文件 → `PluginRegistryScope`  

- **ECO-OC-003**：agent runtime 通过 runtime seam 懒加载注入（降低扩展对核心的冷启动污染）。  
  - 执行点：`sources/openclaw/src/plugins/runtime/runtime-agent.ts` → `createRuntimeAgent()`  
  - 机制：同文件 → `createLazyRuntimeModule(...)` / `createLazyRuntimeMethod(...)`  

- **ECO-OC-004**：插件的 memory/runtime 能力按需加载（扩展能力在需要时装配）。  
  - 执行点：`sources/openclaw/src/plugins/memory-runtime.ts` → `ensureMemoryRuntime(...)` / `getActiveMemorySearchManager(...)`  
  - 装配点：`sources/openclaw/src/plugins/loader.js`（以实际入口为准）  

- **ECO-OC-005**：manifest registry 明确区分 plugin origin 并排序归一（config/workspace/global/bundled），用于解决“同一物理插件多来源候选”的一致性问题。  
  - 定义点：`sources/openclaw/src/plugins/manifest-registry.ts` → `PLUGIN_ORIGIN_RANK`  
  - 设计意图：同文件顶部注释（canonicalize identical physical plugin roots）  

- **ECO-OC-006**：PluginManifestRecord 把扩展能力映射到多表面：channels/providers/cliBackends/skills/hooks/settingsFiles/contracts 等。  
  - 定义点：`sources/openclaw/src/plugins/manifest-registry.ts` → `PluginManifestRecord`（字段：`skills`、`hooks`、`providerAuthEnvVars` 等）  
  - 执行点：同文件 → `loadPluginManifestRegistry(...)`（registry 生成入口）  

- **ECO-OC-007**：contracts 的“归属插件”可从 manifest registry 解析出来，并按 origin/兼容路径过滤，形成可治理的扩展生态索引。  
  - 执行点：`sources/openclaw/src/plugins/manifest-registry.ts` → `resolveManifestContractPluginIds(...)`  
  - 执行点：同文件 → `resolveManifestContractPluginIdsByCompatibilityRuntimePath(...)` / `resolveManifestContractOwnerPluginId(...)`  

- **ECO-OC-008**：manifest registry 有短 TTL 缓存（默认 1000ms）以折叠启动过程的 bursty reload，属于“生态加载路径优化”。  
  - 定义点：`sources/openclaw/src/plugins/manifest-registry.ts` → `DEFAULT_MANIFEST_CACHE_MS = 1000`  
  - 执行点：同文件 → `registryCache`（cache state）  

- **ECO-OC-009**：plugin registry 的加载具备 scope 语义（configured-channels/channels/all）与 rank 机制，防止重复加载并支持按需扩展。  
  - 定义点：`sources/openclaw/src/plugins/runtime/runtime-registry-loader.ts` → `PluginRegistryScope` / `pluginRegistryLoaded` / `scopeRank(...)`  
  - 执行点：同文件 → `ensurePluginRegistryLoaded(...)`  

- **ECO-OC-010**：registry loader 支持只加载指定 pluginIds，并用 activation-context 把“配置启用”映射到运行时加载集合。  
  - 执行点：`sources/openclaw/src/plugins/runtime/runtime-registry-loader.ts` → `normalizePluginIdScope(...)` / `withActivatedPluginIds(...)`  
  - 执行点：同文件 → `loadOpenClawPlugins(buildPluginRuntimeLoadOptionsFromValues(...))`  

- **ECO-OC-011**：manifest registry 引入路径安全工具（`isPathInside`/`safeRealpathSync`），用于在插件发现/加载时建立文件系统边界。  
  - 证据点：`sources/openclaw/src/plugins/manifest-registry.ts` → imports：`isPathInside, safeRealpathSync`（来自 `path-safety.ts`）  
  - 执行点：同文件 → `discoverOpenClawPlugins(...)` / `loadPluginManifest(...)`（加载链路入口，后续可补具体调用点）  

- **ECO-OC-012**：manifest contract 列表键是强类型 union（webFetch/webSearch/memoryEmbeddingProviders 等），减少 contract 名称漂移。  
  - 定义点：`sources/openclaw/src/plugins/manifest-registry.ts` → `PluginManifestContractListKey`  
  - 执行点：同文件 → `listContractValues(...)`（统一取值逻辑）  

---

### Hermes Agent（HA）
> 代码根：`research/sources/hermes-agent/`

- **ECO-HA-001**：内置工具生态采用“模块自注册”模式：工具模块 import 时调用 `registry.register()`，registry 提供 schema/handler/toolset/check_fn。  
  - 定义点：`sources/hermes-agent/tools/registry.py` → `discover_builtin_tools(...)` / `_module_registers_tools(...)`  
  - 执行点：`sources/hermes-agent/tools/registry.py` → `ToolRegistry.register(...)`  

- **ECO-HA-002**：toolsets 将“生态能力面”配置化门控，可组合 toolset，决定 agent 的可行动作空间。  
  - 定义点：`sources/hermes-agent/toolsets.py` → `TOOLSETS`（组合/包含关系）  
  - 执行点：`sources/hermes-agent/run_agent.py`（解析 enabled_toolsets/disabled_toolsets，并过滤 valid tools）  

- **ECO-HA-003**：插件系统支持 hook 生命周期，并允许插件注册工具（接入 registry）。  
  - 定义点：`sources/hermes-agent/hermes_cli/plugins.py` → `VALID_HOOKS` / `ENTRY_POINTS_GROUP`  
  - 执行点：同文件 → `PluginContext.register_tool(...)`（委托到 `tools.registry.register`）  

- **ECO-HA-004**：skills 作为生态核心，同时有 guard/scan 策略对扩展内容做安全治理。  
  - 治理点：`sources/hermes-agent/tools/skills_guard.py` → `scan_skill(...)` / `should_allow_install(...)`  
  - 生命周期：`sources/hermes-agent/tools/skill_manager_tool.py`（创建/编辑/安装/扫描）  

- **ECO-HA-005**：插件系统支持三来源：用户插件、项目插件（需 env opt-in）、pip entrypoints（`hermes_agent.plugins` 组）。  
  - 证据点：`sources/hermes-agent/hermes_cli/plugins.py` 顶部 docstring（sources 列表）  
  - 定义点：同文件 → `ENTRY_POINTS_GROUP = "hermes_agent.plugins"`  

- **ECO-HA-006**：目录插件必须提供 `plugin.yaml` manifest 与 `register(ctx)` 入口（扩展单元的最低合同）。  
  - 证据点：`sources/hermes-agent/hermes_cli/plugins.py` 顶部 docstring（requirements）  
  - 定义点：同文件 → `PluginManifest` dataclass  

- **ECO-HA-007**：hook 生命周期是显式枚举集合，覆盖 tool/llm/api/session 的前后与会话生命周期事件。  
  - 定义点：`sources/hermes-agent/hermes_cli/plugins.py` → `VALID_HOOKS`  
  - 执行点：同文件 docstring → `invoke_hook(name, **kwargs)`（由 core 调用）  

- **ECO-HA-008**：registry 支持 `deregister(...)`，并明确用于 MCP 动态 tool discovery 的 nuke-and-repave（工具列表变更时重建）。  
  - 证据点：`sources/hermes-agent/tools/registry.py` → `deregister(...)` docstring（`notifications/tools/list_changed`）  
  - 执行点：同文件 → `ToolRegistry.deregister(...)`（清理 toolset checks 与 aliases）  

- **ECO-HA-009**：MCP 客户端模块是可选依赖，提供 stdio/HTTP 两种 transport，并对 stdio 子进程 env 做过滤（安全扩展面）。  
  - 证据点：`sources/hermes-agent/tools/mcp_tool.py` 顶部 docstring（features/architecture/thread safety）  
  - 定义点：同文件 → `_SAFE_ENV_KEYS` / `_build_safe_env(...)`  

- **ECO-HA-010**：MCP 错误返回在交给 LLM 前会做 credential stripping，降低扩展面泄露密钥风险。  
  - 定义点：`sources/hermes-agent/tools/mcp_tool.py` → `_CREDENTIAL_PATTERN`  
  - 执行点：同文件 → `_sanitize_error(text)`  

- **ECO-HA-011**：Skills Hub 把生态分发抽象为 Source Adapter（`SkillSource`），并维护 quarantine/audit log/lockfile，形成可治理的技能供应链。  
  - 证据点：`sources/hermes-agent/tools/skills_hub.py` 顶部 docstring（GitHubSource/HubLockFile/quarantine/audit log）  
  - 定义点：同文件 → `LOCK_FILE` / `QUARANTINE_DIR` / `AUDIT_LOG` / `TAPS_FILE` / `INDEX_CACHE_TTL`  

- **ECO-HA-012**：Skills Hub 对 bundle-controlled 路径做严格规范化与 traversal 防护，避免技能包写盘越界。  
  - 定义点：`sources/hermes-agent/tools/skills_hub.py` → `_normalize_bundle_path(...)`  
  - 执行点：同文件 → `_validate_skill_name(...)` / `_validate_bundle_rel_path(...)`  

---

## Evidence Index（按 ID）
### Claude Code（CC）
- ECO-CC-001：`src/Tool.ts` → `ToolUseContext.options.mcpClients/mcpResources`
- ECO-CC-002：`src/tools/SkillTool/SkillTool.ts` → `executeForkedSkill`；`utils/forkedAgent.ts` → `prepareForkedCommandContext`
- ECO-CC-003：`src/tools/AgentTool/loadAgentsDir.ts` → agent 定义加载；`src/tools/AgentTool/agentToolUtils.ts`
- ECO-CC-004：`src/Tool.ts` → `refreshTools?`
- ECO-CC-005：`src/Tool.ts` → `ToolPermissionContext.*`（avoid prompts/automated checks）
- ECO-CC-006：`src/tools/SkillTool/SkillTool.ts` → `getAllCommands`
- ECO-CC-007：`src/tools/SkillTool/SkillTool.ts` → `remoteSkillModules` + `feature('EXPERIMENTAL_SKILL_SEARCH')`
- ECO-CC-008：`src/tools/SkillTool/SkillTool.ts` → `onProgress({type:'skill_progress'})`
- ECO-CC-009：`src/tools/AgentTool/loadAgentsDir.ts` → `AgentMcpServerSpecSchema` / `parseAgentFromJson` / `parseAgentFromMarkdown`
- ECO-CC-010：`src/tools/AgentTool/runAgent.ts` → `initializeAgentMcpServers` / `isRestrictedToPluginOnly` / `isSourceAdminTrusted`
- ECO-CC-011：`src/tools/AgentTool/forkSubagent.ts` → `buildForkedMessages` / `FORK_PLACEHOLDER_RESULT` / `isInForkChild`
- ECO-CC-012：`src/tools/AgentTool/loadAgentsDir.ts` → `hasRequiredMcpServers` / `filterAgentsByMcpRequirements`

### OpenClaw（OC）
- ECO-OC-001：`AGENTS.md` + `src/plugin-sdk/*` + `src/plugins/contracts/*`
- ECO-OC-002：`src/plugins/runtime/runtime-registry-loader.ts` → `ensurePluginRegistryLoaded` / `PluginRegistryScope`
- ECO-OC-003：`src/plugins/runtime/runtime-agent.ts` → `createRuntimeAgent` / `createLazyRuntimeModule`
- ECO-OC-004：`src/plugins/memory-runtime.ts` → `ensureMemoryRuntime`
- ECO-OC-005：`src/plugins/manifest-registry.ts` → `PLUGIN_ORIGIN_RANK`
- ECO-OC-006：`src/plugins/manifest-registry.ts` → `PluginManifestRecord`
- ECO-OC-007：`src/plugins/manifest-registry.ts` → `resolveManifestContractPluginIds*`
- ECO-OC-008：`src/plugins/manifest-registry.ts` → `DEFAULT_MANIFEST_CACHE_MS` / `registryCache`
- ECO-OC-009：`src/plugins/runtime/runtime-registry-loader.ts` → `scopeRank` / `pluginRegistryLoaded`
- ECO-OC-010：`src/plugins/runtime/runtime-registry-loader.ts` → `normalizePluginIdScope` / `withActivatedPluginIds`
- ECO-OC-011：`src/plugins/manifest-registry.ts` → imports：`isPathInside` / `safeRealpathSync`
- ECO-OC-012：`src/plugins/manifest-registry.ts` → `PluginManifestContractListKey` / `listContractValues`

### Hermes Agent（HA）
- ECO-HA-001：`tools/registry.py` → `ToolRegistry.register`
- ECO-HA-002：`toolsets.py` → `TOOLSETS`；`run_agent.py` → toolset 过滤
- ECO-HA-003：`hermes_cli/plugins.py` → `PluginContext.register_tool` / `VALID_HOOKS`
- ECO-HA-004：`tools/skills_guard.py` / `tools/skill_manager_tool.py`
- ECO-HA-005：`hermes_cli/plugins.py` 顶部 docstring + `ENTRY_POINTS_GROUP`
- ECO-HA-006：`hermes_cli/plugins.py` → `PluginManifest` + register(ctx) 约束
- ECO-HA-007：`hermes_cli/plugins.py` → `VALID_HOOKS`
- ECO-HA-008：`tools/registry.py` → `deregister`（MCP list_changed）
- ECO-HA-009：`tools/mcp_tool.py` → `_SAFE_ENV_KEYS` / `_build_safe_env`
- ECO-HA-010：`tools/mcp_tool.py` → `_sanitize_error` / `_CREDENTIAL_PATTERN`
- ECO-HA-011：`tools/skills_hub.py` → `LOCK_FILE` / `QUARANTINE_DIR` / `AUDIT_LOG`
- ECO-HA-012：`tools/skills_hub.py` → `_normalize_bundle_path` / `_validate_bundle_rel_path`
