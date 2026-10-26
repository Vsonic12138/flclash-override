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

## 同名不同协议（重要）

同一个编号会有**两个名字**，代表不同传输方式，不是重复节点：

| 后缀 | 传输 | 入口域名 | 指纹 | 出口 IP |
| --- | --- | --- | --- | --- |
| `-0.1倍` | VLESS + **WS** / TLS | `unamecf3.xn--ghqu5fm27b67w.com` | chrome | **固定** |
| `\| 三网推荐` | VLESS + **REALITY**（xtls-rprx-vision） | `pq.usNN.yydjc.top` | ios | **会漂移** |

实测「圣何塞03」两个版本（各采样 10 次）：

| 节点 | 出口 IP | Gemini |
| --- | --- | --- |
| `圣何塞03-0.1倍` | `104.251.122.87` ×10（唯一） | 5/5 放行 |
| `圣何塞03 \| 三网推荐` | `.87` ×4、`.125` ×6（两个） | 1/5 放行 |

**所以优先用 `-0.1倍`**：出口 IP 稳定，Gemini 通过率高。`三网推荐` 在两个 IP 间轮换，既不利于账号风控，也更容易被 Google 拦。

反过来，所有 `-0.1倍` 节点**共用同一个入口域名**。如果某个网络（比如家里）把这个域名或 WS 这条路阻断了，那么**所有 `-0.1倍` 会一起超时**，这时才切到 `三网推荐` 的 REALITY 版本。

### 网络环境差异

节点是否可用和所在网络强相关，同一个节点换网络结论可能相反：

| 环境 | `-0.1倍`（WS） | `\| 三网推荐`（REALITY） |
| --- | --- | --- |
| 公司网络 | 正常（见上表实测） | 正常，但 Gemini 多被拦 |
| 家用网络 | **整批超时**（用户实测） | 可用 |

原因就是上面说的：`-0.1倍` 整批共用入口域名和 WS 传输，一旦被当前网络阻断就全军覆没；`三网推荐` 的入口域名和传输方式都不同，等于一条独立备用通道。

## 可用节点

| 节点 | 传输 | 地区 | ChatGPT | Gemini | 首字节 | 下载 |
| --- | --- | --- | --- | --- | --- | --- |
| 圣何塞03-0.1倍 | WS | US | ✅ | 200 | 1085ms | 1.58 MB/s |
| 圣何塞06-0.1倍 | WS | US | ✅ | 200 | 1420ms | 1.70 MB/s |
| 圣何塞04-0.1倍 | WS | US | ✅ | 200 | 1363ms | 0.37 MB/s |
| 洛杉矶08-0.1倍 | WS | US | ✅ | 200 | 1678ms | 0.45 MB/s |

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

## 2026-10-27 00:56 夜间复测（切到自建合成订阅之后）

背景：FlClash 里大量节点卡片显示 `Timeout`，怀疑是新订阅有问题。结论：**订阅本身没问题，Timeout 大部分是探测口径造成的假阴性。**

| 检查项 | 结果 |
| --- | --- |
| 订阅内容 | 9 个策略组 / 71 节点 / 9075 规则 / 5 个 rule-provider，首条 `PROCESS-NAME,GameViewer.exe,DIRECT`，末尾 `MATCH,🐟漏网之鱼` ✅ |
| AI 组默认 | `🇺🇸美国圣何塞03-0.1倍` 置顶（`AI_PREFERRED_NODES` 生效）✅ |
| 204 探测 | 73 个节点中 43 个通过（`www.gstatic.com/generate_204`，4s 超时） |
| 真实请求 | 被 UI 标 `Timeout` 的 `圣何塞03-0.1倍` 通过 `POST chatgpt.com/backend-api/codex/responses`（401=正常），能出网 |

**教训**：mihomo 的 `/proxies/<name>/delay` 与界面延迟测试只说明「到那个探测 URL 的 TTFB」，不是「节点能不能用」。0.1 倍节点是共享带宽，凌晨可能被限到探测超时，真实流量仍然通。排查顺序应该是：先看真实请求（下面「怎么测」），不要被红色 Timeout 带跑。

**当下的真问题（Google 侧）**：经 `圣何塞03-0.1倍`、`圣何塞07 | 三网推荐`、`美国06-0.1倍` 三个不同出口 IP 访问 `https://gemini.google.com/app`，全部 `302 → www.google.com/sorry/index`（跟随后 `429`）。三个 IP 一样的结果说明是 Google 对数据中心 IP 的风控/限流，不是本地配置或机场线路问题。Antigravity 报 “not eligible for this account/region” 时，先按这个方向验证：换出口 IP、或用真实浏览器会话（带 cookie）复测，再怀疑账号本身。

出口 IP 抽样（`chatgpt.com/cdn-cgi/trace`）：

| 节点 | 出口 IP |
| --- | --- |
| `圣何塞01/03/05 | 三网推荐`、`洛杉矶08 | 三网推荐` | 207.32.218.89 |
| `圣何塞07 | 三网推荐` | 207.32.216.109 |
| `美国06-0.1倍` | 162.251.162.203 |

快速筛节点（不打扰主选择器时用 AI 组，或临时切 `🚀节点选择` 后记得切回 `♻️自动选择`）：

```bash
curl -s "http://127.0.0.1:9090/proxies/$(node -pe "encodeURIComponent('🚀节点选择')")/delay?timeout=6000&url=$(node -pe "encodeURIComponent('https://gemini.google.com/')")"
```

注意：状态切换要用**文件 + `--data-binary`** 发 PUT，直接 `--data '{"name":"中文"}'` 在 Git Bash 下会被转义破坏，报 `Selector update error: proxy not exist`。
