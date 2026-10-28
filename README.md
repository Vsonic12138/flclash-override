# flclash-override · 聚合订阅与分流配置

面向 FlClash / Mihomo 的三机场聚合服务。**当前主方案是 dedirock 上的 composer：机场提供节点，仓库维护分流、用途分组和默认备用，客户端订阅完整配置。**

## 日常使用

FlClash 选中“大狗叫订阅”，保持规则模式。更新订阅即可获得服务器生成的节点和分组，无需额外挂客户端覆写脚本。

- 🌐 日常上网：国内直连，其他海外流量优先赔钱机场。
- 📥 下载推荐：GitHub 及规则集覆盖的开发服务优先赔钱机场；其他未分类下载走日常。
- 📺 视频推荐：YouTube 优先赔钱机场；国内视频直连。
- 🤖 AI 网站：AI 和 Google 登录走家宽，DMIT2 优先；日本、马来西亚家宽可手动选。
- 🛡️ 广告拦截：默认 REJECT，必要时可手动放行。

日常、下载、视频选择各组第一项“默认与备用”；AI 选择“美国家宽自动”。手动选择具体节点会固定该线路。自动探测与 IP 类型标注都不能保证所有服务可用。

## 维护入口

修改本地文件、Git 提交、部署服务器、客户端更新订阅是四个不同步骤。**仅提交代码不会更新当前服务器。** 真实订阅链接和恢复凭据单独备份，不进入 Git。

| 文档 | 内容 | 适用场景 |
| --- | --- | --- |
| [架构与优先级](docs/architecture.md) | 当前服务链路、公共名单、兼容模式 | 理解分流 |
| [服务器合成配置](docs/composer.md) | 环境变量、部署、默认与备用 | 调整节点与策略 |
| [部署恢复](docs/recovery.md) | 配置模板、私有备份、重建与回滚 | 换服务器、恢复故障 |
| [Sub-Store 与 Caddy](docs/substore.md) | 节点来源和后台访问控制 | 维护订阅源与入口 |
| [AI 层](docs/ai-layer.md) | 家宽隔离、地区、倍率与 Google 登录 | AI 排障 |
| [直连例外](docs/coverage.md) | 个人域名与进程例外 | 检查直连 |
| [Gemini 注意事项](docs/gemini.md) | 地区与登录问题 | Gemini 排障 |
| [节点实测记录](docs/nodes.md) | 带日期的历史记录 | 比较测试方法与旧结果 |
| [测试](docs/testing.md) | 离线检查和运行时验证边界 | 修改与提交 |
| [兼容脚本开关](docs/configuration.md) | 单独使用 override.js 的开关 | 维护兼容模式 |
| [常见问题](docs/faq.md) | 其他排障经验 | 查阅旧问题 |
| [历史本地合并](docs/submerge.md) | submerge 旧方案 | 查阅旧部署 |
| [历史 Worker](worker/README.md) | 未接入现用链路的中转尝试 | 查阅旧方案 |

## 目录

```text
composer/       当前服务器端合成服务、配置模板与单元测试
  runtime.env.example   不含真实凭据的部署模板
  Dockerfile            需将根目录 override.js 复制进构建上下文
override.js     共享规则层；也可单独作为客户端覆写脚本
docs/          当前文档与明确标注的历史记录
test/          共享规则测试
submerge/      历史本地合并服务，保留原路径
worker/        历史 Cloudflare 中转方案，保留源代码和示例配置
AGENTS.md      维护约定
```

## License

个人自用配置。公共名单引用自 MetaCubeX、Loyalsoldier 等项目，上游名单版权与许可归原作者。仓库不复制上游完整名单。
