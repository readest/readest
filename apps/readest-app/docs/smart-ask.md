# SmartAsk — 选中文字智能问答功能

## 功能概述

用户在阅读时选中一段文字，点击工具栏中的 **SmartAsk** 按钮，系统立刻以该段文字为核心，结合当前章节上下文，调用 AI 生成 2–3 个读者最可能产生的疑问并逐一给出简短回答，以浮动弹窗内联展示，不打断阅读思绪。

---

## 相关代码地图

### 现有文件（需修改）

| 文件                                                                                                                    | 修改内容                                                                       |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [`src/types/annotator.ts`](../src/types/annotator.ts)                                                                   | `AnnotationToolType` 联合类型中添加 `'smartask'`                               |
| [`src/types/settings.ts`](../src/types/settings.ts)                                                                     | `SystemSettings` 中添加 `smartAskSettings: SmartAskSettings`                   |
| [`src/app/reader/components/annotator/AnnotationTools.tsx`](../src/app/reader/components/annotator/AnnotationTools.tsx) | `annotationToolButtons` 数组中注册新按钮                                       |
| [`src/app/reader/components/annotator/Annotator.tsx`](../src/app/reader/components/annotator/Annotator.tsx)             | 添加 `showSmartAskPopup` 状态、`handleSmartAsk()` 回调、渲染 `<SmartAskPopup>` |
| [`src/components/settings/AIPanel.tsx`](../src/components/settings/AIPanel.tsx)                                         | 添加 SmartAsk 设置区块（provider / baseUrl / model / apiKey）                  |

### 新建文件

| 文件                                                    | 用途                                                        |
| ------------------------------------------------------- | ----------------------------------------------------------- |
| `src/services/smartAsk/types.ts`                        | `SmartAskSettings`、`SmartAskResult`、`SmartAskQA` 类型定义 |
| `src/services/smartAsk/contextExtractor.ts`             | 从当前页 DOM 提取上下文文字（轻量 RAG）                     |
| `src/services/smartAsk/client.ts`                       | 直接 fetch Ollama/OpenAI-compatible API，流式返回           |
| `src/app/reader/components/annotator/SmartAskPopup.tsx` | 弹窗 UI，仿照 `XRayPopup` 结构                              |

---

## 架构设计

### 1. 独立服务层（`src/services/smartAsk/`）

完全独立于 `src/services/ai/`，仅依赖标准 `fetch`，不引入 Vercel AI SDK 等重型依赖。

```
src/services/smartAsk/
├── types.ts           ← 类型定义
├── contextExtractor.ts ← 上下文提取
└── client.ts          ← API 调用 + 流式解析
```

### 2. 设置类型（`SmartAskSettings`）

```typescript
// src/services/smartAsk/types.ts

export type SmartAskProvider = 'ollama' | 'openai-compatible';

export interface SmartAskSettings {
  enabled: boolean;
  provider: SmartAskProvider;
  baseUrl: string; // Ollama: http://127.0.0.1:11434  |  OpenAI-compatible: https://api.openai.com
  model: string; // 例: 'qwen2.5:7b' / 'gpt-4o-mini'
  apiKey?: string; // OpenAI-compatible 需要; Ollama 不需要
  maxContextChars: number; // 上下文字符数上限，默认 1500
}

export interface SmartAskQA {
  question: string;
  answer: string;
}

export interface SmartAskResult {
  qas: SmartAskQA[];
}
```

### 3. 上下文提取策略（`contextExtractor.ts`）

**目标**：用最低代价取得"所选文字的前后章节段落"，供 AI 理解语境。

**方案**：直接从当前加载的 iframe/shadow DOM 读取文本节点，取选中段落所在的 `<p>` 或容器块，向前/向后各取若干字符，拼接为上下文字符串。

```typescript
// 伪代码
export function extractContext(selection: TextSelection, maxChars: number): string {
  // 1. 从 selection.range 找到最近的块级祖先
  // 2. 取其 previousSibling / nextSibling 的 textContent
  // 3. 拼接直到达到 maxChars 上限
  // 4. 返回: "[上文...]\n【选中】{selection.text}【/选中】\n[下文...]"
}
```

这是"零索引 RAG"——无需预处理，实时提取，延迟极低。

### 4. AI 调用（`client.ts`）

统一走 OpenAI-compatible `/v1/chat/completions` 接口：

- **Ollama**：`{baseUrl}/v1/chat/completions`（Ollama ≥ 0.1.24 支持此端点）
- **OpenAI-compatible**：`{baseUrl}/v1/chat/completions`

```typescript
// 流式生成，yield SmartAskQA[]
export async function* streamSmartAsk(
  selectedText: string,
  context: string,
  settings: SmartAskSettings,
  uiLanguage: string,
): AsyncGenerator<SmartAskResult>
```

**Prompt 设计**：

```
System:
你是一位阅读助手。用户正在阅读一本书，选中了一段文字。
请根据选中文字和上下文，预判读者最可能产生的 2-3 个疑问，并给出简短、准确的回答。
以 JSON 数组格式输出：[{"question":"...","answer":"..."}]
回答语言：{uiLanguage}

User:
上下文：
{context}

选中文字：
{selectedText}
```

输出解析：累积流式 token，在 `]` 出现后尝试解析 JSON。

### 5. 弹窗 UI（`SmartAskPopup.tsx`）

参考 `XRayPopup.tsx` 的结构：

```
┌──────────────────────────────┐
│ "选中文字摘要..." （截断显示）  │
├──────────────────────────────┤
│ ⏳ 加载中...                   │  ← loading 态
│ ──────────────────────────── │
│ Q: 这个词是什么意思？           │  ← streaming 中逐条出现
│ A: 指的是...                  │
│ ──────────────────────────── │
│ Q: 作者为何在此...             │
│ A: 因为...                    │
└──────────────────────────────┘
```

尺寸：`480 × 280`（参考 dict/translator popup），复用现有 `getPopupPosition()` 定位逻辑。

---

## 数据流

```
用户选中文字 → handleSmartAsk()
    ↓
extractContext(selection, maxChars)   ← 从当前 DOM 实时提取
    ↓
streamSmartAsk(text, context, settings, lang)
    ├── 构造 OpenAI-compatible 请求
    ├── fetch → stream → parse JSON tokens
    └── yield SmartAskResult (逐步更新)
    ↓
SmartAskPopup 渲染 Q&A 列表
```

---

## 设置项

在 `AIPanel.tsx` 新增 SmartAsk 区块，包含：

| 字段              | 类型     | 说明                           |
| ----------------- | -------- | ------------------------------ |
| `enabled`         | toggle   | 开关                           |
| `provider`        | select   | `Ollama` / `OpenAI-compatible` |
| `baseUrl`         | text     | API 基础 URL                   |
| `model`           | text     | 模型名称                       |
| `apiKey`          | password | 仅 OpenAI-compatible 时显示    |
| `maxContextChars` | number   | 上下文字符数（500–3000）       |

---

## 默认值

```typescript
export const DEFAULT_SMART_ASK_SETTINGS: SmartAskSettings = {
  enabled: false,
  provider: 'ollama',
  baseUrl: 'http://127.0.0.1:11434',
  model: '',
  apiKey: '',
  maxContextChars: 1500,
};
```

---

## 国际化

新增的界面字符串通过 `useTranslation()` / `stubTranslation` 处理，遵循 [i18n 规范](./i18n.md)。涉及字符串：

- `'SmartAsk'`
- `'Ask AI about this passage'`（tooltip）
- `'Analyzing...'`
- `'Enable AI in Settings'`
- `'SmartAsk model not configured'`
- `'Failed to get AI response'`

---

## 开发顺序

1. **类型层**：`src/services/smartAsk/types.ts` + `src/types/annotator.ts` + `src/types/settings.ts`
2. **服务层**：`contextExtractor.ts` + `client.ts`
3. **弹窗 UI**：`SmartAskPopup.tsx`
4. **集成**：`AnnotationTools.tsx` + `Annotator.tsx`
5. **设置 UI**：`AIPanel.tsx`
6. **测试**：单元测试 for `contextExtractor` + `client`（mock fetch）
