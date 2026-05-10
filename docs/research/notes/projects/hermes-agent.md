# Hermes Agent 关键文件索引（聚焦：规划/执行机制）

> 代码根目录：`research/sources/hermes-agent/`

## 1) 入口（CLI / gateway / agent 主程序）
- `pyproject.toml`：入口脚本声明
  - `hermes = "hermes_cli.main:main"`（交互式 CLI/TUI 入口）
  - `hermes-agent = "run_agent:main"`（直接运行 agent）
- `run_agent.py`：核心 Agent Loop（含 tool dispatch、并行工具执行、checkpoint、安全兜底等）
- `cli.py` / `hermes_cli/`：命令行交互层（命令、UI、会话管理）

## 2) 工具注册与发现（Tool Registry）
- `tools/registry.py`：工具注册中心（每个工具模块 import 时自注册；支持动态/并发安全快照）
- `model_tools.py`：从 registry 汇总工具 schema，并向模型暴露“可用工具列表”（建议与 registry 一起读）
- `tools/mcp_tool.py`：MCP 工具注入（动态扩展工具面）

## 3) Toolset（工具集）= 能力开关（影响规划与执行范围）
- `toolsets.py`：预定义 toolsets + 组合 toolsets（例如 `safe`、`debugging`、`hermes-acp` 等）
- `run_agent.py`：解析 `enabled_toolsets/disabled_toolsets`，用于过滤可用工具（影响 agent 的可行动作空间）

## 4) 规划与执行：Todo + 工具调度（核心证据链）
- `tools/todo_tool.py`：todo 工具（内存 todo 列表；用于“计划表示”）
- `run_agent.py`：
  - `_execute_tool_calls(...)`：执行模型输出的 tool calls（区分顺序执行与并行执行）
  - `_execute_tool_calls_concurrent(...)`：并行工具执行（线程池、心跳、结果按原顺序回填）
  - `_invoke_tool(...)`：统一工具调用入口（含插件 pre-hook block、todo/memory/clarify/delegate 等特殊分发）

## 5) 权限/审批与安全（执行前 gate）
- `tools/approval.py`：命令/工具审批（与 gateway/平台侧安全策略相关）
- `tools/skills_guard.py`：skills 的安全边界/守卫（防止不受控的技能扩展）

## 6) 记忆与上下文治理（影响规划质量与长期一致性）
- `agent/context_compressor.py`：上下文压缩（token 压力、压缩策略、压缩后去重缓存清理）
- `agent/memory_provider.py` + `tools/memory_tool.py`：记忆写入/读取与持久化
- `tools/session_search_tool.py`：跨会话检索（FTS/召回；用于“经验复用”）

## 7) 委派与并行（subagent）
- `tools/delegate_tool.py`：子代理/委派执行（隔离上下文、并行工作流）
- `tools/mixture_of_agents_tool.py`：MoA（多代理/多模型协作）相关入口

---

## 0) 10 分钟跳读路线（新增专题：安全/生态/交互/优化/发布/文档/隐私/评测）
- 安全（Security）：  
  1) `tools/approval.py`（危险命令识别 + 审批 + contextvars 隔离）  
  2) `tools/path_security.py`（path traversal 防护）  
  3) `tools/skills_guard.py`（skills 扫描与安装策略）  
  4) `run_agent.py`（checkpoint + destructive command 识别）
- 扩展（Ecosystem）：  
  1) `tools/registry.py`（自注册 + shadowing 防护 + deregister）  
  2) `toolsets.py`（能力门控）  
  3) `hermes_cli/plugins.py`（插件 hooks + tool 注册 + inject_message）  
  4) `tools/mcp_tool.py`（MCP：安全 env + credential stripping + 动态发现）  
  5) `tools/skills_hub.py`（skills hub：quarantine/audit/lockfile）
- 交互（UX）：  
  1) `hermes_cli/curses_ui.py`（checklist/radiolist + fallback + flush_stdin）  
  2) `hermes_cli/plugins.py`（外部消息注入）  
  3) `run_agent.py`（压缩告警 + 重置去重缓存）  
- 优化（Optimizations）：  
  1) `agent/context_compressor.py`（压缩算法与预算）  
  2) `run_agent.py`（并行 tool_calls 判定 + 心跳 + checkpoint）  
  3) `tools/mcp_tool.py`（后台事件循环 + lock）
- 发布（Release）：  
  1) `pyproject.toml`（版本/依赖/入口脚本）  
  2) `scripts/install.sh`（安装与渠道分流）  
  3) `hermes_cli/main.py`（update 与 zip 更新）
- 文档与 DX（DX+Docs）：  
  1) `hermes_cli/commands.py`（slash commands registry→多表面 help）  
  2) `hermes_cli/tips.py`（持续 onboarding）  
  3) `website/docusaurus.config.ts`（文档站点工程化）
- 隐私与遥测（Privacy+Telemetry）：  
  1) `tools/mcp_tool.py`（safe env + credential stripping）  
  2) `agent/insights.py`（SQLite insights：数据最小化/结构化输出）  
  3) `web/src/pages/AnalyticsPage.tsx`（统计展示层）
- 评测与基准（Evaluation+Benchmarks）：  
  1) `environments/benchmarks/terminalbench_2/terminalbench2_env.py`（eval env）  
  2) `tests/environments/benchmarks/test_terminalbench2_env_security.py`（eval 安全测试）  
  3) `tools/rl_training_tool.py`（训练/评测工具链门禁）

---

## 9) 安全与权限模型（Security）
专题文档：`research/topics/security.md`（Evidence IDs：SEC-HA-001 ~ SEC-HA-012）

关键文件（建议阅读顺序）：
1) `tools/approval.py`（`DANGEROUS_PATTERNS` / `detect_dangerous_command` / contextvars）  
2) `tools/path_security.py`（`validate_within_dir` / `has_traversal_component`）  
3) `tools/skills_guard.py`（`INSTALL_POLICY` / `scan_skill` / `should_allow_install`）  
4) `tools/skill_manager_tool.py`（`_security_scan_skill` + `ALLOWED_SUBDIRS`）  
5) `run_agent.py`（`_DESTRUCTIVE_PATTERNS` / `_is_destructive_command` + checkpoint）  

---

## 10) 扩展与生态（Ecosystem）
专题文档：`research/topics/ecosystem.md`（Evidence IDs：ECO-HA-001 ~ ECO-HA-012）

关键文件（建议阅读顺序）：
1) `tools/registry.py`（`register`/shadowing 拒绝、`deregister` 支持 list_changed）  
2) `toolsets.py`（TOOLSETS 组合）  
3) `hermes_cli/plugins.py`（`VALID_HOOKS`、`PluginContext.register_tool`、`inject_message`）  
4) `tools/mcp_tool.py`（safe env / credential stripping / dynamic discovery）  
5) `tools/skills_hub.py`（hub state：quarantine/audit/lockfile/index cache）  

---

## 11) 产品与交互（UX）
专题文档：`research/topics/ux.md`（Evidence IDs：UX-HA-001 ~ UX-HA-012）

关键文件（建议阅读顺序）：
1) `hermes_cli/curses_ui.py`（`flush_stdin` / `curses_checklist` / `curses_radiolist`）  
2) `hermes_cli/plugins.py`（`inject_message`：running/idle 两种路径）  
3) `run_agent.py`（压缩次数告警、`reset_file_dedup`）  

---

## 12) 优化细节（Optimizations）
专题文档：`research/topics/optimizations.md`（Evidence IDs：OPT-HA-001 ~ OPT-HA-012）

关键文件（建议阅读顺序）：
1) `agent/context_compressor.py`（`SUMMARY_PREFIX`、预算常量、tool output pruning）  
2) `run_agent.py`（`_should_parallelize_tool_batch`、并行/顺序分发、heartbeats、checkpoint）  
3) `tools/registry.py`（`max_result_size_chars`）  
4) `tools/mcp_tool.py`（后台 event loop/lock；安全 env）  

---

## 13) 版本/发布/分发（Release）
专题文档：`research/topics/release.md`（Evidence IDs：REL-HA-001 ~ REL-HA-012）

关键文件（建议阅读顺序）：
1) `pyproject.toml`（requires-python、pinned deps、scripts）  
2) `scripts/install.sh`（uv 安装/非交互检测/Windows 分流）  
3) `hermes_cli/main.py`（update：zip-slip 防护、stashing、web ui build）  

---

## 14) 开发者体验与文档机制（DX+Docs）
专题文档：`research/topics/dx-docs.md`（Evidence IDs：DXD-HA-001 ~ DXD-HA-012）

关键文件（建议阅读顺序）：
1) `hermes_cli/commands.py`（registry→gateway help/bot commands/autocomplete）  
2) `hermes_cli/tips.py`（tips 语料库与未来去重接口）  
3) `website/docusaurus.config.ts`（docs 工程化：search/mermaid/sidebar/editUrl）  

---

## 15) 隐私/遥测/数据治理（Privacy+Telemetry）
专题文档：`research/topics/privacy-telemetry.md`（Evidence IDs：PRI-HA-001 ~ PRI-HA-012）

关键文件（建议阅读顺序）：
1) `tools/mcp_tool.py`（safe env、credential stripping、name sanitization）  
2) `agent/insights.py`（SQL 预编译 + 数据最小化 + 结构化返回）  
3) `web/src/pages/AnalyticsPage.tsx`（统计可解释展示）  

---

## 16) 评测与基准体系（Evaluation+Benchmarks）
专题文档：`research/topics/evaluation-benchmarks.md`（Evidence IDs：EVA-HA-001 ~ EVA-HA-012）

关键文件（建议阅读顺序）：
1) `environments/benchmarks/terminalbench_2/terminalbench2_env.py`（TB2 eval：sandbox+tests+reward）  
2) `tests/environments/benchmarks/test_terminalbench2_env_security.py`（解包 traversal/symlink 测试）  
3) `tools/rl_training_tool.py`（LOCKED_FIELDS、env discovery、status rate limit）  
