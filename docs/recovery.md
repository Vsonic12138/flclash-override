[← 索引](../README.md)

# 部署与恢复

## 哪些在 Git，哪些单独备份

Git 保存合成源码、共享规则、测试、文档和 `composer/runtime.env.example`。完整恢复还需要受限存储中的私有配置。

2026-10-29 核对的服务器目录：

- `/opt/dgc/runtime.env`：订阅来源、私有下载路径、默认与备用顺序及策略开关。
- `/opt/dgc/data/`：上次成功配置与可选来源缓存，包含节点凭据。
- `/opt/substore-stack/data/`：Sub-Store 订阅和处理器数据。
- `/opt/substore-stack/Caddyfile`：路由、后台登录配置及私有路径。
- `/opt/substore-stack/caddy-data/`、`caddy-config/`：Caddy 运行数据。
- Sub-Store 的私有容器环境 / 启动配置，以及后台登录恢复材料。

以上目录、Docker inspect 输出和备份包都可能含凭据，不进入 Git。保存在受访问控制的位置；数据目录备份应停服务或使用一致性快照。已有 `/opt/backup/` 快照只代表本机副本，不替代异地备份。

## 准备配置

将 `composer/runtime.env.example` 复制为服务器 `/opt/dgc/runtime.env`，按实际来源填占位符，权限设为 600。示例不是可直接运行的真实配置。

节点名单使用聚合后的完整名称，前缀与 `NODE_LABEL_SEPARATOR` 必须一致。来源、名称或可用线路变更后重新筛选；示例节点顺序是 2026-10-29 的短测快照，不是永久质量结论。

Sub-Store、Caddy 要先按私有备份恢复。后台与管理 API 需要登录保护，后端只监听本机；公开订阅只放行两个精确路径。详见 [入口维护](substore.md)。

## 构建 composer

在仓库根目录检查后，将文件复制到服务器构建目录：

```bash
node test/smoke.js
node composer/test.js
# server 是自己的 SSH 别名，/opt/dgc 须预先准备
scp composer/server.js composer/package.json composer/package-lock.json composer/Dockerfile composer/.dockerignore override.js server:/opt/dgc/
```

服务器构建镜像。镜像标签应记录这次 Git 提交号，便于追溯：

```bash
cd /opt/dgc
docker build -t dgc-composer:<提交号> .
chmod 600 runtime.env
```

不要直接在 `composer/` 原目录构建：Dockerfile 需要 `override.js`，而它位于仓库根目录。构建上下文不应包含 runtime.env 和 data/，应通过 .dockerignore 排除。

首次启动示例（已有同名容器时先按下节保留旧容器）：

```bash
docker run -d --name dgc --restart unless-stopped --network host   --env-file /opt/dgc/runtime.env   -v /opt/dgc/data:/app/data   dgc-composer:<提交号>
```

上面的复制命令已包含 .dockerignore，构建前须确认其位于 /opt/dgc/。

## 更新与回滚

更新前保留旧镜像、容器启动参数、runtime.env 和 data 的一致性副本。停止旧容器并改名后启动新版，避免直接删除唯一可工作的容器。

验证 `/health`、从本机携带私有路径强制重建后的 `/diag`、客户端规则集和分组。`last-good.yaml` 可能掩盖构建失败，要核对新鲜构建时间、错误和统计，不能只看订阅返回 200。

失败时停止新版，恢复旧配置和匹配的数据副本，再启用旧容器。旧新容器不能同时占用相同端口；共享 data 挂载在回滚前也须处理。

## 客户端验收

1. 更新“大狗叫订阅”，确认五个可见用途组。
2. 日常、下载、视频选择“默认与备用”，AI 选择“美国家宽自动”。旧选择可能优先于配置默认值。
3. 确认 GitHub、YouTube、Google 登录分别命中预期组，B 站等国内网站直连。
4. 探活成功不代表吞吐、IP 纯净度或 AI 平台登录成功。跨网络和节点出口变化后需复测。

本地 Git 提交不会部署服务器，推送 GitHub 也不会自动更新当前容器。
