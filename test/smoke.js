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
    'proxy-groups':
      groups ||
      [{ name: 'PROXY', type: 'select', proxies: ['node-a'] }],
    dns: { enable: true, 'enhanced-mode': 'fake-ip' },
    rules: [
      'DOMAIN-SUFFIX,akamaized.net,PROXY',
      'DOMAIN-SUFFIX,feishu.cn,PROXY',
      'DOMAIN-SUFFIX,microsoft.com,DIRECT',
      'DOMAIN-SUFFIX,cn,DIRECT',
      'GEOIP,CN,DIRECT',
      'MATCH,PROXY',
    ],
  };
}

const keysOf = (rules) => rules.map((r) => r.split(',').slice(0, 2).join(',').toLowerCase());
const AI = '🤖 AI 网站';

// ==================== 场景 1：默认（AI 组 + 上游名单都开） ====================
{
  const { main } = load();
  const base = makeConfig();
  const out = main(JSON.parse(JSON.stringify(base)));

  // 节点原样保留
  assert.deepStrictEqual(out.proxies, base.proxies, '节点必须原样保留');

  // 代理组：AI 组插在最前，原组原样保留
  assert.strictEqual(out['proxy-groups'][0].name, AI, 'AI 组应排在最前（方便在界面里看到）');
  assert.strictEqual(out['proxy-groups'][0].type, 'select', 'AI 组必须是 select');
  assert.deepStrictEqual(out['proxy-groups'][1], base['proxy-groups'][0], '原策略组必须原样保留');

  // AI 组成员：首项跟随原组，末项可切直连，且包含全部节点
  const members = out['proxy-groups'][0].proxies;
  assert.strictEqual(members[0], 'PROXY', 'AI 组默认应跟随原策略组');
  assert.strictEqual(members[members.length - 1], 'DIRECT', 'AI 组应保留 DIRECT 选项');
  assert.ok(members.includes('node-a'), 'AI 组应包含订阅节点');

  // 自定义层仍是最前（进程直连规则在最前，其后是域名直连）
  assert.ok(out.rules[0].indexOf('PROCESS-NAME,') === 0, '进程直连规则应排在最前');
  assert.strictEqual(out.rules[4], 'DOMAIN-SUFFIX,easyeda.com,DIRECT', '进程规则之后紧接着自定义域名规则');

  // AI 层存在且排在订阅规则之前
  const aiSet = out.rules.indexOf('RULE-SET,ai-chat,' + AI);
  assert.ok(aiSet > 0, '应有 AI 名单规则');
  assert.ok(
    out.rules.indexOf('DOMAIN-SUFFIX,chatgpt.com,' + AI) > -1,
    'chatgpt.com 应指向 AI 组'
  );
  assert.ok(
    out.rules.indexOf('DOMAIN-SUFFIX,copilot.microsoft.com,' + AI) > -1,
    'copilot 应指向 AI 组'
  );

  // 关键：copilot 必须抢在订阅的 microsoft.com 直连之前
  const copilot = out.rules.indexOf('DOMAIN-SUFFIX,copilot.microsoft.com,' + AI);
  const ms = out.rules.indexOf('DOMAIN-SUFFIX,microsoft.com,DIRECT');
  assert.ok(copilot > -1 && copilot < ms, 'copilot 必须排在 microsoft.com 直连之前');
  assert.ok(aiSet < ms, 'AI 名单必须排在订阅规则之前');

  // AI 层排在自定义直连之后（自定义直连优先级最高）
  assert.ok(out.rules.indexOf('DOMAIN-SUFFIX,easyeda.com,DIRECT') === 4 && copilot > 0, '顺序应为 自定义直连 → AI');

  // 上游层顺序：private → reject → direct
  const at = (rule) => out.rules.indexOf(rule);
  assert.ok(at('RULE-SET,up-private,DIRECT') > -1, '缺少 private 名单');
  assert.ok(at('RULE-SET,up-private,DIRECT') < at('RULE-SET,up-reject,REJECT'), 'private 应在 reject 前');
  assert.ok(at('RULE-SET,up-reject,REJECT') < at('RULE-SET,up-direct,DIRECT'), 'reject 应在 direct 前');
  assert.ok(at('RULE-SET,up-direct,DIRECT') < at('DOMAIN-SUFFIX,cn,DIRECT'), '上游层应在订阅规则前');
  assert.strictEqual(out.rules.filter((r) => r.startsWith('RULE-SET,up-gfw,')).length, 0, '默认不启用 gfw 名单');

  // rule-providers 已注入（上游 + AI）
  assert.ok(out['rule-providers'], '应注入 rule-providers');
  ['up-private', 'up-reject', 'up-direct', 'up-gfw', 'ai-chat'].forEach((name) => {
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
  const merged = main({
    'rule-providers': { mine: { type: 'inline', payload: [] } },
    'proxy-groups': [{ name: 'PROXY', type: 'select', proxies: ['node-a'] }],
    rules: [],
  });
  assert.ok(merged['rule-providers'].mine, '不应覆盖订阅自带的 rule-providers');
  assert.ok(merged['rule-providers']['up-direct'], '应合并上游名单');
  assert.ok(merged['rule-providers']['ai-chat'], '应合并 AI 名单');
}

// ==================== 场景 2：关闭上游名单（纯内联 + AI） ====================
{
  const { main } = load({ ENABLE_PROVIDERS: false });
  const out = main(makeConfig());

  assert.strictEqual(out['rule-providers']['up-direct'], undefined, '关闭时不应注入上游 rule-providers');
  assert.ok(out['rule-providers']['ai-chat'], 'AI 名单与上游开关无关，应仍然注入');
  assert.strictEqual(out.rules[4], 'DOMAIN-SUFFIX,easyeda.com,DIRECT', '进程规则之后应为自定义域名规则');
  assert.strictEqual(
    out.rules.filter((r) => r.startsWith('RULE-SET,up-')).length,
    0,
    '关闭时不应有上游 RULE-SET 规则'
  );
  assert.ok(out.rules.some((r) => r.startsWith('RULE-SET,ai-chat,')), 'AI 名单规则仍应存在');
  assert.strictEqual(out.rules[out.rules.length - 1], 'MATCH,PROXY', 'MATCH 必须保留在最后');
}

// ==================== 场景 3：gfw 名单的出口组解析 ====================
{
  const { main } = load({ ENABLE_GFW_SET: true });
  // 有 select 组 → 自动取组名（此时 AI 组也在，pickProxyGroup 仍取原组，稳定）
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

// ==================== 场景 4：AI 层的各种开关组合 ====================
{
  // 只留 AI 组、关掉 AI 名单 → 只有内联 DOMAIN-SUFFIX
  const noList = load({ ENABLE_AI_PROVIDER: false }).main(makeConfig());
  assert.strictEqual(noList['rule-providers']['ai-chat'], undefined, '关掉名单时不应注入 ai-chat');
  assert.strictEqual(noList.rules.filter((r) => r.startsWith('RULE-SET,ai-chat')).length, 0, '关掉名单时不应有 RULE-SET');
  assert.ok(noList.rules.indexOf('DOMAIN-SUFFIX,chatgpt.com,' + AI) > -1, '内联 AI 规则仍应存在');
  assert.strictEqual(noList['proxy-groups'][0].name, AI, 'AI 组仍应创建');

  // 关掉 AI 组、留名单 → 规则直接指向原策略组，不创建新组
  const noGroup = load({ ENABLE_AI_GROUP: false }).main(makeConfig());
  assert.strictEqual(noGroup['proxy-groups'].length, 1, '关闭 AI 组时不应新增组');
  assert.strictEqual(noGroup['proxy-groups'][0].name, 'PROXY', '原组保持不变');
  assert.ok(noGroup.rules.includes('RULE-SET,ai-chat,PROXY'), 'AI 规则应回落到原策略组');
  assert.ok(noGroup.rules.indexOf('DOMAIN-SUFFIX,chatgpt.com,PROXY') > -1, '内联 AI 规则回落到原组');

  // 订阅自带同名 AI 组 → 复用，不重复创建
  const own = load().main(
    makeConfig([{ name: AI, type: 'select', proxies: ['node-a'] }, { name: 'PROXY', type: 'select', proxies: ['node-a'] }])
  );
  assert.strictEqual(own['proxy-groups'].filter((g) => g.name === AI).length, 1, '不应重复创建同名 AI 组');
  assert.ok(own.rules.includes('RULE-SET,ai-chat,' + AI), '应复用订阅自带的 AI 组');

  // 订阅用 proxy-providers（config.proxies 为空）→ 组只由组名构成，不报错
  const noNodes = makeConfig();
  delete noNodes.proxies;
  const p = load().main(noNodes);
  assert.ok(p['proxy-groups'][0].proxies.indexOf('PROXY') > -1, '无节点时应至少能跟随原组');
  assert.ok(p['proxy-groups'][0].proxies.indexOf('DIRECT') > -1, '无节点时应保留 DIRECT');
}

// ==================== 场景 6：AI 偏好节点（DMIT2）置顶 ====================
{
  const cfg = makeConfig();
  cfg.proxies = [
    { name: 'node-a', type: 'ss', server: 'a.example.com', port: 8388 },
    { name: '[vless]美国|家宽|DMIT2|移动|联通|x6', type: 'vless', server: 'b.example.com', port: 443 },
    { name: 'node-c', type: 'ss', server: 'c.example.com', port: 8388 },
  ];
  const out = load().main(cfg);
  const members = out['proxy-groups'][0].proxies;
  assert.strictEqual(
    members[0],
    '[vless]美国|家宽|DMIT2|移动|联通|x6',
    '偏好节点的应排在 AI 组第一位（订阅更新后默认仍落回它）'
  );
  assert.ok(members.indexOf('PROXY') > -1, '置顶后仍保留跟随主组的选项');
  assert.strictEqual(members[members.length - 1], 'DIRECT', 'DIRECT 仍应保留在最后');

  // 没有命中关键字的节点 → 回到「跟随主组」的老行为
  const plain = load().main(makeConfig());
  assert.strictEqual(plain['proxy-groups'][0].proxies[0], 'PROXY', '无匹配节点时应默认跟随主组');

  // 换机场：节点名里没有 DMIT2，但命中数组里的第二个关键字（赔钱机场场景）
  const otherAirport = makeConfig();
  otherAirport.proxies = [
    { name: '🚀节点选择', type: 'select', server: 'a.example.com', port: 8388 },
    { name: '🇺🇸美国圣何塞01-0.1倍', type: 'vless', server: 'b.example.com', port: 443 },
    { name: '🇺🇸美国洛杉矶08-0.1倍', type: 'vless', server: 'c.example.com', port: 443 },
  ];
  const swapped = load().main(otherAirport)['proxy-groups'][0].proxies;
  assert.strictEqual(
    swapped[0],
    '🇺🇸美国圣何塞01-0.1倍',
    '第一个关键字不匹配时应自动回退到后面的关键字（跨机场通用）'
  );
  assert.ok(swapped.indexOf('PROXY') > -1, '回退置顶后仍保留跟随主组');
}

// ==================== 场景 5：异常输入 ====================
{
  const { main } = load();
  assert.strictEqual(main(null), null, 'null 输入应原样返回');
  assert.strictEqual(main(undefined), undefined, 'undefined 输入应原样返回');
  assert.ok(main({}).rules.length > 0, '空配置也应只输出自有规则');
  assert.ok(main({ rules: [] }).rules.length > 0, '空 rules 也应正常注入');

  // 没有 proxy-groups → AI 层跳过，但不能崩、不能产生指向空组的规则
  const noGroups = main({ rules: ['MATCH,PROXY'] });
  assert.strictEqual(noGroups.rules.filter((r) => r.indexOf(AI) > -1).length, 0, '没有组时不应生成 AI 规则');
  assert.strictEqual(noGroups.rules[4], 'DOMAIN-SUFFIX,easyeda.com,DIRECT', '自定义直连仍应生效');

  // 进程直连规则（UU远程等）必须存在且在最前
  const proc = noGroups.rules.filter((r) => r.indexOf('PROCESS-NAME,') === 0);
  assert.ok(proc.length >= 4, '应有 UU远程 的进程直连规则');
  assert.strictEqual(proc[0], 'PROCESS-NAME,GameViewer.exe,DIRECT', 'GameViewer.exe 应强制直连');
  // 进程规则不能指向代理组
  assert.ok(proc.every((r) => r.slice(-7) === ',DIRECT'), '进程规则必须是 DIRECT');
}

console.log('✓ 全部断言通过（6 个场景）');
