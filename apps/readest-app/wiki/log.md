# Wiki Log

## [2026-04-18] source | commit 6168aae Inline Insight

记录最近一次 commit 中 Inline Insight 的原始改动面，作为后续设计文档的来源页。

## [2026-04-18] synthesis | Inline Insight design

整理 Inline Insight 的 provider 扩展、上下文提取、缓存、Web 代理和测试设计，并与实现文件互相引用。

## [2026-04-18] update | Inline Insight thinking control

增加 Inline Insight 的 thinking 控制设计：默认尝试关闭或压低 thinking，并按 provider 注入不同请求参数。

## [2026-04-18] update | LM Studio REST provider

增加 LM Studio REST provider，使用原生 `/api/v0/chat/completions` 和 `/api/v0/models` 端点。

## [2026-04-18] update | LM Studio reasoning off

为 LM Studio REST 固定发送 `reasoning: "off"`，不在 UI 增加额外开关。

## [2026-04-19] update | Inline Insight question directions

在 Inline Insight 设置中增加问题方向列表，初始解释和追问都会携带这些方向来引导模型回答。

## [2026-04-19] fix | Inline Insight call logging

恢复 Inline Insight 每次 chat completion 调用的 markdown 调试日志。Web 代理写 `logs/inlineinsight`，Tauri 直连优先写当前目录的 `logs/inlineinsight` 并回退到应用 Log 目录。
