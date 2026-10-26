# 大狗叫订阅：服务器端合成完整配置

把「机场完整配置」+「Sub-Store 合并出的节点」+「本仓库 `override.js` 的规则层」在服务器上合成一份**可直接订阅的完整 Clash 配置**。客户端不需要再挂覆写脚本，订阅里就带着规则。

## 为什么需要它

Sub-Store 的 `组合订阅`（merge）只输出 `proxies:`，没有 `proxy-groups` / `rules` / `rule-providers`。FlClash 直接订阅这种链接，只有节点、没有分流。之前的做法是在客户端挂 `override.js`（有效，但每台设备都要配一遍），或者在本机跑 `submerge`（电脑关机就断）。

`composer/` 把这一步搬到服务器：一条链接，任何设备直接订阅。

## 合成流程

```
① 底座   机场完整 YAML（BASE_URL，User-Agent=clash-verge/v2.4.2）
         → 提供 mixed-port / dns / 9 个策略组 / 机场自带 9000+ 条规则
② 节点   按 SOURCES 顺序拉各家机场（`;` 分隔，顺序即优先级）：
         赔钱 = Sub-Store 的 /download/collection/merge（无标签，保持原名）
         酷狗 = Sub-Store 的 /download/酷狗（有标签，节点名加「酷狗 * 」前缀）
③ 替换   用 ② 的 proxies 覆盖 ① 的 proxies
④ 清理   剔除信息节点（`剩余流量：…` / `距离下次重置剩余：…` / `套餐到期：…`），
         策略组里对这些假节点的引用一起清掉
⑤ 折叠   把机场自带的「🤖AI网站」组折到仓库的「🤖 AI 网站」上，
         让 override.js 新建统一 AI 组（偏好节点才会置顶）
⑥ 补组   合并来的新节点（名字不在底座里的，如酷狗家宽）补进
         「🚀节点选择」「♻️自动选择」
⑦ 规则   跑本仓库 override.js 的 main(config)：
         自定义直连 42 条 / AI 域名 77 条 / 上游名单 5 个 rule-provider
         → prepend 到机场规则之前并去重（与 FlClash 端覆写完全一致）
⑧ 校验   YAML 可解析 / 节点名唯一 / 分组引用存在 / RULE-SET 引用存在
```

输出示例（当前实测，两家机场）：`proxies=117 groups=9 rules=9075 rule-providers=5`，约 497 KB。
117 = 赔钱 71 + 酷狗 49 − 3 个信息节点。

## 节点名加机场前缀（`酷狗 * xxx`）

`SOURCES` 里带标签的源，节点名统一加「`标签 * `」前缀，一眼看出是谁家的：

| 写法 | 结果 |
| --- | --- |
| `酷狗=<url>` | `酷狗 * [ss]香港|家宽|砖线1|x25` |
| `<url>`（裸 URL） | 保持机场原名，不加前缀 |

- 两家机场有同名节点时，前缀天然去重；同一个标签内仍按名字去重。
- 前缀不影响 `override.js` 的 AI 首选节点：`AI_PREFERRED_NODES` 用**子串**匹配（如 `DMIT2`），
  所以「酷狗 * [vless]美国|家宽|DMIT2|…」照样能被置顶到 `🤖 AI 网站` 第一位。
- 信息节点即使带了前缀（`酷狗 * 剩余流量：…`）也会被剔除，不会污染节点列表。

## 规则从哪来（回答常见的「是不是抄大名单」）

是的，分层叠加，不是从零手写：

| 层 | 内容 | 来源 |
| --- | --- | --- |
| ① 自定义直连 | 42 条（嘉立创 / 立创 / 飞书 / 字节 / B站 / GameViewer 等） | 本仓库 `override.js` 内联 |
| ② AI 层 | 77 条内联域名 + MetaCubeX 的 `category-ai-chat-!cn`（204 条，日更） | 内联 + MetaCubeX meta-rules-dat |
| ③ 上游大名单 | private / reject / direct / gfw 四张表 | Loyalsoldier/clash-rules（★28.9k，日更） |
| ④ 机场规则 | 9000+ 条，原样保留在后面 | 机场订阅 |

上游名单用 `rule-providers` **远程引用**（`interval: 86400`），不 fork、不落库；README 里也是这个理由。

## 部署

```bash
# 1) 拷代码（server.js / package.json / Dockerfile / override.js）
rsync -av composer/ server:/opt/dgc/   # override.js 也要放进去

# 2) 构建
ssh server 'cd /opt/dgc && docker build -t dgc-composer .'

# 3) 运行（--network host 才能访问同机的 Sub-Store）
ssh server 'docker run -d --name dgc --restart unless-stopped --network host \
  -e BASE_URL="<机场完整配置链接>" \
  -e SOURCES="http://127.0.0.1:13000/<后端路径>/download/collection/merge;酷狗=http://127.0.0.1:13000/<后端路径>/download/%E9%85%B7%E7%8B%97" \
  -e SECRET=/dgc-<随机12位> \
  -e CACHE_TTL=300 \
  -v /opt/dgc/data:/app/data \
  dgc-composer'
```

环境变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `BASE_URL` | – | 机场完整配置（必须能返回 Clash YAML） |
| `SOURCES` | – | 节点源，`;` 分隔，顺序即优先级；`标签=URL` 会给该源节点加「`标签 * `」前缀，裸 URL 不加前缀 |
| `MERGE_URL` | – | 老的单源写法，等价于一个无标签的 `SOURCES`；配了 `SOURCES` 就以 `SOURCES` 为准 |
| `SECRET` | `/dgc` | 订阅路径，建议随机 |
| `UA` | `clash-verge/v2.4.2` | 拉机场配置用的 UA，**别改成 clash.meta**（见下） |
| `CACHE_TTL` | `300` | 缓存秒数，`?force=1` 强制重建 |
| `GROUP_ALIASES` | `🤖AI网站=🤖 AI 网站` | 组名折叠，`;` 分隔多组 |
| `NODE_GROUPS` | `🚀节点选择,♻️自动选择` | 新节点补进哪些组 |
| `FILENAME` | `大狗叫订阅.yaml` | 订阅文件名的中文名 |

Caddy 侧只需一条路由（比 `/download` 那些更具体，优先级自然更高）：

```caddyfile
handle /dgc-<随机12位>* {
    reverse_proxy 127.0.0.1:13200
}
```

文件名由 composer 自己发 `Content-Disposition`，Caddy 不用管。

## 验证

```bash
curl -s http://127.0.0.1:13200/health          # ok
curl -s http://127.0.0.1:13200/diag            # 节点/分组/规则/RULE-SET 数 + 缓存时间
curl -s -D - -o /dev/null https://<域名>/<SECRET> | grep -i content-disposition
curl -s https://<域名>/<SECRET> | grep -c '^  - name: 酷狗 \* '   # 带前缀的酷狗节点数
```

FlClash 里添加这条链接，名字会是「大狗叫订阅」；配置详情应看到 9 个组（含 `🤖 AI 网站`，第一项是偏好节点）。

## 坑

1. **机场按 UA 发不同文件**（实测同一链接）：`clash-verge/v2.4.2` → 71 节点 + 9 组 + 9263 规则；`FlClash/0.8.80` → 3 节点（试用版）；`clash.meta/v1.19.33` → 403；`mihomo/v1.19.33` → 0 节点。所以 `UA` 固定 `clash-verge/v2.4.2`。
2. **组名折叠必须删旧组，不能改名**：`override.js` 的 `ensureAiGroup()` 遇到同名组直接复用、不会重排偏好节点；把机场的「🤖AI网站」删掉并改指「🤖 AI 网站」后，它才会新建组并把 `AI_PREFERRED_NODE` 置顶。
3. **`js-yaml` 必须有**：Sub-Store 容器里没有，别想着借它的 node 模块。
4. **缓存兜底**：构建失败时继续吐上一次成功的结果（`data/last-good.yaml`），避免客户端刷新时拿到 502。
5. **规则数会变少**：机场 9263 条 + 仓库前置规则去重后是 9075 条，属正常（`dedupe()`）。
6. **信息节点数值会变**：`剩余流量：994.83 GB` 这类假节点的名字每天都不一样，而底座分组里引用的还是上一版名字，
   不处理就会报「分组 🚀节点选择 引用了不存在的节点」。composer 会先把这类节点连同分组引用一起剔除（日志里有「剔除信息节点 N 个」）。
7. **剔除信息节点要在算「新节点」之前**：先算新增再剔除，变过名的流量节点会被当成新节点补回策略组，校验照样失败。

## 和另外两条路的关系

| 方案 | 位置 | 适用 |
| --- | --- | --- |
| `override.js`（客户端挂覆写） | 每台设备 | 只想改规则、节点仍用机场 |
| `submerge/`（本机服务） | Windows 本机 | 电脑常开、临时合并 |
| **`composer/`（本文）** | VPS | 一条链接多设备，最省事 |

三者规则来源完全相同（同一个 `override.js`），可以随时换。
