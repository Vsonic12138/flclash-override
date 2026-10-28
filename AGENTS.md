# AGENTS.md

仓库维护约定。修改前先核对本地改动与服务器实际部署，避免覆盖用户正在进行的工作。

## 当前方案

- 主产物是 `composer/` 生成的完整 Clash 配置，部署在 dedirock 的 `dgc` 容器。
- `override.js` 是共享规则层，也兼容单独挂到客户端；当前聚合订阅无需再挂客户端脚本。
- composer 依赖 Node.js 和 js-yaml；Docker 构建上下文必须同时包含 server.js 和根目录 override.js。
- 本地修改、Git 提交、服务器构建部署、客户端订阅同步分别验证。不能把提交或打开文件当成部署成功。

## 目录职责

| 路径 | 职责 |
| --- | --- |
| `composer/server.js` | 合成、节点来源、用途分组、默认与备用、配置校验 |
| `composer/test.js` | 合成器离线测试 |
| `composer/runtime.env.example` | 不含秘密的部署模板 |
| `override.js` / `test/smoke.js` | 共享域名规则与测试 |
| `docs/` | 当前维护说明；旧快照须标注日期与适用范围 |
| `README.md` | 使用入口和文档索引，不堆部署正文 |
| `submerge/` / `worker/` | 历史方案，当前主链路不依赖；保留路径供查阅 |
| `.github/workflows/smoke.yml` | 共享规则和 composer 两个检查任务 |

## 行为约束

1. 单独使用 override.js 时保持“自定义直连 → AI → 上游 → 订阅”兼容顺序。服务器启用 UNIFIED_RULES 时有意替换机场规则，不混淆两种模式。
2. AI、Google 登录、Copilot 例外必须先于通用 Google / GitHub 规则匹配。
3. AI 严格模式只允许符合地区和倍率要求的家宽标注节点，不能悄悄回退到机房或 DIRECT。自动回退保持同地区，DMIT2 两种入口优先。
4. 日常、下载、视频自动组首选赔钱机场，分别探测对应目标；手动选节点允许固定出口。不要把最小延迟当作下载速度或 IP 质量证明。
5. override.js 不修改 config.proxies；composer 可合并来源、增加前缀并同步分组引用。DNS 仅在明确授权或 APPLY_DNS 开启时调整。
6. 新开关默认保持兼容。生产策略在私有 runtime.env 中启用，示例只提供占位符和公开节点名称。
7. 不覆盖已有未提交内容。变更对应测试与文档，按实际范围运行检查。

## 检查

```bash
node test/smoke.js
node composer/test.js
git diff --check
```

首次安装依赖可执行 `npm ci --omit=dev --prefix composer`。测试本身离线，安装依赖需要网络。

新增行为断言后，用临时副本删除对应行为或改变期望，确认测试会失败，再还原。不要故意破坏正在部署的文件。

涉及部署时，验证新鲜构建、配置引用、规则集加载、客户端选择与实际连接；保留可回滚版本。短测通过不代表长期稳定或已通过 AI 平台登录。

## 文档与记录

中文、短句，一篇一个主题。新增文档在 README 索引登记，并以 `[← 索引](../README.md)` 开头。

节点记录写测试日期、网络环境、机场、方法和局限；旧数据保留为历史快照。家宽、倍率来自机场标注，须区分实际 IP 与平台可用性验证。

## 不提交

真实订阅链接、token、节点密码 / UUID、私有服务器地址、后台账号、后台路径、runtime.env、Sub-Store 数据、节点缓存、Caddy 私有配置与证书、.wrangler 状态。

历史 Worker 只提交示例配置，不提交真实 KV 绑定。提交前检查暂存区，不将运行目录整体加入 Git。

提交信息用 `feat:` / `fix:` / `docs:` / `chore:` 加中文描述，说明最终行为和验证。
