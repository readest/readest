---
type: synthesis
topic: Inline Insight
updated: 2026-04-18
source_count: 1
---

# Inline Insight Design

## Goal

Inline Insight 是阅读器内的局部 AI 解释工具，不是完整聊天助手。它应在用户选中文字后快速返回少量高价值解释，避免把用户从阅读上下文带到侧边栏长对话中。

## Current Design

Inline Insight 以 `src/services/inlineInsight/` 为独立服务边界：

- `providers.ts` 提供常见 OpenAI-compatible provider 预设、LM Studio REST 预设，并兼容旧的 `openai-compatible` 配置。
- `questionDirections` 是用户在设置面板维护的问题方向列表，用来引导初始解释和后续追问的侧重点。
- `contextExtractor.ts` 从当前阅读 DOM 实时抽取上下文，优先同段落文本，再补充相邻正文块。
- `client.ts` 通过 Chat Completions stream 获取纯文本输出，并在完整响应后写入缓存。
- `cache.ts` 使用 `localStorage` 做短期响应缓存。

UI 入口仍在 annotator 工具栏中；设置入口复用 `AIPanel.tsx`，因为 Inline Insight 与现有 AI Assistant 共享用户心智和密钥配置场景。

## Provider Decision

实现选择 provider preset，而不是为每个厂商写不同协议适配器。理由：

- Ollama、OpenAI、DeepSeek、OpenRouter、Groq、Gemini 都可以通过 OpenAI-compatible chat completions 形态接入。
- LM Studio REST 有原生 `/api/v0/chat/completions` 和 `/api/v0/models`，单独建 provider 可以避免用户手写 endpoint path。
- 统一流式解析逻辑，减少弹窗状态复杂度。
- 允许高级用户继续通过 `OpenAI-compatible` 自定义 base URL。

当前不直接接 Anthropic 原生 Messages API；如需支持，应单独增加协议适配层，而不是把非兼容协议塞进当前 endpoint builder。

## Thinking Decision

LLM provider 没有统一的 thinking 关闭参数，因此 Inline Insight 使用 provider-specific best effort：

- Ollama: `think: false`，但 `gpt-oss` 只能降到 `low`。
- OpenRouter: `reasoning.effort = none` 且 `exclude = true`。
- Gemini OpenAI-compatible: 对支持关闭的 2.5 非 Pro 模型使用 `reasoning_effort = none`，对 Gemini 3 Flash 使用 `minimal`。
- OpenAI reasoning 模型: 使用 `reasoning_effort = minimal`，因为这不是完全关闭。
- LM Studio REST: 使用原生 `reasoning` 参数并固定发送 `off`。
- 其它 OpenAI-compatible provider: 不注入未知字段，避免 API 400。

Prompt 仍要求不输出 `<think>` 或内部推理，作为所有 provider 的兜底行为。

## Context Decision

上下文提取保持实时 DOM 扫描，不引入全书索引：

- Inline Insight 的问题通常由局部语句触发，章节级语境足够。
- 实时扫描没有预处理成本，适合首次打开或临时文件。
- 输出显式分为 `Before`、`Selected`、`After`，降低模型忽略选区的概率。

不足是无法回答需要跨章节信息的问题；这类需求更适合现有 AI Assistant 的索引和聊天流程。

## Cache Decision

缓存 keyed by provider、base URL、model、语言、选中文本和上下文哈希。缓存值只保存模型响应文本。

这个粒度避免了跨模型、跨语言或跨上下文复用错误答案；同时能覆盖用户反复打开同一选区、弹窗关闭重开等高频场景。

## Web Proxy Decision

Web 环境继续使用 Next API route 代理 provider 请求。优化点：

- Chat 代理移除文件日志，避免敏感内容落盘和 Cloudflare/非 Node 环境风险。
- 模型列表代理新增 `POST` 请求体传递 API key，避免 key 出现在 URL。
- 代理对 endpoint protocol 做 `http`/`https` 白名单校验。

## Tests

新增测试聚焦服务层：

- 上下文提取：嵌套正文、同段落文本、跳过脚本样式。
- Provider：旧配置兼容、端点拼接、API key 需求。
- Cache：稳定 key、TTL、清理范围。

这些测试覆盖 Inline Insight 的主要非 UI 风险，运行成本低于完整 reader UI 测试。

## Open Questions

- 是否需要把 Inline Insight 与现有 AI Assistant 设置合并，减少两套 provider 配置。
- 是否需要为 Tauri 移动端单独处理 provider CORS 或证书失败。
- 是否需要引入书籍 ID / CFI 到缓存 key，进一步避免不同书中相同文本和上下文碰撞。

## Source Links

- [[../sources/commit-6168aae-inlineinsight]]
