# flclash-override

FlClash / Clash Meta 的**订阅覆写脚本**：把自用的分流规则注入到机场订阅生成的配置最前面，节点、代理组、DNS 和 `MATCH` 兜底全部保持订阅原样。

解决的问题：机场订阅每天自动更新会把 `config.yaml` 整个重写，你在界面里手动加的规则位置不保、换机场还得重配一遍。用覆写脚本后，**规则在脚本里，订阅只负责提供节点**，换机场、换规则集都不影响。

## 规则覆盖了什么

| 站点 | 域名 | 走向 |
| --- | --- | --- |
| 嘉立创 EDA | easyeda.com、lceda.com、lceda.cn、oshwhub.com | 直连 |
| 立创商城 | lcsc.com、szlcsc.com | 直连 |
| 嘉立创 | jlcpcb.com、jlc.com、jlcdfm.com、jlcsmt.com、jlc-ecad.com、jlc-bbs.com、jlc-smt.com | 直连 |
| 飞书 / Lark | feishu.cn、feishu.net、feishucdn.com、larksuite.com、larkoffice.com | 直连 |
| 字节 / 豆包 | doubao.com、snssdk.com、bytedance.com、bytedns1.com、bytescm.com、ibytedapm.com、byteimg.com、pstatp.com | 直连 |
| B 站 | bilibili.com、bilivideo.com、bilivideo.cn、biliapi.net、hdslb.com、b23.tv、akamaized.net | 直连 |

这些域名里，`lcsc.com` / `jlcpcb.com` / `easyeda.com` 解析到 CloudFront，GeoIP 判定为境外，机场的 `GEOIP,CN,DIRECT` 命中不了它们，就会落到 `MATCH` 走代理——实测直连延迟反而更低（见下表），纯属白烧流量，而且这些站要登录/下单，出口 IP 是境外节点容易触发风控。

| 域名 | 直连 | 经代理 |
| --- | --- | --- |
| pro.lceda.cn | 175ms | 1223ms |
| jlcpcb.com | 411ms | 501ms |
| easyeda.com | 371ms | 383ms |
| www.lcsc.com | 885ms | 847ms |

## 快速开始

1. 打开 FlClash → **配置** → **覆写脚本** → 新建，URL 填：

   ```
   https://raw.githubusercontent.com/Vsonic12138/flclash-override/main/override.js
   ```

   > 拉不下来就换镜像：`https://cdn.jsdelivr.net/gh/Vsonic12138/flclash-override@main/override.js`

2. 回到**配置**页，点你的订阅 → **覆写** → 类型选 **脚本** → 选中刚才导入的脚本。
3. 重新应用配置（切换一次开关或重启 FlClash）。

其他订阅也照第 2 步挂同一个脚本即可。

## 修改规则

打开 `override.js`，往 `DIRECT_DOMAINS` 数组里加一行域名（不带协议、不带路径）：

```js
const DIRECT_DOMAINS = [
  'easyeda.com',
  '你的新域名.com',   // ← 加这里
];
```

提交后，在 FlClash 的覆写脚本页面点一下更新，配置即可生效。**不需要动订阅。**

## 开关

`override.js` 顶部有三个开关：

| 开关 | 默认 | 说明 |
| --- | --- | --- |
| `DIRECT_AKAMAI` | `true` | `akamaized.net` 是否直连。它是 B 站海外备用源，也是不少国外服务用的 CDN；直连省代理流量，觉得某站变慢就改 `false` |
| `ENABLE_PROVIDERS` | `false` | 额外加载 GitHub 通用大规则集（Loyalsoldier 直连/广告名单、blackmatrix7 B 站分类），首次启动要联网下载 |
| `APPLY_DNS` | `false` | 顺带修正 DNS：`fallback-lazy-query: true`、补全 `fake-ip-filter`、`listen` 收回到 `127.0.0.1:1053`。**如果你在 FlClash 界面里自己调 DNS，保持 `false`** |

## 自测

```bash
node test/smoke.js
```

会检查：节点/代理组是否原样保留、自有规则是否插在最前、是否抢在订阅规则之前、是否去重、`MATCH` 是否还在最后、空配置会不会崩。

## 工作原理

```js
function main(config) {
  config.rules = dedupe(CUSTOM_RULES.concat(config.rules || []));
  return config;
}
```

FlClash 在生成配置时调用 `main(config)`，返回值就是最终配置。脚本只改动 `rules` 数组的头部，其余字段原样透传，所以：

- 订阅更新 → 脚本重新执行 → 规则重新注入，不会丢
- 换机场 → 节点组名变了也无所谓，脚本不依赖任何组名
- 脚本里的规则排在订阅规则前面，所以能覆盖机场自带的反向规则

## 常见问题

**切到脚本模式后，原来在界面里加的自定义规则还在吗？**
`standard`（界面覆写）和 `script`（脚本覆写）是二选一。原界面里那几条飞书/字节规则已经包含在脚本里了，切过去后建议在界面里删掉，避免重复。

**`ENABLE_PROVIDERS` 打开后第一次启动报错？**
规则集要联网下载，内核启动时代理可能还没就绪，等 `interval: 86400` 后会自动重下，或者手动重启一次 FlClash。所以第一层内联规则是保底，别关。

**改完没生效？**
确认订阅的覆写类型确实是 `脚本`，并且选中的是这个脚本；然后在覆写脚本页面点更新，再重新应用配置。

## License

个人自用配置，随取随用。
