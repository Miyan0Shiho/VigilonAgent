# 产品与交互专题（Claude Code / OpenClaw / Hermes Agent）

> 范围：CLI/TUI/网关交互、onboarding/setup、执行反馈、审批 UX、容错与降级。  
> 证据规范：每条结论必须包含 Evidence ID，并落到“文件 + 符号（函数/类型/常量）”。

## TL;DR
- **Claude Code**：Ink/React 交互层高度工程化（组件化 + keybindings + 进度 UI），并将权限审批与执行反馈深度耦合。
- **OpenClaw**：TUI 事件处理与任务/flow 通知模型强绑定，强调“状态摘要/可解释输出”与可测试的交互行为规格。
- **Hermes Agent**：提供多入口（CLI/TUI + gateway），curses UI 有较多“容错/防输入污染”细节；执行反馈以日志/回调为主，并对中断/重定向有产品级支持。

## 对齐维度
| 子维度 | 关注点 |
|---|---|
| 交互载体 | REPL/TUI/Web dashboard/gateway chat |
| Onboarding/Setup | wizard/doctor/配置生成 |
| 执行反馈 | tool events、进度 UI、状态摘要 |
| 审批交互 | 用户如何做决定、如何持久化规则 |
| 容错体验 | 无 tty、网络失败、依赖缺失的 fallback |

---

## Evidence-backed Findings（按项目）

### Claude Code（CC）
> 代码根：`research/sources/claude-code/`

- **UX-CC-001**：终端 UI 采用 React + Ink 组件体系，并把对话列表、输入、状态条、进度等拆为大量可组合组件。  
  - 定义/入口：`sources/claude-code/src/main.tsx`  
  - 组件层：`sources/claude-code/src/components/`（例如 `App.tsx`、`Messages.tsx`、`StatusLine.tsx` 等）  

- **UX-CC-002**：执行反馈以“工具进度事件类型”建模，并由 UI 组件渲染（可解释、可追踪）。  
  - 定义点：`sources/claude-code/src/types/tools.ts`（progress 类型）  
  - 执行展示：`sources/claude-code/src/components/AgentProgressLine.tsx` / `ToolUseLoader.tsx`  

- **UX-CC-003**：权限审批拥有专门的 UI 组件目录，审批交互被当作一等 UX 流程。  
  - UI：`sources/claude-code/src/components/permissions/`  
  - 例：`.../ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx`  

- **UX-CC-004**：键位体系独立抽象为 keybindings 模块，支持可扩展的快捷键解析/校验/展示。  
  - 定义点：`sources/claude-code/src/keybindings/`（schema、parser、resolver、defaultBindings）  
  - 展示：`sources/claude-code/src/components/ConfigurableShortcutHint.tsx`（以实际为准）  

- **UX-CC-005**：keybinding 自定义支持 feature gate，并提供路径解析、同步加载、加载告警与 watcher 订阅，保证体验可诊断。  
  - 决策点：`sources/claude-code/src/keybindings/loadUserBindings.ts` → `isKeybindingCustomizationEnabled()`  
  - 执行点：同文件 → `loadKeybindingsSyncWithWarnings()` / `subscribeToKeybindingChanges` / `disposeKeybindingWatcher()`  

- **UX-CC-006**：对不可重绑定/终端保留/系统保留快捷键做显式列举，避免用户配置破坏基础交互。  
  - 定义点：`sources/claude-code/src/keybindings/reservedShortcuts.ts` → `NON_REBINDABLE` / `TERMINAL_RESERVED` / `MACOS_RESERVED`  
  - 执行点：同文件 → `getReservedShortcuts()` / `normalizeKeyForComparison()`  

- **UX-CC-007**：keybinding 校验链路包含重复检测与保留快捷键检测，并能格式化告警用于面向用户的可解释输出。  
  - 执行点：`sources/claude-code/src/keybindings/validate.ts` → `validateBindings(...)` / `checkReservedShortcuts(...)`  
  - 输出点：同文件 → `formatWarnings(...)` / `formatWarning(...)`  

- **UX-CC-008**：快捷键解析/展示提供统一字符串化函数，确保 UI 展示与解析输入一致。  
  - 解析：`sources/claude-code/src/keybindings/parser.ts` → `parseKeystroke(...)` / `parseChord(...)`  
  - 展示：同文件 → `keystrokeToDisplayString(...)` / `chordToDisplayString(...)`；`shortcutFormat.ts` → `getShortcutDisplay(...)`  

- **UX-CC-009**：TUI 输入解析与焦点/选择是独立模块，暗示交互复杂度被工程化拆分以提升可维护性。  
  - 输入：`sources/claude-code/src/ink/parse-keypress.ts`（raw keypress 解析入口）  
  - 焦点/选择：`sources/claude-code/src/ink/focus.ts` / `sources/claude-code/src/ink/selection.ts`  

- **UX-CC-010**：对终端特性（例如 hyperlinks 支持）有显式探测，属于“容错/降级体验”的基础设施。  
  - 探测：`sources/claude-code/src/ink/supports-hyperlinks.ts`  
  - 执行面：`sources/claude-code/src/ink/terminal-querier.ts`（终端能力查询）  

- **UX-CC-011**：默认 keybindings 以结构化 block 形式提供，可被模板化生成，降低用户上手成本。  
  - 定义点：`sources/claude-code/src/keybindings/defaultBindings.ts` → `DEFAULT_BINDINGS`  
  - 生成：`sources/claude-code/src/keybindings/template.ts` → `generateKeybindingsTemplate()`  

- **UX-CC-012**：keybinding resolver 支持 chord 状态与展示文本解析，说明产品交互支持“多键组合”等更复杂手势。  
  - 决策点：`sources/claude-code/src/keybindings/resolver.ts` → `resolveKeyWithChordState(...)`  
  - 展示：同文件 → `getBindingDisplayText(...)`  

---

### OpenClaw（OC）
> 代码根：`research/sources/openclaw/`

- **UX-OC-001**：TUI 交互以“事件处理器 + 测试规格”方式组织，交互行为可被单元测试验证。  
  - 行为实现：`sources/openclaw/src/tui/tui-event-handlers.ts`  
  - 行为规格：`sources/openclaw/src/tui/tui-event-handlers.test.ts`  

- **UX-OC-002**：状态摘要输出有独立格式化模块，强调面向用户的可解释性与一致性。  
  - 定义点：`sources/openclaw/src/tui/tui-status-summary.ts` → `formatStatusSummary(...)`  
  - 关联：`sources/openclaw/src/status/status-text.ts`（如需补充）  

- **UX-OC-003**：setup wizard 作为核心 onboarding 路径，覆盖风险确认、密钥输入、插件配置等用户流程。  
  - 入口：`sources/openclaw/src/wizard/setup.ts` → `runSetupWizard(...)`  
  - 秘钥输入 UX：`sources/openclaw/src/wizard/setup.secret-input.ts`（以实际符号为准）  

- **UX-OC-004**：工具执行展示组件支持“运行中/成功/失败”三态背景色，并在非展开状态只展示前 N 行输出，降低信息噪声。  
  - 定义点：`sources/openclaw/src/tui/components/tool-execution.ts` → `PREVIEW_LINES` / `ToolExecutionComponent`  
  - 执行点：同文件 → `setPartialResult(...)` / `setResult(..., { isError })` / `refresh()`  

- **UX-OC-005**：工具展示优先走结构化的 tool-display 格式化（emoji/label/detail），体现“解释性 UI”优先。  
  - 执行点：`sources/openclaw/src/tui/components/tool-execution.ts` → `resolveToolDisplay(...)` / `formatToolDetail(...)`  
  - 容错：同文件 → `formatArgs(...)`（JSON stringify try/catch）  

- **UX-OC-006**：工具输出会将非文本内容（例如 image）转换为占位提示（mime/size/omitted），避免渲染崩溃并提示用户。  
  - 执行点：`sources/openclaw/src/tui/components/tool-execution.ts` → `extractText(...)`（image 分支）  
  - 容错：同文件 → `sanitizeRenderableText(...)`  

- **UX-OC-007**：后台任务的“状态变化/终态消息”格式化有专门 policy 模块，属于统一的用户通知 UX。  
  - 执行点：`sources/openclaw/src/tasks/task-executor-policy.ts` → `formatTaskTerminalMessage(...)`  
  - 执行点：同文件 → `formatTaskStateChangeMessage(...)` / `formatTaskBlockedFollowupMessage(...)`  

- **UX-OC-008**：任务通知策略支持 silent/state_changes，并具备去重/抑制逻辑，避免刷屏。  
  - 决策点：`sources/openclaw/src/tasks/task-executor-policy.ts` → `shouldAutoDeliverTaskTerminalUpdate(...)` / `shouldAutoDeliverTaskStateChange(...)`  
  - 去重：同文件 → `shouldSuppressDuplicateTerminalDelivery(...)`  

- **UX-OC-009**：TUI 状态摘要有独立 formatter，说明产品重视“当前系统状态的一句话解释”。  
  - 定义点：`sources/openclaw/src/tui/tui-status-summary.ts` → `formatStatusSummary(...)`  
  - 关联：`sources/openclaw/src/tui/tui-status-summary.ts` 内部使用的 sanitize/formatters（以实际为准）  

- **UX-OC-010**：TUI 行为由测试文件定义规格，可作为“交互合同”，降低回归风险。  
  - 规格：`sources/openclaw/src/tui/tui-event-handlers.test.ts`  
  - 实现：`sources/openclaw/src/tui/tui-event-handlers.ts`  

- **UX-OC-011**：工具输出支持 expanded/collapsed 两种模式，体现“信息密度可控”的交互设计。  
  - 定义点：`sources/openclaw/src/tui/components/tool-execution.ts` → `expanded` / `setExpanded(...)`  
  - 执行点：同文件 → preview 截断逻辑（`lines.slice(0, PREVIEW_LINES)`）  

- **UX-OC-012**：工具组件在 args/result 提取中大量使用 try/catch 容错，保障 TUI 不因异常数据崩溃。  
  - 证据点：`sources/openclaw/src/tui/components/tool-execution.ts` → `formatArgs(...)` try/catch  
  - 证据点：同文件 → image/text 解析中的 defensiveness（空对象/类型判断）  

---

### Hermes Agent（HA）
> 代码根：`research/sources/hermes-agent/`

- **UX-HA-001**：Hermes 有两个入口：交互式 CLI/TUI（`hermes`）与直接运行 agent（`hermes-agent`），并可通过 gateway 接入多平台对话。  
  - 定义点：`sources/hermes-agent/pyproject.toml` → `[project.scripts]`  
  - 交互层：`sources/hermes-agent/hermes_cli/main.py`  

- **UX-HA-002**：curses UI 提供“检查列表/输入清理”等容错细节，减少终端输入污染带来的配置错误。  
  - 定义点：`sources/hermes-agent/hermes_cli/curses_ui.py` → `curses_checklist(...)` / `flush_stdin()`  
  - 关联：`sources/hermes-agent/hermes_cli/setup.py`（如需补充 onboarding）  

- **UX-HA-003**：执行过程支持“中断并重定向”（用户随时打断当前工作），属于产品级交互能力。  
  - 决策点：`sources/hermes-agent/run_agent.py`（`_interrupt_requested` 相关逻辑）  
  - 工具：`sources/hermes-agent/tools/interrupt.py`（如需补充）  

- **UX-HA-004**：curses checklist 对非 TTY 输入直接返回默认值，避免子进程/管道场景下 curses 卡死。  
  - 决策点：`sources/hermes-agent/hermes_cli/curses_ui.py` → `curses_checklist(...)`（`if not sys.stdin.isatty(): return cancel_returns`）  
  - 关联：同文件 docstring（fallback 策略说明）  

- **UX-HA-005**：curses UI 在退出后显式 `flush_stdin()`，避免残留 escape bytes 污染后续 `input()`/`getpass()`（典型“体验细节优化”）。  
  - 定义点：`sources/hermes-agent/hermes_cli/curses_ui.py` → `flush_stdin()`  
  - 证据点：同文件注释（“corrupting user data (e.g. writing ^[[^[[ into .env files)”）  

- **UX-HA-006**：curses checklist 提供 status_fn 回调用于实时聚合信息（例如 token 估算），体现“交互中可观测性”。  
  - 定义点：`sources/hermes-agent/hermes_cli/curses_ui.py` → `status_fn: Optional[Callable[[Set[int]], str]]`  
  - 执行点：同文件 → 在底部行 right-align 渲染 status bar（`status_text = status_fn(chosen)`）  

- **UX-HA-007**：curses UI 提供 numbered fallback（无 curses 支持时的文本模式），属于降级路径。  
  - 执行点：`sources/hermes-agent/hermes_cli/curses_ui.py` → `except Exception: return _numbered_fallback(...)`  
  - 关联：同文件顶部 docstring（fallback 描述）  

- **UX-HA-008**：插件可向会话注入消息，并在 agent 运行中通过 interrupt queue 打断插入，属于“外部系统联动交互”。  
  - 执行点：`sources/hermes-agent/hermes_cli/plugins.py` → `PluginContext.inject_message(...)`  
  - 并发语义：同函数 → `_agent_running` 分支（running→`_interrupt_queue.put`；idle→`_pending_input.put`）  

- **UX-HA-009**：上下文压缩会在重复压缩次数过多时给出用户警告，并建议 `/new` 开启新会话（产品级质量提示）。  
  - 决策点：`sources/hermes-agent/run_agent.py` → `context_compressor.compression_count` / `_cc >= 2`  
  - 展示：同文件 → `_vprint("⚠️  Session compressed ... Consider /new ...")`  

- **UX-HA-010**：压缩后会重置 file-read 去重缓存，避免模型错误得到“file unchanged stub”，属于面向体验与正确性的细节优化。  
  - 执行点：`sources/hermes-agent/run_agent.py` → `reset_file_dedup(task_id)`  
  - 注释：同文件说明“After compression the original read content is summarised away … needs full content”  

- **UX-HA-011**：curses radiolist 提供单选交互，并对非 TTY 输入返回 cancel/default，保持一致的降级策略。  
  - 定义点：`sources/hermes-agent/hermes_cli/curses_ui.py` → `curses_radiolist(...)`  
  - 降级：同函数 → `if not sys.stdin.isatty(): return cancel_returns`  

- **UX-HA-012**：curses UI 支持 Vim 风格快捷键（j/k）与箭头键，体现“熟练用户效率”导向。  
  - 证据点：`sources/hermes-agent/hermes_cli/curses_ui.py` → `key in (curses.KEY_UP, ord("k"))` / `(curses.KEY_DOWN, ord("j"))`  
  - 交互提示：同文件 → header 文案 “↑↓ navigate …”  

---

## Evidence Index（按 ID）
### Claude Code（CC）
- UX-CC-001：`src/main.tsx`；`src/components/*`
- UX-CC-002：`src/types/tools.ts`；`src/components/AgentProgressLine.tsx` / `ToolUseLoader.tsx`
- UX-CC-003：`src/components/permissions/*`
- UX-CC-004：`src/keybindings/*`
- UX-CC-005：`src/keybindings/loadUserBindings.ts` → `loadKeybindingsSyncWithWarnings` / `subscribeToKeybindingChanges`
- UX-CC-006：`src/keybindings/reservedShortcuts.ts` → `NON_REBINDABLE` / `TERMINAL_RESERVED`
- UX-CC-007：`src/keybindings/validate.ts` → `validateBindings` / `formatWarnings`
- UX-CC-008：`src/keybindings/parser.ts` → `parseChord`；`src/keybindings/shortcutFormat.ts` → `getShortcutDisplay`
- UX-CC-009：`src/ink/parse-keypress.ts`；`src/ink/focus.ts` / `selection.ts`
- UX-CC-010：`src/ink/supports-hyperlinks.ts`；`src/ink/terminal-querier.ts`
- UX-CC-011：`src/keybindings/defaultBindings.ts` → `DEFAULT_BINDINGS`；`src/keybindings/template.ts` → `generateKeybindingsTemplate`
- UX-CC-012：`src/keybindings/resolver.ts` → `resolveKeyWithChordState` / `getBindingDisplayText`

### OpenClaw（OC）
- UX-OC-001：`src/tui/tui-event-handlers.ts` + `tui-event-handlers.test.ts`
- UX-OC-002：`src/tui/tui-status-summary.ts` → `formatStatusSummary`
- UX-OC-003：`src/wizard/setup.ts` → `runSetupWizard`
- UX-OC-004：`src/tui/components/tool-execution.ts` → `ToolExecutionComponent` / `PREVIEW_LINES`
- UX-OC-005：`src/tui/components/tool-execution.ts` → `resolveToolDisplay` / `formatToolDetail`
- UX-OC-006：`src/tui/components/tool-execution.ts` → `extractText`（image 分支）
- UX-OC-007：`src/tasks/task-executor-policy.ts` → `formatTaskTerminalMessage`
- UX-OC-008：`src/tasks/task-executor-policy.ts` → `shouldAutoDeliverTaskTerminalUpdate` / `shouldSuppressDuplicateTerminalDelivery`
- UX-OC-009：`src/tui/tui-status-summary.ts`
- UX-OC-010：`src/tui/tui-event-handlers.test.ts`
- UX-OC-011：`src/tui/components/tool-execution.ts` → `setExpanded`
- UX-OC-012：`src/tui/components/tool-execution.ts` try/catch 容错（`formatArgs`）

### Hermes Agent（HA）
- UX-HA-001：`pyproject.toml` scripts + `hermes_cli/main.py`
- UX-HA-002：`hermes_cli/curses_ui.py` → `flush_stdin` / `curses_checklist`
- UX-HA-003：`run_agent.py` → `_interrupt_requested`（中断语义）
- UX-HA-004：`hermes_cli/curses_ui.py` → 非 TTY 直接返回
- UX-HA-005：`hermes_cli/curses_ui.py` → `flush_stdin` 注释（防输入污染）
- UX-HA-006：`hermes_cli/curses_ui.py` → `status_fn`（状态栏）
- UX-HA-007：`hermes_cli/curses_ui.py` → `_numbered_fallback`（降级）
- UX-HA-008：`hermes_cli/plugins.py` → `PluginContext.inject_message`
- UX-HA-009：`run_agent.py` → 压缩次数告警（`_cc >= 2`）
- UX-HA-010：`run_agent.py` → `reset_file_dedup(task_id)`（压缩后去重清理）
- UX-HA-011：`hermes_cli/curses_ui.py` → `curses_radiolist`
- UX-HA-012：`hermes_cli/curses_ui.py` → Vim 风格键位（j/k）
