# AGENTS.md - /home/readest 初始化上下文

> 目的：给后续 Agent / 助手一个项目入口说明，避免每次从零开始分析。本文件记录本服务器上的仓库结构、低噪声分析方法、部署脚本、以及已经定位过的关键业务入口。

## 1. 当前仓库概览

- 仓库路径：`/home/readest`
- 主应用：`apps/readest-app`
- 技术栈：Next.js + Tauri v2 + TypeScript，pnpm monorepo。
- 详细前端/应用规则：见 `apps/readest-app/AGENTS.md`。
- Docker 部署配置目录：`docker/`
- 运维脚本目录：`bin/`

常见顶层目录：

```text
apps/readest-app              主前端 / Tauri 应用
apps/readest-calibre-plugin   Calibre 插件
apps/readest.koplugin         KOReader 插件
packages/                     monorepo 内部包、Tauri fork/plugins 等
docker/                       Docker compose 部署配置
bin/                          本服务器启动/停止脚本
backups/                      本地备份目录
```

## 2. 本服务器部署方式

本项目在当前服务器上已有两个脚本：

```bash
/home/readest/bin/start.sh
/home/readest/bin/stop.sh
```

脚本内容：

```bash
# start.sh
cd /home/readest/docker
docker compose -f compose.local.yaml -f compose.build.yaml up --build -d

# stop.sh
cd /home/readest/docker
docker compose -f compose.local.yaml down
```

因此，前端源码修改后如需线上生效，通常执行：

```bash
/home/readest/bin/start.sh
```

它会重新 build 并后台启动/替换容器。一般不需要先 stop，除非排查容器状态或需要完整停机。

## 3. 低噪声分析原则

用户明确不希望每次修改都大范围搜索代码，也不希望控制台刷大量输出。

### 推荐顺序

1. **先看本文件和相关 AGENTS 文档**
   - 根目录：`/home/readest/AGENTS.md`
   - 主应用：`/home/readest/apps/readest-app/AGENTS.md`
2. **先根据功能归属定位目录**，不要上来全仓库 grep。
3. **搜索只输出文件名**，不要输出匹配内容。
4. **限制搜索范围**，优先限定到 `apps/readest-app/src` 或更小目录。
5. **读取文件用 SFTP 或小范围 sed**，避免整屏刷日志。
6. **验证也要小范围**，优先 `git diff --name-only`、`grep -n` 精确确认。

### 避免搜索的目录

除非明确需要，不要搜索：

```text
node_modules
.git
.next
dist
build
out
coverage
.cache
```

### 没有 rg 时

当前服务器曾出现：

```text
Command 'rg' not found
```

所以可以用 `grep -RIlE` 代替，只输出文件名，例如：

```bash
cd /home/readest
grep -RIlE 'quota|Quota|translation|limit|usage' apps/readest-app/src 2>/dev/null | head -80
```

如果只是看设置相关，优先限定：

```bash
grep -RIlE 'quota|Quota|translation|subscription|storage' \
  apps/readest-app/src/app/user \
  apps/readest-app/src/components \
  apps/readest-app/src/hooks \
  apps/readest-app/src/types 2>/dev/null | head -80
```

## 4. 设置 / 账户页相关入口

用户强调：“这些都是设置相关，重点看设置”。

设置 / 账户页目前重点入口：

```text
apps/readest-app/src/app/user/page.tsx
apps/readest-app/src/app/user/components/UsageStats.tsx
apps/readest-app/src/app/user/components/AccountActions.tsx
apps/readest-app/src/components/Quota.tsx
apps/readest-app/src/hooks/useQuotaStats.ts
apps/readest-app/src/types/quota.ts
apps/readest-app/src/utils/access.ts
apps/readest-app/src/app/user/utils/plan.ts
```

### 额度显示链路

```text
user/page.tsx
  -> UsageStats.tsx
    -> useQuotaStats.ts 生成 quotas
    -> Quota.tsx 统一渲染 used / total / progress
```

关键文件职责：

- `useQuotaStats.ts`
  - 读取 token/user 中的 storage/translation quota 数据。
  - 组装 `QuotaType[]`。
- `Quota.tsx`
  - 统一显示额度名称、已用/总量、进度条、重置提示。
- `types/quota.ts`
  - 定义 `QuotaType`、`UserPlan` 等类型。
- `AccountActions.tsx`
  - 账户设置页下方按钮区，例如管理同步、管理存储、重置密码、退出登录等。

## 5. 已做过的本地定制

### 5.1 翻译额度改为每日 10M

用户已经把翻译服务对接到 CPA AI，不再使用原本 `49K` 翻译额度。当前定制目标：

- 不显示 `0 / 49K`。
- 不使用无穷符号 `∞`。
- 翻译额度最高显示为每天 `10M`。
- 每天刷新/重置，保留重置倒计时。
- 样式和空间占用一样，有进度条背景，进度按实际使用量 / 10M 计算。

涉及文件：

```text
apps/readest-app/src/hooks/useQuotaStats.ts
apps/readest-app/src/components/Quota.tsx
apps/readest-app/src/types/quota.ts
```

当前显示逻辑：

```text
0 / 10 M
```

`useQuotaStats.ts` 中固定每日翻译额度：

```ts
const DAILY_TRANSLATION_QUOTA = 10 * 1024 * 1024;
```

翻译 quota 应设置：

```ts
used: parseFloat((translationPlan.usage / 1024 / 1024).toFixed(2)),
total: 10,
unit: 'M',
resetAt: translationResetAt,
```

`Quota.tsx` 不应包含 `unlimited` 或 `∞` 显示逻辑。

### 5.2 移除“管理订阅”按钮

用户要求去掉设置页下方 “Manage Subscription / 管理订阅” 按钮。

涉及文件：

```text
apps/readest-app/src/app/user/components/AccountActions.tsx
```

该组件中不应再渲染：

```text
Manage Subscription
```

如果后续需要确认，用低噪声检查：

```bash
cd /home/readest
if grep -n 'Manage Subscription' apps/readest-app/src/app/user/components/AccountActions.tsx; then
  echo 'warning: Manage Subscription still exists'
else
  echo 'Manage Subscription removed'
fi
```

## 6. 验证方法

当前服务器环境曾经没有 `node`：

```text
Command 'node' not found
```

所以在这台机器上不一定能直接跑 `pnpm lint` 或 `pnpm build`。优先做低噪声静态确认：

```bash
cd /home/readest

git diff --name-only

grep -n 'DAILY_TRANSLATION_QUOTA\|total: 10\|unit: .M.' apps/readest-app/src/hooks/useQuotaStats.ts

grep -n '∞\|unlimited' \
  apps/readest-app/src/hooks/useQuotaStats.ts \
  apps/readest-app/src/components/Quota.tsx \
  apps/readest-app/src/types/quota.ts || true

grep -n '\[REDACTED\]' \
  apps/readest-app/src/app/user/components/AccountActions.tsx \
  apps/readest-app/src/components/Quota.tsx || true
```

如果 Node/pnpm 可用，再考虑：

```bash
cd /home/readest/apps/readest-app
pnpm lint
pnpm build
```

如果是部署验证，使用：

```bash
/home/readest/bin/start.sh
```

然后检查容器状态：

```bash
cd /home/readest/docker
docker compose -f compose.local.yaml ps
```

## 7. Git / 推送记录

曾将当前项目强制推送到：

```text
https://github.com/youtatu-hub/readest.git
```

本地 `origin` 已被设置为该仓库。

推送时应避免把 token 写入 git remote URL 或配置文件。推荐用临时 askpass 文件，推送后删除临时凭据。

## 8. 后续 Agent 工作建议

- 不要每次从项目根目录做大范围内容搜索。
- 对“设置页 / 账户页 / 额度显示”问题，优先查看第 4 节列出的文件。
- 对部署问题，优先看 `bin/start.sh`、`bin/stop.sh` 和 `docker/compose*.yaml`。
- 写文件前先确认已有 AGENTS 文档和当前 git diff。
- 修改完成后汇报：
  - 修改文件
  - 核心逻辑变化
  - 是否需要 rebuild/restart
  - 如果未运行构建，说明原因
