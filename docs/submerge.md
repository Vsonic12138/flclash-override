[← 索引](../README.md)

# 双订阅合并（`submerge/`）

两家机场各管一头：**赔钱**规则全、流媒体齐；**酷狗**有家宽节点——Gemini Antigravity 只认居住地机房 IP，普通机房节点会报 `not eligible for this account/region`。FlClash 一次只能启用一个订阅，来回切换很难受。

`submerge/` 是个跑在 `127.0.0.1` 的小服务（Node 内置 http，无框架）：

1. 定期拉两家订阅；
2. 以赔钱为「底」——规则、策略组、DNS 全部保留；
3. 把酷狗的 `proxies` 段加 `[酷狗]` 前缀后追加进去；
4. 输出成一条新订阅给 FlClash 用。

于是 `🤖 AI 网站` 组（收全部节点）里直接能看到 `[酷狗][vless]美国|家宽|DMIT2…`，点选即用；平时照旧走赔钱的分流和流媒体规则。

## 用法

```bash
cd submerge
npm install                 # 只依赖 js-yaml
copy config.example.json %USERPROFILE%\.submerge\config.json
# 编辑 %USERPROFILE%\.submerge\config.json 填两家真实订阅链接
start.cmd                   # 或 node server.js
```

FlClash → 订阅 → 添加 `http://127.0.0.1:7788/sub`，覆写脚本照旧挂上。

开机自启（可选，不需要管理员权限）：

```powershell
powershell -ExecutionPolicy Bypass -File install-autostart.ps1     # 放进「启动」文件夹的快捷方式
powershell -ExecutionPolicy Bypass -File uninstall-autostart.ps1   # 撤掉自启并停掉进程
```

## 端点

| 端点 | 用途 |
| --- | --- |
| `/sub` | 合并后的订阅（默认缓存 30 分钟） |
| `/sub?force` | 跳过缓存强制重拉 |
| `/diag` | 每家的抓取状态、节点数、家宽节点数、校验结果 |
| `/health` | 存活探针 |

## 离线自测

```bash
node server.js --merge-files base.yaml extra.yaml "[酷狗]"   # 合并并校验，结果打到 stdout
node server.js --check 某配置.yaml                            # 只校验
```

## 几个坑（都已在代码里处理）

| 坑 | 处理 |
| --- | --- |
| 两家缩进风格不一致（赔钱 4 空格 + 流式 `- { name: … }`，酷狗 2 空格块式） | 追加段整体重排缩进到底配置 |
| 拼出非法 YAML 会把 FlClash 配置整个搞坏 | 合并结果用 js-yaml 真解析，再查节点重名、组成员、规则出口；不过就报错 |
| 机场临时抽风拉不到订阅 | 回落到 `%USERPROFILE%\.submerge\last-good.yaml`（上次成功的合并结果） |
| token 泄露 | 真实订阅链接只放 `%USERPROFILE%\.submerge\config.json`（仓库外），仓库里只有占位符 |

## 为什么不用 Cloudflare Worker

`worker/` 里那份已部署但不可用：`workers.dev` 在国内直连不通（解析被污染 + TLS 超时），而且赔钱机场对 Cloudflare 出口 IP 直接回 403。本地服务不依赖外网可达性，反而最稳。
