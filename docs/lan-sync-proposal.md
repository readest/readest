# 局域网同步方案 v2（已拍板，进入实施）

> **v2 · 2026-08-29**。所有者已对 §8 决策点全部拍板（见 §8 拍板记录），方案 A 进入实施。
> v1→v2 主要变更：①写入全部拍板结论；②修正 §4.1 服务器目录设计（**不**原样暴露 Books，改用独立 LanSync 树）；③§4.3 补付费墙特判；④§4.4 写入发现模块 spike 结论（自研多播）；⑤新增 §5 legado/小幻阅读借鉴论证；⑥分期重排（发现提前至 M1.5，书文件降 M2 可选）。
> 所有 `file:line` 相对仓库根，基于 v0.12.6 勘察 + feat/lan-sync 分支 M1 实现现状。

## 1. 目标与非目标

**目标**：不依赖任何云服务，Windows 与 Android 通过家庭局域网双向同步：阅读进度、笔记/高亮/书签、阅读配置（M1）；书籍文件与封面（M2，可选）。

**匹配模型（v2 写明）**：两端运行同一个 app，书籍以 `bookHash`（partialMD5，`types/book.ts:99-100`）天然同构匹配——**不存在 legado 式「书名+作者模糊匹配、章节标题对齐索引」的跨协议匹配问题，也不引入那套逻辑**（论证见 §5）。

**非目标**：legado 协议兼容；跨互联网/中继同步；改动上游云同步（Readest Cloud / WebDAV / S3 / GDrive / OneDrive / iCloud 原样保留，局域网同步是第 6 种文件同步后端）；Android 前台服务常驻（拍板：打开 app 即同步）。

## 2. 现有设施盘点（可复用资产）

| 资产 | 位置 | 价值 |
|---|---|---|
| 文件同步引擎 FileSyncEngine | `services/sync/file/engine.ts:243` | 进度/笔记/书文件/书架索引全部拉推、合并、短路逻辑，后端无关 |
| 后端接口 FileSyncProvider | `services/sync/file/provider.ts:52-93` | 9 个必需方法 + 2 个可选流式方法；官方注释：「实现一个新后端只需写这一个接口」（provider.ts:2-9）；错误契约 read/head 404→null，其余抛 `FileSyncError`（:19-31） |
| 合并策略 | `services/sync/file/merge.ts` | 笔记按 id 并集 + updatedAt 元素级 CRDT（:34-54）；进度/配置 LWW（:70-109）；删除墓碑 |
| 远端目录布局 | `services/sync/file/layout.ts:30-38` | 冻结 wire 格式：`<root>/Readest/library.json` + `Readest/books/<hash>/{书文件,cover.png,config.json}` |
| 后端注册工厂 | `services/sync/file/providerRegistry.ts:21,76-99` | 加 `'lan'` 一例即可 |
| 同步触发钩子 | `useFileSync.ts` / `useLibraryFileSync.ts:31-56` / `store/fileSyncStore.ts` | 新后端零改动继承全部触发时机与互斥锁 |
| 网络权限 | `src-tauri/capabilities/default.json:85-115`（http://*:* 放行）、`tauri.conf.json:16`（CSP connect-src） | webview 直连局域网 HTTP 无需改权限 |
| 网卡枚举 | `if-addrs`（Cargo.toml:96）；三份现成实现：`localsend/commands.rs:7-24`、`lan_sync/mod.rs:61-76`、koplugin 移植版 | 含 VPN 隧道过滤（tun/utun/ppp/wg） |
| Android 多播 | `gen/android/app/src/main/AndroidManifest.xml:3-7`（INTERNET + ACCESS_WIFI_STATE + CHANGE_WIFI_MULTICAST_STATE 已声明）；MulticastLock 桥 `plugins/tauri-plugin-native-bridge/android/.../NativeBridgePlugin.kt:550-569`，前端 `utils/bridge.ts:153-157`，启停挂钩 `LocalSendManager.tsx:83-104` | 自研多播零新增权限 |
| **lan_sync 服务器（M1 已落地，指挥官）** | `src-tauri/src/lan_sync/`（axum，端口 **53430**） | token 中间件（server.rs:56-74）、`/ping` 返回 device_id（server.rs:142-151）、防目录穿越；安全模型 = 明文 HTTP + Bearer token 为 deliberate trade-off（mod.rs:14-19） |

## 3. 方案选型（已拍板：A）

| | A. 新增 `'lan'` 后端 + 自研轻量 REST 服务器 | B. 复用 LocalSend 协议 | C. 内嵌 WebDAV 服务器复用 WebDAVProvider |
|---|---|---|---|
| TS 侧 | LanSyncProvider ~150 行 + 7 处注册 + UI | 巨大且语义不匹配 | ≈0 |
| Rust 侧 | axum 六端点 ~200-300 行 | 已有但语义不匹配 | WebDAV 子集 ~500 行或引入 dav-server |
| 结论 | **✅ 拍板采用** | 排除 | 排除 |

## 4. 详细设计

### 4.1 服务器端（Rust `src-tauri/src/lan_sync/`，指挥官实现中）

**v2 修正**：服务器 **不** 原样暴露本地 `Books/` 目录。HTTP 根 = 每设备独立的远端格式目录树 `<app_data>/LanSync/`（类迷你 WebDAV）。理由：

1. **布局隔离**：本地 `Books/<hash>/` 与远端 `Readest/books/<hash>/` 本就是两套布局（本地无 `Readest/` 前缀层），由 LocalStore/Provider 分工隔离（`localStore.ts` vs `layout.ts`）。服务器直接复用远端布局作根，Provider 的 `rootPath` 语义最干净。
2. **边界与安全**：防目录穿越的校验面收敛在一个专用树内，不与 app 数据目录其他部分共享路径前缀。
3. **落地解耦**：收到的同步数据先落入 LanSync 树，由本设备的 LocalStore 侧逻辑再合并进 Books/——服务器只做字节搬运，不碰 app 语义。

| 端点 | 对应 provider 方法 | 说明 |
|---|---|---|
| `GET /ping` | 连通性/发现 | 返回 `{device_id, name, version}`（server.rs:142-151 已实现） |
| `GET /files/<path>` | readText / readBinary | 404 → provider 侧转 null；路径限制在 LanSync 树内 |
| `HEAD /files/<path>` | head | Content-Length + ETag（内容指纹，配合 engine.ts:371-398 的 HEAD+size 短路） |
| `PUT /files/<path>` | writeText / writeBinary | 父目录自动创建 |
| `DELETE /files/<path>` | deleteDir | 递归删 |
| `POST /list` `{dir}` | list | 返回 `FileEntry[]`，代替 PROPFIND |

- 框架 axum：lockfile 已有 0.8.9（localsend 传递依赖），加显式依赖零编译增量。
- 鉴权：所有端点走 Bearer token 中间件（server.rs:56-74 已实现）；首连配对 = 交换 token，存 `SystemSettings.lan.token`。
- Tauri 命令：`lan_sync_start/stop/status`。

### 4.2 客户端（TS `services/sync/providers/lan/LanSyncProvider.ts`，指挥官）

- 实现 `FileSyncProvider`（provider.ts:52-93），webview `fetch` 直连 `http://<peer>:53430`。
- 错误映射 `FileSyncError`（AUTH_FAILED / NOT_FOUND / NETWORK）。
- M1 同步范围 = library.json + config.json（进度/笔记/配置，均小 JSON，writeBinary 全内存可接受）；M2 书文件走 `uploadStream/downloadStream`（provider.ts:85-93 可选方法，Rust reqwest 流式直写）。

### 4.3 注册接线（**7 处**，v2 增付费门特判）

| # | 位置 | 改动 | 归属 |
|---|---|---|---|
| 1 | `providerRegistry.ts:21,76-99` | union 加 `'lan'` + 工厂分支（cache key = host+port+token） | 指挥官 |
| 2 | `cloudSyncProvider.ts:21-24,27-38,44-54,146-186` | settingsKey / displayName / enabled 列表 / syncBooks auto-enable 各加一例 | 指挥官 |
| 3 | **`cloudSyncProvider.ts:116-126`（v2 必补）** | **付费墙特判**：`resolveCloudSyncGate` 的 `paused = backends.length > 0 && !isCloudSyncAllowed(plan)` 会把免费 plan 的全部第三方后端 pause（`getActiveFileSyncBackends:129-135` 返回空）。用户硬需求是「LAN 同步在云额度之外」，`'lan'` 必须在 gate 中放行——如 `paused` 计算排除 `'lan'`（paused 只 pause 云类后端，LAN 后端不受 plan 限制），否则登录前/免费账户下 LAN 后端永远不会进 active 列表 | 指挥官 |
| 4 | `types/settings.ts` | `LanSyncSettings { enabled, host, port, token, name?, syncProgress, syncNotes, syncBooks, strategy, deviceId, lastSyncedAt, discoveredPeers? }`；SystemSettings 加 `lan` 切片 | 指挥官定稿 |
| 5 | `useFileSync.ts:198-228` | `updateLastSyncedAt` 手写 switch 补 `'lan'` | 指挥官 |
| 6 | `runLibrarySync.ts:39-43` | `canBackendRun` 平台门控（全平台可用） | 指挥官 |
| 7 | UI：`components/settings/integrations/LanForm.tsx`（新建）+ `IntegrationsPanel.tsx:47-53,241-395` | 开关、对端 IP:端口、token、**手填 + 发现设备列表双入口**、「测试连接」（调 `/ping`）；复用 `FileSyncForm` 共享控件（`FileSyncForm.tsx:192-252`），参照 `WebDAVForm.tsx:57-97` 的 `persistCloudProviderEnabled` 模式 | **参谋长**（等 §4.3-#4 定稿） |

### 4.4 发现与配对（v2：spike 已出结论，发现从 M3 提前至 M1.5）

**拍板**：手填 + 自动发现结合，LanForm 双入口。自动发现采用 **自研 UDP 多播**，弃用 localsend 发现。spike 对比结论：

| 维度 | A. 自研 UDP 多播（**224.0.0.x:53430**，JSON `{protocol, device_id, name, port, token_fingerprint}`） | B. 复用 localsend discovery |
|---|---|---|
| Rust 成本 | ~250-350 行（UdpSocket + 网卡 join + announce 三连发 + TTL 设备表 + event pump）；`local_ips`、MulticastLock 桥、event→zustand 管线全部有现成模板 | 集成面 ~80-120 行，但 discovery feature 编译期强制拉入完整 TLS/HTTP 栈 |
| 身份耦合 | 无 TLS，与 lan_sync 既定安全模型（mod.rs:14-19）一致 | **DiscoveryConfig 硬性要求 DeviceIdentity（证书+私钥）**，register 走 HTTPS 客户端证书，为发现功能引入 identity.rs 全套 |
| 自定义字段 | 完全可控（token_fingerprint 一行带出，宣告→`/ping` 验 token→记住 device_id，一气呵成） | `MulticastMessageV2` 字段固定，无自定义位，配对只能绕道证书指纹，与 token 体系两张皮 |
| 生态噪音 | 私有组，只有 Readest 互见 | 默认组 224.0.0.167:53317 会与真实 LocalSend app 互相串台（协议互不兼容，过滤靠 hack）；改私有组则 B 的优势尽失 |

**实现要点**（风险前置规避）：
1. 多播组选 **224.0.0.0/24** 段而非 255.255.255.255 广播——localsend crate 源码注释实证部分 Android 设备只收 /24 多播。
2. announce 三连发（延迟 100/500/2000ms，抄 crate `ANNOUNCE_DELAYS` 节奏）抗丢包；「UDP 只宣告不回应」语义，对端收到后向宣告端口发 HTTP register/`/ping` 回填——因此 axum 侧需一个发现注册端点（~30 行）。
3. 多播绑定失败不致命（存 multicast_error），手动填 IP + `/ping` 兜底（M1 行为即退路）。
4. Android：MulticastLock acquire/release 挂 LanSync 服务启停（照抄 `LocalSendManager.tsx:87,98` 模式）。
5. 架构照抄 localsend 三层管线：Rust event pump → zustand store（新 `lanSyncStore` 或并入）→ Manager 组件订阅事件。
6. 持久 device_id 与配对记忆在 M1.5 落地（`lan_sync/mod.rs:98-103` 已预留注释：M1 期间 device_id 为每次启动 UUID）。

### 4.5 触发与冲突（零改动继承引擎）

开书拉取、翻页 5s 防抖推送、窗口聚焦拉取、库级变化 5s pass、Sync now 互斥——由 `useFileSync`/`useLibraryFileSync` 自动覆盖。合并 = 笔记 CRDT + **时间戳优先 LWW**（拍板）+ 删除墓碑；书文件 HEAD+size 短路。多后端并存由 `runLibrarySync.ts:159-178` 按后端隔离 pass 与错误。

### 4.6 Android 存活（拍板：打开 app 即同步，不做前台服务）

同步由手机主动发起（手机作为客户端拉+推），PC 常驻服务器；两端一致由手机端一次 pass 完成。app 退后台被冻结即暂停同步，打开/关书/翻页自然触发。若日后体验不足再评估前台服务（M3+）。

## 5. legado / 小幻阅读借鉴论证（v2 新增，所有者指示）

**借鉴什么**：legado 的 BookProgress（durChapterIndex / durChapterPos / **durChapterTitle**）与小幻阅读 books.db 的进度记录都携带**人类可读的章节信息**。价值：纯 location/xpointer/页码是机器坐标，多设备核对「我上次读到哪」时不可读；章节标题让用户在同步日志、冲突提示、设置页的设备状态里一眼核对进度是否合理（如时间戳接近的 LWW 合并后，肉眼判断落点是否符合预期）。

**为什么不搬 legado 的匹配逻辑**：legado 跨协议同步（自建服务 ↔ 各阅读器）必须按「书名+作者」模糊匹配、按章节标题对齐章节索引，因为同一本书在不同数据源 hash 不同。我们两端运行同一 app，`bookHash`（partialMD5）天然一致（§1），整套匹配/对齐复杂度**不存在，也不引入**。

**落地评估：给 config wire 加可选字段 `durChapterTitle?: string`**（建议同时评估 `durChapterIndex?: number`）：

- 写入点：reader 保存进度时（现有防抖推送链路内，从渲染侧 toc 取当前章节标题随 config 持久化）。
- 读取方：同步日志/调试输出、（可选）设备同步状态 UI。
- 兼容性：可选字段；旧版本 JSON 解析忽略未知字段；`layout.ts:30-38` 冻结的是**目录树路径**，config.json 内容 schema 加字段不破坏 wire。原生云 wire（`types/records.ts:27-41` DBBookConfig）**不动**，此字段仅进第三方/局域网文件同步的 config.json。
- 风险：低；上游 rebase 冲突面 = `types/book.ts` BookConfig 一个可选字段 + 写入点一两处。
- 时机建议：M1 顺带（字段本身一行）或 M1.5，由指挥官按接线进度定。

## 6. 分期计划（v2 重排：发现提前，书文件降 M2）

| 阶段 | 内容 | 状态 |
|---|---|---|
| **M1** | Rust axum 服务器（六端点 + token + 防穿越，端口 53430）+ LanSyncProvider + 7 处注册（含付费门特判）+ LanForm（手填入口）+ 同步范围 = library.json / config.json | 🔨 指挥官进行中（Rust 已落地雏形） |
| **M1.5** | 自动发现（自研 UDP 多播 224.0.0.x:53430 + LanForm 设备列表双入口）+ 持久 device_id / 配对记忆 + `durChapterTitle`（若 M1 未带） | ⏳ 参谋长（spike 已完成，见 §4.4） |
| **M2**（可选） | 书文件与封面：writeBinary/readBinary 全量 + uploadStream/downloadStream 流式直写 | ⏳ |
| **M3** | （按需）Android 前台服务常驻、进度实时推送（POST /notify 即时拉取） | ⏳ 远期 |

## 7. 风险与对策

1. **付费墙**：已升级为 §4.3-#3 必做项（`resolveCloudSyncGate` 特判），实现时须加「免费 plan 下 LAN 后端出现在 active 列表」的验证用例。
2. **安全**：局域网明文 HTTP + Bearer token（deliberate trade-off，mod.rs:14-19）；config.json/笔记为低敏阅读数据；token 防蹭网。要求加密则后续复用 localsend 自签 TLS 升级。
3. **IP 漂移**：M1.5 自动发现根治；M1 期间建议路由器静态绑定 PC IP。
4. **CORS**：自研服务器全响应加 `Access-Control-Allow-Origin: *`（无 cookie 场景）。
5. **并发写**：引擎层 LWW/CRDT 收敛最终态，服务器无需锁。
6. **大文件内存**：M1 只同步小 JSON 避开；M2 流式方案见 §4.2。
7. **上游演进**：`layout.ts` 冻结 wire、注册点均为小文件，rebase 冲突可控。

## 8. 拍板记录（2026-08-29，项目所有者）

1. **方案 A 确认**（自研轻量 REST + 第 6 个 FileSyncProvider）。
2. **M1 = 进度 + 笔记 + 配置**；书籍文件降为 M2 可选（原话：不同步书籍的话可能都花不了多少流量）。
3. **token + HTTP 确认**。
4. **打开 app 即同步确认**（不做前台服务）。
5. **手填 + 自动发现结合**，发现模块提前，LanForm 双入口。
6. 冲突解决：**时间戳优先 LWW**；借鉴 legado/小幻阅读——进度带章节标题等人类可读信息（→ §5）。

**分工与文件所有权**（mission-control 备案）：`src-tauri/src/lan_sync/**`、`services/sync/providers/lan/**`、`providerRegistry.ts`、`cloudSyncProvider.ts`、`types/settings.ts`（LanSyncSettings 定稿）→ 指挥官；`LanForm.tsx`、`IntegrationsPanel.tsx`、发现模块 → 参谋长。
