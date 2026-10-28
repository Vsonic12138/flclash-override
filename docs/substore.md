[← 索引](../README.md)

# Sub-Store 与 Caddy

当前 Sub-Store 提供节点，Caddy 保护后台并转发 composer 完整订阅；客户端实际链路见 [架构](architecture.md)。以下包含早期直接订阅 Sub-Store 集合的历史示例。

## 2026-10-27：后台登录与订阅下载分离

- 后台网页、静态资源和 API 全部经过 Caddy HTTP Basic 登录。
- 删除公开首页自动附带 `magicpath` 的跳转；后台入口用私有书签保存。
- 已暴露的后台路径已轮换。旧路径和根路径 `/api/*` 不再提供管理 API。
- 仅 composer 完整订阅的两个精确路径（原路径及 `.yaml`）和 `/ping.txt` 免登录。
- Sub-Store 与 composer 后端仍只监听 `127.0.0.1`；内部 composer 拉节点不经过公网登录层。
- 移除了两条订阅中没有脚本内容的 `Script Operator`，保留其余处理器；酷狗前缀由 composer 添加。
- 后台账号和密码保存在服务器受限文件中；不要把密码、后台路径或真实订阅链接提交仓库。

以下部署命令是基础组件示例；对公网使用时必须同时配置上述登录层。

`submerge/`（见 [双订阅合并](submerge.md)）只能在这台电脑上跑，换设备、换系统就得重配一遍。这个方案把合并搬到自己服务器：**一条 https 链接，在哪台设备都能用，机场原始订阅由服务器管理；客户端仍会保存聚合订阅 URL，需按凭据保护**。

```
FlClash ──https──> Caddy :443 ──> Sub-Store 后端 127.0.0.1:13000
                    （自动签证书）      │
                                      ├─ 订阅「赔钱」   下载 + 改 UA + 加 [赔钱] 前缀
                                      ├─ 订阅「酷狗」   下载 + 改 UA + 加 [酷狗] 前缀
                                      └─ 集合「merge」  两者按顺序拼接成一条订阅
```

## 为什么不是 Cloudflare Worker

当初的想法是 Worker 里塞 KV 存 token，结果三道墙：

| 墙 | 现象 |
| --- | --- |
| `*.workers.dev` 国内不可达 | `wrangler tail` 连不上、直连订阅超时 |
| 机场对 Cloudflare 出口 IP 返 403 | Worker 拉赔钱订阅直接 403，本机拉正常 |
| 自家的 Cloudflare DNS token 没有 DNS 权限 | 想绑自定义域名也不行 |

换成自己的 VPS（本来就跑着 new-api）就没有这些问题。Worker 代码留在 `worker/` 里，不再维护。

## 部署（一次性）

```bash
# 1. 后端：只监听 127.0.0.1，靠 Caddy 登录层保护管理接口
docker run -d --name substore --restart unless-stopped \
  -e SUB_STORE_BACKEND_MERGE=true \
  -e SUB_STORE_FRONTEND_BACKEND_PATH=/<后端路径> \
  -e SUB_STORE_CORS_ALLOWED_ORIGINS=https://sub.<你的域名> \
  -p 127.0.0.1:13001:3001 -p 127.0.0.1:13000:3000 \
  -v /opt/substore-stack/data:/opt/app/data \
  xream/sub-store:latest

# 2. 反代 + 证书：Caddy 容器用 host 网络，80/443 直接对外
docker run -d --name caddy --restart unless-stopped --network host \
  -v /opt/substore-stack/Caddyfile:/etc/caddy/Caddyfile:ro \
  -v /opt/substore-stack/caddy-data:/data \
  -v /opt/substore-stack/caddy-config:/config \
  caddy:2-alpine
```

`/opt/substore-stack/Caddyfile` 将后台网页和 API 放在登录层之后；只有完整订阅下载入口单独放行。

```caddyfile
sub.<你的域名> {
	@subscription path /<完整订阅路径> /<完整订阅路径>.yaml
	handle @subscription { reverse_proxy 127.0.0.1:13200 }
	handle {
		basic_auth {
			admin <caddy-hash-password生成的哈希>
		}
		@rootApi path /api/*
		respond @rootApi 404
		reverse_proxy 127.0.0.1:13000
	}
}
```

DNS 必须是**灰色云（仅 DNS）A 记录**指到 VPS。橙云会让 Let's Encrypt 的 HTTP-01 验证失败，证书签不下来。

## 后台与链接

| 用途 | 地址 |
| --- | --- |
| 管理后台（推荐书签）| `https://sub.<你的域名>/?magicpath=<后端路径去掉开头的 />`，打开即连上后端 |
| 管理后台（裸地址）| `https://sub.<你的域名>/`，会弹窗让你填后端地址 `https://sub.<你的域名>/<后端路径>` |
| 内部节点订阅（受后台登录保护） | `https://sub.<你的域名>/<后端路径>/download/collection/merge/ClashMeta` |
| FlClash 完整订阅 | composer 的独立随机下载路径，详见 [composer](composer.md) |
| 健康检查 | `https://sub.<你的域名>/<后端路径>/api/collections` |

订阅 URL 本身就是口令，等同于账户密码：**不进仓库、不发群、贴图前打码**。

## 踩过的坑

| 坑 | 处理 |
| --- | --- |
| 机场对 `clash.meta` UA 返 403 | 每条订阅的 `ua` 设成 `clash-verge/v2.4.2`，别用默认 |
| Node 环境里脚本操作报 `脚本操作必须设置 SUB_STORE_FRONTEND_BACKEND_PATH` | 启动加 `SUB_STORE_BACKEND_MERGE=true`（或设前端后端路径）|
| 脚本对象写 `{"type":"Script Operator","args":"function operator(proxies){}"}` 报 `operator is not defined` | 新格式是 `"args":{"content":"...脚本...","arguments":{}}`，`content` 是脚本源码 |
| 前缀脚本加在「集合」上 | 会误伤其它来源、且拼接后重复加前缀。要加在**每条订阅**上 |
| 集合名用中文 | 订阅 URL 里要 URL 编码，容易出错，用 ASCII（`merge`） |
| 橙云 + Caddy | ACME 验证被 Cloudflare 截走，必须灰云 |
| 后台打开一片白，或狂弹 `403 CORS origin not allowed` | 后端默认只允许 `sub-store.vercel.app` 等几个源，自己的域名要加进 `SUB_STORE_CORS_ALLOWED_ORIGINS` |
| 直接开裸地址一片白 | 前端在等后端地址；用 `?magicpath=` 的书签链接，或强刷 `Ctrl+F5` 后填一次 |

## 换密码（后端路径）

```bash
NEW=/$(openssl rand -hex 6)
sed -i "s#^SUB_STORE_FRONTEND_BACKEND_PATH=.*#SUB_STORE_FRONTEND_BACKEND_PATH=$NEW#" /opt/substore-stack/.backend-path
docker rm -f substore   # 用新 env 重新 docker run
sed -i "s#/<后端路径>/#$NEW/#" /opt/substore-stack/Caddyfile
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```

改完记得把 FlClash 里的订阅 URL 换掉。

## 什么时候还用 submerge

- 服务器挂了 / 临时想在局域网里合：本机 `submerge/` 仍可用，配置在 `%USERPROFILE%\.submerge\config.json`。
- 平时不用它，可以撤掉开机自启：`submerge\uninstall-autostart.ps1`。
