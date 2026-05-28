# 用户感知机制深度调研

调研日期：2026-05-27
聚焦：Agent 如何感知用户正在做什么——不等用户在聊天框里描述

---

## 调研动机

Vigilon Phase 2 的 Goal 1（用户需求感知，主动帮助用户）的核心前提是：Agent 需要知道用户在做什么、在什么情境下、遇到了什么问题。当前几乎所有 Agent 产品都是**聊天框被动模式**——用户必须打字描述自己的状态。

2026 年 4-5 月，Codex 在"感知"方向上密集发布了一系列功能，标志着行业开始从"等用户开口"转向"看用户在做什么"。理解这些机制对 Vigilon 的问题域 A（意图理解与适应性引导）至关重要。

---

## 一、感知机制全景图

2026 年的用户感知技术栈可以分为四个层次：

```
Layer 4: 心理生理感知  ← AwareLLM (研究阶段)
Layer 3: 持续环境记忆  ← Chronicle (连续录屏 → 可搜索视觉记忆)
Layer 2: 语义桌面感知  ← Computer Use (AX Tree 结构化读取)
Layer 1: 即时窗口感知  ← Appshots (用户触发截图 + 文本提取)
```

| 层次 | 机制 | 触发方式 | 感知深度 | 产品状态 |
|------|------|---------|---------|---------|
| L1 | Appshots | 用户主动（双击 Cmd） | 单窗口截图 + 结构化文本 + 屏幕外内容 | Codex 已发布 |
| L2 | Computer Use | Agent 主动 | 完整 AX Tree（UI 元素语义树） | Codex 已发布 |
| L3 | Chronicle | 系统自动（周期性） | 连续录屏 → OCR → 可搜索记忆 | Codex 预览版 |
| L4 | 生理感知 | 系统自动（持续） | 眼动、瞳孔、姿态、心率 | 研究阶段 |

---

## 二、Codex Appshots（L1：即时窗口感知）

### 触发

用户双击左右 Cmd 键 → 前台应用窗口被捕获并附加到当前对话线程。

### 捕获的三层信息

| 层 | 内容 | 技术实现 |
|----|------|---------|
| 可见截图 | 窗口的可视区域图像 | macOS Screen Recording 权限 |
| 可读文本 | 窗口内结构化文字（按钮标签、输入框内容、菜单项） | macOS Accessibility API |
| 屏幕外内容 | 需要滚动才能看到的隐藏文本 | Accessibility API 遍历 |

关键设计：不是"把截图发给模型让模型自己 OCR"——而是在 **Mac 本地做文本提取**，模型收到的是**像素 + 结构化元数据 + 提取文本**的多模态融合输入。这避免了 OCR 幻觉和 UI 结构误识别。

### 权限

- Screen & System Audio Recording
- Accessibility 权限（用于读取窗口文本）

### 数据流

```
用户双击 Cmd → 本地预处理(截图+AX文本提取) → 附加到对话线程 → 发送给模型
```

### 设计洞察

- **用户主动触发**：不是持续监控，是用户想说"看看这个"时的快捷操作
- **追加到同一线程**：短时间内连续操作会智能合并到同一条线程，避免碎片化
- **仅限前台窗口**：不捕获整个桌面，隐私边界清晰

---

## 三、Codex Computer Use（L2：语义桌面感知 + 行动）

### 核心架构：AX Tree，不是像素

Codex Computer Use 和所有竞品的根本区别在于它读的是 **macOS Accessibility Tree**（语义 UI 树），而不是截图的像素：

```
传统方案（Claude Computer Use 等）：
  截图 → 视觉模型 → 猜测坐标 → 模拟点击
  ↓ 问题：坐标不准、UI 变化时失效、无法理解元素关系

Codex 方案：
  Accessibility API → AX Tree（语义结构）→ 精确操作
  ↓ 优势：知道每个元素的 role/label/value/state/parent/children
```

### AX Tree 提供的信息

对于每个 UI 元素，Agent 可以读取：
- `role`：AXButton, AXTextField, AXMenu, AXScrollArea...
- `label`：元素显示的文字
- `value`：当前值（输入框内容、滑块位置等）
- `focused`：是否聚焦
- `enabled/disabled`：是否可用
- `bounds`：元素在屏幕上的位置和大小
- `actions`：支持的操作（Press, Raise, ShowMenu...）
- `parent/children`：UI 层级关系

### 操作原语

| 操作 | 说明 |
|------|------|
| `list_apps` | 列出所有运行中的应用 |
| `get_app_state` | 获取窗口完整快照（截图 + AX Tree + 结构化元素列表） |
| `click` | 坐标或元素定位点击 |
| `type_text` | 原生事件合成文本输入 |
| `press_key` | 按键 + 修饰键组合 |
| `set_value` | **直接 AX 值修改**——最安全的背景操作路径，不抢夺焦点 |
| `scroll` | 原生滚动 |
| `perform_secondary_action` | AX 辅助动作 |

### 后台并行执行

- **独立虚拟光标**：Agent 有自己的光标，不和用户抢鼠标/键盘
- **多 Agent 并行**：多个 Agent 同时操作不同应用，各有自己的光标
- **展示但不干扰**：虚拟光标可见（带趣味动画），但不影响用户操作
- **锁屏后可工作**：短时授权 + 屏幕遮盖 + 本地输入自动重锁

### 技术来源

OpenAI 在 2025 年秋收购了 **Sky Applications Inc.**（Apple Shortcuts/Workflow 原团队），其 macOS 自动化和 Accessibility 技术积累直接转化为 Computer Use 插件：
```
~/.codex/plugins/cache/openai-bundled/computer-use/.../SkyComputerUseClient.app
```

---

## 四、Codex Chronicle（L3：持续环境记忆）

### 工作机制

1. **后台 Agent 周期性截屏**——每隔一段时间捕获显示屏内容
2. **上传到 OpenAI 服务器**——OCR + 视觉分析处理
3. **生成 Markdown 记忆文件**——存储在 `~/.codex/memories_extensions/chronicle/`
4. **原始截图 6 小时后删除**——记忆持久化保留
5. **用户提问时注入上下文**——Codex 能"记得"你之前在做什么

### 关键风险

| 风险 | 详情 |
|------|------|
| 隐私 | 截图上传云端处理；可能捕获密码、私密文档、聊天记录 |
| 存储安全 | 记忆文件**未加密**存储，本地其他应用可读取 |
| 注入攻击 | 屏幕上的恶意文字可能被 Agent 解读为指令 |
| 配额消耗 | 后台 Agent 持续消耗 API 额度 |
| 合规 | EU/UK/瑞士不可用（GDPR） |

### 与 Microsoft Recall 的对比

| | Chronicle | Windows Recall |
|---|---|---|
| 处理位置 | 云端 | 本地 NPU |
| 存储加密 | 未加密 | 加密 |
| 触发方式 | 可随时暂停 | 可随时暂停 |
| 删除机制 | 截图 6h 后删除 | 本地管理 |

### 设计洞察

Chronicle 解决的核心问题是：**用户不需要每次都重新描述上下文**。当用户说"修一下刚才那个 bug"，Codex 能从视觉记忆中检索"刚才屏幕上显示了什么"。

但代价极大——隐私、安全、合规三重风险。这也是它仍然是"预览版"且不在 EU 上线的原因。

---

## 五、Claude Code 的感知机制

Claude Code 在 2026 年 5 月**没有桌面级感知能力**。它的感知范围限定在：

### Hooks 系统（Session 内事件驱动）

| 事件 | 感知内容 |
|------|---------|
| `SessionStart` | Session 启动时注入项目上下文 |
| `UserPromptSubmit` | 用户每次发 prompt 时追加上下文 |
| `PreToolUse / PostToolUse` | 工具调用前后的文件操作、参数 |
| `PreCompact` | 上下文压缩前保存关键信息 |
| `Notification` | Claude 需要用户注意时推送通知 |

### 文件感知（间接）

- **agentflash**（第三方）：通过 `fs_usage`（macOS 内核级 I/O 监控）实时可视化文件读写
- **ctx**（第三方）：监控终端命令和文件编辑，检测危险操作

### 关键局限

Claude Code 不追踪：
- 用户在其他应用中的活动
- 浏览器中的操作（WebFetch 调用之外）
- 用户注意力状态
- 全局键盘/鼠标活动

Claude Code 的感知模型是 **"Session 内事件驱动"**——它知道你在这个 Session 里做了什么，但不知道你在 Session 外做什么。

---

## 六、研究前沿（尚未产品化）

### ProAgent（AR 眼镜上的主动感知）

- **分层感知**：低成本线索持续监测 → 深度感知按需触发
- **上下文感知推理**：综合传感器数据 + 用户偏好 → 推断需求
- **结果**：85% 的参与者满意，愿意日常使用

### AwareLLM（心理生理感知）

- 整合：自我中心视觉 + 瞳孔测量 + 眼动追踪 + 姿态检测 + 心率
- 动态适应用户的认知状态和压力水平
- 实现了个性化的适时干预

### Intent Assistant（INA，CHI 2026）

- 持续监控：截图 + 应用标题 + URL
- 检测上下文相关的分心行为
- 温和、可忽略的提醒（不是强硬阻断）
- 三周实地研究：显著降低离任务行为

---

## 七、对 Vigilon 的启示

### 感知分层策略

Codex 的三层感知（Appshots → Computer Use → Chronicle）提供了一个清晰的参考架构：

| Vigilon 可能的感知层 | 对应 Codex | 触发方式 | 隐私风险 |
|---------------------|-----------|---------|---------|
| 项目文件感知 | — | 自动（已有） | 低 |
| 即时上下文感知 | Appshots | 用户主动 | 低 |
| Agent 主动环境感知 | Computer Use | Agent 主动 | 中 |
| 持续环境记忆 | Chronicle | 系统自动 | 高 |

### 关键判断

1. **Appshots 模式（用户主动触发）是 Phase 2 最可行的起点**。隐私风险最低，用户完全控制，不需要持续监控权限。Vigilon 可以做一个更轻量的版本——"选中一段文字/一个文件/一个终端输出 → 快捷键 → Agent 理解上下文"。

2. **AX Tree 是 Computer Use 的核心壁垒**。Codex 通过收购 Sky 获得了顶级的 macOS Accessibility 技术。Vigilon 短期内不应在 macOS 桌面自动化上和 Codex 硬碰硬——但可以在**文件系统和项目上下文**上做更深的感知（Vigilon 的本地 whiteboard runtime 优势）。

3. **Chronicle 的隐私代价决定了它不会是大众功能**。持续录屏 + 云端处理在 EU 不可用、在企业环境受限制。Vigilon 的"环境感知"应该走**本地处理 + 选择性记忆**的路线——不做全时录屏，但做关键事件的本地索引。

4. **Claude Code 的 Hooks 系统是最易参考的感知架构**。事件驱动、JSON stdin 输入、stdout 注入上下文、退出码控制——这个模式可以直接适用于 Vigilon 的感知层设计。

5. **心理生理感知（AwareLLM）虽然是研究阶段，但方向值得关注**。当 Agent 能感知用户的认知负荷和注意力状态时，适应性引导（问题域 A4）才能真正做到"在用户最需要的时候提供帮助"。

### Vigilon 的差异化感知路径

Codex 的优势在 **macOS 桌面感知**（AX Tree + 截图 + Chronicle），Claude Code 的优势在 **Session 内事件感知**（Hooks 系统）。

Vigilon 的差异化路径应该在：
- **项目上下文深度感知**：不只"当前窗口有什么"，而是"这个项目的完整技术上下文、历史决策、代码约定、团队规范"——这是 Vigilon 作为 local whiteboard runtime 的天然优势
- **本地优先 + 隐私保护**：所有感知数据本地处理，不依赖云端，满足企业和 EU 合规需求
- **信念驱动的感知**：不只"看到什么"，而是"根据看到的内容更新 belief registry，发现矛盾和过期知识"（问题域 B + D 联动）

---

## 更新日志

- 2026-05-27：初始版本，覆盖 Appshots、Computer Use、Chronicle、Claude Code Hooks、ProAgent、AwareLLM、INA
