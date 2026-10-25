/**
 * 冒烟测试：验证 override.js 在典型订阅配置上的行为
 * 运行：node test/smoke.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const scriptPath = path.join(__dirname, '..', 'override.js');
const source = fs.readFileSync(scriptPath, 'utf8');

// override.js 是给 FlClash 的脚本，不是 CommonJS 模块，
// 这里用 Function 包一层拿到 main
const factory = new Function(
  'module',
  'console',
  source + '\nmodule.exports = main;'
);
const mod = { exports: {} };
const logs = [];
factory(mod, { log: (...args) => logs.push(args.join(' ')) });
const main = mod.exports;

assert.strictEqual(typeof main, 'function', 'main 必须是函数');

// 模拟一份「机场订阅」生成出来的配置
const subscription = {
  mixed_port: 7890,
  mode: 'rule',
  proxies: [{ name: 'node-a', type: 'ss', server: 'example.com', port: 8388 }],
  'proxy-groups': [{ name: 'PROXY', type: 'select', proxies: ['node-a'] }],
  dns: { enable: true, 'enhanced-mode': 'fake-ip' },
  rules: [
    'DOMAIN-SUFFIX,akamaized.net,PROXY',
    'DOMAIN-SUFFIX,feishu.cn,PROXY',
    'DOMAIN-SUFFIX,cn,DIRECT',
    'GEOIP,CN,DIRECT',
    'MATCH,PROXY',
  ],
};

const out = main(JSON.parse(JSON.stringify(subscription)));

// 1. 不修改节点与分组
assert.deepStrictEqual(out.proxies, subscription.proxies, '节点必须原样保留');
assert.deepStrictEqual(
  out['proxy-groups'],
  subscription['proxy-groups'],
  '代理组必须原样保留'
);

// 2. 自有规则插在最前面
assert.strictEqual(out.rules[0], 'DOMAIN-SUFFIX,easyeda.com,DIRECT', '首条应为自有规则');

// 3. 抢在订阅规则之前生效（订阅里原本是走代理的）
const akamai = out.rules.indexOf('DOMAIN-SUFFIX,akamaized.net,DIRECT');
const feishu = out.rules.indexOf('DOMAIN-SUFFIX,feishu.cn,DIRECT');
assert.ok(akamai > -1, 'akamaized.net 应被改为直连');
assert.ok(feishu > -1, 'feishu.cn 应被改为直连');
assert.ok(akamai < out.rules.indexOf('DOMAIN-SUFFIX,cn,DIRECT'), '自定义规则要在通用规则之前');

// 4. 订阅里被覆盖的旧规则已被去重掉，没有重复键
const keys = out.rules.map((r) => r.split(',').slice(0, 2).join(',').toLowerCase());
assert.strictEqual(keys.length, new Set(keys).size, '规则不应有重复');
assert.strictEqual(
  out.rules.filter((r) => r.startsWith('DOMAIN-SUFFIX,akamaized.net')).length,
  1,
  'akamaized.net 只应保留一条'
);

// 5. 兜底 MATCH 与订阅原有规则保留
assert.strictEqual(out.rules[out.rules.length - 1], 'MATCH,PROXY', 'MATCH 必须保留在最后');
assert.ok(out.rules.includes('GEOIP,CN,DIRECT'), '订阅原有规则必须保留');

// 6. 空配置 / 异常输入不崩
assert.deepStrictEqual(main({}).rules.length > 0, true, '空配置也应只输出自有规则');
assert.strictEqual(main(null), null, 'null 输入应原样返回');

console.log('✓ 全部断言通过');
console.log('  自有规则 ' + logs.join(' | '));
console.log('  样例输出前 5 条：');
out.rules.slice(0, 5).forEach((r) => console.log('    ' + r));
