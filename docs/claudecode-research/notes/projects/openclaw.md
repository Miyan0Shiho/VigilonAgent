# OpenClaw 关键文件索引（聚焦：规划/执行机制）

> 代码根目录：`research/sources/openclaw/`

## 1) 入口与整体边界（先读这个）
- `AGENTS.md`：仓库结构与边界约束的“总地图”（强烈建议先读）
- `src/cli/`：CLI wiring（命令行入口/子命令入口）
- `src/commands/`：CLI 命令实现（例如 onboard / gateway / channels / doctor 等）
- `src/provider-web.ts`：Web provider（LLM/工具对接中的一个关键 provider 面）

## 2) 任务系统（任务=执行单元；支撑“后台执行/并行/通知”）
- `src/tasks/task-executor.ts`：任务运行生命周期 API（queued/running/terminal；one-task flow 绑定）
- `src/tasks/task-registry.ts`：任务注册表（内存 Map + 持久化快照 + 观察者事件 + delivery 状态）
- `src/tasks/task-flow-runtime-internal.ts`、`src/tasks/task-flow-registry.*`：任务 flow（父子任务、取消、revision）
- `src/tasks/task-executor-policy.ts`：任务状态变更/终态的投递策略（什么时候通知、怎么去重）

## 3) 规划（Plan）与执行（Execute）在“系统运行”层的表征
- `src/test-utils/system-run-prepare-payload.ts`：构建 system.run 的“plan payload”（argv/cwd/preview 等）
  - 关键字段：`payload.plan.argv`、`payload.plan.cwd`、`payload.plan.commandText`
- `src/utils/transcript-tools.ts`：transcript 工具（会话记录与证据链，便于审计/复盘）

## 4) 工具风险与权限边界（安全=执行机制的一部分）
- `src/security/dangerous-tools.ts`：高风险工具 denylist（例如 `shell`、`fs_write`、`apply_patch`、`sessions_spawn` 等）
- `src/security/audit.ts`：安全审计相关逻辑（建议与危险工具表一起读）

## 5) 插件/扩展架构（决定“工具/能力”如何动态注入）
- `src/plugins/`：插件发现、manifest 校验、loader/registry、契约约束
- `src/plugin-sdk/`：对第三方/扩展公开的 SDK 合同（extension 只能通过这里进入 core）
- `docs/plugins/`：插件体系文档（architecture/manifest/sdk-overview 等）

## 6) UI/TUI 的执行反馈（可观测性）
- `src/tui/`：终端 UI（会话流、事件处理、命令处理、主题）
- `src/tui/components/tool-execution.ts`：工具执行可视化（对“执行链路”观测很关键）

---

## 0) 10 分钟跳读路线（新增专题：安全/生态/交互/优化/发布/文档/隐私/评测）
- 安全（Security）：  
  1) `src/security/dangerous-tools.ts`（denylist）  
  2) `src/security/audit.ts`（审计与懒加载/缓存）  
  3) `src/gateway/auth.ts`（多模式 AuthN/AuthZ）  
  4) `src/config/types.secrets.ts` + `src/secrets/provider-env-vars.ts`（SecretRef/环境变量治理）
- 扩展（Ecosystem）：  
  1) `AGENTS.md`（边界与约束总地图）  
  2) `src/plugin-sdk/*`（公开合同）  
  3) `src/plugins/runtime/runtime-registry-loader.ts`（scope 加载）  
  4) `src/plugins/manifest-registry.ts`（manifest registry/contract 索引）
- 交互（UX）：  
  1) `src/tui/components/tool-execution.ts`（工具输出/preview/容错）  
  2) `src/tui/tui-status-summary.ts`（状态摘要）  
  3) `src/tasks/task-executor-policy.ts`（用户通知策略）  
  4) `src/wizard/setup.ts`（onboarding）
- 优化（Optimizations）：  
  1) `scripts/bench-cli-startup.ts`  
  2) `scripts/bench-model.ts`  
  3) `src/security/audit.ts`（module promise cache）  
- 发布（Release）：  
  1) `src/infra/update-check.ts`  
  2) `src/infra/update-package-manager.ts`  
  3) `src/infra/update-global.ts`
- 文档与 DX（DX+Docs）：  
  1) `src/config/schema.help.ts`  
  2) `src/config/schema.help.quality.test.ts`  
  3) `src/utils/usage-format.ts`
- 隐私与遥测（Privacy+Telemetry）：  
  1) `src/logging/redact.ts`  
  2) `src/secrets/runtime-config-collectors-core.ts`  
  3) `src/plugin-sdk/diagnostics-otel.ts`
- 评测与基准（Evaluation+Benchmarks）：  
  1) `scripts/bench-cli-startup.ts`  
  2) `scripts/bench-model.ts`  
  3) `extensions/qa-lab/src/agentic-parity-report.ts`

---

## 9) 安全与权限模型（Security）
专题文档：`research/topics/security.md`（Evidence IDs：SEC-OC-001 ~ SEC-OC-012）

关键文件（建议阅读顺序）：
1) `src/security/dangerous-tools.ts`（`DEFAULT_GATEWAY_HTTP_TOOL_DENY`）  
2) `src/security/audit.ts`（`collectFilesystemFindings`、`loadGatewayProbeDeps`、cache）  
3) `src/gateway/auth.ts`（`authorizeGatewayConnect*`，trusted-proxy 互斥校验）  
4) `src/config/types.secrets.ts`（`SecretRef` 与校验）  
5) `src/secrets/provider-env-vars.ts`（workspace 插件信任决策）  

---

## 10) 扩展与生态（Ecosystem）
专题文档：`research/topics/ecosystem.md`（Evidence IDs：ECO-OC-001 ~ ECO-OC-012）

关键文件（建议阅读顺序）：
1) `AGENTS.md`（边界规则）  
2) `src/plugins/runtime/runtime-registry-loader.ts`（`ensurePluginRegistryLoaded` / `PluginRegistryScope`）  
3) `src/plugins/manifest-registry.ts`（`PluginManifestRecord` / `resolveManifestContractPluginIds*`）  
4) `src/plugin-sdk/*`（对外合同）  
5) `src/plugins/contracts/*`（合同测试护栏）  

---

## 11) 产品与交互（UX）
专题文档：`research/topics/ux.md`（Evidence IDs：UX-OC-001 ~ UX-OC-012）

关键文件（建议阅读顺序）：
1) `src/tui/components/tool-execution.ts`（ToolExecutionComponent）  
2) `src/tui/tui-event-handlers.ts` + `*.test.ts`（交互规格）  
3) `src/tui/tui-status-summary.ts`（状态摘要）  
4) `src/tasks/task-executor-policy.ts`（通知策略/去重）  
5) `src/wizard/setup.ts`（setup wizard）  

---

## 12) 优化细节（Optimizations）
专题文档：`research/topics/optimizations.md`（Evidence IDs：OPT-OC-001 ~ OPT-OC-012）

关键文件（建议阅读顺序）：
1) `scripts/bench-cli-startup.ts`（启动 bench）  
2) `scripts/bench-model.ts`（模型延迟 bench）  
3) `src/security/audit.ts`（module promise cache；filesystem 审计）  
4) `src/secrets/provider-env-vars.ts`（lazy record + Proxy）  
5) `src/plugins/runtime/runtime-registry-loader.ts`（scope early return）  

---

## 13) 版本/发布/分发（Release）
专题文档：`research/topics/release.md`（Evidence IDs：REL-OC-001 ~ REL-OC-012）

关键文件（建议阅读顺序）：
1) `src/infra/update-check.ts`（installKind/git/deps/registry status）  
2) `src/infra/update-channels.ts`（channel 与 npm tag 规则）  
3) `src/infra/update-package-manager.ts`（corepack/bootstrap pnpm、compat fallback）  
4) `src/infra/update-global.ts`（global install 完整性校验/quiet flags）  

---

## 14) 开发者体验与文档机制（DX+Docs）
专题文档：`research/topics/dx-docs.md`（Evidence IDs：DXD-OC-001 ~ DXD-OC-012）

关键文件（建议阅读顺序）：
1) `src/config/schema.help.ts`（FIELD_HELP：字段级文档单一事实源）  
2) `src/config/schema.help.quality.test.ts`（help/label parity + minLength + examples）  
3) `src/utils/usage-format.ts`（token/cost 展示与热路径策略）  

---

## 15) 隐私/遥测/数据治理（Privacy+Telemetry）
专题文档：`research/topics/privacy-telemetry.md`（Evidence IDs：PRI-OC-001 ~ PRI-OC-012）

关键文件（建议阅读顺序）：
1) `src/logging/redact.ts`（默认脱敏 patterns + config 解析 + batch redaction）  
2) `src/secrets/runtime-config-collectors-core.ts`（secret assignment + active/inactive reason）  
3) `src/shared/usage-aggregates.ts`（稳定排序输出）  

---

## 16) 评测与基准体系（Evaluation+Benchmarks）
专题文档：`research/topics/evaluation-benchmarks.md`（Evidence IDs：EVA-OC-001 ~ EVA-OC-012）

关键文件（建议阅读顺序）：
1) `scripts/bench-cli-startup.ts`（startup 性能基准：p50/p95/rss）  
2) `scripts/bench-model.ts`（模型延迟基准：median/min/max）  
3) `extensions/qa-lab/src/agentic-parity-report.ts`（parity gate：fake success/unintended stop/coverage）  
