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
  enforceEgressPolicy,
  maskUrl,
  simplifyGroups,
  curateDailyNodes,
  nodeMultiplier,
  addUsageGroups,
  addDefaultFallbacks,
  prepareUnifiedRules,
  finishUnifiedRules,
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

ok('AI 仅美国家宽，日常组不可直接或间接选家宽，节点定义保持原样', () => {
  const cfg = baseConfig();
  const homes = ['酷狗 * 美国家宽 DMIT2', '酷狗 * 美国家宽 ATT', '酷狗 * 日本家宽'];
  cfg.proxies.push(...homes.map((name) => ({ name, type: 'vless' })));
  cfg['proxy-groups'].push({ name: '🤖 AI 网站', type: 'select', proxies: [homes[0], '🚀节点选择', homes[1], homes[2], 'DIRECT'] });
  cfg['proxy-groups'][1].proxies.push(...homes, '🤖 AI 网站');
  cfg['proxy-groups'][2].proxies.push(...homes);
  const before = JSON.stringify(cfg.proxies);
  enforceEgressPolicy(cfg, { aiResidentialOnly: true, dailyDatacenterOnly: true, aiRegion: '美国' });
  assert.deepStrictEqual(cfg['proxy-groups'].find((g) => g.name === '🤖 AI 网站').proxies, homes.slice(0, 2));
  for (const g of cfg['proxy-groups'].filter((g) => g.name !== '🤖 AI 网站')) {
    assert.ok(g.proxies.every((n) => !homes.includes(n) && n !== '🤖 AI 网站'));
  }
  assert.strictEqual(JSON.stringify(cfg.proxies), before);
});

ok('标记为星链和蜂窝的特殊节点不自动混入日常或 AI 家宽', () => {
  const cfg = baseConfig();
  const extra = ['TAGMeta * 🇺🇸 美国-家宽 01', 'TAGMeta * 🇺🇸 美国星链', 'TAGMeta * 🇯🇵 日本蜂窝5G'];
  cfg.proxies.push(...extra.map((name) => ({ name, type: 'ss' })));
  cfg['proxy-groups'].push({ name: '🤖 AI 网站', type: 'select', proxies: [...extra] });
  cfg['proxy-groups'][1].proxies.push(...extra);
  enforceEgressPolicy(cfg, { aiResidentialOnly: true, dailyDatacenterOnly: true, aiRegion: '美国' });
  assert.deepStrictEqual(cfg['proxy-groups'].find((g) => g.name === '🤖 AI 网站').proxies, [extra[0]]);
  assert.ok(cfg['proxy-groups'].find((g) => g.name === '🚀节点选择').proxies.every((n) => !extra.includes(n)));
  assert.strictEqual(cfg.proxies.length, 5, '所有节点定义仍保留');
});

ok('AI 家宽只保留选定且倍率不高于 6x 的线路，未知倍率不自动加入', () => {
  const cfg = baseConfig();
  const names = ['酷狗 * [vless]美国|家宽|DMIT2|移动|联通|x6', '酷狗 * [Hy2]美国|家宽|DMIT2|移动|联通|x6', '酷狗 * [ss]美国|家宽Wave|砖线1|x25', '酷狗 * [vless]美国|家宽|Wave|x5', '酷狗 * [Hy2]美国|家宽|Wave|x5', 'TAGMeta * 🇺🇸 美国-家宽 01丨5x US', 'TAGMeta * 🇺🇸 美国-家宽 02丨5x US', 'TAGMeta * 🇺🇸 美国-家宽 03丨5x US', '美国|家宽|DMIT2|未标倍率'];
  cfg.proxies.push(...names.map((name) => ({ name, type: name.startsWith('TAGMeta') ? 'ss' : name.includes('[Hy2]') ? 'hysteria2' : 'vless' })));
  cfg['proxy-groups'].push({ name: '🤖 AI 网站', type: 'select', proxies: names });
  enforceEgressPolicy(cfg, { aiResidentialOnly: true, dailyDatacenterOnly: true, aiAutoFallback: true, aiRegion: '美国', aiMaxMultiplier: 6, aiResidentialKeywords: ['DMIT2', '美国|家宽|Wave', '美国-家宽 01', '美国-家宽 02'] });
  const auto = cfg['proxy-groups'].find((g) => g.name === '🏠 美国家宽自动');
  assert.deepStrictEqual(auto.proxies, [names[0], names[1], names[3], names[4], names[5], names[6]]);
  assert.strictEqual(nodeMultiplier(names[2]), 25);
  assert.strictEqual(nodeMultiplier(names[5]), 5);
  assert.strictEqual(nodeMultiplier(names[8]), null);
  assert.ok(!auto.proxies.some((n) => /x25/.test(n)));
});

ok('日本和马来西亚低倍率家宽可手动选择，美国自动回退仍仅用美国出口', () => {
  const cfg = baseConfig();
  const names = ['酷狗 * [vless]美国|家宽|DMIT2|x6', 'TAGMeta * 🇯🇵 日本家宽 01丨3x JP', 'TAGMeta * 🇲🇾 马来西亚家宽 01丨1x MY', 'TAGMeta * 🇯🇵 日本家宽 12丨3x JP', 'TAGMeta * 🇯🇵 日本家宽 13丨25x JP'];
  cfg.proxies.push(...names.map((name) => ({ name, type: 'ss' })));
  cfg['proxy-groups'].push({ name: '🤖 AI 网站', type: 'select', proxies: names });
  cfg['proxy-groups'][1].proxies.push(...names);
  enforceEgressPolicy(cfg, { aiResidentialOnly: true, dailyDatacenterOnly: true, aiAutoFallback: true, aiRegion: '美国', aiAllowedRegions: ['美国', '日本', '马来西亚'], aiAutoRegion: '美国', aiMaxMultiplier: 6, aiResidentialKeywords: ['DMIT2', '日本家宽', '马来西亚家宽'] });
  const ai = cfg['proxy-groups'].find((g) => g.name === '🤖 AI 网站');
  const auto = cfg['proxy-groups'].find((g) => g.name === '🏠 美国家宽自动');
  assert.deepStrictEqual(ai.proxies, ['🏠 美国家宽自动', ...names.slice(0, 4)]);
  assert.deepStrictEqual(auto.proxies, [names[0]]);
  assert.ok(cfg['proxy-groups'].find((g) => g.name === '🚀节点选择').proxies.every((n) => !names.includes(n)));
  assert.deepStrictEqual(validate(cfg).problems, []);
});

ok('严格 AI 策略缺少家宽时明确失败，关闭策略保持原行为', () => {
  assert.throws(() => enforceEgressPolicy(baseConfig(), { aiResidentialOnly: true, aiRegion: '美国' }), /没有符合/);
  const cfg = baseConfig(), before = JSON.stringify(cfg);
  assert.strictEqual(enforceEgressPolicy(cfg, {}), null);
  assert.strictEqual(JSON.stringify(cfg), before);
});

ok('跨网络时仅在美国家宽中回退，DMIT2 两种传输优先，并保留手动固定出口', () => {
  const cfg = baseConfig();
  cfg.proxies.push({ name: '美国家宽 ATT', type: 'vless' }, { name: '美国家宽 DMIT2 Hy2', type: 'hysteria2' }, { name: '美国家宽 DMIT2 VLESS', type: 'vless' });
  cfg['proxy-groups'].push({ name: '🤖 AI 网站', type: 'select', proxies: ['美国家宽 ATT', '美国家宽 DMIT2 Hy2', '美国家宽 DMIT2 VLESS', 'DIRECT'] });
  enforceEgressPolicy(cfg, { aiResidentialOnly: true, dailyDatacenterOnly: true, aiAutoFallback: true, aiRegion: '美国' });
  const ai = cfg['proxy-groups'].find((g) => g.name === '🤖 AI 网站');
  const auto = cfg['proxy-groups'].find((g) => g.name === '🏠 美国家宽自动');
  assert.strictEqual(ai.proxies[0], auto.name);
  assert.deepStrictEqual(auto.proxies, ['美国家宽 DMIT2 VLESS', '美国家宽 DMIT2 Hy2', '美国家宽 ATT']);
  assert.strictEqual(auto.type, 'fallback');
  assert.strictEqual(auto.timeout, 15000);
  assert.strictEqual(auto['expected-status'], undefined, '不把 HTTP 风控状态误判成网络中断');
  assert.ok(ai.proxies.includes('美国家宽 ATT'), '允许探活误判时手动固定');
  assert.deepStrictEqual(validate(cfg).problems, []);
});

ok('诊断 URL 不泄露路径口令、查询参数和用户名密码', () => {
  assert.strictEqual(maskUrl('https://user:pass@example.com/private-secret/download/collection/merge?token=secret'), 'https://example.com/…');
});

ok('精简分组：媒体/地区/漏网之鱼改走日常，广告直接拦截，自动组隐藏', () => {
  const cfg = baseConfig();
  cfg['proxy-groups'] = cfg['proxy-groups'].filter((g) => g.name !== '🤖AI网站');
  cfg['proxy-groups'][0].proxies = ['♻️自动选择', '🇯🇵日本东京01', '🇺🇸圣何塞03'];
  cfg['proxy-groups'].push(
    { name: '🤖 AI 网站', type: 'select', proxies: ['🏠 美国家宽自动'] },
    { name: '🏠 美国家宽自动', type: 'fallback', proxies: ['🇺🇸圣何塞03'] },
    ...['🎬媒体解锁', '🐟漏网之鱼', '🇺🇸美国节点', '🛑广告拦截'].map((name) => ({ name, type: 'select', proxies: ['🚀节点选择'] })),
  );
  cfg.rules = ['DOMAIN-SUFFIX,netflix.com,🎬媒体解锁', 'GEOIP,US,🇺🇸美国节点,no-resolve', 'RULE-SET,up-direct,🚀节点选择', 'DOMAIN,ad.example,🛑广告拦截', 'AND,((NETWORK,TCP),(DST-PORT,443)),🎬媒体解锁', 'DOMAIN,ai.example,🤖 AI 网站', 'MATCH,🐟漏网之鱼'];
  cfg['sub-rules'] = { nested: ['MATCH,🐟漏网之鱼'] };
  const proxies = JSON.stringify(cfg.proxies), info = simplifyGroups(cfg);
  assert.deepStrictEqual(info.visible, ['🌐 日常上网', '🤖 AI 网站']);
  assert.deepStrictEqual(info.hidden, ['♻️自动选择', '🏠 美国家宽自动']);
  assert.ok(cfg['proxy-groups'].filter((g) => g.hidden).every((g) => g.proxies.length));
  assert.deepStrictEqual(cfg.rules, ['DOMAIN-SUFFIX,netflix.com,🌐 日常上网', 'GEOIP,US,🌐 日常上网,no-resolve', 'RULE-SET,up-direct,🌐 日常上网', 'DOMAIN,ad.example,REJECT', 'AND,((NETWORK,TCP),(DST-PORT,443)),🌐 日常上网', 'DOMAIN,ai.example,🤖 AI 网站', 'MATCH,🌐 日常上网']);
  assert.deepStrictEqual(cfg['sub-rules'].nested, ['MATCH,🌐 日常上网']);
  assert.strictEqual(JSON.stringify(cfg.proxies), proxies);
  assert.deepStrictEqual(validate(cfg).problems, []);
  const first = JSON.stringify(cfg); simplifyGroups(cfg); assert.strictEqual(JSON.stringify(cfg), first, '重复应用应稳定');
});

ok('精选日常节点并提供广告开关，原有 AI 与安全拒绝规则保持有效', () => {
  const cfg = baseConfig();
  cfg['proxy-groups'] = cfg['proxy-groups'].filter((g) => g.name !== '🤖AI网站');
  cfg['proxy-groups'][0].proxies = ['♻️自动选择', '🇯🇵日本东京01', '🇺🇸圣何塞03'];
  cfg['proxy-groups'].push({ name: '🤖 AI 网站', type: 'select', proxies: ['🇺🇸圣何塞03'] }, { name: '🛑广告拦截', type: 'select', proxies: ['REJECT','DIRECT'] });
  cfg.rules = ['RULE-SET,up-reject,REJECT','DOMAIN,ad.example,🛑广告拦截','DOMAIN,block.example,REJECT','DOMAIN,ai.example,🤖 AI 网站','MATCH,🚀节点选择'];
  cfg['rule-providers']['up-reject'] = { type: 'http' };
  simplifyGroups(cfg, { adGroupEnabled: true });
  const selected = curateDailyNodes(cfg, { dailyNodeNames: ['🇺🇸圣何塞03','不存在'] });
  assert.deepStrictEqual(selected, { requested: 2, available: 1 });
  const daily=cfg['proxy-groups'].find(g=>g.name==='🌐 日常上网'),auto=cfg['proxy-groups'].find(g=>g.name==='♻️自动选择'),ad=cfg['proxy-groups'].find(g=>g.name==='🛡️ 广告拦截');
  assert.deepStrictEqual(daily.proxies,['♻️自动选择','🇺🇸圣何塞03']);
  assert.deepStrictEqual(auto.proxies,['🇺🇸圣何塞03']);
  assert.deepStrictEqual(ad.proxies,['REJECT','DIRECT']);
  assert.ok(cfg.rules.includes('RULE-SET,up-reject,🛡️ 广告拦截'));
  assert.ok(cfg.rules.includes('DOMAIN,ad.example,🛡️ 广告拦截'));
  assert.ok(cfg.rules.includes('DOMAIN,block.example,REJECT'));
  assert.ok(cfg.rules.includes('DOMAIN,ai.example,🤖 AI 网站'));
  assert.deepStrictEqual(validate(cfg).problems,[]);
  assert.throws(()=>curateDailyNodes(cfg,{dailyNodeNames:['不存在']}),/全部不可用/);
});




ok('自定义前缀同步底座分组且保留节点引用', () => {
  const cfg = baseConfig();
  const merged = prefixProxies(cfg.proxies, '赔钱机场', ' · ');
  const result = assemble(cfg, merged, {baseSourceLabel: '赔钱机场', labelSeparator: ' · '});
  ensureAliasTargets(cfg, result.alias.targets);
  assert.ok(cfg['proxy-groups'].find(g => g.name === '🚀节点选择').proxies.includes('赔钱机场 · 🇯🇵日本东京01'));
  assert.deepStrictEqual(validate(cfg).problems, []);
});

ok('新前缀的信息节点依然被过滤', () => {
  const cfg = {proxies:[{name:'酷狗 · 剩余流量：10 GB'}], 'proxy-groups':[]};
  stripInfoNodes(cfg);
  assert.strictEqual(cfg.proxies.length, 0);
});


ok('用途分组首选赔钱机场，AI与直连和广告优先，明确视频下载域名才分流', () => {
  const p = ['赔钱机场 · 美国线路', '赔钱机场 · 新加坡线路', '酷狗 · 香港'];
  const cfg = {proxies:p.map(name=>({name})), 'proxy-groups':[
    {name:'🌐 日常上网',type:'select',proxies:p}, {name:'🤖 AI 网站',type:'select',proxies:[p[0]]},
    {name:'🛡️ 广告拦截',type:'select',proxies:['REJECT','DIRECT']}],
    rules:['DOMAIN-SUFFIX,bilibili.com,DIRECT','DOMAIN-SUFFIX,accounts.google.com,🤖 AI 网站','RULE-SET,up-reject,🛡️ 广告拦截','RULE-SET,up-gfw,🌐 日常上网','MATCH,🌐 日常上网'],
    'rule-providers':{'up-reject':{},'up-gfw':{}}};
  addUsageGroups(cfg,{usageGroups:true,downloadPreferred:p[0],videoPreferred:p[1]});
  const dl=cfg['proxy-groups'].find(g=>g.name==='📥 下载推荐'),video=cfg['proxy-groups'].find(g=>g.name==='📺 视频推荐');
  assert.strictEqual(dl.proxies[0],p[0]);assert.strictEqual(video.proxies[0],p[1]);
  assert.ok(!video.proxies.includes(p[2]));
  const idx=x=>cfg.rules.indexOf(x);
  assert.ok(idx('DOMAIN-SUFFIX,accounts.google.com,🤖 AI 网站') < idx('RULE-SET,meta-youtube,📺 视频推荐'));
  assert.ok(idx('RULE-SET,up-reject,🛡️ 广告拦截') < idx('RULE-SET,meta-youtube,📺 视频推荐'));
  assert.ok(idx('RULE-SET,meta-youtube,📺 视频推荐') < idx('RULE-SET,up-gfw,🌐 日常上网'));
  assert.ok(cfg.rules.includes('RULE-SET,meta-github,📥 下载推荐'));
  assert.ok(idx('DOMAIN,copilot-proxy.githubusercontent.com,🤖 AI 网站') < idx('RULE-SET,meta-github,📥 下载推荐'));
  assert.strictEqual(cfg['rule-providers']['meta-github'].behavior,'domain');
  assert.strictEqual(cfg['rule-providers']['meta-youtube'].behavior,'domain');
  assert.deepStrictEqual(validate(cfg).problems,[]);
  assert.throws(()=>addUsageGroups({...cfg,'proxy-groups':cfg['proxy-groups'].filter(g=>!g.name.includes('推荐'))},{usageGroups:true,videoPreferred:'不存在'}),/首选节点不存在/);
});


ok('各用途自动回退有默认、有独立探测，AI隔离和统一规则兜底完整',()=>{
  const names=['赔钱机场 · 美国 A','赔钱机场 · 日本 B','酷狗 · 香港 C'];
  const cfg={proxies:names.map(name=>({name})),rules:['旧机场规则'], 'proxy-groups':[
    {name:'🌐 日常上网',type:'select',proxies:names}, {name:'📥 下载推荐',type:'select',proxies:names}, {name:'📺 视频推荐',type:'select',proxies:names}, {name:'♻️自动选择',type:'url-test',proxies:names}]};
  prepareUnifiedRules(cfg,{unifiedRules:true});assert.deepStrictEqual(cfg.rules,[]);
  cfg.rules=['RULE-SET,ai-chat,🤖 AI 网站'];
  const opt={autoBackup:true,dailyFallbackNames:names,downloadFallbackNames:names.slice(0,2),videoFallbackNames:names.slice(0,2)};
  addDefaultFallbacks(cfg,opt);
  for(const group of cfg['proxy-groups'].filter(g=>!g.hidden)){let auto=cfg['proxy-groups'].find(g=>g.name===group.proxies[0]);assert.strictEqual(auto.type,'fallback');assert.strictEqual(auto.proxies[0],names[0]);assert.ok(auto.hidden);}
  assert.strictEqual(cfg['proxy-groups'].filter(g=>g.hidden).length,3);
  assert.strictEqual(new Set(cfg['proxy-groups'].filter(g=>g.hidden).map(g=>g.url)).size,3);
  assert.ok(!cfg['proxy-groups'].some(g=>g.name==='♻️自动选择'));
  finishUnifiedRules(cfg,{unifiedRules:true});assert.strictEqual(cfg.rules.at(-1),'MATCH,🌐 日常上网');
  assert.ok(cfg.rules.includes('GEOIP,CN,DIRECT,no-resolve'));
  const bad=JSON.parse(JSON.stringify(cfg));bad.proxies.push({name:'赔钱机场 · 美国家宽'});
  assert.throws(()=>addDefaultFallbacks(bad,{...opt,dailyFallbackNames:['赔钱机场 · 美国家宽']}),/混入家宽/);
});

console.log('\n通过 ' + passed + ' 项');
