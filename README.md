# flclash-override

FlClash / Clash Meta 的**订阅覆写脚本**：把自用分流规则注入到机场订阅生成的配置最前面。节点原样保留，只额外新增一个「🤖 AI 网站」策略组；DNS 和 `MATCH` 兜底不动。

解决的问题：机场订阅每天自动更新会把 `config.yaml` 整个重写，你在界面里手动加的规则位置不保、换机场还得重配一遍。用覆写脚本后，**规则在脚本里，订阅只负责提供节点**，换机场、换规则集都不影响。

## 四层结构

```
覆写脚本（一个，所有订阅共用）
├─ ① 自定义直连层（内联 39 域 + 4 进程）  嘉立创 / 立创 / 飞书 / 字节 / B站 / UU远程 → DIRECT
├─ ② AI 层（内联 80 条 + 引用 204 条）  AI 域名 → 🤖 AI 网站（自动新建的策略组）
├─ ③ 上游层（rule-providers 引用）  Loyalsoldier/clash-rules ★28.9k 日更
│     private → DIRECT / reject → REJECT / direct → DIRECT
└─ ④ 订阅层（原样保留）             机场自带规则 + MATCH 兜底
```

优先级自上而下，越靠前越先生效。第 ① ② 层内联在脚本里，零外部依赖，永远可用；第 ③ 层是引用过来的大名单，24 小时自动刷新；第 ④ 层完全不动，机场的流媒体解锁、地区分流照样生效。

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
| 网易 UU远程 | nrd.nie.163.com（API 与信令）、nie.163.com、webapp.163.com、uu.163.com、easebar.com，**外加进程规则** `GameViewer.exe` 等 4 个进程全部直连 | 直连 |

这些域名里，`lcsc.com` / `jlcpcb.com` / `easyeda.com` 解析到 CloudFront，GeoIP 判定为境外，机场的 `GEOIP,CN,DIRECT` 命中不了，于是落到 `MATCH` 走代理。实测：

| 域名 | 直连 | 经代理 |
| --- | --- | --- |
| pro.lceda.cn | 175ms | 1223ms |
| jlcpcb.com | 411ms | 501ms |
| easyeda.com | 371ms | 383ms |
| www.lcsc.com | 885ms | 847ms |

走代理纯烧流量，而且这些站要登录/下单，出口 IP 是境外节点容易触发风控。B 站则是全站直连（含直播流 `*.bilivideo.com`），看视频不消耗代理流量。

**为什么 UU远程额外加了进程规则**：远控的画面中转可能直接连任意中转 IP（不看域名），光靠域名拦不住；`PROCESS-NAME,GameViewer.exe,DIRECT` 让这个进程的全部流量（含 UDP）无条件直连，比域名规则更彻底。实测启动 UU远程 后，`api-ipv4.nrd.nie.163.com`、`sig-3207-b.nrd.nie.163.com`（信令）都是 DIRECT，没有一条走代理。

## AI 层：自动建一个「🤖 AI 网站」组

国外 AI 之前是**靠最后一条 `MATCH` 兜底**才走代理的，没有任何显式规则，其中还有一个真漏洞：`copilot.microsoft.com` 命中了订阅里的 `DOMAIN-SUFFIX,microsoft.com,DIRECT`，实测直连 TLS 握手直接被重置，**Copilot 完全用不了**（走代理也一样，因为规则先把它判成了直连）。

现在脚本会：

1. 在最前面插入策略组 **`🤖 AI 网站`**（`select`），成员 = 原主策略组 + 所有节点 + `DIRECT`，**默认选中命中 `AI_PREFERRED_NODE` 关键字的节点**（默认 `DMIT2`；没有匹配时才「跟随原主组」，行为与以前一致）；
2. 把 AI 域名全部指向这个组，且排在订阅的 `microsoft.com → DIRECT` 之类规则**之前**，堵住类似漏洞；
3. 名单双层：内联 80 条精准域名 + 引用 [MetaCubeX/meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat) 的 `category-ai-chat-!cn`（204 条，24 小时自动刷新）。

覆盖范围（内联部分，上游名单还会补更多）：

| 类别 | 域名 |
| --- | --- |
| OpenAI / ChatGPT / Sora | openai.com、chatgpt.com、oaistatic.com、oaiusercontent.com、sora.com |
| Google / Gemini | gemini.google.com、aistudio.google.com、generativelanguage.googleapis.com、notebooklm.google.com、jules.google、deepmind.google、makersuite.google.com |
| Anthropic / Claude | claude.ai、anthropic.com |
| 微软 Copilot / Bing Chat | copilot.microsoft.com、copilot.cloud.microsoft、sydney.bing.com、edgeservices.bing.com、services.bingapis.com、gateway.bingviz.microsoft.net、designer.microsoft.com |
| xAI / Grok | x.ai、grok.com、grok.x.com、accounts.x.ai、api.x.ai |
| 检索 / 对话 | perplexity.ai、pplx.ai、poe.com、you.com、phind.com、pi.ai、monica.im |
| 模型服务 / 推理 | mistral.ai、cohere.ai、cohere.com、groq.com、cerebras.ai、huggingface.co、hf.co、replicate.com、together.ai、together.xyz、fireworks.ai、deepinfra.com、openrouter.ai、ollama.com、lmstudio.ai |
| 生成式 / 创意 | midjourney.com、suno.com、suno.ai、runwayml.com、lumalabs.ai、pika.art、ideogram.ai、leonardo.ai、stability.ai、elevenlabs.io、elevenlabs.com、heygen.com、synthesia.io、character.ai、c.ai |
| 编码类 AI | cursor.com、cursor.sh、windsurf.com、githubcopilot.com、v0.app、v0.dev、lovable.dev、gamma.app、lmarena.ai、chat.lmsys.org |

上游名单还额外覆盖了 notebooklm、antigravity、claudemcp、deepwiki、grok.x.com、manus、sider、coderabbit、comfyui、trae、marscode 等 200 多个域名。

**想给 AI 单独固定节点**：FlClash → 代理 → `🤖 AI 网站` → 选一个美国/日本节点。这样其它流量仍走主组，AI 用固定出口，主组换节点也不会把 AI 带偏。

**让它"默认就选中某个节点"**（更省心，订阅每天更新也不会把选择冲掉）：改脚本顶部的

```js
const AI_PREFERRED_NODE = 'DMIT2';   // 换成你想要的节点名关键字，留空 '' 则跟随主组
```

命中关键字的节点会被排到 `🤖 AI 网站` 组成员的第一位，而 select 组的默认选择就是第一位 —— 所以每次订阅更新、每次重新应用配置，AI 都会自动落在这个节点上。目前设的是 `DMIT2`（实测唯一能稳定连 ChatGPT 的家宽出口，约 1.3 秒握手）。

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
| `ENABLE_AI_GROUP` | `true` | 创建「🤖 AI 网站」策略组（订阅已有同名组则直接复用，不会重复创建）。关掉后 AI 规则回落到原主策略组 |
| `ENABLE_AI_PROVIDER` | `true` | 引用 MetaCubeX 的 `category-ai-chat-!cn` 名单（204 条，日更）。关掉后只用内联的 80 条 |
| `AI_PREFERRED_NODE` | `'DMIT2'` | AI 组默认落点。成员名命中该关键字的节点排到第一位并被默认选中，订阅更新后也不会被重置。留空 `''` 则跟随主组 |

## 修改规则

**加自定义站点**：打开 `override.js`，往 `DIRECT_DOMAINS` 加一行（不带协议、不带路径）：

```js
const DIRECT_DOMAINS = [
  'easyeda.com',
  '你的新域名.com',   // ← 加这里
];
```

提交后，在 FlClash 的覆写脚本页面点一下更新即可。不需要动订阅。

**加 AI 站点**：往 `AI_DOMAINS` 加一行即可（同样不带协议和路径），例如：

```js
const AI_DOMAINS = [
  'chatgpt.com',
  '你的新AI域名.com',   // ← 加这里
];
```

**换上游**：改 `UPSTREAM` / `AI_UPSTREAM` 常量即可，例如换成 blackmatrix7 的分类或 MetaCubeX。拉取失败时换成 jsDelivr 镜像（文件里已写好注释）。

## 自测

```bash
node test/smoke.js
```

6 个场景：AI 组 + 上游名单全开 / 关闭上游名单 / gfw 出口组自动探测 / AI 层开关组合（含订阅自带同名组复用、无节点只有组名）/ AI 偏好节点置顶 / 异常输入。校验节点是否原样保留、AI 组是否跟随主组、`copilot` 是否排在 `microsoft.com` 直连之前、四层顺序、规则去重、`MATCH` 是否还在最后。推送时 GitHub Actions 会自动跑一遍。

## 常见问题

**上游名单第一次启动报错？**
规则集要联网下载，内核启动时代理可能还没就绪，该次规则会被跳过、配置仍能正常加载；`interval: 86400` 到点后自动重下，或手动重启一次 FlClash。自定义层是内联的，不受影响。

**改完没生效？**
确认订阅的覆写类型确实是 `脚本` 且选中了这个脚本；然后在覆写脚本页面点更新，再重新应用配置。

**切到脚本模式后，原来在界面里加的自定义规则还在吗？**
`standard`（界面覆写）和 `script`（脚本覆写）是二选一。原界面里那几条飞书/字节规则已包含在脚本第 ① 层，切过去后建议在界面里删掉，避免重复。

**这和 `geosite:cn` 冲突吗？**
不冲突。`geosite:cn` 来自 MetaCubeX 内置数据，走的是订阅原有的 `GEOIP,CN,DIRECT` 兜底；我们只是在这之前补上 GeoIP 判不准的域名。

**`🤖 AI 网站` 这个组是干什么的？能删吗？**
脚本会自动建（订阅自带同名组则复用），AI 域名都指向它。它默认跟随你的主策略组，所以不管它也不影响使用；想给 AI 固定出口时再去里面选节点。删掉的话下次应用配置又会生成，要彻底关掉就把 `ENABLE_AI_GROUP` 改成 `false`（此时 AI 规则直接指向主组）。

**为什么 AI 域名要显式写规则，靠 `MATCH` 兜底不行吗？**
不行。`MATCH` 是最后一道兜底，订阅里任何一条更早的 `DIRECT` 规则都能截胡——比如 `microsoft.com → DIRECT` 就把 Copilot 判成了直连并且实测连不通。显式规则排在订阅规则之前，才不会被覆盖。

## License

个人自用配置，随取随用。上游名单版权归各仓库作者。
