# Inline Insight 开发文档

## Code Structure

高价值入口如下。

| 文件                                                         | 职责                                            |
| ------------------------------------------------------------ | ----------------------------------------------- |
| `src/app/reader/components/annotator/InlineInsightPopup.tsx` | 主弹窗组件。初次请求、follow-up、流式渲染       |
| `src/components/settings/InlineInsightSettingsPanel.tsx`     | 设置编辑、API Host 补全、provider/profile 切换  |
| `src/services/inlineInsight/client.ts`                       | 发送 chat 请求、处理 stream、接入 cache         |
| `src/services/inlineInsight/contextExtractor.ts`             | 从阅读 DOM 提取局部上下文                       |
| `src/services/inlineInsight/parser.ts`                       | 解析 LLM 流式返回的 partial JSON                |
| `src/services/inlineInsight/prompts.ts`                      | LLM的 prompt / messages 构建                    |
| `src/services/inlineInsight/providers.ts`                    | provider 辅助规则、API Host 补全、thinking 参数 |
| `src/services/inlineInsight/providerConfigs.ts`              | provider 默认配置表                             |
| `src/services/inlineInsight/cache.ts`                        | 本地响应缓存                                    |
| `src/services/inlineInsight/logging.ts`                      | stream delta 提取和调试日志格式化               |
| `src/app/api/inlineinsight/chat/route.ts`                    | Web 环境下的 chat 流式代理                      |
| `src/app/api/inlineinsight/models/route.ts`                  | Web 环境下的 models 列表代理                    |

代码阅读顺序建议：

1. `InlineInsightPopup.tsx`
2. `client.ts`
3. `parser.ts`
4. `contextExtractor.ts`
5. `InlineInsightSettingsPanel.tsx`
6. `providers.ts` / `providerConfigs.ts`
7. 两个 `route.ts`

## Inline Insight Settings

核心Settings类型是 `InlineInsightSettings`，定义在 [types.ts](/C:/Users/manfred/workspace/_fork/readest/apps/readest-app/src/services/inlineInsight/types.ts)。

当前字段：

- `enabled`
- `provider`
- `chatUrl`
- `modelUrl`
- `model`
- `apiKey`
- `providerProfiles`
- `maxContextChars`
- `targetLanguage`
- `systemPrompt`
- `questionDirections`
- `cacheEnabled`

### providerProfiles

支持的LLM Provider

- 官方 provider：`openai`、`deepseek`、`openrouter`、`groq`、`gemini`
- 本地或自定义 provider：`ollama`、`lmstudio`、`custom-openai-compatible`

`providerProfiles` 用来为每个 provider 单独保存对应的API信息：

- `chatUrl`
- `modelUrl`
- `model`
- `apiKey`

## Runtime Flow

### 初次请求（点击InlineInsight按钮）

链路如下：

```text
selection
  -> extractContext
  -> buildInlineInsightMessages
  -> streamInlineInsight
  -> optional cache read
  -> streamChatCompletions
  -> parseInlineInsightSections
  -> popup render
  -> optional cache write
```

详细步骤：

1. 用户选中文字并触发 popup
2. `InlineInsightPopup.tsx` 在 mount 后调用 `callLLM()`
3. `extractContext(selection, maxContextChars)` 从当前阅读 DOM 提取 `Before / Selected / After`
4. `buildInlineInsightMessages(...)` 组装 system + user messages
5. `streamInlineInsight(...)` 先尝试命中 cache
6. 未命中时进入 `streamChatCompletions(...)`
7. LLM 以 SSE 流式返回 partial JSON
8. `parseInlineInsightSections(answer)` 在每次 render 时增量解析：
   - `briefItems`
   - `detailItems`
   - `detailMap`
9. Popup 先显示 brief，details 到位后允许用户切换 `More / Less`

### Follow-up

链路如下：

```text
follow-up question
  -> reuse contextRef
  -> buildInlineInsightFollowUpMessages
  -> streamInlineInsightFollowUp
  -> streamChatCompletions
  -> append follow-up answer
```

### Proxy for Web

- Web
  - chat 走 `/api/inlineinsight/chat`
  - models 走 `/api/inlineinsight/models`
  - 目的：绕过浏览器 CORS，并避免直接把 API key 暴露到前端跨域请求里

## Lifecycle Notes

### Popup 生命周期

`InlineInsightPopup.tsx` 是主要的运行时状态容器。

初次请求相关状态：

- `loading`
- `thinking`
- `error`
- `answer`
- `abortRef`
- `contextRef`

含义：

- `loading`
  - 请求已发出，但还没有可展示结果时为 `true`
- `thinking`
  - 收到 reasoning chunk，但正文还没开始时为 `true`
- `error`
  - 初次请求失败信息
- `answer`
  - 当前已累计的正文文本
- `abortRef`
  - 当前初次请求的 `AbortController`
- `contextRef`
  - 当前 passage 的固定上下文，供 follow-up 复用

在 `useEffect(..., [])` 中：

- mount 时触发一次 `callLLM()`
- unmount 时中止初次请求和 follow-up 请求

### Follow-up 生命周期

follow-up 有独立的一套状态：

- `followUpOpen`
- `followUpQuestion`
- `followUpAnswer`
- `followUpLoading`
- `followUpError`
- `followUpAbortRef`

## Context Extraction

`extractContext(selection, maxChars)` 的目标是拿到对当前选区最有帮助的一小段上下文。

策略：

1. 找到选区起止位置最近的 block ancestor
2. 在 `article` / `main` / `body` 范围内收集可读 block
3. 跳过 `script`、`style`、`iframe`、`canvas` 等非正文节点
4. 优先保留同一个 block 内选区前后的文本
5. 再按字符预算向前、向后扩展相邻 block
6. 输出固定格式：

```text
Before:
...
Selected:
...
After:
...
```

## Streaming Format and Parsing

当前输出协议为 JSON object：

```json
{
  "brief": [{ "label": "Meaning", "content": "..." }],
  "details": [{ "label": "Meaning", "content": "..." }]
}
```

解析层由 `parser.ts` 负责：

- 允许解析不完整的JSON文本，第一时间输出给用户
- 如果 `details` 的 label 没有对应的 `brief`，这条 detail 会直接作为 brief 展示

## Provider Rules

provider 默认配置定义在 [providerConfigs.ts](/C:/Users/manfred/workspace/_fork/readest/apps/readest-app/src/services/inlineInsight/providerConfigs.ts)。

`providers.ts` 负责三类辅助逻辑：

1. `getProviderDefaultConfig(provider)`
2. API Host 补全和反推：
   - `buildInlineInsightUrlsFromApiHost`
   - `getApiHostFromInlineInsightChatUrl`
3. thinking 参数：
   - `getMinimalThinkingParams`

当前规则重点：

- `ollama`、`lmstudio`、`custom-openai-compatible`
  - 允许编辑 API Host
- hosted provider
  - 不允许编辑 API Host
- `getMinimalThinkingParams` 只对已明确验证过的 provider 注入额外字段

## Cache

cache 只负责复用完全相同请求的正文结果。

当前位置：

- `src/services/inlineInsight/cache.ts`

当前设计：

- key 输入：
  - `provider`
  - `chatUrl`
  - `model`
  - `messages`
- value：
  - 完整的最终正文字符串
- 不缓存空响应
- 不做 TTL
- 最多保留 200 条

## Web Proxy

### chat route

`src/app/api/inlineinsight/chat/route.ts`

职责：

- Web 环境下转发 chat 请求
- 将前端 body 原样转发到上游 `settings.chatUrl`
- 保留 SSE 流式输出
- 开启调试日志时，边转发边提取：
  - `responseText`
  - `reasoningText`

### models route

`src/app/api/inlineinsight/models/route.ts`

职责：

- Web 环境下转发模型列表请求
- 代理 `settings.modelUrl`
- 将 API key 作为 Authorization header 转发

## Testing Notes

测试目录：

- `providers.test.ts`
  - provider 默认配置
  - API Host 补全
  - hosted provider 只读语义
  - thinking 参数策略

- `cache.test.ts`
  - cache key 只依赖当前真实输入
  - 空响应不写入
  - `clearInlineInsightCache()` 只清理 Inline Insight key

- `parser.test.ts`
  - 完整 JSON
  - partial brief JSON
  - partial detail JSON
  - unmatched detail fallback 到 brief

- `logging.test.ts`
  - 日志文件名
  - markdown 日志格式
  - SSE content / reasoning 提取

- `contextExtractor.test.ts`
  - 嵌套正文块
  - 同 block 前后文优先
  - 跳过 script/style
  - 字符预算裁剪
