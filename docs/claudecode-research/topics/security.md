# 安全与权限模型专题（Claude Code / OpenClaw / Hermes Agent）

> 范围：运行时执行面 + 密钥/认证 + 扩展边界治理（不强制覆盖供应链/遥测）。  
> 证据规范：每条结论必须包含 Evidence ID，并落到“文件 + 符号（函数/类型/常量）”。

## TL;DR
- **Claude Code**：以“权限模式 + 规则匹配 + 路径/工具 gate + 审批 UI”组成细粒度授权体系，Bash/文件类工具有明确安全层与只读/路径校验。
- **OpenClaw**：以“控制面安全”为核心，HTTP surface 默认 deny 高风险工具，并以审计模块与 SecretRef 语义系统化约束执行面。
- **Hermes Agent**：以“审批/危险命令识别 + 路径安全 + skills 安全扫描 +（可选）插件 pre-hook block”构成运行时防线，同时具备并发执行下的隔离策略。

## 对齐维度
| 子维度 | 关注点 |
|---|---|
| AuthN | token/password/trusted-proxy/oauth 等 |
| AuthZ | allow/deny/ask、模式切换、规则来源、目录范围 |
| 高风险执行面 | shell/fs_write/patch/session orchestration |
| 审批交互 | 同步/异步审批、默认策略、拒绝追踪 |
| 密钥与敏感信息 | SecretRef、脱敏、来源限制 |
| 审计与健康检查 | audit、风险提示、日志 |

---

## Evidence-backed Findings（按项目）

### Claude Code（CC）
> 代码根：`research/sources/claude-code/`

#### AuthZ / 执行面控制
- **SEC-CC-001**：权限上下文把“模式 + 规则集合 + 目录范围 + 自动化策略”建模为强类型对象，作为工具执行的统一输入。  
  - 定义点：`sources/claude-code/src/Tool.ts` → `ToolPermissionContext`  
  - 执行点：`sources/claude-code/src/Tool.ts` → `ToolUseContext.options.*`（工具/权限注入）  

- **SEC-CC-002**：Bash 工具存在独立的安全检查层，包含对危险命令与命令替换模式的显式规则集合。  
  - 定义点：`sources/claude-code/src/tools/BashTool/bashSecurity.ts` → `COMMAND_SUBSTITUTION_PATTERNS` / `ZSH_DANGEROUS_COMMANDS` / `BASH_SECURITY_CHECK_IDS`  
  - 执行点：`sources/claude-code/src/tools/BashTool/BashTool.tsx`（Bash 工具主实现，调用安全检查与权限）  

- **SEC-CC-003**：Bash 工具对“破坏性命令”存在专门的警告与校验逻辑（安全 UX）。  
  - 定义点：`sources/claude-code/src/tools/BashTool/destructiveCommandWarning.ts`  
  - 执行点：`sources/claude-code/src/tools/BashTool/commandSemantics.ts`（命令语义分类）  

- **SEC-CC-004**：文件编辑/写入工具与“只读/写入权限”分离建模（读写工具拆分）。  
  - 定义点：`sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`  
  - 定义点：`sources/claude-code/src/tools/FileEditTool/FileEditTool.ts` / `types.ts`  

#### 审批交互 / 计划 gate（与安全耦合）
- **SEC-CC-005**：Plan Mode 退出需要用户批准（将高风险执行前置到明确审批 gate）。  
  - 定义点：`sources/claude-code/src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts`  
  - 执行点：`sources/claude-code/src/components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx`（审批 UI）  

- **SEC-CC-006**：计划内容在远程会话可被 snapshot 到 transcript，降低“压缩/断线导致计划丢失”带来的执行偏移风险。  
  - 定义点：`sources/claude-code/src/utils/plans.ts` → `persistFileSnapshotIfRemote()`  
  - 执行点：`sources/claude-code/src/utils/plans.ts` → `recoverPlanFromMessages(...)`  

#### 可补充（待执行阶段按符号细化，保持每项目>=12）
- **SEC-CC-007**：权限规则匹配与“向用户发起权限请求”的提示文案生成被显式实现为可复用函数。  
  - 决策点：`sources/claude-code/src/utils/permissions/permissions.ts` → `toolMatchesRule(...)` / `getDenyRuleForTool(...)` / `getAskRuleForTool(...)`  
  - 执行点：同文件 → `createPermissionRequestMessage(...)`  

- **SEC-CC-008**：路径写入授权包含“沙箱写入 allowlist + 多层校验”，并提供统一的 `validatePath(...)` 入口。  
  - 定义/决策点：`sources/claude-code/src/utils/permissions/pathValidation.ts` → `isPathInSandboxWriteAllowlist(...)` / `isPathAllowed(...)`  
  - 执行点：同文件 → `validatePath(...)`（结合 glob 校验与危险路径判断）  

- **SEC-CC-009**：对“连续拒绝/连续成功”有状态追踪，并在达到阈值时切换到 prompting 以降低误拒绝导致的卡死。  
  - 定义点：`sources/claude-code/src/utils/permissions/denialTracking.ts` → `DENIAL_LIMITS` / `DenialTrackingState`  
  - 决策点：同文件 → `recordDenial(...)` / `recordSuccess(...)` / `shouldFallbackToPrompting(...)`  

- **SEC-CC-010**：权限规则存在“不可达/被遮蔽”检测，避免规则顺序/来源导致的误授权或误拒绝。  
  - 定义点：`sources/claude-code/src/utils/permissions/shadowedRuleDetection.ts` → `UnreachableRule` / `DetectUnreachableRulesOptions`  
  - 执行点：同文件 → `detectUnreachableRules(...)`  

- **SEC-CC-011**：权限模式（external/internal）是显式枚举与类型系统的一部分，降低模式漂移与隐式行为。  
  - 定义点：`sources/claude-code/src/types/permissions.ts` → `EXTERNAL_PERMISSION_MODES` / `INTERNAL_PERMISSION_MODES` / `PermissionMode`  
  - 关联：同文件 → `ToolPermissionContext`（权限上下文主结构）  

- **SEC-CC-012**：Bash 执行权限与模式校验被拆成独立模块，体现“执行前 gate”而非单点判断。  
  - 决策点：`sources/claude-code/src/tools/BashTool/bashPermissions.ts`（Bash 权限判定/规则落点）  
  - 执行点：`sources/claude-code/src/tools/BashTool/modeValidation.ts`（Bash mode 校验）  

---

### OpenClaw（OC）
> 代码根：`research/sources/openclaw/`

#### 高风险执行面控制（默认 deny）
- **SEC-OC-001**：Gateway HTTP 工具调用面默认 deny 一组高风险工具（RCE/文件破坏/会话编排）。  
  - 定义点：`sources/openclaw/src/security/dangerous-tools.ts` → `DEFAULT_GATEWAY_HTTP_TOOL_DENY`  
  - 语义：列表中包含 `shell` / `fs_write` / `apply_patch` / `sessions_spawn` / `cron` 等  

#### 审计与健康检查
- **SEC-OC-002**：安全审计模块会收集 filesystem findings，并对结果做缓存，避免重复深审计带来的成本。  
  - 执行点：`sources/openclaw/src/security/audit.ts` → `collectFilesystemFindings(...)`  
  - 定义/缓存：`sources/openclaw/src/security/audit.ts` → `codeSafetySummaryCache`  

#### AuthN（网关认证）
- **SEC-OC-003**：网关连接授权统一由 auth 模块决策（集中式 AuthN gate）。  
  - 决策点：`sources/openclaw/src/gateway/auth.ts` → `resolveGatewayAuth(...)`（及相关授权函数）  
  - 执行点：`sources/openclaw/src/plugins/runtime/gateway-request-scope.ts`（如涉及 request scope 校验可补证据）  

#### 密钥与敏感信息（SecretRef 语义）
- **SEC-OC-004**：密钥输入与解析以 `SecretRef` 语义建模，明确区分“引用/已解析”，并提供强校验函数。  
  - 定义点：`sources/openclaw/src/config/types.secrets.ts` → `SecretRef`  
  - 决策/校验点：`sources/openclaw/src/config/types.secrets.ts` → `assertSecretInputResolved(...)` / `resolveSecretInputString(...)`  

#### 可补充（待执行阶段按符号细化，保持每项目>=12）
- **SEC-OC-005**：安全审计对重型依赖与 probe 依赖采用懒加载 Promise 缓存，减少冷启动副作用并避免重复 import。  
  - 定义点：`sources/openclaw/src/security/audit.ts` → `gatewayProbeDepsPromise` / `pluginRegistryLoaderModulePromise`  
  - 执行点：同文件 → `loadGatewayProbeDeps()` / `loadPluginRegistryLoaderModule()`  

- **SEC-OC-006**：文件系统权限审计对 state/config 路径做 world-writable/group-writable/symlink 检查，并给出 remediation 文案。  
  - 执行点：`sources/openclaw/src/security/audit.ts` → `collectFilesystemFindings(...)`  
  - 证据点：同文件 → `inspectPathPermissions(...)` / `formatPermissionRemediation(...)`（来自 `audit-fs.ts`）  

- **SEC-OC-007**：网关认证支持多模式并显式互斥校验（例如 trusted-proxy 与 token auth 互斥），避免“同时开启导致绕过”。  
  - 定义点：`sources/openclaw/src/gateway/auth.ts` → `ResolvedGatewayAuthMode = "none" | "token" | "password" | "trusted-proxy"`  
  - 决策点：同文件 → `authorizeGatewayConnect(...)` / `authorizeGatewayConnectCore(...)` / `authorizeTrustedProxy(...)`  

- **SEC-OC-008**：provider 级环境变量候选集合集中维护，并对 workspace 插件的“可信度”做决策，限制不可信插件注入 env candidates。  
  - 定义点：`sources/openclaw/src/secrets/provider-env-vars.ts` → `CORE_PROVIDER_AUTH_ENV_VAR_CANDIDATES` / `PROVIDER_AUTH_ENV_VAR_CANDIDATES` / `PROVIDER_ENV_VARS`  
  - 决策点：同文件 → `shouldUsePluginProviderEnvVars(...)` / `isWorkspacePluginTrustedForProviderEnvVars(...)`  

- **SEC-OC-009**：高风险工具 denylist 顶部注释明确其目的：防止 gateway 限制与 security audits 漂移（集中治理）。  
  - 定义点：`sources/openclaw/src/security/dangerous-tools.ts` → 顶部注释  
  - 执行点：同文件 → `DEFAULT_GATEWAY_HTTP_TOOL_DENY`  

- **SEC-OC-010**：HTTP surface 明确禁止 interactive flows（例如 `whatsapp_login`），将“交互式安全风险”作为工具层策略。  
  - 定义点：`sources/openclaw/src/security/dangerous-tools.ts` → `DEFAULT_GATEWAY_HTTP_TOOL_DENY`（含 `whatsapp_login`）  
  - 语义：同文件注释说明“non-interactive HTTP surface”约束  

- **SEC-OC-011**：审计链路显式纳入 exec approvals（执行许可文件）与 interpreter-like allowlist 语义，属于“执行面授权”的工程化组件。  
  - 证据点：`sources/openclaw/src/security/audit.ts` → `loadExecApprovals` / `ExecApprovalsFile`（来自 `infra/exec-approvals.ts`）  
  - 证据点：同文件 → `isInterpreterLikeAllowlistPattern`（来自 `infra/exec-inline-eval.ts`）  

- **SEC-OC-012**：任务投递策略在“避免重复通知/抑制重复交付”上具备明确逻辑，可视为对执行状态泄露/噪声的安全性优化。  
  - 定义/决策点：`sources/openclaw/src/tasks/task-executor-policy.ts` → `shouldSuppressDuplicateTerminalDelivery(...)`  
  - 执行点：同文件 → `shouldAutoDeliverTaskTerminalUpdate(...)` / `shouldAutoDeliverTaskStateChange(...)`  

---

### Hermes Agent（HA）
> 代码根：`research/sources/hermes-agent/`

#### 审批与危险命令识别
- **SEC-HA-001**：危险命令识别使用显式正则/模式集合，并在工具执行前用于审批 gate。  
  - 定义点：`sources/hermes-agent/tools/approval.py` → `DANGEROUS_PATTERNS` / `SUSPICIOUS_PATTERNS`（以实际为准）  
  - 决策点：`sources/hermes-agent/tools/approval.py` → `detect_dangerous_command(...)`  

#### 路径安全（防 traversal/越界）
- **SEC-HA-002**：路径安全模块提供 traversal 检测与“限定目录内”校验，作为文件工具的执行前 gate。  
  - 定义点：`sources/hermes-agent/tools/path_security.py` → `has_traversal_component(...)`  
  - 决策点：`sources/hermes-agent/tools/path_security.py` → `validate_within_dir(...)`  

#### skills 扩展面的安全治理
- **SEC-HA-003**：skills 安全扫描包含威胁模式库与安装策略（把“扩展面”纳入安全模型）。  
  - 定义点：`sources/hermes-agent/tools/skills_guard.py` → `THREAT_PATTERNS` / `INSTALL_POLICY`  
  - 执行点：`sources/hermes-agent/tools/skills_guard.py` → `scan_skill(...)` / `should_allow_install(...)`  

- **SEC-HA-004**：skill 管理工具在保存/安装前会触发安全扫描（安全前置到技能生命周期）。  
  - 执行点：`sources/hermes-agent/tools/skill_manager_tool.py` → `_security_scan_skill(...)`  
  - 关联：`sources/hermes-agent/tools/skills_guard.py`（扫描规则来源）  

#### 并发执行下的安全/稳定性护栏（执行系统层）
- **SEC-HA-005**：并行工具执行对写文件/patch 会做 checkpoint，降低误操作的不可逆风险。  
  - 决策点：`sources/hermes-agent/run_agent.py` → `_execute_tool_calls_concurrent(...)`（`function_name in ("write_file", "patch")` 分支）  
  - 执行点：`sources/hermes-agent/tools/checkpoint_manager.py`（checkpoint 实现，以实际接口为准）  

- **SEC-HA-006**：工具调用前支持插件 hook 进行阻断（pre-tool-call block），形成可扩展的安全拦截面。  
  - 决策点：`sources/hermes-agent/run_agent.py` → `_invoke_tool(...)` → `get_pre_tool_call_block_message(...)`  
  - 扩展点：`sources/hermes-agent/hermes_cli/plugins.py`（hook 机制）  

#### 可补充（待执行阶段按符号细化，保持每项目>=12）
- **SEC-HA-007**：工具注册显式拒绝“shadow existing tool”，阻止插件/MCP 覆写内置工具（除非 MCP→MCP 刷新）。  
  - 决策点：`sources/hermes-agent/tools/registry.py` → `ToolRegistry.register(...)`（shadowing 检查）  
  - 证据点：同文件 → `existing = self._tools.get(name)` 分支（允许 MCP-to-MCP overwrite，拒绝其他覆盖）  

- **SEC-HA-008**：approval 体系使用 `contextvars` 维护审批会话 key，确保并发/多会话场景下审批回调不串线。  
  - 定义点：`sources/hermes-agent/tools/approval.py` → `_approval_session_key: contextvars.ContextVar[str]`  
  - 执行点：同文件 → `set_current_session_key(...)` / `reset_current_session_key(...)`  

- **SEC-HA-009**：破坏性 terminal 命令识别采用预编译正则集合，并在执行前触发 checkpoint（执行面安全 gate）。  
  - 定义点：`sources/hermes-agent/run_agent.py` → `_DESTRUCTIVE_PATTERNS`  
  - 决策点：同文件 → `_is_destructive_command(...)`（在并行/顺序执行路径均会用到）  

- **SEC-HA-010**：skills 写入面通过“允许子目录白名单 + traversal 检测 + resolve-within-dir”组合约束，降低写任意文件风险。  
  - 定义点：`sources/hermes-agent/tools/skill_manager_tool.py` → `ALLOWED_SUBDIRS` / `_validate_file_path(...)`  
  - 执行点：同文件 → `_resolve_skill_target(...)`（调用 `validate_within_dir(...)`）  

- **SEC-HA-011**：skills 安全策略包含来源信任等级与安装策略矩阵，明确将“社区技能”置于更严格的默认拒绝。  
  - 定义点：`sources/hermes-agent/tools/skills_guard.py` → `TRUSTED_REPOS` / `INSTALL_POLICY` / `VERDICT_INDEX`  
  - 决策点：同文件 → `should_allow_install(...)`（按 trust_level+verdict 决策 allow/block/ask）  

- **SEC-HA-012**：依赖版本在 pyproject 中被显式 pin 到“已知安全范围”，并带 CVE 注释，体现运行环境层的安全工程化。  
  - 证据点：`sources/hermes-agent/pyproject.toml` → “pinned to known-good ranges”注释  
  - 证据点：同文件 → `requests>=2.33.0,<3  # CVE-2026-25645` / `PyJWT[crypto]>=2.12.0,<3  # CVE-2026-32597`  

---

## Evidence Index（按 ID）
> 便于快速审计：按 Evidence ID 汇总“文件 → 符号”。

### Claude Code（CC）
- SEC-CC-001：`src/Tool.ts` → `ToolPermissionContext` / `ToolUseContext`
- SEC-CC-002：`src/tools/BashTool/bashSecurity.ts` → `COMMAND_SUBSTITUTION_PATTERNS` / `ZSH_DANGEROUS_COMMANDS` / `BASH_SECURITY_CHECK_IDS`；`src/tools/BashTool/BashTool.tsx`
- SEC-CC-003：`src/tools/BashTool/destructiveCommandWarning.ts`；`src/tools/BashTool/commandSemantics.ts`
- SEC-CC-004：`src/tools/FileReadTool/FileReadTool.ts`；`src/tools/FileEditTool/FileEditTool.ts`
- SEC-CC-005：`src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts`；`src/components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx`
- SEC-CC-006：`src/utils/plans.ts` → `persistFileSnapshotIfRemote` / `recoverPlanFromMessages`
- SEC-CC-007：`src/utils/permissions/permissions.ts` → `createPermissionRequestMessage` / `toolMatchesRule` / `getDenyRuleForTool` / `getAskRuleForTool`
- SEC-CC-008：`src/utils/permissions/pathValidation.ts` → `isPathInSandboxWriteAllowlist` / `isPathAllowed` / `validatePath`
- SEC-CC-009：`src/utils/permissions/denialTracking.ts` → `DENIAL_LIMITS` / `recordDenial` / `recordSuccess` / `shouldFallbackToPrompting`
- SEC-CC-010：`src/utils/permissions/shadowedRuleDetection.ts` → `detectUnreachableRules`
- SEC-CC-011：`src/types/permissions.ts` → `EXTERNAL_PERMISSION_MODES` / `INTERNAL_PERMISSION_MODES` / `PermissionMode`
- SEC-CC-012：`src/tools/BashTool/bashPermissions.ts`；`src/tools/BashTool/modeValidation.ts`

### OpenClaw（OC）
- SEC-OC-001：`src/security/dangerous-tools.ts` → `DEFAULT_GATEWAY_HTTP_TOOL_DENY`
- SEC-OC-002：`src/security/audit.ts` → `collectFilesystemFindings` / `codeSafetySummaryCache`
- SEC-OC-003：`src/gateway/auth.ts` → `resolveGatewayAuth` / `authorizeGatewayConnect` / `authorizeTrustedProxy`
- SEC-OC-004：`src/config/types.secrets.ts` → `SecretRef` / `assertSecretInputResolved` / `resolveSecretInputString`
- SEC-OC-005：`src/security/audit.ts` → `gatewayProbeDepsPromise` / `loadGatewayProbeDeps`
- SEC-OC-006：`src/security/audit.ts` → `inspectPathPermissions` / `formatPermissionRemediation`
- SEC-OC-007：`src/gateway/auth.ts` → `ResolvedGatewayAuthMode`（union）+ trusted-proxy 互斥检查
- SEC-OC-008：`src/secrets/provider-env-vars.ts` → `PROVIDER_AUTH_ENV_VAR_CANDIDATES` / `shouldUsePluginProviderEnvVars`
- SEC-OC-009：`src/security/dangerous-tools.ts` 顶部“避免漂移”的注释 + `DEFAULT_GATEWAY_HTTP_TOOL_DENY`
- SEC-OC-010：`src/security/dangerous-tools.ts` → deny interactive flow（`whatsapp_login`）
- SEC-OC-011：`src/security/audit.ts` → `loadExecApprovals` / `isInterpreterLikeAllowlistPattern`
- SEC-OC-012：`src/tasks/task-executor-policy.ts` → `shouldSuppressDuplicateTerminalDelivery` / `shouldAutoDeliverTaskTerminalUpdate`

### Hermes Agent（HA）
- SEC-HA-001：`tools/approval.py` → `DANGEROUS_PATTERNS` / `detect_dangerous_command`
- SEC-HA-002：`tools/path_security.py` → `has_traversal_component` / `validate_within_dir`
- SEC-HA-003：`tools/skills_guard.py` → `THREAT_PATTERNS` / `INSTALL_POLICY` / `scan_skill` / `should_allow_install`
- SEC-HA-004：`tools/skill_manager_tool.py` → `_security_scan_skill`
- SEC-HA-005：`run_agent.py` → checkpoint 分支（`function_name in ("write_file","patch")`）+ `tools/checkpoint_manager.py`
- SEC-HA-006：`run_agent.py` → `_invoke_tool` + `hermes_cli/plugins.py` → `get_pre_tool_call_block_message`
- SEC-HA-007：`tools/registry.py` → `ToolRegistry.register`（shadowing 拒绝逻辑）
- SEC-HA-008：`tools/approval.py` → `_approval_session_key` / `set_current_session_key` / `reset_current_session_key`
- SEC-HA-009：`run_agent.py` → `_DESTRUCTIVE_PATTERNS` / `_is_destructive_command`
- SEC-HA-010：`tools/skill_manager_tool.py` → `ALLOWED_SUBDIRS` / `_validate_file_path` / `_resolve_skill_target`
- SEC-HA-011：`tools/skills_guard.py` → `TRUSTED_REPOS` / `INSTALL_POLICY` / `should_allow_install`
- SEC-HA-012：`pyproject.toml` → 依赖 pin + CVE 注释（`requests`、`PyJWT`）
