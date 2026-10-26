# flclash-override

FlClash / Clash Meta 的**订阅覆写脚本**：把自用分流规则注入到机场订阅生成的配置最前面。节点原样保留，DNS 和 `MATCH` 兜底不动。

解决的问题：机场订阅每天更新会把 `config.yaml` 整个重写，手动加的规则位置不保、换机场还得重配一遍。用覆写脚本后，**规则在脚本里，订阅只负责提供节点**。

## 快速开始

1. FlClash → **配置** → **覆写脚本** → 新建，URL 填：

   ```
   https://raw.githubusercontent.com/Vsonic12138/flclash-override/main/override.js
   ```

2. 回到**配置**页 → 点订阅 → **覆写** → 类型选 **脚本** → 选中该脚本。
3. 重新应用配置（切换一次开关或重启 FlClash）。

其他订阅挂同一个脚本即可，不用重复配置规则。

## 文档

| 文档 | 讲什么 | 什么时候看 |
| --- | --- | --- |
| [四层结构](docs/architecture.md) | 规则怎么分层、为什么引上游而不 fork | 想理解优先级 |
| [直连层覆盖](docs/coverage.md) | 哪些站点强制直连及原因 | 某个站速度不对 |
| [AI 层](docs/ai-layer.md) | `🤖 AI 网站` 组、首选节点怎么定 | 给 AI 固定出口 |
| [Gemini 注意事项](docs/gemini.md) | 为什么提示「地区不可用」 | Gemini 报错 |
| [节点实测记录](docs/nodes.md) | 各节点对 ChatGPT / Gemini 的实测 | 换节点、排查断连 |
| [双订阅合并](docs/submerge.md) | 两家机场合一、家宽节点进 AI 组 | 想同时用两个机场 |
| [开关与修改](docs/configuration.md) | 全部开关、加规则的方法 | 定制 |
| [自测](docs/testing.md) | 怎么跑测试 | 改完代码 |
| [常见问题](docs/faq.md) | FAQ | 遇到问题先看这里 |

## 目录

```
override.js      覆写脚本（唯一产物，FlClash 直接引用）
docs/            文档，按主题拆分
test/smoke.js    测试，CI 自动跑
submerge/        本地合并订阅服务（可选，见 docs/submerge.md）
AGENTS.md        仓库约定（改代码前先读）
```

## License

个人自用配置，随取随用。上游名单版权归各仓库作者。
