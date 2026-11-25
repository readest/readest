# 上游同步与发布

## 主线与发布

- `main` 是 Gratis 产品主线，包含品牌、数据目录、更新地址、签名和 Linux CEF/Arch 打包定制。
- 上游来源固定为 `readest/readest:main`；同步保留 Git merge 历史。
- `gratis` 是旧发布分支，仅供历史参考；新 nightly 和正式版均从 `main` 构建。
- GitHub Actions 每天检查上游并建立机器人 PR。分类器仅允许已知应用源码、翻译资源和 `docs/` 路径在完整 PR 检查通过后自动合并；根目录 `README.md`、构建/依赖/工作流/权限/签名相关文件及所有未知路径均须人工审查。路径未明确列入自动范围时按敏感变更处理。

## 必要 GitHub 配置

在仓库设置中安装专用 GitHub App，并创建 Actions secrets：

- `UPSTREAM_SYNC_APP_ID`
- `UPSTREAM_SYNC_APP_PRIVATE_KEY`

再创建 Actions repository variable：

- `UPSTREAM_SYNC_CANDIDATE_REPOSITORY`：一个**公开的 Gratis 仓库 fork**，格式为 `owner/repository`，不能是产品仓库本身。它只用于保存待测同步分支；GitHub App 必须安装到产品仓库和这个 fork 所属账号，并授予候选仓库 Contents: read/write。候选 fork 不得保存任何签名/发布 secrets，默认 `GITHUB_TOKEN` 权限应为只读。

产品仓库 App 权限为 Contents: read/write、Pull requests: read/write、Checks: read、Administration: read。同步流程先在无写凭据 job 中使用 `main` 上的可信 classifier 计算候选；有凭据 job 只做 Git/GitHub 操作，不执行候选代码。同步分支推到候选 fork，再以 fork PR 送入产品仓库。请保持 GitHub 对 fork PR 的 secrets 和写权限 token 禁用；PR checks 以 base 版本 workflow 运行，fork PR 不获得仓库 secrets 或写权限 token。

配置经典 branch protection 保护 `main`：要求 PR、`PR checks / Required CI` 成功且分支必须与最新 base 同步；审批数设为 0，避免阻断普通源码的 CI 后自动合并。启用管理员规则，禁止强推和删除；同步 App 不得绕过规则。敏感 PR 由 classifier 停止自动合并，仍须维护者人工审查。workflow 会通过 branch-protection API 在创建 PR 前及合并前检查保护状态；缺少严格 Required CI/PR 规则时会失败关闭。手动启动 Nightly 或 Release 时，选择 `main`。

## 每夜版

- `main` 有新提交时及每天 22:00 UTC（台湾时间 06:00）构建。
- 版本计算和所有平台工作固定在同一完整 commit SHA。
- 提供 Android、Linux x86_64/aarch64、Windows x86_64/aarch64 和 Linux x86_64 pacman 套件。Actions artifacts 保留 14 天；每夜版沿用现有 Android 与 Tauri 签名密钥。
- Arch 套件可由 pacman 安装，但没有 pacman OpenPGP 签章；nightly 套件与 stable 套件互斥。

## 正式版

- 每天 23:30 UTC 检查上游最新的正式 release。只有该 tag 的提交已合入 `main`，且 `main` 中的 app 版本精确匹配该 tag 时，才为它创建 Gratis draft release。
- Release job 固定源码 SHA 和 fork tag；建置、签名、updater manifest 与资产验证全数成功后才公开 Release 并设为 Latest。失败会留下 draft，不会把不完整的更新 manifest 推给现有用户。
- 首次启用只追上游当前最新正式版本，不自动补发历史版本。GitHub tag 使用 `gratis-vX.Y.Z`。
- 稳定发布包含 Android、Linux x86_64/aarch64、Windows x86_64/aarch64 与 Linux x86_64 Arch 包。macOS 尚未纳入，因为仓库没有可确认可用的 Apple 签章/公证配置；R2 不是发布前提。

## 人工处理

- 同步 PR 遇到冲突、敏感文件或 required CI 失败时，不会自动合并；先人工审查、解决并重新验证，再合并。
- 查看近期运行：Actions → Sync upstream、Nightly Readest、Release Gratis Readest。Stable release 建置失败时，确认该 tag 对应草稿和资产后再重跑；不要移动或覆盖已发布 tag。
- `.gradle`、`target`、`.next`、`node_modules` 和 Android 生成目录是构建产物，不要暂存提交。处理合并时先检查 `git status` 和 `git diff --name-only --diff-filter=U`；不要用 `git reset --hard` 或整体覆盖文件来消除冲突。
