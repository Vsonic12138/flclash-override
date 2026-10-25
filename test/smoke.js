/**
 * 冒烟测试：验证 override.js 在典型订阅配置上的行为
 * 运行：node test/smoke.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const scriptPath = path.join(__dirname, '..', 'override.js');
const source = fs.readFileSync(scriptPath, 'utf8');

/** override.js 是给 FlClash 的脚本而非 CommonJS 模块，这里包一层拿到 main，并可按需改开关 */
function load(flags) {
  let src = source;
  for (const [name, value] of Object.entries(flags || {})) {
    const pattern = new RegExp('const ' + name + ' = (?:true|false);');
    assert.ok(pattern.test(src), '找不到开关 ' + name + '，请检查 override.js 顶部');
    src = src.replace(pattern, 'const ' + name + ' = ' + value + ';');
  }
  const logs = [];
  const factory = new Function('module', 'console', src + '\nmodule.exports = main;');
  const mod = { exports: {} };
  factory(mod, { log: (...args) => logs.push(args.join(' ')) });
  assert.strictEqual(typeof mod.exports, 'function', 'main 必须是函数');
  return { main: mod.exports, logs };
}

/** 模拟一份「机场订阅」生成出来的配置 */
function makeConfig(groups) {
  return {
    mixed_port: 7890,
    mode: 'rule',
    proxies: [{ name: 'node-a', type: 'ss', server: 'example.com', port: 8388 }],
    'proxy-groups': groups || [{ name: 'PROXY', type: 'select', proxies: ['node-a'] }],
    dns: { enable: true, 'enhanced-mode': 'fake-ip' },
    rules: [
      'DOMAIN-SUFFIX,akamaized.net,PROXY',
      'DOMAIN-SUFFIX,feishu.cn,PROXY',
      'DOMAIN-SUFFIX,cn,DIRECT',
      'GEOIP,CN,DIRECT',
      'MATCH,PROXY',
    ],
  };
}

const keysOf = (rules) => rules.map((r) => r.split(',').slice(0, 2).join(',').toLowerCase());

// ==================== 场景 1：默认（挂上游名单） ====================
{
  const { main } = load();
  const base = makeConfig();
  const out = main(JSON.parse(JSON.stringify(base)));

  // 节点与分组原样保留
  assert.deepStrictEqual(out.proxies, base.proxies, '节点必须原样保留');
  assert.deepStrictEqual(out['proxy-groups'], base['proxy-groups'], '代理组必须原样保留');

  // 自定义层在最前
  assert.strictEqual(out.rules[0], 'DOMAIN-SUFFIX,easyeda.com,DIRECT', '首条应为自定义规则');

  // 上游层顺序：private → reject → direct，且都在订阅规则之前
  const at = (rule) => out.rules.indexOf(rule);
  assert.ok(at('RULE-SET,up-private,DIRECT') > -1, '缺少 private 名单');
  assert.ok(at('RULE-SET,up-private,DIRECT') < at('RULE-SET,up-reject,REJECT'), 'private 应在 reject 前');
  assert.ok(at('RULE-SET,up-reject,REJECT') < at('RULE-SET,up-direct,DIRECT'), 'reject 应在 direct 前');
  assert.ok(at('RULE-SET,up-direct,DIRECT') < at('DOMAIN-SUFFIX,cn,DIRECT'), '上游层应在订阅规则前');
  assert.strictEqual(at('RULE-SET,up-gfw,'), -1, '默认不启用 gfw 名单');

  // rule-providers 已注入
  assert.ok(out['rule-providers'], '应注入 rule-providers');
  ['up-private', 'up-reject', 'up-direct', 'up-gfw'].forEach((name) => {
    assert.ok(out['rule-providers'][name], '缺少 provider: ' + name);
    assert.strictEqual(out['rule-providers'][name].behavior, 'domain', name + ' 应为 domain 行为');
    assert.strictEqual(out['rule-providers'][name].interval, 86400, name + ' 应每天刷新');
  });

  // 抢在订阅规则之前生效 + 去重
  const akamai = out.rules.indexOf('DOMAIN-SUFFIX,akamaized.net,DIRECT');
  assert.ok(akamai > -1 && akamai < at('DOMAIN-SUFFIX,cn,DIRECT'), 'akamaized.net 应被改为直连');
  assert.strictEqual(
    out.rules.filter((r) => r.startsWith('DOMAIN-SUFFIX,akamaized.net')).length,
    1,
    'akamaized.net 只应保留一条'
  );
  assert.strictEqual(new Set(keysOf(out.rules)).size, out.rules.length, '规则不应有重复');

  // 兜底与订阅原有规则保留
  assert.strictEqual(out.rules[out.rules.length - 1], 'MATCH,PROXY', 'MATCH 必须保留在最后');
  assert.ok(out.rules.includes('GEOIP,CN,DIRECT'), '订阅原有规则必须保留');

  // 不覆盖订阅已有的 rule-providers
  const merged = main({ 'rule-providers': { mine: { type: 'inline', payload: [] } }, rules: [] });
  assert.ok(merged['rule-providers'].mine, '不应覆盖订阅自带的 rule-providers');
  assert.ok(merged['rule-providers']['up-direct'], '应合并上游名单');
}

// ==================== 场景 2：关闭上游名单（纯内联） ====================
{
  const { main } = load({ ENABLE_PROVIDERS: false });
  const out = main(makeConfig());

  assert.strictEqual(out['rule-providers'], undefined, '关闭时不应注入 rule-providers');
  assert.strictEqual(out.rules[0], 'DOMAIN-SUFFIX,easyeda.com,DIRECT', '首条应为自定义规则');
  assert.strictEqual(
    out.rules.filter((r) => r.startsWith('RULE-SET,')).length,
    0,
    '关闭时不应有 RULE-SET 规则'
  );
  assert.strictEqual(out.rules[out.rules.length - 1], 'MATCH,PROXY', 'MATCH 必须保留在最后');
}

// ==================== 场景 3：gfw 名单的出口组解析 ====================
{
  const { main } = load({ ENABLE_GFW_SET: true });
  // 有 select 组 → 自动取组名
  const out = main(makeConfig([{ name: '🎯 手动', type: 'select', proxies: ['node-a'] }]));
  assert.ok(
    out.rules.includes('RULE-SET,up-gfw,🎯 手动'),
    '有 select 组时应把 gfw 名单指向它'
  );

  // 没有 select 组 → 跳过 gfw，不能崩
  const empty = main(makeConfig([{ name: 'AUTO', type: 'url-test', proxies: ['node-a'] }]));
  assert.strictEqual(
    empty.rules.filter((r) => r.startsWith('RULE-SET,up-gfw')).length,
    0,
    '没有 select 组时应跳过 gfw 名单'
  );
  assert.strictEqual(empty.rules[empty.rules.length - 1], 'MATCH,PROXY', 'MATCH 必须保留在最后');
}

// ==================== 场景 4：异常输入 ====================
{
  const { main } = load();
  assert.strictEqual(main(null), null, 'null 输入应原样返回');
  assert.strictEqual(main(undefined), undefined, 'undefined 输入应原样返回');
  assert.ok(main({}).rules.length > 0, '空配置也应只输出自有规则');
  assert.ok(main({ rules: [] }).rules.length > 0, '空 rules 也应正常注入');
}

console.log('✓ 全部断言通过（4 个场景）');
