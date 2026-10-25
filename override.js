/**
 * FlClash / Clash Meta 订阅覆写脚本
 * ---------------------------------------------------------------
 * 三层结构（越靠前优先级越高）：
 *   ① 自定义层：本文件内联的精准规则（嘉立创 / 立创 / 飞书 / 字节 / B站）
 *   ② 上游层：引用 GitHub 高星大名单（Loyalsoldier/clash-rules ★28.9k，日更）
 *   ③ 订阅层：机场自带的规则，原样保留在后面
 *
 * 节点、代理组、DNS、MATCH 兜底全部保持订阅原样不动，
 * 所以订阅每天自动更新不会影响这些规则；换机场只需把「覆写」指向同一个脚本。
 *
 * 在 FlClash 里的位置：配置 → 覆写脚本 → 新建 → 填入本文件 URL
 * 然后：配置 → 选中订阅 → 覆写 → 选择该脚本
 * ---------------------------------------------------------------
 */

// ============ 开关 ============
// 是否引用上游大名单（Loyalsoldier/clash-rules）作为第二层
// 打开后第一次启动内核要联网下载，代理没起来会失败一次（规则自动跳过，不影响启动），
// 之后 interval 到点自动重下。自定义层是内联的，永远不受影响。
const ENABLE_PROVIDERS = true;

// 是否额外引用 gfw 名单，把被墙域名强制送进代理组（默认关，机场订阅通常已覆盖）
const ENABLE_GFW_SET = false;

// 是否把 akamaized.net 也直连（B站海外备用源，直连可省代理流量）
const DIRECT_AKAMAI = true;

// 是否顺带修正 DNS（如果你在 FlClash 界面里自己调 DNS，请保持 false）
const APPLY_DNS = false;

// ============ 上游名单源 ============
// 官方源
const UPSTREAM = 'https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release';
// 拉不动时换成 jsDelivr 镜像：
// const UPSTREAM = 'https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release';

const REFRESH_INTERVAL = 86400; // 名单刷新间隔（秒）

const PROVIDERS = {
  'up-private': {
    type: 'http',
    behavior: 'domain',
    format: 'yaml',
    url: UPSTREAM + '/private.txt',
    path: './ruleset/up-private.yaml',
    interval: REFRESH_INTERVAL,
  },
  'up-reject': {
    type: 'http',
    behavior: 'domain',
    format: 'yaml',
    url: UPSTREAM + '/reject.txt',
    path: './ruleset/up-reject.yaml',
    interval: REFRESH_INTERVAL,
  },
  'up-direct': {
    type: 'http',
    behavior: 'domain',
    format: 'yaml',
    url: UPSTREAM + '/direct.txt',
    path: './ruleset/up-direct.yaml',
    interval: REFRESH_INTERVAL,
  },
  'up-gfw': {
    type: 'http',
    behavior: 'domain',
    format: 'yaml',
    url: UPSTREAM + '/gfw.txt',
    path: './ruleset/up-gfw.yaml',
    interval: REFRESH_INTERVAL,
  },
};

// ============ ① 自定义层：直连域名 ============
// 加新站点：在这里加一行「不带协议、不带路径」的域名即可
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

// ============ 工具函数 ============

/** 找一个可用的策略组名，用于 gfw 名单的出口（不依赖任何硬编码组名） */
function pickProxyGroup(config) {
  const groups = Array.isArray(config['proxy-groups']) ? config['proxy-groups'] : [];
  for (const group of groups) {
    if (group && group.type === 'select' && Array.isArray(group.proxies) && group.proxies.length > 0) {
      return group.name;
    }
  }
  return null;
}

/** 去重：同一「规则类型 + 匹配内容」只保留第一次出现的（我们的规则在前，故优先生效） */
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

function buildHead(config) {
  const head = CUSTOM_RULES.slice();

  if (!ENABLE_PROVIDERS) {
    return head;
  }

  config['rule-providers'] = Object.assign({}, config['rule-providers'] || {}, PROVIDERS);

  head.push('RULE-SET,up-private,DIRECT');
  head.push('RULE-SET,up-reject,REJECT');

  if (ENABLE_GFW_SET) {
    const proxyGroup = pickProxyGroup(config);
    if (proxyGroup) {
      head.push('RULE-SET,up-gfw,' + proxyGroup);
    } else {
      console.log('[override] 未找到可用的 select 策略组，跳过 gfw 名单');
    }
  }

  head.push('RULE-SET,up-direct,DIRECT');
  return head;
}

// ============ 入口 ============
function main(config) {
  if (!config || typeof config !== 'object') {
    return config;
  }

  const head = buildHead(config);
  const original = Array.isArray(config.rules) ? config.rules : [];
  config.rules = dedupe(head.concat(original));

  if (APPLY_DNS && config.dns && typeof config.dns === 'object') {
    config.dns = Object.assign({}, config.dns, DNS_TWEAKS);
  }

  console.log(
    '[override] 自定义层 ' + CUSTOM_RULES.length + ' 条，' +
    '总规则 ' + config.rules.length + ' 条' +
    (ENABLE_PROVIDERS ? '（已挂上游名单）' : '')
  );

  return config;
}
