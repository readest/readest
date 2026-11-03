---
name: translator-thinking-off-6865
description: "#6865 custom LLM translator Thinking: Default/Off, host-mapped param + 400 retry; MERGED #7275 (746a13eb0) 2026-11-03, UNRELEASED"
metadata:
  node_type: memory
  type: project
  originSessionId: 6d33b726-8b01-45b5-b2d6-e751b53d3324
  modified: 2026-11-03T05:32:19.931Z
---

MERGED as 746a13eb0 (PR #7275, head e5acad02b) on 2026-11-03; worktree and branch removed. It adds a Thinking select (Default / Off) to custom OpenAI-compatible translators. Also applies to the AI context dictionary through the shared `generateChatText` in `services/translators/custom/openaiCompatible.ts`.

chrox chose the host-mapped select over a generic "extra JSON params" field (2026-11-03). Off sends: openrouter → reasoning.effort none; deepseek/bigmodel/z.ai/volces → thinking.type disabled; siliconflow/aliyuncs → enable_thinking false; else reasoning_effort none. A 400 triggers one retry without the field, and that baseUrl+model stops sending it.

**Why:** a wrong field 400s on strict APIs (OpenAI), and some models can't turn thinking off at all (Gemini 3, gpt-5 before 5.1, gpt-4.x).
**How to apply:** for vLLM/SGLang local Qwen3 (`chat_template_kwargs`), add a host rule rather than a generic field. No real-service run yet: only a mock server plus unit tests. The SDK can't load in vitest browser mode (`os.platform`).

Review round 1 (CodeRabbit) fixed in 30f9d0517: pack always sends `thinking` ('default' when unset), plus a context-dictionary test.
chrox asked to fix the older disabled/temperature sync gap in the same PR (e5acad02b): pack always sends temperature (null) and disabled (false). apiKey is deliberately left out: a device without a local key would push '' and wipe it everywhere.

Related: [[custom-translation-providers]], [[context-dictionary-5544]].
