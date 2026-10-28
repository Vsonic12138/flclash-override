[← 索引](../README.md)

# 服务器端合成订阅

composer 是当前主服务：把三机场节点、共享规则与用途策略合成一份完整 Clash YAML，FlClash 直接订阅，无需另挂脚本。

## 当前配置快照

2026-10-29 核对的运行配置：348 个节点定义、5 个可见用途组和 4 个隐藏自动回退组、148 条顶层规则、7 个公共规则集。数量是快照，会随来源和名单变化。

| 分组 | 默认与备用 |
| --- | --- |
| 日常上网 | 默认新加坡 4 号，赔钱机场共 7 条候选，之后是酷狗和 TAG 应急线路 |
| 下载推荐 | GitHub 和部分开发服务，自动回退优先赔钱机场 6 条候选 |
| 视频推荐 | YouTube，自动回退优先赔钱机场 6 条候选 |
| AI 网站 | DMIT2 Vless → DMIT2 Hy2 → 其他美国家宽；日本和马来西亚仅手动选择 |
| 广告拦截 | REJECT；DIRECT 可临时放行 |

日常、下载、视频选择第一项“默认与备用”才启用自动回退；手动选择具体节点会固定它。AI 选择“美国家宽自动”。新配置默认值不能覆盖客户端已保存的旧选择，更新后须核对。

## 合成流程

1. 拉取 BASE_URL：沿用机场完整配置的 DNS、端口等底座。
2. 按 SOURCES、OPTIONAL_SOURCES 拉节点，增加来源前缀并去重。
3. 同步底座分组中的节点引用，剔除信息节点，合并同义组。
4. 当前 UNIFIED_RULES 模式清空机场规则，由 override.js 添加个人直连、AI 和公共名单。
5. 按地区、倍率和关键词限制家宽候选，隔离日常与 AI。
6. 精简用途分组，添加 MetaCubeX GitHub / YouTube 名单及 Copilot 例外。
7. 添加三个按固定顺序回退的隐藏组，最后以国内 IP 直连、其余流量走日常兜底。
8. 校验节点、分组和 RULE-SET 引用，成功后保存 last-good.yaml。

UNIFIED_RULES 未启用时保留机场规则，适合兼容旧部署。两种模式的规则数量、用途和默认行为不同。

## 规则来源与覆盖

- MetaCubeX meta-rules-dat：AI、GitHub、YouTube 的域名分类，24 小时刷新。
- Loyalsoldier clash-rules：国内、内网、广告及可选 gfw 名单，24 小时刷新。
- override.js：个人直连、Google 登录与 AI 的补充域名。

当前顺序见 [架构](architecture.md)。GitHub 公共名单包含网页、仓库、文件域名及部分开发服务；Copilot 特例优先走 AI。YouTube 页面和视频资源走视频组，Google 登录走家宽。普通浏览器下载无法仅凭“下载动作”统一分类，未识别的海外下载走日常组。

## 配置与部署

完整占位模板见 `composer/runtime.env.example`；构建、私有备份与回滚见 [部署恢复](recovery.md)。Dockerfile 需要 server.js、package 文件和仓库根目录 override.js 同处构建上下文，不能漏复制规则层。

服务默认只监听 127.0.0.1:13200；Caddy 管理后台和订阅入口的访问策略见 [Sub-Store 与 Caddy](substore.md)。仓库没有保存真实订阅 URL、私有路径或后台密码。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| BASE_URL | 空 | 机场完整 YAML，提供底座 |
| SOURCES | 空 | 分号分隔的标签=URL；无标签保持原名 |
| MERGE_URL | 空 | SOURCES 未配置时的兼容单来源 |
| OPTIONAL_SOURCES | 空 | 可选来源，失败保留最近一次成功缓存 |
| UA | clash-verge/v2.4.2 | 来源可能按 UA 返回不同配置，修改前验证 |
| HOST / PORT | 127.0.0.1 / 13200 | 后端绑定地址 |
| SECRET | /dgc | 私有订阅路径；生产需替换并保护 |
| CACHE_TTL | 300 | 输出缓存秒数，?force=1 强制重建 |
| FETCH_TIMEOUT | 30000 | 拉来源的超时毫秒数 |
| LAST_GOOD_DIR | data 目录 | 上次成功输出与可选来源缓存 |
| FILENAME | 大狗叫订阅.yaml | 下载文件名 |
| OVERRIDE_FILE | 同目录 override.js | 共享规则层 |
| GROUP_ALIASES | 🤖AI网站=🤖 AI 网站 | 分号分隔的旧组=新组 |
| NODE_GROUPS | 🚀节点选择,♻️自动选择 | 逗号分隔，新节点补进这些组 |
| NODE_LABEL_SEPARATOR | ` * ` | 当前部署改为 ` · `，前后空格属于值 |
| BASE_SOURCE_LABEL | 空 | 当前为赔钱机场，同步底座节点引用；SOURCES 须配相同标签 |
| AI_RESIDENTIAL_ONLY | false | AI 仅允许符合条件的家宽标注节点 |
| DAILY_DATACENTER_ONLY | false | 日常组排除家宽和特殊出口 |
| AI_REGION | 美国 | 兼容地区默认值 |
| AI_ALLOWED_REGIONS | AI_REGION | 手动家宽候选地区，分号分隔 |
| AI_AUTO_REGION | AI_REGION | 自动回退地区；当前美国 |
| AI_AUTO_FALLBACK | false | 增加同地区家宽自动回退组 |
| AI_MAX_MULTIPLIER | 0 | 0 不限制；当前 6，未知倍率不自动加入 |
| AI_RESIDENTIAL_KEYWORDS | 空 | 家宽名称关键词，分号分隔 |
| SIMPLIFY_GROUPS | false | 合并旧媒体、地区、漏网组；用途组和广告组由其他开关补充 |
| DAILY_NODE_NAMES | 空 | 精选日常完整节点名，分号分隔 |
| AD_GROUP_ENABLED | false | 增加 REJECT / DIRECT 广告开关 |
| USAGE_GROUPS | false | 增加下载和视频组及对应规则集 |
| DOWNLOAD_PREFERRED / VIDEO_PREFERRED | 空 | 用途手动组的首项，须在赔钱机场精选候选中 |
| AUTO_BACKUP | false | 增加日常、下载、视频三个隐藏 fallback 组 |
| DAILY_FALLBACK_NAMES | 空 | 日常回退完整节点名，按顺序、分号分隔 |
| DOWNLOAD_FALLBACK_NAMES | 空 | 下载回退顺序 |
| VIDEO_FALLBACK_NAMES | 空 | 视频回退顺序 |
| UNIFIED_RULES | false | 用公共名单与个人例外替代机场规则，补国内与日常兜底 |

当前生产功能通过 runtime.env 显式开启，代码默认保持兼容。

## 默认、探活与质量边界

三个用途分别探测 Google 204、GitHub robots、YouTube 204，每 120 秒检查一次，按候选顺序选择可用线路。`max-failed-times` 超过阈值会触发额外检查，不是“保证失败三次才切换”。AI 自动组优先 DMIT2 两种入口，之后仍只在美国家宽中回退。

来源名称中的家宽和倍率只是机场标注。探测通过也不代表吞吐、纯净度、地区权限或已登录的 AI 会话可用。2026-10-29 当前 Windows 以太网 / FlClash TUN 环境筛查 30 条常规线路，再对 8 条做独立内核实际请求和 3 MB 下载短测；新加坡 4 号两次约 1.8–3.9 MB/s，按该次表现排在首位。测速不是 GitHub 专项吞吐，也不代表公司网络或晚高峰。

OPTIONAL_SOURCES 缓存只表示曾从 Sub-Store 获得节点，不能证明机场源仍可刷新。TAG 订阅链接生成后 10 分钟有效，需在有效期内让 Sub-Store 拉取，过期后按机场机制重新填写。缓存含凭据，不公开。

## 验证与回滚

本机 `/health` 只确认进程存活；`/diag` 提供构建时间、错误和统计。强制重建后要确认不是在返回旧 last-good.yaml。客户端同时检查规则集已加载、分组选择与实际连接链路。

2026-10-29 的运行验证包括 GitHub / YouTube 走赔钱机场、Google 登录走 DMIT2、B 站直连。独立内核故意配置故障首选后，可回退到备用并完成 204 请求；未在生产中故意破坏线路。

## 历史兼容快照

早期两机场合成曾为 117 节点、9 组、9075 条规则、5 个规则集。该快照采用机场规则叠加模式，不能作为当前统一规则模式的验收值。

`submerge/` 和 `worker/` 是历史路线，当前主服务不依赖；单独使用 override.js 的兼容方式见 [脚本开关](configuration.md)。
