[← 索引](../README.md)

> 本页主要说明单独使用 override.js 的兼容开关。当前服务器合成策略、默认与备用请看 [composer](composer.md)。

# 开关与修改



## 开关

都在 `override.js` 顶部。

| 开关 | 默认 | 作用 |
| --- | --- | --- |
| `ENABLE_PROVIDERS` | `true` | 引用上游大名单。关掉退化成纯内联 |
| `ENABLE_GFW_SET` | `false` | 引用 gfw 名单。出口组自动探测，不写死组名 |
| `DIRECT_AKAMAI` | `true` | `akamaized.net` 是否直连 |
| `APPLY_DNS` | `false` | 顺带修 DNS。**自己调过 DNS 就保持 false** |
| `ENABLE_AI_GROUP` | `true` | 是否创建 `🤖 AI 网站` 组 |
| `ENABLE_AI_PROVIDER` | `true` | 是否引用 AI 名单（204 条，日更） |
| `AI_PREFERRED_NODES` | `['DMIT2', '圣何塞03', '洛杉矶08']` | AI 组默认落点，详见 [AI 层](ai-layer.md) |

## 加直连站点

```js
const DIRECT_DOMAINS = ['easyeda.com', '你的新域名.com'];
```

只写域名，不带协议和路径。

## 加 AI 站点

```js
const AI_DOMAINS = ['chatgpt.com', '你的新AI域名.com'];
```

## 换上游名单

改 `UPSTREAM` / `AI_UPSTREAM` 常量。拉不动就换文件里注释掉的 jsDelivr 镜像。

## 换机场后

把新机场里真实存在的节点关键字加进 `AI_PREFERRED_NODES`。

关键字必须能在节点名里匹配到，否则会被跳过。选哪个节点先按[节点实测记录](nodes.md)测一轮，别凭感觉。
