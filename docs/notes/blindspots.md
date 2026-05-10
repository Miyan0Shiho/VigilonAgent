# 研究盲点清单（细节问题：失败路径 / 长期运行 / 漂移）

> 目的：把“我们还没系统性深挖到位的细节风险面”收敛成一个可执行清单。  
> 约束：只使用 **源码 / 测试 / 配置** 作为证据来源；不引用 issues/PR；不依赖运行日志或人工体验复述。  
> 使用方式：每条盲点都给出三项目入口文件 + 关键符号（函数/类型/常量）+ 验证方法（CODE/TEST/CONFIG）。

---

## A) 失败路径 / 反例 / 竞态（Race & Counterexamples）

### A1) 后台输出落盘与通知的竞态：是否存在“重复投递/错投递/路径重指向窗口期”？
**归属专题**：UX / Optimizations  
**为什么是盲点**：现有研究已覆盖“任务系统存在、并行执行存在、通知去重存在”，但缺少对“多源输出 + 重连/清理 + symlink/atomic write”的反例验证入口。

**入口文件（高信号）**
- Claude Code：`sources/claude-code/src/tasks/LocalMainSessionTask.ts`  
  - 关注符号：`initTaskOutputAsSymlink(...)`、notified 状态的 check-and-set（若存在）
- OpenClaw：`sources/openclaw/src/tasks/task-registry.ts`  
  - 关注符号：`emitTaskRegistryObserverEvent(...)` 的 try/catch、delivery state 的写入/去重
- Hermes：`sources/hermes-agent/run_agent.py`  
  - 关注符号：并行回填顺序、interrupt 注入与工具回填交织

**验证方法（仅 CODE/TEST/CONFIG）**
- CODE：列出是否有“原子写/幂等投递/重复通知抑制”的硬机制；是否存在 symlink 先写后换/TOCTOU 防护。  
- TEST：优先查 OpenClaw 任务投递/去重相关测试断言（若无则记录为测试证据缺失）。

---

### A2) Cancel/Abort/Interrupt 跨层一致性：取消是否会留下“仍写盘/仍投递/仍推进 flow”的幽灵动作？
**归属专题**：Security / UX  
**为什么是盲点**：我们覆盖了“有中断能力”，但未验证中断是否在工具执行、任务状态机、持久化层、UI/消息投递之间一致落账。

**入口文件**
- Claude Code：`sources/claude-code/src/Tool.ts`  
  - 关注符号：`ToolUseContext` 中断/状态更新注入点
- OpenClaw：`sources/openclaw/src/tasks/task-flow-runtime-internal.ts`  
  - 关注符号：flow cancel/revision 传播边界
- Hermes：`sources/hermes-agent/tools/interrupt.py` + `sources/hermes-agent/run_agent.py`  
  - 关注符号：interrupt queue 与执行循环的衔接

**验证方法**
- CODE：绘制“取消信号传播链”并找出吞错/静默失败分支。  
- TEST：检索取消/超时测试；缺失则标为盲点。

---

### A3) 更新/自更新的多进程锁竞争 + 半更新状态恢复：失败后是否可重入？
**归属专题**：Release  
**为什么是盲点**：我们覆盖了更新路径与部分失败处理，但未系统验证“多进程并发更新 + stale lock + 更新中断后的半状态”是否能恢复。

**入口文件**
- Claude Code：`sources/claude-code/src/utils/autoUpdater.ts`  
  - 关注符号：`acquireLock()`、`LOCK_TIMEOUT_MS`
- OpenClaw：`sources/openclaw/src/infra/update-runner.test.ts`  
  - 关注符号：runner 失败路径/dirty tree/deps stale 的断言
- Hermes：`sources/hermes-agent/hermes_cli/main.py`  
  - 关注符号：`_stash_local_changes_if_needed(...)`、`_restore_stashed_changes(...)`、zip 更新 preserve 列表

**验证方法**
- TEST（OC）：归纳 runner 失败类型是否覆盖网络/权限/dirty/deps/兼容 fallback。  
- CODE（CC/HA）：检查失败后是否保证“可以再次执行 update”。

---

### A4) 扩展面加载失败的降级：坏定义/缺依赖/权限不足会不会导致工具面“半刷新不一致”？
**归属专题**：Ecosystem / DX+Docs  
**为什么是盲点**：我们覆盖了扩展架构，但未验证“扩展损坏”时的隔离与诊断是否足够强，是否会污染主会话。

**入口文件**
- Claude Code：`sources/claude-code/src/tools/AgentTool/loadAgentsDir.ts`  
  - 关注符号：zod schema 校验失败路径、Markdown/JSON 解析错误处理
- OpenClaw：`sources/openclaw/src/plugins/manifest-registry.ts`  
  - 关注符号：discover/load 失败是否隔离、cache 行为
- Hermes：`sources/hermes-agent/tools/registry.py`  
  - 关注符号：import 自注册失败路径、shadowing 保护逻辑

**验证方法**
- CODE：定位 try/catch 是否吞错；错误是否带上下文（文件路径/plugin id/符号名）。  
- TEST：OpenClaw contracts 测试是否包含“坏 manifest/不兼容 contract”的断言（若无则记录）。

---

### A5) 评测对“假阳性/假成功”的识别：跨项目是否可对齐？
**归属专题**：Evaluation+Benchmarks  
**为什么是盲点**：OpenClaw parity report 对 fake-success 有强 gate，但 Claude Code/Hermes 的验收机制是否有等价“假阳性识别”证据链还没对齐。

**入口文件**
- Claude Code：`sources/claude-code/src/tools/AgentTool/built-in/verificationAgent.ts`（verdict + adversarial probe 要求）  
- OpenClaw：`sources/openclaw/extensions/qa-lab/src/agentic-parity-report.ts`（fake success/unintended stop patterns）  
- Hermes：`sources/hermes-agent/environments/benchmarks/terminalbench_2/terminalbench2_env.py`（二元 reward 的信息粒度限制）  

**验证方法**
- CODE：提取每项目“成功判定规则”是否包含：fake-success、unintended stop、valid-tool-call-rate 等。  
- TEST：OpenClaw parity gate failures 是否被测试覆盖；Hermes TB2 若仅二元奖励则记录“失败分类不足”为盲点。

---

## B) 长期运行 / 规模化（增长、退化、清理）

### B1) 存储增长与清理：任务/会话/输出是否有“真实删除/归档/VACUUM”证据？
**归属专题**：Optimizations / Privacy  
**为什么是盲点**：现有研究有“上限/过滤/排序”，但“长期运行”的真实清理机制（删除/归档/压缩/VACUUM/rotation）尚未形成统一证据链。

**入口文件**
- Claude Code：`sources/claude-code/src/memdir/memoryScan.ts`（如 `MAX_MEMORY_FILES`、失败时静默退化）  
- OpenClaw：`sources/openclaw/src/tasks/task-registry.store.sqlite.ts`（store 层）  
- Hermes：`sources/hermes-agent/website/docs/developer-guide/session-storage.md`（指向后端存储实现文件）  

**验证方法**
- CODE/CONFIG：查是否存在 deletion/retention/vacuum/rotation 的默认策略与触发条件；没有就记录“证据缺失”。  
- TEST：若 store 层存在“过期清理”测试断言则引用；若仅 UI 过滤则标为盲点结论。

---

### B2) 缓存一致性：TTL/LRU/Promise-cache 是否与“配置变更/扩展变更/权限变更”联动失效？
**归属专题**：Optimizations  
**为什么是盲点**：我们列出了多个 cache，但还没系统验证“变更触发失效”的机制，容易导致长期运行的偏差累积。

**入口文件**
- Claude Code：`sources/claude-code/src/utils/fileStateCache.ts`（LRU + merge/clone）  
- OpenClaw：`sources/openclaw/src/plugins/manifest-registry.ts`（TTL cache）  
- Hermes：`sources/hermes-agent/tools/skills_hub.py`（index cache TTL/落盘目录增长）  

**验证方法**
- CODE：列出每个 cache 的键空间、上限/TTL、失效触发条件；标注是否考虑“配置/扩展/权限变化”。  
- TEST：找不到缓存相关测试即记录。

---

### B3) 日志/遥测的 backpressure：队列是否有上限？日志是否 rotation/retention？
**归属专题**：Privacy+Telemetry  
**为什么是盲点**：脱敏解决“内容安全”不等于“容量治理”；长期运行更需要 backpressure/rotation。

**入口文件**
- Claude Code：`sources/claude-code/src/services/analytics/index.ts`（queue-before-attach，但是否 max size？）  
- OpenClaw：`sources/openclaw/src/logging/redact.ts`（脱敏；需反推 logging 子系统是否 rotation）  
- Hermes：`sources/hermes-agent/web/src/pages/LogsPage.tsx`（存在日志展示面时，需回链存储与留存机制）  

**验证方法**
- CODE/CONFIG：grep `max/rotation/retention/truncate/vacuum` 相关机制；没有则记录为盲点。  
- CONFIG：若 schema/help 中存在 logging.*，用它作为“用户可控”的证据。

---

### B4) 索引增长导致静默截断/静默丢失：用户是否可见？是否有恢复路径？
**归属专题**：DX+Docs / Optimizations  
**为什么是盲点**：上限/截断若无显式告警与恢复方式，会导致长期运行下“质量悄悄变差”。

**入口文件**
- Claude Code：`sources/claude-code/src/memdir/memdir.ts`（entrypoint 截断常量与告警文案）  
- OpenClaw：`sources/openclaw/scripts/bench-cli-startup.ts`（是否覆盖“规模变大后的退化”）  
- Hermes：`sources/hermes-agent/website/docs/developer-guide/session-storage.md`（FTS/触发器与维护证据）  

**验证方法**
- CODE：定位“截断触发时的用户可见反馈”（warning/UI/log）。  
- TEST：检查是否存在“超大输入/超多文件/超大索引”的回归测试；缺失则记录。

---

## C) 一致性与漂移（Schema/Help/权限/工具面/扩展面）

### C1) help/schema/命令一致性：是否存在自动化门禁防止“功能变了但 help 没变”？
**归属专题**：DX+Docs  
**为什么是盲点**：OpenClaw 有 schema help quality test；Hermes 有 command registry SSOT；Claude Code 的 help 是否有同级别的自动化校验仍需补证据。

**入口文件**
- Claude Code：`sources/claude-code/src/components/HelpV2/HelpV2.tsx`  
- OpenClaw：`sources/openclaw/src/config/schema.help.quality.test.ts`  
- Hermes：`sources/hermes-agent/hermes_cli/commands.py`  

**验证方法**
- TEST（OC）：以 help parity/minLength/enum doc gate 作为“黄金样例”，对比 CC/HA 是否存在等价测试证据；没有则记录为盲点。

---

### C2) 权限/denylist 与工具面演进：新增工具是否一定落入安全 gate？是否有“绕过”反例？
**归属专题**：Security  
**为什么是盲点**：我们看到了 denylist/规则检测/registry shadowing，但未形成“新增工具一定被 gate”的证据闭环与反例测试。

**入口文件**
- Claude Code：`sources/claude-code/src/utils/permissions/shadowedRuleDetection.ts`  
- OpenClaw：`sources/openclaw/src/security/dangerous-tools.ts`  
- Hermes：`sources/hermes-agent/tools/registry.py`（shadowing 拒绝逻辑）  

**验证方法**
- CODE：梳理工具注册/发现链路是否强制走权限判定；如存在可绕过路径则记录。  
- TEST：查 denylist 漂移测试（若无则标记为盲点）。

---

### C3) 扩展合同/manifest/SDK 的升级漂移：是否有 schema version、迁移函数或兼容分支？
**归属专题**：Ecosystem / Release  
**为什么是盲点**：扩展面是最容易 breaking change 的区域；当前研究更多是静态结构，缺少迁移/兼容的证据链。

**入口文件**
- Claude Code：`sources/claude-code/src/tools/AgentTool/loadAgentsDir.ts`（agent schema）  
- OpenClaw：`sources/openclaw/src/plugins/contracts/`（合同测试目录）  
- Hermes：`sources/hermes-agent/hermes_cli/plugins.py`（plugin.yaml 合同与 hooks）  

**验证方法**
- TEST（OC）：列出 contracts 测试覆盖的 contract keys 与 breaking change 防护方式。  
- CODE（CC/HA）：查是否存在版本字段/迁移函数/兼容分支；没有则记录为盲点。

---

### C4) 成本/usage/analytics 字段漂移：存储层↔聚合↔UI 是否全链路承接？
**归属专题**：Privacy+Telemetry / Optimizations  
**为什么是盲点**：字段新增最容易出现“写了但不读/读了但不写”的漂移，进而导致评测与可观测性失真。

**入口文件**
- Claude Code：`sources/claude-code/src/cost-tracker.ts`（写入/恢复/导出字段）  
- OpenClaw：`sources/openclaw/src/shared/usage-aggregates.ts`（聚合输出与排序）  
- Hermes：`sources/hermes-agent/agent/insights.py` + `sources/hermes-agent/web/src/pages/AnalyticsPage.tsx`（后端字段→前端消费）  

**验证方法**
- CODE：对照四表一致性：写入字段列表 / migration(若有) / 聚合计算 / 前端消费字段；任何不一致记录为盲点。  
- TEST：若有 schema migration 或 API contract 测试，引用断言；没有则记录“测试证据缺失”。

