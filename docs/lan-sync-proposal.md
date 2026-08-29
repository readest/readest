# 局域网同步方案（草案 v1，待讨论）

> 状态：设计稿。基于对 fork 时点 v0.12.6 源码的勘察，所有 `file:line` 引用相对仓库根。
> 目标读者：项目所有者。§7 是需要拍板的决策点清单。

## 1. 目标与非目标

**目标**：在不依赖任何云服务的前提下，让 Windows 与 Android 两台设备通过家庭局域网双向同步：

- 阅读进度（location / xpointer / progress）
- 笔记、高亮、书签（BookNote）
- 阅读配置（BookConfig：视图设置、搜索配置等）
- 书籍文件与封面（可选开关，二期）
- 书架索引（library.json，分组/标签/删除墓碑）

**非目标**：

- 不做 legado 协议兼容（已定案）
- 不做跨互联网 / 中继同步（只做局域网）
- 不改动上游云同步（Readest Cloud / WebDAV / S3 等保持原样，局域网同步是新增的第 6 种文件同步后端）

## 2. 现有设施盘点（可直接复用的资产）

| 资产 | 位置 | 价值 |
|---|---|---|
| 文件同步引擎 FileSyncEngine | `apps/readest-app/src/services/sync/file/engine.ts:243` | 进度/笔记/书文件/书架索引的全部拉推、合并、短路逻辑，后端无关 |
| 后端接口 FileSyncProvider | `apps/readest-app/src/services/sync/file/provider.ts:52-93` | 9 个必需方法 + 2 个可选流式方法；注释明说"实现一个新的后端只需要写这一个接口"（provider.ts:2-9） |
| 合并策略 | `apps/readest-app/src/services/sync/file/merge.ts` | 笔记按 id 并集 + updatedAt 元素级 CRDT（:34-54）；进度/配置 LWW（:70-109）；删除墓碑 |
| 远端目录布局 | `apps/readest-app/src/services/sync/file/layout.ts:30-38` | 冻结 wire 格式：`<root>/Readest/library.json` + `Readest/books/<hash>/{书文件,cover.png,config.json}`，与本地 Books/ 目录同构 |
| 后端注册工厂 | `apps/readest-app/src/services/sync/file/providerRegistry.ts:21,76-99` | `'webdav'\|'gdrive'\|'s3'\|'onedrive'\|'icloud'`，加 `'lan'` 一例即可 |
| 同步触发钩子 | `useFileSync.ts`（每书：开书拉取/5s 防抖推送/聚焦拉取）、`useLibraryFileSync.ts`（库级）、`Sync now`（`store/fileSyncStore.ts` 互斥） | 新后端零改动继承全部触发时机 |
| Rust 局域网栈 | `src-tauri/src/localsend/service.rs:97-199`（HTTPS 服务器 + UDP 多播发现，端口 53318-53327）、`commands.rs`、`events.rs` | MVP 可不依赖；二期自动发现可直接复用多播 |
| 本地网络权限 | `src-tauri/capabilities/default.json:85-115`（http://*:* 已放行）、`tauri.conf.json:16`（CSP connect-src 已放行 http://*:*） | webview 里直接 fetch 局域网 HTTP 无需改权限 |
| 网卡枚举 | `if-addrs` crate（Cargo.toml:93） | 服务器绑定 LAN 地址时用 |

结论：**同步语义（何时同步、怎么合并、冲突怎么处理）全部免费，我们要写的只有"传输层"——一个 FileSyncProvider 客户端 + 一个嵌在对方设备里的文件服务器。**

## 3. 候选方案对比

| | A. 新增 `'lan'` 后端 + 自研轻量文件服务器 | B. 复用 LocalSend 协议传文件 | C. 设备内嵌 WebDAV 服务器，复用 WebDAVProvider |
|---|---|---|---|
| TS 侧改动 | LanSyncProvider ~150 行 + 5 处注册 + UI 表单 | 巨大（localsend 是一次性发送流，无目录语义，不满足双向增量同步） | ≈0（webdav 后端已全链路注册） |
| Rust 侧改动 | 简单 REST 文件服务器 ~200 行（GET/PUT/HEAD/DELETE/LIST） | 已有，但语义不匹配 | WebDAV 服务器子集 ~500 行（PROPFIND/ETag/锁语义）或引入 dav-server crate（成熟度未知） |
| 与引擎契合度 | 完美（provider 接口就是为它设计的） | 差 | 好，但 ETag/PROPFIND 语义要严格对齐 engine.ts:371-398 的 HEAD 短路假设 |
| 大文件流式 | 二期补 uploadStream/downloadStream（provider.ts:85-93 可选方法，走 Rust reqwest） | 天生流式 | 已有（tauriUpload/tauriDownload 支持 webdav） |
| 风险 | 低 | 高（协议改造） | 中（WebDAV 服务器实现的边角） |

**推荐 A**。理由：B 语义不匹配直接排除；C 省的 TS 代码会被 Rust 侧 WebDAV 服务器复杂度吃掉，且 debug 面更窄。A 顺着上游设计好的扩展点走，代码量最小、最可控。

## 4. 方案 A 详细设计

```
┌─────────── Windows（PC）───────────┐        ┌─────────── Android（手机）───────────┐
│  Webview (TS)                      │        │  Webview (TS)                        │
│   LanSyncProvider ──fetch────┐     │        │   LanSyncProvider ──fetch─────┐      │
│  src-tauri                   │     │        │  src-tauri                    │      │
│   lan_sync::server (axum) ◄──┘     │        │   lan_sync::server (axum) ◄───┘      │
│   监听 0.0.0.0:53430               │  HTTP  │   监听 0.0.0.0:53430                 │
│   文件区 = AppData/Books/…         │ ◄────► │   文件区 = AppData/Books/…           │
└────────────────────────────────────┘        └──────────────────────────────────────┘
     两台设备运行同一个 app：既是服务器也是客户端，互为对端（peer）。
```

### 4.1 服务器端（Rust，新模块 `src-tauri/src/lan_sync/`）

端点设计（与 FileSyncProvider 方法一一对应）：

| 端点 | 对应 provider 方法 | 说明 |
|---|---|---|
| `GET /ping` | （连通性测试/发现） | 返回 `{name, device_id, version}` |
| `GET /files/<path>` | readText / readBinary | 404 返回 404（provider 侧转 null），路径限制在 `Readest/` 根下（防目录穿越） |
| `HEAD /files/<path>` | head | 返回 `Content-Length` + `ETag`（内容 MD5 前 8 位，复用 partialMD5 语义） |
| `PUT /files/<path>` | writeText / writeBinary | body 即文件内容；父目录自动创建 |
| `DELETE /files/<path>` | deleteDir | 目录递归删 |
| `POST /list` `{dir}` | list | 返回 `FileEntry[]`（name/size/etag/is_dir），代替 PROPFIND |

- 文件区直接映射 app 的 `Books/` 目录（`app.path().app_data_dir()/Books`），即 `GET /files/Readest/library.json` ↔ `Books/` 同构布局——**服务器只是把本地 Books 目录按 layout.ts 的冻结格式原样暴露**，客户端 provider 把 `rootPath` 固定为空串。
- 框架用 `axum`（tokio 生态已在依赖树内，增量编译成本低）；若想更省，`tiny_http` 也够。
- 新 Tauri 命令：`lan_sync_start(port) -> {port, addrs}`、`lan_sync_stop`、`lan_sync_status`；注册进 `lib.rs:442-450`。
- 鉴权：首连配对时生成随机 token，之后所有请求带 `Authorization: Bearer <token>`；对端在 LanForm 里粘贴 token 完成配对。token 存 `SystemSettings.lan.token`。

### 4.2 客户端（TS，新文件 `services/sync/providers/lan/LanSyncProvider.ts`）

- 实现 `FileSyncProvider`（provider.ts:52-93），用 webview `fetch` 直连 `http://<peer>:53430`（权限已放行，见 §2）。
- 错误映射为 `FileSyncError`（AUTH_FAILED / NOT_FOUND / NETWORK），read/head 404 → null（provider.ts:19-31 契约）。
- 书文件大对象先走 `writeBinary`/`readBinary`（ArrayBuffer 全内存，50MB 内可接受）；二期加 `uploadStream`/`downloadStream` 走 Rust `reqwest` + 本地文件直写（同 WebDAVProvider 在 Tauri 平台的做法）。

### 4.3 注册接线（上游留好的插拔点，共 6 处）

1. `providerRegistry.ts:21` union 加 `'lan'`；`:76-99` 工厂分支（cache key = host+port+token）。
2. `cloudSyncProvider.ts:21-24 settingsKeyForBackend`、`:27-38 displayName`、`:44-54 getEnabledFileSyncBackends`、`:146-186 applySyncBooksAutoEnable`。
3. `types/settings.ts` 加 `LanSyncSettings { enabled, host, port, token, syncProgress, syncNotes, syncBooks, strategy, deviceId, lastSyncedAt }`，`SystemSettings` 加 `lan` 切片（照抄 WebDAVSettings:152-187 形状）。
4. `useFileSync.ts:198-228 updateLastSyncedAt` 手写 switch 补 `'lan'` 一例。
5. `runLibrarySync.ts:39-43 canBackendRun` 补平台门控（全部平台可用，无需限制）。
6. UI：新建 `components/settings/integrations/LanForm.tsx`（对端 IP、端口、token 输入 + 「测试连接」调 `/ping` + 启用开关，复用 `FileSyncForm.tsx` 共享控件），`IntegrationsPanel.tsx:47-53,241-395` 加行与子页。

### 4.4 发现与配对

- **M1（手动）**：LanForm 里手填对端 IP:端口。PC 侧起服务器后把自己的 LAN IP 列表显示在表单里（`if-addrs`），手机上照抄填入。
- **M3（自动，二期）**：复用 localsend 的 UDP 多播（224.0.0.167，service.rs:33-34）广播 `{device_id, name, port}`，LanForm 变成设备列表点选配对。也可以选择更简单的 UDP 广播（255.255.255.255:53430）自研发现，避免碰 localsend 的 TLS 证书身份（identity.rs）。

### 4.5 触发与冲突（零改动，继承引擎）

- 开书拉取、翻页 5s 防抖推送、窗口聚焦拉取、库级变化 5s 后全库 pass、设置页 Sync now（互斥锁）——全部由 `useFileSync` / `useLibraryFileSync` 自动覆盖新后端。
- 合并：笔记 CRDT + 配置 LWW + 删除墓碑（merge.ts）；书文件 HEAD+size 短路（engine.ts:371-398）。
- 需要注意的唯一坑：`getEnabledFileSyncBackends` 会同时启用多个后端（用户可能同时开 WebDAV + LAN），`runLibrarySync.ts` 已按后端隔离 pass 与错误（:159-178），无需额外处理。

### 4.6 Android 侧存活问题（关键约束）

服务器要能被 PC 连到，手机 app 必须活着。约束与对策：

- MVP 策略：**同步由手机主动发起**（手机作为客户端拉+推），PC 常驻服务器。手机→PC 的进度回传、PC→手机的进度下发都由手机端一次 pass 完成——这正好覆盖核心诉求（两端进度/笔记一致）。
- app 退到后台后 Android 会冻结 webview 与网络；M1 不做前台服务，接受"打开 app 即同步"模型（打开/关书/翻页都会触发）。若体验不足，M3 给 `useFileSync` 的触发点加一个前台服务（FOREGROUND_SERVICE + 局域网常驻）选项。

## 5. 分期计划

| 阶段 | 内容 | 交付判据 |
|---|---|---|
| M1 | Rust axum 服务器（6 端点 + token）+ LanSyncProvider + 6 处注册 + LanForm（手动 IP）+ 同步范围 = library.json / config.json（进度+笔记+配置） | 两台设备打开 app 后进度与笔记在局域网内双向收敛；断网不影响本地 |
| M2 | 书文件与封面：writeBinary/readBinary 全量 + `uploadStream/downloadStream`（Rust reqwest 流式直写 Books 目录） | 100MB EPUB 传输内存占用 < 50MB |
| M3 | 自动发现（UDP 多播/广播）+ 设备配对记忆 + （可选）Android 前台服务常驻 | 手机上从列表点选 PC 即配对成功 |
| M4（可选） | 进度实时推送：翻页即推（POST /notify → 对端立即拉取），消除"打开 app 才同步"的延迟 | 双端同时在读时进度差 < 1s |

## 6. 风险与开放问题

1. **安全**：局域网明文 HTTP。config.json/笔记是阅读数据，敏感度低；token 防蹭网访问。若要求加密，可复用 localsend 的自签 TLS（identity.rs）升级为 HTTPS，代价是证书校验逻辑。
2. **IP 漂移**：DHCP 换 IP 后配对失效。M3 自动发现根治；M1 阶段建议在路由器上给 PC 绑定静态 IP。
3. **webview fetch 的 CORS**：对端服务器是自研的，直接给所有响应加 `Access-Control-Allow-Origin: *` 即可（无凭据 cookie 场景）。
4. **并发写**：两端同时 PUT 同一文件——引擎层 LWW/CRDT 已收敛最终状态，服务器端无需加锁（单写者语义由 last-write 到达顺序决定，与 WebDAV 后端行为一致）。
5. **上游演进**：`layout.ts` 是冻结 wire 格式，跟随 upstream 时冲突面小；`providerRegistry`/`cloudSyncProvider` 是小文件，rebase 冲突可控。

## 7. 待拍板决策点

1. 方案选型：接受推荐 A（自研轻量 REST），还是倾向 C（内嵌 WebDAV 复用 WebDAVProvider）？
2. MVP 同步范围：进度+笔记+配置先行、书文件放 M2，是否符合预期？（书文件是大头，涉及流式传输）
3. 鉴权级别：token 明文 HTTP 够用，还是要求 HTTPS（复用 localsend 自签证书）？
4. Android 常驻：接受"打开 app 即同步"（不做前台服务），还是一开始就要常驻同步？
5. 自动发现：M3 才做可以接受，还是 MVP 就要？
