'use strict';
/**
 * composer 的离线单元测试（不联网）：
 *   node test.js
 * 覆盖：合并结果解析、重名去重、分组折叠、新节点补组、信息节点剔除、校验器能否抓到悬空引用。
 */

const assert = require('assert');
const {
  parseProxyText,
  parseSources,
  prefixProxies,
  dedupeProxies,
  injectIntoGroups,
  applyGroupAliases,
  ensureAliasTargets,
  stripInfoNodes,
  assemble,
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

ok('节点源解析：标签=URL 与裸 URL 混写，顺序即优先级', () => {
  assert.deepStrictEqual(parseSources('酷狗=http://a/x; http://b/y ;赔钱=https://c/z?token=1'), [
    { label: '酷狗', url: 'http://a/x' },
    { label: '', url: 'http://b/y' },
    { label: '赔钱', url: 'https://c/z?token=1' },
  ]);
  assert.deepStrictEqual(parseSources(''), [], '未配置时不产生源');
});

ok('带标签的源加「标签 * 」前缀，裸源保持原名', () => {
  const input = [{ name: '[ss]香港|家宽|砖线1' }, { name: 'x' }];
  assert.deepStrictEqual(prefixProxies(input, '酷狗').map((p) => p.name), [
    '酷狗 * [ss]香港|家宽|砖线1',
    '酷狗 * x',
  ]);
  assert.deepStrictEqual(prefixProxies(input, '').map((p) => p.name), ['[ss]香港|家宽|砖线1', 'x']);
  assert.strictEqual(input[0].name, '[ss]香港|家宽|砖线1', '不能改到原对象');
});

ok('前缀过的酷狗节点会被当作新节点补进策略组，且校验通过', () => {
  const cfg = baseConfig();
  cfg.proxies = [].concat(cfg.proxies, prefixProxies([{ name: '香港01' }], '酷狗'));
  const added = injectIntoGroups(cfg, ['酷狗 * 香港01']);
  const select = cfg['proxy-groups'].find((g) => g.name === '🚀节点选择');
  assert.ok(select.proxies.includes('酷狗 * 香港01'));
  assert.strictEqual(added.length, 2, '两个组各补一次');
  assert.deepStrictEqual(validate(cfg).problems, []);
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

ok('剔除信息节点：节点删掉，分组引用一起清掉', () => {
  const cfg = baseConfig();
  cfg.proxies.push(
    { name: '剩余流量：994.7 GB', type: 'ss', server: '127.0.0.1' },
    { name: '套餐到期：2027-09-25', type: 'ss', server: '127.0.0.1' },
  );
  cfg['proxy-groups'][1].proxies.push('剩余流量：994.7 GB', '套餐到期：2027-09-25');

  const { removed, refs } = stripInfoNodes(cfg);
  assert.strictEqual(removed.length, 2, JSON.stringify(removed));
  assert.strictEqual(refs, 2, '两处引用都要清掉');
  assert.ok(!cfg.proxies.some((p) => p.name.includes('剩余流量')));
  assert.ok(!cfg['proxy-groups'][1].proxies.some((n) => n.includes('剩余流量')));
  assert.deepStrictEqual(validate(cfg).problems, [], '剔干净后不该有悬空引用');
});

ok('带机场前缀的信息节点也会被剔除，真节点留下', () => {
  const cfg = {
    proxies: [
      { name: '酷狗 * 剩余流量：1 GB', type: 'ss' },
      { name: '酷狗 * 距离下次重置剩余：29 天', type: 'ss' },
      { name: '酷狗 * [ss]香港|家宽|砖线1|x25', type: 'ss' },
    ],
    'proxy-groups': [{ name: '🚀节点选择', type: 'select', proxies: ['酷狗 * 剩余流量：1 GB'] }],
  };
  const { removed } = stripInfoNodes(cfg);
  assert.strictEqual(removed.length, 2, JSON.stringify(removed));
  assert.deepStrictEqual(cfg.proxies.map((p) => p.name), ['酷狗 * [ss]香港|家宽|砖线1|x25']);
});

ok('信息节点数值变了，也不会被当成新节点补回策略组（build 顺序回归）', () => {
  const cfg = baseConfig();
  cfg.proxies.push({ name: '剩余流量：994.7 GB', type: 'ss', server: '127.0.0.1' });
  cfg['proxy-groups'][1].proxies.push('剩余流量：994.7 GB');
  // SOURCES 拉回来时流量数值已经变了 → 名字不同，会被误判成「新节点」
  const merged = [...cfg.proxies, { name: '剩余流量：994.83 GB', type: 'ss', server: '127.0.0.1' }];

  const asm = assemble(cfg, merged);
  ensureAliasTargets(cfg, asm.alias.targets);

  assert.strictEqual(asm.info.removed.length, 2, JSON.stringify(asm.info.removed));
  assert.deepStrictEqual(validate(cfg).problems, []);
  for (const g of cfg['proxy-groups']) {
    assert.ok(!(g.proxies || []).some((n) => String(n).includes('剩余流量')), g.name + ' 里还有流量节点');
  }
});

console.log(`\n通过 ${passed} 项`);
