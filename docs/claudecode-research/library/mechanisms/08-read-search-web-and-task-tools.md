# 读、搜、Web 与 Task 工具族

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：技能与记忆`](./07-skills-and-memory.md) | [`下一站：机制总卷`](./01-07.md)

本文聚焦一类常被低估的工具族：它们不直接改代码，但决定 Claude Code 如何观察世界、获取外部信息、以及把工作拆成显式任务。

## 1. FileReadTool 是观察层，不只是读文件

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts)

它处理的不是单纯 `readFile()`：

- 图片、PDF、notebook、memory file、session transcript 等多种文件形态
- token 上限与文件大小估算
- auto memory / conditional skills 触发
- device path 阻断
- 文件读取监听器

所以 FileReadTool 更像统一“内容摄取层”。

## 2. GrepTool 是结构化搜索，不是 shell 透传

源码镜像：[`../../sources/claude-code/src/tools/GrepTool/GrepTool.ts`](../../sources/claude-code/src/tools/GrepTool/GrepTool.ts)

它负责：

- 路径存在性校验
- permission-aware 搜索范围约束
- 输出模式切换：content / files_with_matches / count
- limit / offset 分页
- VCS 目录与 plugin cache 噪音过滤

这意味着 GrepTool 的价值在于“可控搜索结果”，不是单纯复用 `rg`。

## 3. WebSearchTool 是外部实时知识面

源码镜像：[`../../sources/claude-code/src/tools/WebSearchTool/WebSearchTool.ts`](../../sources/claude-code/src/tools/WebSearchTool/WebSearchTool.ts)

它与普通本地工具很不同：

- 依赖 provider 是否支持 web search
- 通过 model 调用内建 `web_search_20250305` server tool
- 可控制 allowed / blocked domains
- 返回搜索 hit 与文本解释混合结果
- 权限语义是显式 `passthrough`

因此它不是“调用搜索 API 的一个小 wrapper”，而是模型能力扩展面的一部分。

## 4. TaskCreateTool 说明任务工具族的产品方向

源码镜像：[`../../sources/claude-code/src/tools/TaskCreateTool/TaskCreateTool.ts`](../../sources/claude-code/src/tools/TaskCreateTool/TaskCreateTool.ts)

即使是最简单的 `TaskCreateTool`，也在做：

- 真实 task list 写入
- task-created hooks
- 阻断时回滚已创建任务
- 自动展开 task list 视图

这意味着任务工具不是“TodoWrite 的另一种写法”，而是在操作产品内建的任务模型。
