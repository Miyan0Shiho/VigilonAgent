<!-- vigilon_session_memory {"sessionId":"session-executor-001","generatedAt":"2026-05-25T10:30:00.000Z","sourceEventCount":11} -->

## Current Task

重构 auth 模块：将旧代码从 /src/legacy/auth 迁移到 /src/auth，删除旧目录。

## Current State

执行者已创建新 /src/auth 模块，迁移了 createUser/validateToken/refreshSession 逻辑。但删除旧目录时被安全机制阻止——发现 git 子模块引用。审查者介入质疑了删除操作。

## Todo State

- [completed] 创建新 /src/auth 模块
- [completed] 迁移旧代码到新模块
- [completed] 更新 3 处引用
- [pending] 删除旧目录 (被阻止)
- [pending] 运行测试验证

## Important Files

- /src/legacy/auth/index.ts (待删除)
- /src/auth/index.ts (新创建)
- /src/app.ts (已更新引用)
- /src/middleware.ts (已更新引用)
- .gitmodules (发现子模块引用)

## Next Step

在删除旧目录前，需要先检查并移除 git 子模块引用。审查者建议增加 .git 检查步骤。
