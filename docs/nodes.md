# 节点实测记录

[← 索引](../README.md)

> ⚠️ 这是**时间点快照**，会过期。机场节点名、落地 IP 都会变，发现问题请按下面的方法复测。

| 项 | 值 |
| --- | --- |
| 测试日期 | 2026-10-26 |
| 网络环境 | 公司网络，FlClash + TUN 模式 |
| 机场 | 赔钱机场(颜)、Hello酷狗 |

## 结论速查

| 用途 | 节点 | 出口 IP |
| --- | --- | --- |
| AI | `🇺🇸美国圣何塞03-0.1倍` | 104.251.122.87 |
| 日常 | `🇺🇸美国圣何塞06-0.1倍` | 134.195.101.197 |

两者同属美国，Google 看到的始终是美国 IP。

## 怎么测

只用真实请求，不用延迟探测——延迟低不代表能过 ChatGPT/Gemini。

| 项 | 请求 | 判定 |
| --- | --- | --- |
| ChatGPT | `POST /backend-api/codex/responses`，body `{}` | `401` = 正常（未登录的预期响应） |
| Gemini | `GET gemini.google.com/app` | `200` = 放行；`302 → /sorry/index` = 被拦 |
| 出口 IP | `GET chatgpt.com/cdn-cgi/trace` | 多次采样看是否变化 |

```bash
# ChatGPT（401 即正常）
curl --proxy http://127.0.0.1:7890 --noproxy '' --ssl-no-revoke -sS -o NUL -w '%{http_code}\n' \
  -X POST -H 'Content-Type: application/json' -d '{}' \
  https://chatgpt.com/backend-api/codex/responses

# Gemini（看 Location 有没有 sorry）
curl --proxy http://127.0.0.1:7890 --noproxy '' --ssl-no-revoke -sS -o NUL -D - \
  -H 'User-Agent: Mozilla/5.0 Chrome/141.0.0.0' https://gemini.google.com/app | head -5
```

### 三个坑

1. **必须加 `--ssl-no-revoke`**，否则 Windows 下报 `CRYPT_E_REVOCATION_OFFLINE`，看起来像节点坏了。
2. **用 `-o NUL` 而不是 `-o /dev/null`**，后者在 Windows curl 会返回 exit 23。
3. **`-w` 的参数不能以 `@` 开头**，curl 会当成读文件。用换行前缀。

## 可用节点

| 节点 | 地区 | ChatGPT | Gemini | 首字节 | 下载 |
| --- | --- | --- | --- | --- | --- |
| 圣何塞03-0.1倍 | US | ✅ | 200 | 1085ms | 1.58 MB/s |
| 圣何塞06-0.1倍 | US | ✅ | 200 | 1420ms | 1.70 MB/s |
| 圣何塞04-0.1倍 | US | ✅ | 200 | 1363ms | 0.37 MB/s |
| 洛杉矶08-0.1倍 | US | ✅ | 200 | 1678ms | 0.45 MB/s |

四个节点的出口 IP 多次采样都**固定不变**，适合绑定。

## 有问题的节点

| 节点 | 问题 | 表现 |
| --- | --- | --- |
| 圣何塞01-0.1倍 | 被 Google 拦 | Gemini 稳定 302 → `/sorry/index`；ChatGPT 正常 |
| 圣何塞02-0.1倍 | 被 Google 拦 | 同上 |
| 新加坡01 | 被 Google 拦 | 稳定 302 → `/sorry/index` |
| AWS日本01 | TLS 握手失败 | trace 3/6、POST 0/5、连续 0/8 |
| AWS日本02 | TLS 握手失败 | trace 0/6、连续 7/8，仍大量握手失败 |
| AWS新加坡02 | 极不稳定 | trace 2/6、POST 3/5、连续 2/8 |
| 台湾 / 台湾2 | 无法连接 | 请求返回 000 |

补充：

- **日本线路整条不要用于 AI**：`日本东京01~06` 在延迟探测里直接 `alive=false`。
- `/sorry` 拦截是**可复现**的：休息 20 秒后连续复测 3 次，结果一致，不是压测造成的临时限流。
- `/sorry` 换浏览器 UA 也消不掉；而 `chatgpt.com` 那种 403 challenge 换 UA 就好，两者不是一回事。

## 为什么要记这些

1. 主组和 AI 组出口国家不一致时，Google 会看到两套 IP → 地区不可用。
2. 能连 ChatGPT ≠ 能过 Gemini，必须分别验证。
3. 节点状态会漂移，发现异常先复测，别急着改配置。
