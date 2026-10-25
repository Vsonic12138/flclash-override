/**
 * FlClash / Clash Meta 订阅覆写脚本
 * ---------------------------------------------------------------
 * 作用：在机场订阅生成的配置「最前面」插入一套自己的分流规则，
 *       节点、代理组、DNS、MATCH 兜底全部保持订阅原样不动。
 *
 * 因为是覆写脚本，订阅每天自动更新也不会影响这些规则，
 * 换机场 / 加新订阅只要把它的「覆写」指向同一个脚本即可。
 *
 * 在 FlClash 里的位置：配置 → 覆写脚本 → 新建 → 填入本文件 URL
 * 然后：配置 → 选中订阅 → 覆写 → 选择该脚本
 * ---------------------------------------------------------------
 */

// ============ 开关 ============
// 是否把 akamaized.net 也直连（B站海外备用源，直连可省代理流量）
const DIRECT_AKAMAI = true;

// 是否额外加载 GitHub 上的通用大规则集（直连名单 / 广告拦截）
// 打开后首次启动内核需要联网下载，代理没起来时会失败一次，属正常
const ENABLE_PROVIDERS = false;

// 是否顺带修正 DNS（如果你在 FlClash 界面里自己调 DNS，请保持 false）
const APPLY_DNS = false;

// ============ 自有精规则（直连） ============
const DIRECT_DOMAINS = [
  // —— 嘉立创 / 立创 / EDA ——
  'easyeda.com',
  'lceda.com',
  'lceda.cn',
  'lcsc.com',
  'szlcsc.com',
  'jlcpcb.com',
  'jlc.com',
  'jlcdfm.com',
  'jlcsmt.com',
  'jlc-ecad.com',
  'jlc-bbs.com',
  'jlc-smt.com',
  'oshwhub.com',

  // —— 飞书 / Lark ——
  'feishu.cn',
  'feishu.net',
  'feishucdn.com',
  'larksuite.com',
  'larkoffice.com',

  // —— 字节 / 豆包 ——
  'doubao.com',
  'snssdk.com',
  'bytedance.com',
  'bytedns1.com',
  'bytescm.com',
  'ibytedapm.com',
  'byteimg.com',
  'pstatp.com',

  // —— B 站 ——
  'bilibili.com',
  'bilivideo.com',
  'bilivideo.cn',
  'biliapi.net',
  'hdslb.com',
  'b23.tv',
];

if (DIRECT_AKAMAI) {
  DIRECT_DOMAINS.push('akamaized.net');
}

const CUSTOM_RULES = DIRECT_DOMAINS.map((domain) => `DOMAIN-SUFFIX,${domain},DIRECT`);

// ============ 可选：通用大规则集 ============
const PROVIDERS = {
  'ls-direct': {
    type: 'http',
    behavior: 'domain',
    format: 'yaml',
    url: 'https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release/direct.txt',
    path: './ruleset/ls-direct.yaml',
    interval: 86400,
  },
  'ls-reject': {
    type: 'http',
    behavior: 'domain',
    format: 'yaml',
    url: 'https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release/reject.txt',
    path: './ruleset/ls-reject.yaml',
    interval: 86400,
  },
  'bm-bilibili': {
    type: 'http',
    behavior: 'classical',
    format: 'yaml',
    url: 'https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/BiliBili/BiliBili.yaml',
    path: './ruleset/bm-bilibili.yaml',
    interval: 86400,
  },
};

// ============ 可选：DNS 修正 ============
const DNS_TWEAKS = {
  'fallback-lazy-query': true,
  'fake-ip-filter': [
    '*.lan',
    '*.local',
    '*.localdomain',
    '*.home.arpa',
    'time.*.com',
    'time.*.apple.com',
    'ntp.*.com',
    '*.ntp.org.cn',
    'stun.*.*',
    '*.stun.*.*',
    '*.msftconnecttest.com',
    '*.msftncsi.com',
    'localhost.ptlogin2.qq.com',
  ],
  listen: '127.0.0.1:1053',
};

/**
 * 去重：同一类规则的「类型 + 匹配内容」只保留第一次出现的
 * 因为我们插在数组最前面，所以保留下来的必然是自定义规则，优先生效
 */
function dedupe(rules) {
  const seen = new Set();
  const result = [];
  for (const rule of rules) {
    if (typeof rule !== 'string' || rule.trim() === '') continue;
    const key = rule.split(',').slice(0, 2).join(',').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(rule);
  }
  return result;
}

function main(config) {
  if (!config || typeof config !== 'object') {
    return config;
  }

  let head = CUSTOM_RULES.slice();

  if (ENABLE_PROVIDERS) {
    config['rule-providers'] = Object.assign(
      {},
      config['rule-providers'] || {},
      PROVIDERS
    );
    head = head.concat([
      'RULE-SET,ls-reject,REJECT',
      'RULE-SET,ls-direct,DIRECT',
      'RULE-SET,bm-bilibili,DIRECT',
    ]);
  }

  const original = Array.isArray(config.rules) ? config.rules : [];
  config.rules = dedupe(head.concat(original));

  if (APPLY_DNS && config.dns && typeof config.dns === 'object') {
    config.dns = Object.assign({}, config.dns, DNS_TWEAKS);
  }

  console.log(
    '[override] 自有规则 ' + CUSTOM_RULES.length + ' 条，' +
    '最终 ' + config.rules.length + ' 条规则'
  );

  return config;
}
