'use strict';
/**
 * composer 的离线单元测试（不联网）：
 *   node test.js
 * 覆盖：合并结果解析、重名去重、分组折叠、新节点补组、校验器能否抓到悬空引用。
 */

const assert = require('assert');
const {
  parseProxyText,
  dedupeProxies,
  injectIntoGroups,
  applyGroupAliases,
  ensureAliasTargets,
  validate,
} = require('./server');

let passed = 0;
function ok(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    console.error('  ✗ ' + name + '\n    ' + e.message);
    process.exitCode = 1;
  }
}

function baseConfig() {
  return {
    'mixed-port': 7890,
    proxies: [
      { name: '🇯🇵日本东京01', type: 'vless', server: 'a.example', port: 443 },
      { name: '🇺🇸圣何塞03', type: 'vless', server: 'b.example', port: 443 },
    ],
    'proxy-groups': [
      { name: '🤖AI网站', type: 'select', proxies: ['🚀节点选择', 'DIRECT'] },
      { name: '🚀节点选择', type: 'select', proxies: ['♻️自动选择', '🇯🇵日本东京01', '🤖AI网站'] },
      { name: '♻️自动选择', type: 'url-test', proxies: ['🇯🇵日本东京01', '🇺🇸圣何塞03'] },
    ],
    rules: [
      'DOMAIN-KEYWORD,openai,🤖AI网站',
      'RULE-SET,up-direct,DIRECT',
      'MATCH,🚀节点选择',
    ],
    'rule-providers': { 'up-direct': { type: 'http', url: 'https://example.com/direct.yaml' } },
  };
}

console.log('composer 测试');

ok('合并结果必须是带 proxies 的 YAML', () => {
  const proxies = parseProxyText('proxies:\n  - {"name":"A","type":"ssh","server":"x","port":22}\n');
  assert.deepStrictEqual(proxies.map((p) => p.name), ['A']);
});

ok('没有 proxies 时明确报错（旧版 regex 会误报 0 个）', () => {
  assert.throws(() => parseProxyText('proxies: []\n'), /没有 proxies/);
});

ok('重名节点只保留第一个', () => {
  const out = dedupeProxies([{ name: 'A' }, { name: 'A' }, { name: 'B' }]);
  assert.deepStrictEqual(out.map((p) => p.name), ['A', 'B']);
});

ok('折叠组：删机场 AI 组并把引用改到新名字', () => {
  const cfg = baseConfig();
  const info = applyGroupAliases(cfg);
  assert.deepStrictEqual(info.folded, ['🤖AI网站 ⇢ 🤖 AI 网站']);
  const names = cfg['proxy-groups'].map((g) => g.name);
  assert.ok(!names.includes('🤖AI网站'), '旧组应被删除');
  const select = cfg['proxy-groups'].find((g) => g.name === '🚀节点选择');
  assert.ok(select.proxies.includes('🤖 AI 网站'), '组内引用应改指新组');
  assert.ok(cfg.rules.includes('DOMAIN-KEYWORD,openai,🤖 AI 网站'), '规则目标应改指新组');
});

ok('没有 override.js 时会补建被折叠的组', () => {
  const cfg = baseConfig();
  const info = applyGroupAliases(cfg);
  ensureAliasTargets(cfg, info.targets);
  assert.ok(cfg['proxy-groups'].some((g) => g.name === '🤖 AI 网站'));
  const { problems } = validate(cfg);
  assert.deepStrictEqual(problems, []);
});

ok('新节点补进指定组且不重复', () => {
  const cfg = baseConfig();
  const added = injectIntoGroups(cfg, ['[酷狗] 美国家宽 DMIT2']);
  const select = cfg['proxy-groups'].find((g) => g.name === '🚀节点选择');
  assert.ok(select.proxies.includes('[酷狗] 美国家宽 DMIT2'));
  assert.strictEqual(added.length, 2, '两个组各补一次');
});

ok('校验器能抓到悬空引用', () => {
  const cfg = baseConfig();
  cfg['proxy-groups']
    .find((g) => g.name === '🚀节点选择')
    .proxies.push('不存在的节点');
  const { problems } = validate(cfg);
  assert.ok(problems.some((p) => p.includes('不存在的节点')), JSON.stringify(problems));
});

ok('校验器能抓到 RULE-SET 指向不存在的 provider', () => {
  const cfg = baseConfig();
  cfg.rules.push('RULE-SET,up-gfw,DIRECT');
  const { problems } = validate(cfg);
  assert.ok(problems.some((p) => p.includes('up-gfw')), JSON.stringify(problems));
});

ok('校验器能抓到重名节点', () => {
  const cfg = baseConfig();
  cfg.proxies.push({ name: '🇯🇵日本东京01', type: 'vless' });
  const { problems } = validate(cfg);
  assert.ok(problems.some((p) => p.includes('节点重名')), JSON.stringify(problems));
});

console.log(`\n通过 ${passed} 项`);
