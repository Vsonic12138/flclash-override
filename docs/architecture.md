# 四层结构

[← 索引](../README.md)

一句话：**规则写在脚本里，订阅只负责提供节点。**

```
① 自定义直连层   内联域名 + 进程 → DIRECT
② AI 层          AI 域名 → 🤖 AI 网站（自动新建）
③ 上游层         rule-providers 引用大名单，日更
④ 订阅层         机场自带规则，原样保留
```

从上到下依次生效，越靠前优先级越高。

- **①② 内联在脚本里**，不依赖网络，永远可用。
- **③ 引用外部名单**，24 小时自动刷新。
- **④ 完全不动**，机场的流媒体解锁、地区分流照常工作。

## 为什么不 fork 上游仓库

上游名单每天推送（`direct.txt` 11 万行、`reject.txt` 20 万行），fork 等于每天手工合冲突。而 mihomo 的 `rule-providers` 本来就能引用外部名单并定时刷新：

```js
config['rule-providers']['up-direct'] = {
  type: 'http', behavior: 'domain', format: 'yaml',
  url: '.../Loyalsoldier/clash-rules/release/direct.txt',
  path: './ruleset/up-direct.yaml', interval: 86400,
};
config.rules.unshift('RULE-SET,up-direct,DIRECT');
```

上游更新 → 内核自动拉取 → 我们不用改代码。

## 为什么还需要①层

嘉立创、飞书、UU远程这类站点，主流规则仓库**都没收录**，只能自己写。详见[直连层覆盖](coverage.md)。
