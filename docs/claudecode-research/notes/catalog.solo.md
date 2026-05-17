# Master Catalog（兼容入口）

旧版 `catalog.solo.md` 依赖带会话 ID 的 `computer:///` 链接，换机器、换会话或换预览器后会整体失效，因此不再作为独立导航库维护。

请改用以下稳定入口：

- 总目录：[`catalog.md`](./catalog.md)
- Claude Code 主馆藏：[`../library/README.md`](../library/README.md)
- 源码库：[`../src/`](../src/)

如果某个渲染器无法正确处理相对链接，应修复渲染器或补充通用预览适配，而不是继续把会话私有 URI 写进馆藏正文。
