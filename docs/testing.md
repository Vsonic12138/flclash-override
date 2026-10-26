# 自测

[← 返回索引](../README.md)

```bash
node test/smoke.js
```

7 个场景：

1. AI 组 + 上游名单全开
2. **Google 域名必须跟随 AI 组**（`accounts.google.com` 等 4 个 + `gemini.google.com`）
3. 关闭上游名单
4. gfw 出口组自动探测
5. AI 层开关组合（含订阅自带同名组复用、无节点只有组名）
6. AI 偏好节点置顶与跨机场回退
7. 异常输入

校验内容：节点是否原样保留、AI 组是否跟随主组、`copilot` 是否排在 `microsoft.com` 直连之前、四层顺序、规则去重、`MATCH` 是否还在最后。

推送时 GitHub Actions（`.github/workflows/smoke.yml`）会自动跑一遍。

## 用真实订阅做离线验证

`test/verify-pipeline.js` 需要传入一份 JSON 配置，用来在**不启动 FlClash** 的情况下检查脚本对你真实订阅的输出。注意输入必须是**覆写前的原始订阅**（`profiles/<id>.yaml`），不是 FlClash 生成的 `config.yaml` —— 后者已经包含 `🤖 AI 网站` 组，脚本会走"复用已有组"的早退分支，测不出首选节点是否生效。

```bash
node test/verify-pipeline.js /path/to/profile.json
```

## 新增断言的约定

改 `override.js` 的行为时必须同步补 smoke 断言，并且**用负向测试确认断言真的会失败**（临时删掉一条规则，看 `node test/smoke.js` 是否报错）。只加断言不验证其有效性，很容易写出永远为真的测试。
