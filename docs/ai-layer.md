# AI 层：`🤖 AI 网站` 组

[← 索引](../README.md)

## 它做什么

脚本会在策略组最前面插入一个 `select` 组 `🤖 AI 网站`，把 AI 域名都指向它。

- 成员 = 原主策略组 + 所有节点 + `DIRECT`
- 订阅里已有同名组就直接复用，不重复创建
- 规则排在订阅的 `microsoft.com → DIRECT` 之前，避免像 Copilot 那样被误判直连

名单两层：内联约 80 条 + 引用 MetaCubeX 的 `category-ai-chat-!cn`（约 204 条，日更）。

## 内联覆盖了什么

| 类别 | 代表域名 |
| --- | --- |
| OpenAI | openai.com、chatgpt.com、sora.com |
| Google / Gemini | gemini.google.com、aistudio.google.com、notebooklm.google.com |
| Google 账号 / 静态 | accounts.google.com、clients6.google.com、lh3.googleusercontent.com |
| Anthropic | claude.ai、anthropic.com |
| 微软 Copilot | copilot.microsoft.com、sydney.bing.com |
| xAI / Grok | x.ai、grok.com |
| 检索 | perplexity.ai、poe.com、you.com |
| 模型平台 | huggingface.co、openrouter.ai、mistral.ai、groq.com |
| 生成式 | midjourney.com、suno.com、runwayml.com、elevenlabs.io |
| 编码类 | cursor.com、windsurf.com、v0.dev |

完整列表见 `override.js` 的 `AI_DOMAINS`。

> Google 账号那几个域名是为了让 Gemini 不跨地区，原因见 [Gemini 注意事项](gemini.md)。

## 给 AI 固定节点

两种方式：

**手动** —— FlClash → 代理 → `🤖 AI 网站` → 选节点。其他流量不受影响，但重载配置后会重置。

**自动**（推荐）—— 改脚本顶部的数组：

```js
const AI_PREFERRED_NODES = [
  'DMIT2',           // Hello酷狗
  '圣何塞03-0.1倍',   // 赔钱机场
  '洛杉矶08-0.1倍',   // 赔钱机场备选
];
```

数组里第一个能在当前机场匹配到的关键字生效，该节点会被排到组内第一位，于是成为默认选择。

> 关键字要写全。同一台服务器可能有两个名字（`-0.1倍` 是 WS、`| 三网推荐` 是 REALITY），写短了可能命中另一个传输版本。见[节点实测记录](nodes.md#同名不同协议重要)。

### 实际会选中谁

| 机场 | 命中 | 结果 |
| --- | --- | --- |
| Hello酷狗 | `DMIT2` | DMIT2 家宽节点 |
| 赔钱机场 | `圣何塞03` | 美国圣何塞03 |

**赔钱机场落到 `圣何塞03` 是正常的**：`DMIT2` 只存在于酷狗，匹配不到就顺延到下一个关键字。每次 FlClash 重新拉取脚本、重新应用配置，都会按这个顺序重新落点。

全部关键字都匹配不到时，脚本会打印告警，而不是静默跟随主组。

> 踩过的坑：早期这个配置是单值 `'DMIT2'`，在赔钱机场匹配不到就静默失效，AI 一路跟随主组走到新加坡，表现为「选了美国却走新加坡、IP 天天变」。

## 选哪个节点

不同节点的 ChatGPT / Gemini 可用性差别很大，别凭感觉选。实测数据见[节点实测记录](nodes.md)。
