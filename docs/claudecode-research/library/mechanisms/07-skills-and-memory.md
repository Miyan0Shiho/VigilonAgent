# Skills、Memory 与长期上下文

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：集成与产品工作流命令`](../commands/03-integration-and-product-workflow-commands.md) | [`下一站：读、搜、Web 与 Task 工具族`](./08-read-search-web-and-task-tools.md)

本文聚焦三套容易被混淆的长期上下文系统：skills、memdir typed memory，以及 SessionMemory。

## 1. Skills 是“按需加载能力包”

源码镜像：[`../../sources/claude-code/src/skills/loadSkillsDir.ts`](../../sources/claude-code/src/skills/loadSkillsDir.ts)

`loadSkillsDir.ts` 说明 skills 至少有这些属性：

- 可以来自 project、user、managed、plugin、bundled、mcp
- 有 frontmatter，包含 description、allowed-tools、arguments、model、effort、hooks、paths、context 等
- 需要做文件去重、path 作用域处理、frontmatter 校验、shell frontmatter 处理

所以 skills 不是“几个 Markdown 提示词”，而是文件型、可路由、可组合的能力对象。

## 2. skills 的加载问题本质是“发现 + 作用域 + 安全”

`getSkillsPath()`、`parseSkillFrontmatterFields()`、`parseSkillPaths()` 说明，skills 系统在解决：

- 技能文件在哪里找
- 哪些技能在当前目录或文件路径下应当生效
- 哪些技能允许用户手动调用，哪些只应模型内部使用
- 哪些技能会附带 hooks 或 shell 行为

因此 skill loader 更接近一个小型配置/插件加载器。

## 3. memdir typed memory 是跨会话长期记忆

源码镜像：[`../../sources/claude-code/src/memdir/memdir.ts`](../../sources/claude-code/src/memdir/memdir.ts)

`memdir.ts` 明确把长期记忆建模成：

- 一个 `MEMORY.md` 入口索引
- 多个独立 memory files
- 明确的类型体系、何时访问、何时不该保存的规则
- 自动目录创建与大小/行数截断

它的目标是让 Claude Code 在未来会话中记住用户、项目和反馈，而不是只靠当前 transcript。

## 4. SessionMemory 不是同一回事

源码镜像：[`../../sources/claude-code/src/services/SessionMemory/sessionMemory.ts`](../../sources/claude-code/src/services/SessionMemory/sessionMemory.ts)

SessionMemory 的目标不同：

- 自动维护当前会话的 markdown 笔记
- 基于 token threshold 和 tool-call threshold 决定何时抽取
- 在后台用 forked subagent 做总结
- 读写 `session-memory` 目录中的会话级文件

所以：

- memdir = 跨会话长期记忆
- SessionMemory = 当前长会话的自动摘要与辅助上下文
- skills = 按需注入的能力/知识包

## 5. 为什么这三者必须拆开讲

如果把它们都叫“memory”，会立刻混淆：

- 哪些内容应长期保存
- 哪些内容只是当前会话摘要
- 哪些内容其实是 workflow / knowledge package，而不是记忆

这也是长期上下文层必须单独成卷的原因。
