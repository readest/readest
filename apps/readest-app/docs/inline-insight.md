# Inline Insight Development Documentation

## Code Structure

Key entry points are listed below.

| File                                                         | Responsibility                                                         |
| ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `src/app/reader/components/annotator/InlineInsightPopup.tsx` | Main popup component. Initial request, follow-up, stream rendering     |
| `src/components/settings/InlineInsightSettingsPanel.tsx`     | Settings editing, API Host auto-completion, provider/profile switching |
| `src/services/inlineInsight/client.ts`                       | Sending chat requests, handling streams, cache integration             |
| `src/services/inlineInsight/contextExtractor.ts`             | Extracting local context from the reading DOM                          |
| `src/services/inlineInsight/parser.ts`                       | Parsing the partial JSON returned by the LLM stream                    |
| `src/services/inlineInsight/prompts.ts`                      | Building LLM prompts/messages                                          |
| `src/services/inlineInsight/providers.ts`                    | Provider helper rules, API Host auto-completion, thinking parameters   |
| `src/services/inlineInsight/providerConfigs.ts`              | Provider default configuration tables                                  |
| `src/services/inlineInsight/cache.ts`                        | Local response caching                                                 |
| `src/services/inlineInsight/logging.ts`                      | Stream delta extraction and debug log formatting                       |
| `src/app/api/inlineinsight/chat/route.ts`                    | Chat streaming proxy in the Web environment                            |
| `src/app/api/inlineinsight/models/route.ts`                  | Models list proxy in the Web environment                               |

Suggested code reading order:

1. `InlineInsightPopup.tsx`
2. `client.ts`
3. `parser.ts`
4. `contextExtractor.ts`
5. `InlineInsightSettingsPanel.tsx`
6. `providers.ts` / `providerConfigs.ts`
7. The two `route.ts` files

## Inline Insight Settings

The core Settings type is `InlineInsightSettings`, defined in [types.ts](/C:/Users/manfred/workspace/_fork/readest/apps/readest-app/src/services/inlineInsight/types.ts).

Current fields:

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

Supported LLM Providers

- Official providers: `openai`, `deepseek`, `openrouter`, `groq`, `gemini`
- Local or custom providers: `ollama`, `lmstudio`, `custom-openai-compatible`

`providerProfiles` is used to save the corresponding API information separately for each provider:

- `chatUrl`
- `modelUrl`
- `model`
- `apiKey`

## Runtime Flow

### Initial Request (Clicking the Inline Insight button)

The flow is as follows:

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

Detailed steps:

1. The user selects text and triggers the popup.
2. `InlineInsightPopup.tsx` calls `callLLM()` after mounting.
3. `extractContext(selection, maxContextChars)` extracts `Before / Selected / After` from the current reading DOM.
4. `buildInlineInsightMessages(...)` assembles system + user messages.
5. `streamInlineInsight(...)` first attempts a cache hit.
6. If not cached, it enters `streamChatCompletions(...)`.
7. The LLM returns partial JSON via SSE streaming.
8. `parseInlineInsightSections(answer)` incrementally parses during each render:
   - `briefItems`
   - `detailItems`
   - `detailMap`
9. The popup first displays the brief; once details are ready, it allows the user to toggle `More / Less`.

### Follow-up

The flow is as follows:

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
  - chat routes to `/api/inlineinsight/chat`
  - models route to `/api/inlineinsight/models`
  - Purpose: To bypass browser CORS and avoid exposing the API key directly in frontend cross-origin requests.

## Lifecycle Notes

### Popup Lifecycle

`InlineInsightPopup.tsx` is the primary runtime state container.

States related to the initial request:

- `loading`
- `thinking`
- `error`
- `answer`
- `abortRef`
- `contextRef`

Meanings:

- `loading`
  - `true` when the request has been sent, but there are no displayable results yet.
- `thinking`
  - `true` when a reasoning chunk has been received, but the main content hasn't started yet.
- `error`
  - Initial request failure information.
- `answer`
  - The currently accumulated main body text.
- `abortRef`
  - The `AbortController` for the current initial request.
- `contextRef`
  - The fixed context of the current passage, reused for follow-ups.

In `useEffect(..., [])`:

- Triggers `callLLM()` once on mount.
- Aborts the initial request and follow-up request on unmount.

### Follow-up Lifecycle

Follow-up has an independent set of states:

- `followUpOpen`
- `followUpQuestion`
- `followUpAnswer`
- `followUpLoading`
- `followUpError`
- `followUpAbortRef`

## Context Extraction

The goal of `extractContext(selection, maxChars)` is to retrieve a short snippet of context that is most helpful for the current selection.

Strategy:

1. Find the nearest block ancestor of the selection's start and end positions.
2. Collect readable blocks within the `article` / `main` / `body` scope.
3. Skip non-content nodes like `script`, `style`, `iframe`, `canvas`, etc.
4. Prioritize retaining text before and after the selection within the same block.
5. Then expand to adjacent blocks backwards and forwards based on the character budget.
6. Output a fixed format:

```text
Before:
...
Selected:
...
After:
...
```

## Streaming Format and Parsing

The current output protocol is a JSON object:

```json
{
  "brief": [{ "label": "Meaning", "content": "..." }],
  "details": [{ "label": "Meaning", "content": "..." }]
}
```

The parsing layer is handled by `parser.ts`:

- Allows parsing of incomplete JSON text, outputting it to the user as quickly as possible.
- If a label in `details` does not have a corresponding `brief`, this detail will be displayed directly as a brief.

## Provider Rules

Provider default configurations are defined in [providerConfigs.ts](/C:/Users/manfred/workspace/_fork/readest/apps/readest-app/src/services/inlineInsight/providerConfigs.ts).

`providers.ts` is responsible for three types of helper logic:

1. `getProviderDefaultConfig(provider)`
2. API Host auto-completion and reverse deduction:
   - `buildInlineInsightUrlsFromApiHost`
   - `getApiHostFromInlineInsightChatUrl`
3. Thinking parameters:
   - `getMinimalThinkingParams`

Current rule highlights:

- `ollama`, `lmstudio`, `custom-openai-compatible`
  - Allow editing the API Host.
- hosted provider
  - Do not allow editing the API Host.
- `getMinimalThinkingParams` only injects additional fields for explicitly verified providers.

## Cache

The cache is only responsible for reusing the body results of completely identical requests.

Current location:

- `src/services/inlineInsight/cache.ts`

Current design:

- Key inputs:
  - `provider`
  - `chatUrl`
  - `model`
  - `messages`
- Value:
  - The complete final body string.
- Does not cache empty responses.
- No TTL (Time-To-Live).
- Retains a maximum of 200 entries.

## Web Proxy

### chat route

`src/app/api/inlineinsight/chat/route.ts`

Responsibilities:

- Forwards chat requests in the Web environment.
- Forwards the frontend body exactly as-is to the upstream `settings.chatUrl`.
- Preserves SSE streaming output.
- When debug logging is enabled, extracts while forwarding:
  - `responseText`
  - `reasoningText`

### models route

`src/app/api/inlineinsight/models/route.ts`

Responsibilities:

- Forwards model list requests in the Web environment.
- Proxies `settings.modelUrl`.
- Forwards the API key as the Authorization header.

## Testing Notes

Testing directory:

- `providers.test.ts`
  - Provider default configurations
  - API Host auto-completion
  - Hosted provider read-only semantics
  - Thinking parameter strategy

- `cache.test.ts`
  - Cache key strictly depends on the current actual input
  - Empty responses are not written
  - `clearInlineInsightCache()` only clears Inline Insight keys

- `parser.test.ts`
  - Complete JSON
  - Partial brief JSON
  - Partial detail JSON
  - Unmatched detail fallbacks to brief

- `logging.test.ts`
  - Log file names
  - Markdown log format
  - SSE content / reasoning extraction

- `contextExtractor.test.ts`
  - Nested content blocks
  - Prioritized context within the same block
  - Skipping script/style
  - Character budget truncation
