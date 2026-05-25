<!-- vigilon_session_memory {"sessionId":"session-reviewer-001","generatedAt":"2026-05-25T10:35:00.000Z","sourceEventCount":5} -->

## Current Task

审查执行者的 auth 重构计划，重点评估删除旧目录的安全性。

## Current State

已发现 /src/legacy/auth 下存在 git 子模块 (vendor/auth-lib)。直接 rm -rf 会丢失子模块引用，导致 .gitmodules 不一致。已经向执行者提出质疑。

## Todo State

- [completed] 检查目录内容和依赖
- [completed] 发现子模块风险
- [in_progress] 向执行者提出质疑
- [pending] 等待执行者修改计划

## Important Files

- /src/legacy/auth/vendor (git 子模块)
- .gitmodules
- /src/app.ts
- /src/middleware.ts

## Next Step

等待执行者响应质疑。建议方案：先 git submodule deinit，移除 .gitmodules 中的条目，再删除物理目录。
