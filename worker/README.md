# 历史 Worker 中转方案

[← 索引](../README.md)

这里保留早期 Cloudflare Worker 订阅中转源码，**当前 FlClash → Caddy → composer 主链路不依赖此目录**。保留原路径供查阅，不作为生产恢复方案。

当时记录过国内访问 workers.dev 和机场限制 Cloudflare 出口的问题；这是历史观察，本次未重新验证。不要据此认定所有 Worker 部署都不可用。

`wrangler.example.toml` 使用占位 KV 绑定。真实 `wrangler.toml`、.wrangler 状态以及 PATH_KEY、SUB_KG、SUB_PQ 等 Secret 不提交。源码定时任务可把上游片段写进 KV，可能包含节点信息；恢复此方案前需重新检查数据访问和日志范围。
