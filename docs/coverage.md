# 直连层覆盖的站点

[← 索引](../README.md)

## 清单

| 站点 | 走向 |
| --- | --- |
| 嘉立创 EDA（easyeda / lceda / oshwhub） | 直连 |
| 立创商城（lcsc / szlcsc） | 直连 |
| 嘉立创（jlcpcb / jlc 系） | 直连 |
| 飞书 / Lark | 直连 |
| 字节 / 豆包 | 直连 |
| B 站（含直播流、akamaized 备用源） | 直连 |
| 网易 UU远程 | 域名 + 进程直连 |

完整域名列表见 `override.js` 的 `DIRECT_DOMAINS`。

## 为什么直连

这些站点解析到 CloudFront，GeoIP 判成境外，机场的 `GEOIP,CN,DIRECT` 命中不了，会落到 `MATCH` 走代理。实测：

| 域名 | 直连 | 走代理 |
| --- | --- | --- |
| pro.lceda.cn | 175ms | 1223ms |
| jlcpcb.com | 411ms | 501ms |
| easyeda.com | 371ms | 383ms |
| www.lcsc.com | 885ms | 847ms |

走代理既烧流量，又因为要登录下单、出口是境外 IP 而容易触发风控。

## UU远程为什么还要进程规则

远控的画面中转会直连任意中转 IP，不看域名，域名规则拦不住。所以加 `PROCESS-NAME,GameViewer.exe,DIRECT`，让这个进程的全部流量（含 UDP）无条件直连。

## 加站点

往 `DIRECT_DOMAINS` 加一行，只写域名（不带协议和路径）：

```js
const DIRECT_DOMAINS = ['easyeda.com', '你的新域名.com'];
```

提交后在 FlClash 里点一下脚本更新即可。
