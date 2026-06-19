---
version: "1.0"
created: {{DATE}}
updated: {{DATE}}
cache_anchor: "memory-index-v1"
description: "T0 startup index — always loaded. Append-only. Do NOT edit mid-session."
---

# 🧠 记忆索引

## 当前状态
> {{CURRENT_STATUS}}

## 最近动态（近3天）
| 日期 | 摘要 | 链接 |
|------|------|------|
| {{DATE-2}} | {{SUMMARY}} | [daily/{{DATE-2}}.md] |
| {{DATE-1}} | {{SUMMARY}} | [daily/{{DATE-1}}.md] |
| {{DATE}}   | {{SUMMARY}} | [daily/{{DATE}}.md] |

## 活跃决策（Top 5，按强度排序）
1. [[decisions/{{NAME}}]] — strength: {{STRENGTH}}
2. [[decisions/{{NAME}}]] — strength: {{STRENGTH}}
3. [[decisions/{{NAME}}]] — strength: {{STRENGTH}}
4. [[decisions/{{NAME}}]] — strength: {{STRENGTH}}
5. [[decisions/{{NAME}}]] — strength: {{STRENGTH}}

## 待办追踪
- [ ] {{TODO-1}}
- [ ] {{TODO-2}}
- [ ] {{TODO-3}}

## MOC 导航
- [[moc/project-status]] — 项目状态地图
- [[moc/memory-graph]] — 记忆图谱全局视图

## 缓存锚点
<!-- CACHE_ANCHOR: memory-index-v1 — DO NOT MODIFY ABOVE THIS LINE MID-SESSION -->
<!-- Last cache hit rate: {{CACHE_HIT_RATE}} -->
