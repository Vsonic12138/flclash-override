# flclash-override

FlClash / Clash Meta 的**订阅覆写脚本**：把自用分流规则注入到机场订阅生成的配置最前面，节点、代理组、DNS 和 `MATCH` 兜底全部保持订阅原样。

解决的问题：机场订阅每天自动更新会把 `config.yaml` 整个重写，你在界面里手动加的规则位置不保、换机场还得重配一遍。用覆写脚本后，**规则在脚本里，订阅只负责提供节点**，换机场、换规则集都不影响。

## 三层结构

```
覆写脚本（一个，所有订阅共用）
├─ ① 自定义层（内联，约 30 条）     嘉立创 / 立创 / 飞书 / 字节 / B站  → DIRECT
├─ ② 上游层（rule-providers 引用）  Loyalsoldier/clash-rules ★28.9k 日更
│     private → DIRECT / reject → REJECT / direct → DIRECT
└─ ③ 订阅层（原样保留）             机场自带规则 + MATCH 兜底
```

优先级自上而下，越靠前越先生效。第 ① 层内联在脚本里，零外部依赖，永远可用；第 ② 层是引用过来的大名单，24 小时自动刷新；第 ③ 层完全不动，机场的流媒体解锁、地区分流照样生效。

## 为什么「基于」高星仓库而不是 fork

| 仓库 | ★ | 最近推送 | 用途 |
| --- | --- | --- | --- |
| [Loyalsoldier/clash-rules](https://github.com/Loyalsoldier/clash-rules) | 28,955 | 每天 | **本项目的上游层**：direct / reject / private / gfw |
| [blackmatrix7/ios_rule_script](https://github.com/blackmatrix7/ios_rule_script) | 28,392 | 每天 | 按 App 细分 669 类，适合查漏 |
| [ACL4SSR/ACL4SSR](https://github.com/ACL4SSR/ACL4SSR) | 6,854 | 每天 | 整套配置模板 |
| [MetaCubeX/meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat) | 5,396 | 每天 | geosite/geoip 数据，内核已内置 |

`direct.txt` 有 11 万行、`reject.txt` 20 万行，上游每天推送。**fork 下来等于每天手工合冲突**，而 mihomo 的 `rule-providers` 天生就是为「引用外部名单 + 定时刷新」设计的——所以这里引而不抄：

```js
config['rule-providers'] = Object.assign({}, config['rule-providers'], {
  'up-direct': {
    type: 'http', behavior: 'domain', format: 'yaml',
    url: '.../Loyalsoldier/clash-rules/release/direct.txt',
    path: './ruleset/up-direct.yaml', interval: 86400,
  },
});
config.rules = ['RULE-SET,up-direct,DIRECT', ...config.rules];
```

上游更新 → 内核到点自动拉取 → 我们一行代码都不用改。

至于嘉立创、飞书这类站点，上面这几个仓库**都没有收录**（在 blackmatrix7 的 669 个分类里搜 Lark/Feishu、搜 EasyEDA/lceda/lcsc 均为 0 命中），只能靠自己写，这也是第 ① 层存在的意义。

## 自定义层覆盖了什么

| 站点 | 域名 | 走向 |
| --- | --- | --- |
| 嘉立创 EDA | easyeda.com、lceda.com、lceda.cn、oshwhub.com | 直连 |
| 立创商城 | lcsc.com、szlcsc.com | 直连 |
| 嘉立创 | jlcpcb.com、jlc.com、jlcdfm.com、jlcsmt.com、jlc-ecad.com、jlc-bbs.com、jlc-smt.com | 直连 |
| 飞书 / Lark | feishu.cn、feishu.net、feishucdn.com、larksuite.com、larkoffice.com | 直连 |
| 字节 / 豆包 | doubao.com、snssdk.com、bytedance.com、bytedns1.com、bytescm.com、ibytedapm.com、byteimg.com、pstatp.com | 直连 |
| B 站 | bilibili.com、bilivideo.com、bilivideo.cn、biliapi.net、hdslb.com、b23.tv、akamaized.net | 直连 |

这些域名里，`lcsc.com` / `jlcpcb.com` / `easyeda.com` 解析到 CloudFront，GeoIP 判定为境外，机场的 `GEOIP,CN,DIRECT` 命中不了，于是落到 `MATCH` 走代理。实测：

| 域名 | 直连 | 经代理 |
| --- | --- | --- |
| pro.lceda.cn | 175ms | 1223ms |
| jlcpcb.com | 411ms | 501ms |
| easyeda.com | 371ms | 383ms |
| www.lcsc.com | 885ms | 847ms |

走代理纯烧流量，而且这些站要登录/下单，出口 IP 是境外节点容易触发风控。B 站则是全站直连（含直播流 `*.bilivideo.com`），看视频不消耗代理流量。

## 快速开始

1. FlClash → **配置** → **覆写脚本** → 新建，URL 填：

   ```
   https://raw.githubusercontent.com/Vsonic12138/flclash-override/main/override.js
   ```

2. 回到**配置**页 → 点订阅 → **覆写** → 类型选 **脚本** → 选中该脚本。
3. 重新应用配置（切换一次开关或重启 FlClash）。

其他订阅挂同一个脚本即可，不用重复配置规则。

## 开关

`override.js` 顶部：

| 开关 | 默认 | 说明 |
| --- | --- | --- |
| `ENABLE_PROVIDERS` | `true` | 引用上游大名单作为第二层。关掉就退化成纯内联（零依赖，但少一层通用直连/广告拦截） |
| `ENABLE_GFW_SET` | `false` | 引用 gfw 名单强制走代理。出口组**自动探测**（取第一个 `select` 组），不写死任何组名；找不到就跳过 |
| `DIRECT_AKAMAI` | `true` | `akamaized.net` 是否直连。它是 B 站海外备用源，也服务不少国外站点，觉得某站变慢就改 `false` |
| `APPLY_DNS` | `false` | 顺带修 DNS：`fallback-lazy-query: true`、补全 `fake-ip-filter`、`listen` 收回到 `127.0.0.1:1053`。**界面里自己调 DNS 就保持 `false`** |

## 修改规则

**加自定义站点**：打开 `override.js`，往 `DIRECT_DOMAINS` 加一行（不带协议、不带路径）：

```js
const DIRECT_DOMAINS = [
  'easyeda.com',
  '你的新域名.com',   // ← 加这里
];
```

提交后，在 FlClash 的覆写脚本页面点一下更新即可。不需要动订阅。

**换上游**：改 `UPSTREAM` 常量即可，例如换成 blackmatrix7 的分类或 MetaCubeX。拉取失败时换成 jsDelivr 镜像（文件里已写好注释）。

## 自测

```bash
node test/smoke.js
```

4 个场景：挂上游名单 / 关闭上游名单 / gfw 出口组自动探测 / 异常输入。校验节点与代理组是否原样保留、三层顺序是否正确、规则是否去重、`MATCH` 是否还在最后。推送时 GitHub Actions 会自动跑一遍。

## 常见问题

**上游名单第一次启动报错？**
规则集要联网下载，内核启动时代理可能还没就绪，该次规则会被跳过、配置仍能正常加载；`interval: 86400` 到点后自动重下，或手动重启一次 FlClash。自定义层是内联的，不受影响。

**改完没生效？**
确认订阅的覆写类型确实是 `脚本` 且选中了这个脚本；然后在覆写脚本页面点更新，再重新应用配置。

**切到脚本模式后，原来在界面里加的自定义规则还在吗？**
`standard`（界面覆写）和 `script`（脚本覆写）是二选一。原界面里那几条飞书/字节规则已包含在脚本第 ① 层，切过去后建议在界面里删掉，避免重复。

**这和 `geosite:cn` 冲突吗？**
不冲突。`geosite:cn` 来自 MetaCubeX 内置数据，走的是订阅原有的 `GEOIP,CN,DIRECT` 兜底；我们只是在这之前补上 GeoIP 判不准的域名。

## License

个人自用配置，随取随用。上游名单版权归各仓库作者。
