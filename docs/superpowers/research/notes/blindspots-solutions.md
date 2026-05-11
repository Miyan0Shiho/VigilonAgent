# 研究盲点“解决方案”建议（不改代码版）

> 目标：针对 `notes/blindspots.md` 的每条盲点，给出**可落地的工程建议方案**（含优先级、建议落点文件/模块、以及如何用现有证据链闭环）。  
> 约束：本文件不直接修改三项目代码；仅提出建议与具体落点（你若后续要做“补测试/护栏”，可直接把这些建议转成 PR 任务）。

---

## A) 失败路径 / 反例 / 竞态（Race & Counterexamples）

### A1) 后台输出落盘与通知竞态
**风险**：重复投递、错投递、丢投递；以及 symlink/原子写窗口期被利用导致输出链污染或审计不一致。  
**建议（P0）**：
1) **把“投递幂等”变成显式状态机**：每条投递（terminal update/state change/attachment）都用 `(taskId, revision, deliveryKind)` 做幂等 key，并在持久化层记录 “delivered_at”。  
2) **把“输出路径”从可变引用（symlink）变成不可变对象**：输出文件使用内容地址（hash）或 revision 目录（`taskId/rev-N/`）写入，symlink 仅作为“最新指针”，且写入采用“写临时 → fsync → rename”原子替换。  
3) **引入竞态测试模板**：用“模拟重复事件/乱序事件/重连事件”驱动任务系统，验证不会出现 double-delivery 或 delivery after cancel。

**建议落点（按项目）**
- Claude Code：`src/tasks/LocalMainSessionTask.ts` + 任务输出落盘相关 util（梳理 `initTaskOutputAsSymlink(...)` 及 notified 机制）  
- OpenClaw：`src/tasks/task-registry.ts` + `task-executor-policy.ts`（把去重 key 与 delivered 状态显式化）  
- Hermes：`run_agent.py`（并行回填与中断注入）+ “输出/通知存储层”（如存在单独模块）

**如何闭环（仅文档证据）**
在 `blindspots.md` 对 A1 增补一个“推荐 invariant 列表”：例如 *同一 task revision 的 terminal update 只能被 delivered 一次*、*cancel 后不允许出现新的 deliver* 等，并把这些 invariant 映射到各项目对应模块的“应实现位置”。

---

### A2) Cancel/Abort/Interrupt 跨层一致性
**风险**：用户看到“已取消”，但后台仍写盘/仍执行/仍发通知；产生幽灵副作用与审计偏差。  
**建议（P0）**：
1) **统一取消 token / cancellation context**：让 tool 调用与任务执行都持有同一个 cancellation token（或 contextvar），并强制在 IO 边界检查。  
2) **取消的“落账点”必须唯一**：定义一个 authoritative cancel recorder（写入 task state store），所有层以它为准；禁止多处各自维护“我认为取消了”。  
3) **取消后副作用门禁**：任何写盘/网络/子进程启动都必须检查 cancellation state；对于并行批次，需定义“批次部分成功”策略并记录。

**建议落点**
- Claude Code：`src/Tool.ts`（ToolUseContext 作为统一中断/状态更新枢纽）  
- OpenClaw：`src/tasks/task-flow-runtime-internal.ts`（flow 与 task 的 cancel 传播与一致性）  
- Hermes：`tools/interrupt.py` + `run_agent.py`（interrupt queue 与执行循环）

---

### A3) 更新/自更新锁竞争与半更新恢复
**风险**：多进程更新导致脏状态；半更新造成不可启动；stale lock 导致“永远不能更新”。  
**建议（P0）**：
1) **把更新做成事务**：写入一个 update journal（state machine：downloaded → staged → swapped → verified），崩溃后可以 resume 或 rollback。  
2) **锁语义升级**：锁文件除了 PID/时间戳还应写入“owner version + start time + hostname”，并提供“强制解锁”用户路径（带清晰警告）。  
3) **dirty tree 的一致策略**：对 git 安装（Hermes/OC）与包管理器安装（CC/OC）分别定义“阻止/允许但备份/自动 stash”的统一策略，并文档化。  
4) **把失败类型做成枚举**：统一把“网络/权限/依赖缺失/dirty/兼容性”映射到 error codes（便于 DX 与自动化评测）。

**建议落点**
- Claude Code：`src/utils/autoUpdater.ts`（锁与 kill switch）+ `src/cli/update.ts`（失败提示与 doctor）  
- OpenClaw：`src/infra/update-*.ts`（runner/package-manager/global）+ `update-runner.test.ts`（补齐并发/半更新测试用例）  
- Hermes：`hermes_cli/main.py`（stash/restore、zip 更新 preserve）+ `scripts/install.sh`（分发策略）

---

### A4) 扩展面加载失败的降级与“半刷新不一致”
**风险**：扩展加载部分失败导致工具面不一致；错误缺少上下文难以定位；主会话被污染。  
**建议（P1）**：
1) **两阶段加载（discover → validate → commit）**：先构建“候选工具表”，只有全部校验通过才替换为新工具表（copy-on-write），否则保留旧表。  
2) **错误必须携带三元上下文**：`{extension_id, source_path, symbol}`，并保证在 UI/日志层可见。  
3) **把 schema 兼容做成版本化**：对 agent/plugin manifest 增加 schemaVersion，提供至少一个 deprecation window（旧版仍可读但警告）。  

**建议落点**
- Claude Code：`loadAgentsDir.ts`（解析/校验/报错上下文） + `runAgent.ts`（MCP 初始化失败的隔离）  
- OpenClaw：`manifest-registry.ts`（registry commit 模型） + contracts tests  
- Hermes：`tools/registry.py`（discover/import 错误处理）+ `hermes_cli/plugins.py`

---

### A5) 评测对假阳性/假成功的识别对齐
**风险**：不同项目“PASS”的含义不同，导致横向对比失真；回归时出现 fake success。  
**建议（P1）**：
1) **统一“评测判定维度”字典**：至少包含 `unintended_stop / fake_success / tool_call_required_missing / flaky_timeout`。  
2) **把 OpenClaw parity gate 的模式抽象为通用 lint**：对 Claude Code 的 verification 输出做 parser，检测“failure tone with PASS”；对 Hermes TB2 增加更细粒度日志/分类（哪怕不改 reward，也可增加 tags）。  
3) **要求每个评测都提供结构化结果**：JSON 结果 + 稳定排序（便于 diff）。

**建议落点**
- Claude Code：`verificationAgent.ts`（输出格式已结构化，可扩展 parser）  
- OpenClaw：`agentic-parity-report.ts`（已实现 fake success/unintended stop）  
- Hermes：`terminalbench2_env.py`（若不改 reward，可增加 failure taxonomy 输出文件）

---

## B) 长期运行 / 规模化（增长、退化、清理）

### B1) 存储增长与清理（真实删除/归档/VACUUM/rotation）
**风险**：DB/日志/索引无限增长 → 性能退化、磁盘爆炸、隐私留存风险。  
**建议（P0）**：
1) **显式 retention policy**：为 tasks/sessions/logs/analytics 每类数据提供默认 TTL + 最大容量 + 用户可配置。  
2) **把清理做成“可证”的后台任务**：例如 SQLite `VACUUM/pragma wal_checkpoint`、log rotation、archive 压缩；并记录清理统计（deleted rows/bytes）。  
3) **清理策略必须可测试**：至少有“过期数据会被 delete”与“未过期不会误删”两类断言。

**建议落点**
- Claude Code：`memdir/*`（上限/截断）+ 任何 session/transcript 持久化模块  
- OpenClaw：`task-registry.store.sqlite.ts`（如存在 cleanup 只做过滤，应升级为真实 delete）  
- Hermes：session storage 后端（WAL/FTS）与 logs storage（若有）

---

### B2) 缓存一致性与失效联动
**风险**：配置/扩展变化后 cache 仍命中旧值 → 工具面/权限面/成本统计漂移。  
**建议（P1）**：
1) **缓存键必须包含“版本戳”**：例如 config hash、registry generation、permission mode；只要版本戳变就自动 miss。  
2) **把 invalidation 事件化**：当插件/skills/MCP 刷新时发布 `invalidate(reason)`，所有 cache 统一响应。  
3) **为 merge/clone 策略加 invariant**：例如“timestamp 新者覆盖旧者”是否会造成回滚；需定义冲突策略并文档化。

---

### B3) 日志/遥测队列 backpressure
**风险**：队列无上限导致内存增长；日志无 rotation 导致磁盘增长；遥测 flush 失败导致阻塞。  
**建议（P1）**：
1) **为队列加 max size + drop policy**（drop-oldest/drop-newest）并统计丢弃量。  
2) **日志 rotation/retention 标准化**：size-based + time-based 双触发；敏感环境默认更短 retention。  
3) **遥测 flush 强制超时**：失败时降级为丢弃，不阻塞主流程（除非用户显式要求“可靠投递”模式）。

---

### B4) 索引增长导致截断/静默退化的可见性与恢复
**风险**：系统“悄悄变笨”，用户无法理解；回归难。  
**建议（P1）**：
1) **任何截断都要可见告警**（UI + 日志 + 可导出的诊断信息）。  
2) **提供恢复路径**：例如“如何增大上限/如何清理/如何重建索引”。  
3) **基准覆盖“规模变大”**：bench 里加入“索引规模/文件数/任务数”的参数化 case。

---

## C) 一致性与漂移（Schema/Help/权限/工具面/扩展面）

### C1) help/schema/命令一致性的自动化门禁
**风险**：功能改了但 help 没改；用户学习成本飙升；错误信息与行为不一致。  
**建议（P0）**：
1) **为 Claude Code 增加“help parity test”**（对齐 OpenClaw 的 schema help quality 思路）：至少检查“命令存在则 help 有条目/不隐藏则可发现”。  
2) **Hermes command registry 继续强化 SSOT**：确保 gateway/bot/cli 三表面共享同一 registry（已具备），补充“config gate 覆盖率”测试。  
3) **OpenClaw 把 schema.help.quality.test 扩展到更多关键域**（例如安全/更新/telemetry）。

---

### C2) 权限/denylist 漂移：新增工具是否一定被 gate
**风险**：新增工具绕过审批/denylist；扩展面注入工具未被纳入权限。  
**建议（P0）**：
1) **新增工具必须显式声明 risk class**（low/medium/high），缺省视为 high 并 require ask/deny；CI 检查遗漏。  
2) **denylist/allowlist 与工具注册同源**：禁止手写列表与工具表分离；由工具 registry 生成 deny candidates 再人工覆写。  
3) **为扩展注入工具加 policy test**：MCP/插件注入的工具必须走同一权限上下文（写成断言）。

---

### C3) contracts/manifest/SDK 的升级漂移与兼容
**风险**：扩展生态最易 breaking；用户升级后插件全挂。  
**建议（P1）**：
1) schemaVersion + migration：manifest/agent schema 版本化，提供一段 deprecation window。  
2) contracts 的 breaking change 必须有“compat shim 或 fail-fast 提示”并在测试覆盖。  
3) “兼容矩阵”由 CI 自动生成：输出哪些 contracts/keys 在哪些版本仍受支持（文档化机制，不必手写）。

---

### C4) usage/cost/analytics 字段漂移（存储↔计算↔UI）
**风险**：字段新增后只有一端更新，导致 dashboard/insights 错误或 silently wrong。  
**建议（P0）**：
1) **定义结构化 schema（版本化）**：每次新增字段都 bump schema 版本，提供 migration（哪怕是 no-op）。  
2) **端到端 contract test**：对“写入 → 聚合 → UI 消费”做最小 JSON contract 测试（不跑 UI 也可用 snapshot）。  
3) **稳定排序/稳定格式**：所有聚合输出稳定排序、稳定小数位，确保 diff 可靠（OpenClaw 已很好，建议 CC/HA 对齐）。

---

## 建议的落地顺序（如果后续你要真的改代码/补测试）
1) **P0：C1、C2、B1、A2、A3**（会直接决定“安全/可维护/可升级”底盘）  
2) **P1：A1、A4、A5、B2、B3、B4、C3、C4**（提升成熟度与可审计性）  

