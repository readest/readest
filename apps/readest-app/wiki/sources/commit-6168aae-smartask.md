---
type: source-summary
source: git commit 6168aae2867de437e33c1c793c99f89b2e52c9e4
date: 2026-04-18
---

# Commit 6168aae - Add Inline Insight

## Summary

最近一次 commit 在 Readest 电子书阅读器中加入 Inline Insight：用户选中文本后，可以通过注释工具栏触发 AI 弹窗，结合局部上下文生成简短解释和详情。

## Changed Areas

- `src/types/annotator.ts` 增加 `smartask` 工具类型。
- `src/types/settings.ts` 增加 `smartAskSettings`。
- `src/app/reader/components/annotator/AnnotationTools.tsx` 注册 Ask AI 按钮。
- `src/app/reader/components/annotator/Annotator.tsx` 管理 Inline Insight 弹窗状态。
- `src/app/reader/components/annotator/SmartAskPopup.tsx` 负责弹窗、流式加载和输出展示。
- `src/components/settings/AIPanel.tsx` 增加 Inline Insight 配置。
- `src/services/smartAsk/*` 增加类型、上下文提取和客户端请求逻辑。
- `src/app/api/smartask/*` 增加 Web 代理接口。
- `docs/smart-ask.md` 记录初版设计。

## Issues Found During Optimization

- Provider 设置只有 `ollama` 和泛化的 `openai-compatible`，用户需要手动记忆常见 provider 的 base URL。
- 上下文提取只扫描同级 sibling，嵌套章节、同段落选区前后文字容易丢失。
- `smartAskSettings` 未合入默认设置，旧配置加载后新增字段可能缺失。
- Web 模型代理把 API key 放在 query string 中。
- Chat 代理无条件写 `logs/smartask` 文件，可能污染工作区并影响非 Node Web 部署。
- 没有缓存，重复选中同一段文字会重复请求 provider。

## Links

- [[../syntheses/smartask-design]]
