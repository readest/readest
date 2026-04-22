# Inline Insight - 随文智解

product name: Inline Insight
internal codename: inlineInsight

## 功能概述

结合上下文的免输入查询，极大地保持阅读的沉浸感和连贯性，是阅读体验

选中文本后点击查询图标，弹窗会结合选中文本、同段落剩余文字和相邻章节块，猜测读者意图，生成几条最有帮助的几项解释。

## 代码地图

| 文件                                                         | 职责                                                      |
| ------------------------------------------------------------ | --------------------------------------------------------- |
| `src/app/reader/components/annotator/AnnotationTools.tsx`    | 注册 `inlineinsight` 工具按钮                             |
| `src/app/reader/components/annotator/Annotator.tsx`          | 控制 Inline Insight 弹窗打开和定位                        |
| `src/app/reader/components/annotator/InlineInsightPopup.tsx` | 弹窗 UI、流式状态、错误状态和输出解析                     |
| `src/components/settings/AIPanel.tsx`                        | Inline Insight provider、模型、上下文、问题方向和缓存设置 |
| `src/services/inlineInsight/types.ts`                        | 设置、provider 和结果类型                                 |
| `src/services/inlineInsight/providers.ts`                    | Provider 预设、端点拼接、thinking 参数和旧配置兼容        |
| `src/services/inlineInsight/contextExtractor.ts`             | 从阅读 DOM 提取选区上下文                                 |
| `src/services/inlineInsight/client.ts`                       | Chat Completions 请求、SSE 解析和缓存接入                 |
| `src/services/inlineInsight/cache.ts`                        | 本地响应缓存                                              |
| `src/app/api/inlineinsight/chat/route.ts`                    | Web 环境下的流式请求代理                                  |
| `src/app/api/inlineinsight/models/route.ts`                  | Web 环境下的模型列表代理                                  |

## Provider 策略

Inline Insight 主要以 OpenAI Chat Completions 协议作为统一调用面。Ollama 使用其兼容的 `/v1/chat/completions`，模型列表走 `/api/tags`；常见云 provider 使用 `/v1/chat/completions` 和 `/v1/models`；LM Studio REST 使用原生 REST v0 的 `/api/v0/chat/completions` 和 `/api/v0/models`。

内置 provider:

| Provider          | 默认 Base URL                                             | API Key  |
| ----------------- | --------------------------------------------------------- | -------- |
| Ollama            | `http://127.0.0.1:11434`                                  | 不需要   |
| OpenAI            | `https://api.openai.com`                                  | 需要     |
| DeepSeek          | `https://api.deepseek.com`                                | 需要     |
| OpenRouter        | `https://openrouter.ai/api`                               | 需要     |
| Groq              | `https://api.groq.com/openai`                             | 需要     |
| Gemini            | `https://generativelanguage.googleapis.com/v1beta/openai` | 需要     |
| LM Studio REST    | `http://localhost:1234`                                   | 可选     |
| OpenAI-compatible | 用户自定义                                                | 通常需要 |

## Thinking 控制

各家 LLM API 没有统一的 `thinking=false` 标准。Inline Insight 不在 UI 暴露 thinking 开关；该功能默认追求快速直答，代码路径会尽量关闭 thinking，不能关闭时压到最低或仅通过 prompt 约束直接回答。LM Studio REST 使用原生 `reasoning` 参数，固定发送 `"off"`。

| Provider                 | 请求参数策略                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Ollama                   | `think: false`；`gpt-oss` 模型只能降到 `think: "low"`                                                      |
| OpenRouter               | `reasoning: { effort: "none", exclude: true }`                                                             |
| Gemini OpenAI-compatible | `gemini-2.5` 非 Pro 模型使用 `reasoning_effort: "none"`；Gemini 3 Flash 使用 `reasoning_effort: "minimal"` |
| OpenAI                   | 对 `o*`、`gpt-5*`、`gpt-oss*` 等 reasoning 模型使用 `reasoning_effort: "minimal"`                          |
| LM Studio REST           | `reasoning: "off"`                                                                                         |
| DeepSeek / Groq / Custom | 不注入非标准字段，依赖 prompt 约束；需要真正关闭时应选择非 reasoning 模型                                  |

无论 provider 是否支持参数，系统 prompt 都要求不输出 `<think>`、推理过程或内部思考。

## 上下文提取

`extractContext(selection, maxChars)` 的目标是低延迟提取足够的局部语境，而不是构建全书索引。

策略：

1. 找到选区起止位置最近的块级祖先。
2. 在 `article`、`main` 或 `body` 范围内按文档顺序收集可读块。
3. 跳过 `script`、`style`、`canvas`、`iframe` 等非正文内容。
4. 优先保留同段落中选区前后的文字。
5. 再按预算向前、向后收集相邻块。
6. 输出固定结构：

```text
Before:
...
Selected:
...
After:
...
```

`maxContextChars` 默认 2000，设置面板允许在 500 到 3000 之间调整。

## 问题方向

设置面板支持维护 `questionDirections` 列表，用来提示模型优先从哪些方向生成初始解释，例如“地名背景”“人物关系”“文言翻译”。这些方向会进入初始 Inline Insight 和追问请求的 user message，但不会覆盖用户追问本身。

设置面板也支持 `targetLanguage`。默认留空时跟随 Readest 的 UI 语言；用户填写目标语言后，初始解释和追问都会使用该语言，而不再强制使用 UI 语言。

设置面板允许修改初始解释使用的 `systemPrompt`。留空时使用内置英文默认 prompt；追问请求继续使用固定英文 `FOLLOW_UP_SYSTEM_PROMPT`，不暴露自定义入口。

缓存 key 包含 `questionDirections`，因此调整方向后不会命中旧方向下的缓存结果。
缓存 key 也包含实际发送给 LLM 的目标语言，因此不同目标语言不会互相复用旧响应。
当 `systemPrompt` 变化时，设置面板会直接清空 Inline Insight 缓存。

## 调用流程

```text
用户选中文字
  -> Annotator 打开 InlineInsightPopup
  -> extractContext(selection, maxContextChars)
  -> streamInlineInsight(selectedText, context, settings, locale)
  -> 命中缓存则直接返回完整文本
  -> 未命中则调用 provider 的 Chat Completions stream
  -> InlineInsightPopup 解析简述和详述并流式渲染
  -> 完整响应写入本地缓存
  -> 开启 INLINE_INSIGHT_DEBUG_LOGGING 时，每次真实 LLM call 写入 logs/inlineinsight/*.md 调试日志
```

Tauri 环境直接请求 provider 端点；Web 环境通过 `/api/inlineinsight/chat` 代理，避免浏览器 CORS 限制。模型列表在 Web 环境通过 `POST /api/inlineinsight/models` 代理，API key 放在请求体中，不再放入查询字符串。

## 调试日志

设置 `INLINE_INSIGHT_DEBUG_LOGGING=true` 后，每一次 Inline Insight chat completion 调用都会生成 markdown 日志，文件名使用 ISO 时间并替换 `:` 和 `.`，例如 `2026-04-18T09-25-17-869Z.md`。该开关默认关闭，仅建议在本地开发调试时开启。`pnpm dev-web` 默认启用该环境变量。

Tauri 直连路径在前端判断 `NEXT_PUBLIC_INLINE_INSIGHT_DEBUG_LOGGING=true` 后写日志。Web 代理路径在服务端判断 `INLINE_INSIGHT_DEBUG_LOGGING=true` 后写日志。

- Web/dev 代理路径写入 `logs/inlineinsight/`。
- Tauri 直连路径优先写入当前工作目录的 `logs/inlineinsight/`，失败时回退到系统应用 Log 目录。
- 日志包含 endpoint、model、temperature、status、duration、messages、请求 body、响应文本或错误信息。
- 命中缓存时不会写新日志，因为没有发生新的 LLM call。

## 输出格式

模型输出使用纯文本分段，避免在流式 JSON 未闭合时解析失败。

```text
[含义] 一句简洁说明
[背景] 一句简洁说明

===DETAILS===

[含义] 2-4 句话详细说明。

[背景] 2-4 句话详细说明。
```

弹窗会先展示 `===DETAILS===` 前的简述，收到详情后提供展开按钮。

## 缓存

Inline Insight 缓存保存在浏览器 `localStorage`：

- key 使用 provider、base URL、model 和完整 messages 的哈希，不把原文放进 key。
- value 直接保存模型响应文本。
- 最多保留 200 条，超出后按创建时间淘汰。
- 默认开启。
- 设置面板支持关闭缓存和清空缓存。

缓存仅用于完全相同输入的重复查询；换模型、换 provider、换上下文或换语言都会重新请求。

## 设置默认值

```typescript
export const DEFAULT_INLINE_INSIGHT_SETTINGS: InlineInsightSettings = {
  enabled: false,
  provider: 'ollama',
  baseUrl: 'http://127.0.0.1:11434',
  model: '',
  apiKey: '',
  maxContextChars: 2000,
  targetLanguage: '',
  systemPrompt: '',
  questionDirections: [],
  cacheEnabled: true,
};
```

`loadSettings()` 会将默认值合并到旧配置，保证新增字段不会是 `undefined`。

## 安全和隐私

- Web 代理只允许 `http` 和 `https` endpoint。
- 模型列表代理支持 `POST`，避免 API key 进入 URL。
- 仅在环境变量显式开启时写本地 `logs/inlineinsight` 文件，减少敏感内容落盘。
- 选中文本、上下文和模型响应仍会发送给用户配置的 provider；UI 需要让用户自行选择可信 provider。

## 测试

新增测试覆盖：

- `contextExtractor`: 嵌套正文、同段落前后文、跳过脚本和样式内容。
- `providers`: endpoint 拼接、旧 provider 兼容、API key 需求。
- `cache`: key 稳定性、清理空缓存、清空 Inline Insight 缓存。
