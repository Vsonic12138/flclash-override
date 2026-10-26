# Gemini / Google 注意事项

[← 索引](../README.md)

## 问题

Gemini 一次会话里会同时请求几类域名：页面、登录态、图片、后端 API。

如果这几类走了**不同出口国家**，Google 会看到两套 IP，容易判成「地区不可用」或异常流量。

## 已经统一到 AI 组

| 域名 | 用途 |
| --- | --- |
| `gemini.google.com` | 页面 |
| `accounts.google.com` | 登录 / OAuth |
| `clients6.google.com` | 后端 API |
| `lh3.googleusercontent.com` | 生成的图片 / 头像 |
| `lh3.google.com` | 静态资源 |

代价：Gmail、Drive、YouTube 的登录态也走 AI 节点。AI 节点挂了，Google 登录会一起受影响。

## 仍然走主组

`www.google.com`、`googleapis.com`、`gstatic.com` —— 不参与 Gemini 的地区判定，影响很小。

**但主组和 AI 组最好保持同国**，这样即使有漏网的域名，Google 看到的仍是同一个国家。

## 节点本身也要过 Google 的检查

有的节点能连 ChatGPT，访问 Gemini 却被拦。实测（同一时刻、同一台机器）：

| 节点 | Gemini | ChatGPT |
| --- | --- | --- |
| 圣何塞03 / 04 / 06 | 200 ✅ | 通过 |
| 洛杉矶08 | 200 ✅ | 通过 |
| 圣何塞01 / 02 | 302 → `google.com/sorry/index` ❌ | 通过 |
| 新加坡01 | 302 → `google.com/sorry/index` ❌ | 通过 |

`/sorry/index` 是 Google 的异常流量拦截页。

> 注意区分：`chatgpt.com` 网页对裸 curl 返回 `403 + cf-mitigated: challenge` 是正常的，换浏览器 UA 就 200，**不代表节点被封**。`/sorry/index` 才是真的拦截。

## 结论

- 挑 AI 节点时，ChatGPT 和 Gemini **要分别验证**。
- 主组和 AI 组用同一个国家。
- 复测方法和完整数据见[节点实测记录](nodes.md)。
