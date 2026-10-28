# AI 层：`🤖 AI 网站` 组

[← 索引](../README.md)

## 服务器聚合订阅的出口隔离（2026-10-27）

`composer/` 启用 `AI_RESIDENTIAL_ONLY=true`、`DAILY_DATACENTER_ONLY=true`、
`AI_AUTO_FALLBACK=true`、`AI_REGION=美国` 后：

- `🤖 AI 网站` 默认选 `🏠 美国家宽自动`；也可以手动固定某个美国家宽。
- 自动组按顺序回退：DMIT2 VLESS → DMIT2 Hysteria2 → 其它美国家宽。只在美国池内切换。
- 日常各组排除机场标记的家宽及两个 AI 组，保持原有机房节点和地区分组。
- AI 池不含 `DIRECT`、日常组或普通机房；没有合格节点就拒绝构建，不放宽条件。
- 家宽判定来自机场节点名称（家宽 / 住宅 / residential），不是独立的 IP 属性认证。

自动探活每 120 秒检查一次，超时 15 秒。它只判断 HTTPS 可达，不把 403 / 429 当作入口断开；
也不证明 ChatGPT、Grok、Gemini 或 Antigravity 的账号、地区、配额和 IP 风控检查通过。
家里和公司可能限制不同协议，因此先尝试同一 DMIT2 落地的不同入口，再换其它家宽。
优先入口恢复后会回切；如果探活误判或需要会话期间固定 IP，在 `🤖 AI 网站` 手动选具体节点。

Antigravity 的网页登录、OAuth、Cloud Code、Business AI Code、Vertex AI 和区域 API
均补了内联规则，优先于机场的 Google 直连规则。
端点参考：[Google 官方网络列表](https://antigravity.google/docs/enterprise/#network-allowlists-and-mtls-endpoints)。

下文描述的是独立使用 `override.js` 时的通用行为。服务器聚合订阅会在覆写后追加上述隔离策略。

服务器启用 `SIMPLIFY_GROUPS=true` 和 `AD_GROUP_ENABLED=true` 时，界面显示 `🌐 日常上网`、`🤖 AI 网站` 和 `🛡️ 广告拦截`。
日常自动测速及美国家宽自动回退组保留为隐藏的内部组；媒体、地区与漏网之鱼规则统一指向日常入口。广告组默认 REJECT，可切换为 DIRECT；其他独立的拒绝规则仍独立生效。

2026-10-29：AI 手动候选增加 TAGMeta 日本家宽（3 倍）和马来西亚家宽（1 倍）；自动回退仍限定美国，避免自动切换国家。
倍率超过 6 倍或名称未标倍率的线路不自动加入。家宽与倍率均依据机场标注，实际 IP 类型及服务可用性需要实测。

## 单独使用 override.js 的兼容行为

以下描述未经过 composer 家宽隔离的原始脚本行为；当前主方案已限制成员，不允许 AI 回退到机房或 DIRECT，默认与备用见 [composer](composer.md)。

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

**手动** —— FlClash → 代理 → `🤖 AI 网站` → 选节点。其他流量不受影响，客户端可能保留旧选择，更新后需核对；手动固定节点时不使用自动备用。

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
