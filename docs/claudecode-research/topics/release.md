# 版本 / 发布 / 分发专题（Claude Code / OpenClaw / Hermes Agent）

> 范围：版本标识与构建信息、更新检查与通道、自动/手动更新、失败路径与回滚保护、依赖/运行时 gate、release notes/迁移提示机制。  
> 证据规范：每条结论必须包含 Evidence ID（REL-CC/OC/HA-###），并落到“文件 + 符号（函数/类型/常量）”；证据类型标注 CODE/TEST/CONFIG。

## TL;DR
- **Claude Code**：具备专门的 update 命令与 auto-updater/notes 模块，通常将“更新检查/安装/提示”作为一等 CLI 能力。
- **OpenClaw**：更新体系集中在 `infra/update-*`，并配套 test 覆盖更新通道、包管理器与 runner；发布/更新偏工程化与可测。
- **Hermes Agent**：分发以 Python packaging + 安装脚本为主，更新入口通常体现在 CLI 命令与安装脚本策略。

## 对齐维度
| 子维度 | 关注点 |
|---|---|
| 版本标识 | semver/构建号/commit 信息来源 |
| 更新检查 | 频率、缓存、通道（stable/beta/dev） |
| 应用更新 | 自动/手动、权限、平台差异 |
| 失败路径 | 网络失败、dirty tree、依赖缺失、回滚 |
| 兼容性 gate | Node/Python 版本、包管理器/lockfile |
| Release notes | 缓存、迁移提示、开关 |

---

## Evidence-backed Findings（按项目）

### Claude Code（CC）
> 代码根：`research/sources/claude-code/`

- **REL-CC-001（CODE）**：`claude update` 会打印当前版本并按设置选择更新通道（默认 `latest`），同时埋点“更新检查”事件。  
  - 证据：`sources/claude-code/src/cli/update.ts` → `update()`：`writeToStdout(\`Current version: ${MACRO.VERSION}\`)`、`getInitialSettings()?.autoUpdatesChannel ?? 'latest'`、`logEvent('tengu_update_check', {})`

- **REL-CC-002（CODE）**：更新前会运行 doctor 诊断，收集“安装类型/配置期望/多安装冲突/告警与修复建议”，把更新失败风险前置为可读输出。  
  - 证据：`sources/claude-code/src/cli/update.ts` → `update()`：`getDoctorDiagnostic()`、`diagnostic.multipleInstallations`、`diagnostic.warnings[] (issue/fix)`

- **REL-CC-003（CODE）**：更新逻辑会把“安装方式 installMethod”持久化到全局配置，并在“配置与现实不一致”时自动纠偏（避免更新错装）。  
  - 证据：`sources/claude-code/src/cli/update.ts` → `getGlobalConfig()` / `saveGlobalConfig(...)`、`typeMapping`、`configExpects vs runningType` mismatch 分支

- **REL-CC-004（CODE）**：若检测到 development build，会显式拒绝更新并退出，避免覆盖开发环境。  
  - 证据：`sources/claude-code/src/cli/update.ts` → `if (diagnostic.installationType === 'development') ... gracefulShutdown(1)`

- **REL-CC-005（CODE）**：若检测到 package-manager 安装，会根据不同包管理器输出“推荐更新命令”，而不是尝试自更新（Homebrew/winget/apk 有明确指令；其它只给泛化提示）。  
  - 证据：`sources/claude-code/src/cli/update.ts` → `if (diagnostic.installationType === 'package-manager') ... getPackageManager()`；分支：`homebrew/winget/apk/else`

- **REL-CC-006（CODE）**：package-manager 分支下仍会查询最新版本并做 semver 比较（避免提示无意义更新）。  
  - 证据：`sources/claude-code/src/cli/update.ts` → `getLatestVersion(channel)` + `gte(MACRO.VERSION, latest)` 判定

- **REL-CC-007（CODE）**：native 安装更新优先走 native updater，并显式处理“锁竞争（另一个进程正在运行）”与“失败建议运行 doctor”。  
  - 证据：`sources/claude-code/src/cli/update.ts` → `installLatestNative(channel, true)`；`result.lockFailed` / `result.lockHolderPid`；catch：`Try running "claude doctor"...`

- **REL-CC-008（CODE）**：更新成功后会重建 completion cache，体现“更新后体验修复”的工程化细节。  
  - 证据：`sources/claude-code/src/cli/update.ts` → `regenerateCompletionCache()`

- **REL-CC-009（CODE）**：存在“最低版本门禁”：通过动态配置（growthbook）下发 `minVersion`，若当前版本过旧则强制提示 `claude update` 并退出。  
  - 证据：`sources/claude-code/src/utils/autoUpdater.ts` → `assertMinVersion()`：`getDynamicConfig_BLOCKS_ON_INIT('tengu_version_config', {minVersion})` + `lt(MACRO.VERSION, minVersion)` + `gracefulShutdownSync(1)`

- **REL-CC-010（CODE）**：存在“最大版本上限（事故期间暂停自动更新的 kill switch）”，并提供面向用户的解释文案（按 ant/external 分流）。  
  - 证据：`sources/claude-code/src/utils/autoUpdater.ts` → `getMaxVersion()` / `getMaxVersionMessage()` / `getMaxVersionConfig()`：读取 `tengu_max_version_config`

- **REL-CC-011（CODE）**：全局更新安装采用 lockfile 互斥，并包含 stale lock 回收 + TOCTOU 重检，避免两进程同时认为“自己持锁”。  
  - 证据：`sources/claude-code/src/utils/autoUpdater.ts` → `LOCK_TIMEOUT_MS`、`getLockFilePath()`、`acquireLock()`：`stat`→recheck→`unlink`→`writeFile(flag:'wx')`

- **REL-CC-012（CODE）**：release notes 采用“后台抓取 + 本地缓存 + 下次启动展示”的策略，并尊重“非交互模式/仅必要流量”开关以减少网络流量。  
  - 证据：`sources/claude-code/src/utils/releaseNotes.ts` → `fetchAndStoreChangelog()`：`getIsNonInteractiveSession()`、`isEssentialTrafficOnly()`；`CHANGELOG_URL/RAW_CHANGELOG_URL`、`getChangelogCachePath()`、`migrateChangelogFromConfig()`、`getRecentReleaseNotes(...)`

---

### OpenClaw（OC）
> 代码根：`research/sources/openclaw/`

- **REL-OC-001（CODE）**：更新通道是强类型 union（`stable|beta|dev`），并对 git/package 安装提供不同默认（git 默认为 dev，package 默认为 stable）。  
  - 证据：`sources/openclaw/src/infra/update-channels.ts` → `UpdateChannel`、`DEFAULT_GIT_CHANNEL`、`DEFAULT_PACKAGE_CHANNEL`、`DEV_BRANCH`

- **REL-OC-002（CODE）**：有效通道由 config/git tag/git branch 共同决定，并输出包含来源的 label（config/git-tag/git-branch/default）。  
  - 证据：`sources/openclaw/src/infra/update-channels.ts` → `resolveEffectiveUpdateChannel(...)` / `resolveUpdateChannelDisplay(...)` / `formatUpdateChannelLabel(...)`

- **REL-OC-003（CODE）**：`channel → npm dist-tag` 映射显式实现（stable→latest，beta→beta，dev→dev）。  
  - 证据：`sources/openclaw/src/infra/update-channels.ts` → `channelToNpmTag(...)`

- **REL-OC-004（CODE）**：更新检查结果结构化为 `UpdateCheckResult`，同时报告 installKind（git/package）、package manager、git 状态、依赖状态与 registry 版本。  
  - 证据：`sources/openclaw/src/infra/update-check.ts` → `UpdateCheckResult` / `checkUpdateStatus(...)`

- **REL-OC-005（CODE）**：git 更新状态检查并行执行多个 git 命令并带超时，同时记录 `ahead/behind/dirty/tag/upstream` 等字段；可选执行 `git fetch`。  
  - 证据：`sources/openclaw/src/infra/update-check.ts` → `checkGitUpdateStatus(...)`：`Promise.all([...])`、`timeoutMs`、`fetchOk`、`rev-list --left-right --count`

- **REL-OC-006（CODE）**：dirty 检查会排除 `dist/control-ui/`，避免构建产物影响“是否有未提交变更”的判断。  
  - 证据：`sources/openclaw/src/infra/update-check.ts` → `git status --porcelain -- :!dist/control-ui/`；`sources/openclaw/src/infra/update-runner.ts` → `clean check` step 同样使用该 pathspec

- **REL-OC-007（CODE）**：依赖状态检查通过“lockfile mtime vs install marker mtime（+1s 容差）”判定 node_modules 是否 stale。  
  - 证据：`sources/openclaw/src/infra/update-check.ts` → `checkDepsStatus(...)`：`if (lockMtime > markerMtime + 1000) status:'stale'`

- **REL-OC-008（CODE）**：可直接查询 npm registry 的 target（tag 或版本）并提取 `version` 与 `engines.node`，为兼容性 gate 提供数据。  
  - 证据：`sources/openclaw/src/infra/update-check.ts` → `fetchNpmPackageTargetStatus(...)`：请求 `https://registry.npmjs.org/openclaw/<target>`，解析 `engines.node`

- **REL-OC-009（CODE）**：beta 通道解析具备“beta 落后则回退 latest”的策略，避免 beta tag 反而更旧导致误降级。  
  - 证据：`sources/openclaw/src/infra/update-check.ts` → `resolveNpmChannelTag(...)`：`compareSemverStrings(beta, latest)` 后回退

- **REL-OC-010（CODE）**：更新时会解析并尽量使用“偏好包管理器”，pnpm 缺失时可尝试 corepack enable；仍不可用则用 npm bootstrap 临时 pnpm（并 PATH prepend + cleanup）。  
  - 证据：`sources/openclaw/src/infra/update-package-manager.ts` → `resolveUpdateBuildManager(...)` / `enablePnpmViaCorepack(...)` / `bootstrapPnpmViaNpm(...)` / `applyPathPrepend(...)`

- **REL-OC-011（CODE）**：安装命令支持 compat fallback（npm `--no-package-lock --legacy-peer-deps`）与 ignore-scripts，体现对失败路径与安全面的显式考虑。  
  - 证据：`sources/openclaw/src/infra/update-package-manager.ts` → `managerInstallArgs(... {compatFallback})` / `managerInstallIgnoreScriptsArgs(...)`

- **REL-OC-012（CODE）**：全局安装与分发完整性有工程化校验：quiet flags（no-audit/no-fund）、package dist inventory、critical sidecar 路径清单与缺失/意外文件检测。  
  - 证据：`sources/openclaw/src/infra/update-global.ts` → `NPM_GLOBAL_INSTALL_QUIET_FLAGS` / `NPM_GLOBAL_INSTALL_OMIT_OPTIONAL_FLAGS`；`collectInstalledGlobalPackageErrors(...)`、`PACKAGE_DIST_INVENTORY_RELATIVE_PATH`、`collectInstalledPathErrors(...)`

---

### Hermes Agent（HA）
> 代码根：`research/sources/hermes-agent/`

- **REL-HA-001（CONFIG）**：版本与运行时门禁在 packaging 层显式声明（版本号、Python 版本要求、入口脚本）。  
  - 证据：`sources/hermes-agent/pyproject.toml` → `[project].version`、`requires-python = ">=3.11"`；`[project.scripts] hermes/hermes-agent`

- **REL-HA-002（CONFIG）**：核心依赖固定在“已知安全范围”，并以 CVE 注释标注风险（供应链防线的一部分）。  
  - 证据：`sources/hermes-agent/pyproject.toml` → dependencies 注释 “pinned to known-good ranges…”；如 `requests ... # CVE-2026-25645`、`PyJWT[crypto] ... # CVE-2026-32597`

- **REL-HA-003（CONFIG）**：通过 optional extras 分离“wheel-only/平台敏感依赖”（如 voice），降低对 Homebrew 等源构建分发渠道的破坏性。  
  - 证据：`sources/hermes-agent/pyproject.toml` → `[project.optional-dependencies].voice` 注释（ctranslate2/onnxruntime 等）

- **REL-HA-004（CODE）**：安装脚本把安装目录/数据目录/分支作为可配置项，并声明 Python/Node 版本目标。  
  - 证据：`sources/hermes-agent/scripts/install.sh` → `HERMES_HOME` / `INSTALL_DIR` / `BRANCH` / `PYTHON_VERSION` / `NODE_VERSION`；参数解析 `--branch/--dir/--hermes-home`

- **REL-HA-005（CODE）**：安装脚本显式检测“非交互模式（curl|bash）”，避免 `read -p` EOF 导致 `set -e` 静默中断。  
  - 证据：`sources/hermes-agent/scripts/install.sh` → `if [ -t 0 ]; then IS_INTERACTIVE=true else false`（含注释说明）

- **REL-HA-006（CODE）**：安装脚本对 Windows 直接提示使用 PowerShell installer 并退出（分发渠道分流）。  
  - 证据：`sources/hermes-agent/scripts/install.sh` → `detect_os()`：`Windows detected... install.ps1`

- **REL-HA-007（CODE）**：默认使用 uv 作为安装器，并实现多路径探测 + curl 安装回退；Termux 场景则切换到 stdlib venv + pip。  
  - 证据：`sources/hermes-agent/scripts/install.sh` → `install_uv()`：查找 `uv`（PATH/`~/.local/bin`/`~/.cargo/bin`）+ `astral.sh/uv/install.sh`；Termux 分支注释

- **REL-HA-008（CODE）**：更新流程会清理 `__pycache__`（排除 venv/node_modules/.git），避免代码更新后因陈旧字节码导致 ImportError。  
  - 证据：`sources/hermes-agent/hermes_cli/main.py` → `_clear_bytecode_cache(root)`（含注释解释原因）

- **REL-HA-009（CODE）**：gateway 模式下的更新交互采用“文件 IPC prompt/response”转发给消息渠道，并带超时 default。  
  - 证据：`sources/hermes-agent/hermes_cli/main.py` → `_gateway_prompt(...)`：`.update_prompt.json` / `.update_response`、timeout fallback

- **REL-HA-010（CODE）**：Windows 场景提供 ZIP 更新路径，并包含 zip-slip 防护；复制更新时保留关键目录（venv/node_modules/.git/.env）。  
  - 证据：`sources/hermes-agent/hermes_cli/main.py` → `_update_via_zip(args)`：zip-slip 检测、`preserve = {'venv','node_modules','.git','.env'}`

- **REL-HA-011（CODE）**：更新后会执行 Python 依赖更新（uv 优先；否则显式 `ensurepip` 恢复 pip），并可选构建 web UI（npm 可用则 build，不可用给出手动指令）。  
  - 证据：`sources/hermes-agent/hermes_cli/main.py` → `_update_via_zip`：`_install_python_dependencies_with_optional_fallback(...)` / `ensurepip`；`_build_web_ui(...)`（npm 检测与指令）

- **REL-HA-012（CODE）**：更新对本地改动采用“自动 stash→更新→可选恢复”，并在冲突时硬重置到干净状态以保持系统可运行（用户改动仍在 stash）。  
  - 证据：`sources/hermes-agent/hermes_cli/main.py` → `_stash_local_changes_if_needed(...)` / `_restore_stashed_changes(...)`：unmerged index 处理、conflict detection、`git reset --hard HEAD`

---

## Evidence Index（按 ID）
### Claude Code（CC）
- REL-CC-001：`src/cli/update.ts` → `update`（channel selection + version output + event）
- REL-CC-002：`src/cli/update.ts` → `getDoctorDiagnostic`（warnings/multiple installs）
- REL-CC-003：`src/cli/update.ts` → `getGlobalConfig` / `saveGlobalConfig`（installMethod 纠偏）
- REL-CC-004：`src/cli/update.ts` → development build early exit
- REL-CC-005：`src/cli/update.ts` → package-manager flows (`getPackageManager`)
- REL-CC-006：`src/cli/update.ts` → `getLatestVersion` + `gte`
- REL-CC-007：`src/cli/update.ts` → `installLatestNative`（lockFailed/lockHolderPid）
- REL-CC-008：`src/cli/update.ts` → `regenerateCompletionCache`
- REL-CC-009：`src/utils/autoUpdater.ts` → `assertMinVersion`
- REL-CC-010：`src/utils/autoUpdater.ts` → `getMaxVersion` / `getMaxVersionMessage`
- REL-CC-011：`src/utils/autoUpdater.ts` → `acquireLock` / `getLockFilePath` / `LOCK_TIMEOUT_MS`
- REL-CC-012：`src/utils/releaseNotes.ts` → `fetchAndStoreChangelog` / `migrateChangelogFromConfig` / `getRecentReleaseNotes`

### OpenClaw（OC）
- REL-OC-001：`src/infra/update-channels.ts` → `UpdateChannel` / `DEFAULT_*` / `DEV_BRANCH`
- REL-OC-002：`src/infra/update-channels.ts` → `resolveUpdateChannelDisplay`
- REL-OC-003：`src/infra/update-channels.ts` → `channelToNpmTag`
- REL-OC-004：`src/infra/update-check.ts` → `checkUpdateStatus` / `UpdateCheckResult`
- REL-OC-005：`src/infra/update-check.ts` → `checkGitUpdateStatus`
- REL-OC-006：`src/infra/update-check.ts` + `src/infra/update-runner.ts` → dirty check excludes `dist/control-ui`
- REL-OC-007：`src/infra/update-check.ts` → `checkDepsStatus`（mtime stale）
- REL-OC-008：`src/infra/update-check.ts` → `fetchNpmPackageTargetStatus`（node engine）
- REL-OC-009：`src/infra/update-check.ts` → `resolveNpmChannelTag`
- REL-OC-010：`src/infra/update-package-manager.ts` → `resolveUpdateBuildManager` / corepack/bootstrap
- REL-OC-011：`src/infra/update-package-manager.ts` → `managerInstallArgs` / `managerInstallIgnoreScriptsArgs`
- REL-OC-012：`src/infra/update-global.ts` → `NPM_GLOBAL_INSTALL_QUIET_FLAGS` / `collectInstalledGlobalPackageErrors`

### Hermes Agent（HA）
- REL-HA-001：`pyproject.toml` → version / requires-python / scripts
- REL-HA-002：`pyproject.toml` → pinned deps + CVE 注释
- REL-HA-003：`pyproject.toml` → optional extras（voice/homebrew）
- REL-HA-004：`scripts/install.sh` → `HERMES_HOME`/`INSTALL_DIR`/`BRANCH`/`PYTHON_VERSION`/`NODE_VERSION`
- REL-HA-005：`scripts/install.sh` → `IS_INTERACTIVE` 检测
- REL-HA-006：`scripts/install.sh` → Windows PowerShell installer 提示
- REL-HA-007：`scripts/install.sh` → `install_uv()` 多路径探测 + curl 安装；Termux 分支
- REL-HA-008：`hermes_cli/main.py` → `_clear_bytecode_cache`
- REL-HA-009：`hermes_cli/main.py` → `_gateway_prompt`
- REL-HA-010：`hermes_cli/main.py` → `_update_via_zip`（zip-slip + preserve）
- REL-HA-011：`hermes_cli/main.py` → `ensurepip` + `_build_web_ui`
- REL-HA-012：`hermes_cli/main.py` → `_stash_local_changes_if_needed` / `_restore_stashed_changes`
