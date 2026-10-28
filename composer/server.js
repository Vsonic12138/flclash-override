'use strict';
/**
 * 大狗叫订阅 · 服务器端合成器
 * ---------------------------------------------------------------
 * 作用：把「机场完整配置（底座）+ Sub-Store 合并出的节点 + 本仓库 override.js 的规则层」
 *      合成一份可以直接丢给 FlClash 订阅的完整 Clash 配置。
 *
 * 流程（每次重建）：
 *   1. 拉底座：BASE_URL（机场的完整 YAML，必须能被 Clash 解析）→ 提供 DNS/端口/分组/机场自带规则
 *   2. 拉节点：SOURCES（可多个机场）/ MERGE_URL（单个 Sub-Store 合并输出），只有 proxies；
 *      带标签的源会给节点名加「标签 * 」前缀，用来区分机场：`酷狗 * [ss]香港|家宽|砖线1`
 *   3. 用合并节点替换底座里的 proxies
 *   4. 把底座分组不认识的新节点（如「酷狗 * 」前缀的）补进「🚀节点选择」「♻️自动选择」
 *   5. 跑本仓库 override.js 的 main(config)：加 rule-providers、自定义直连、AI 层、上游大名单，
 *      并把它们 prepend 到机场规则之前（与 FlClash 端覆写完全一致）
 *   6. 校验（YAML 可解析 / 节点名唯一 / 分组引用存在 / RULE-SET 引用存在）后输出
 *
 * 路由：
 *   GET  /health            → 200 ok
 *   GET  /diag              → JSON 统计（节点/分组/规则/RULE-SET/时间戳）
 *   GET  <SECRET>           → 完整 YAML（带 Content-Disposition: 大狗叫订阅.yaml）
 *   GET  <SECRET>?force=1   → 忽略缓存重建
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yaml = require('js-yaml');

const CFG = {
  port: parseInt(process.env.PORT || '13200', 10),
  host: process.env.HOST || '127.0.0.1',
  baseUrl: process.env.BASE_URL || '',
  mergeUrl: process.env.MERGE_URL || '',
  sources: parseSources(process.env.SOURCES || ''),
  optionalSources: parseSources(process.env.OPTIONAL_SOURCES || ''),
  ua: process.env.UA || 'clash-verge/v2.4.2',
  secret: (process.env.SECRET || '/dgc').replace(/\/+$/, '') || '/dgc',
  overrideFile: process.env.OVERRIDE_FILE || path.join(__dirname, 'override.js'),
  cacheTtl: parseInt(process.env.CACHE_TTL || '300', 10) * 1000,
  lastGoodDir: process.env.LAST_GOOD_DIR || path.join(__dirname, 'data'),
  fetchTimeout: parseInt(process.env.FETCH_TIMEOUT || '30000', 10),
  filename: process.env.FILENAME || '大狗叫订阅.yaml',
  aiResidentialOnly: process.env.AI_RESIDENTIAL_ONLY === 'true',
  dailyDatacenterOnly: process.env.DAILY_DATACENTER_ONLY === 'true',
  aiRegion: process.env.AI_REGION || '美国',
  aiAllowedRegions: (process.env.AI_ALLOWED_REGIONS || process.env.AI_REGION || '美国').split(';').map((s) => s.trim()).filter(Boolean),
  aiAutoRegion: process.env.AI_AUTO_REGION || process.env.AI_REGION || '美国',
  aiAutoFallback: process.env.AI_AUTO_FALLBACK === 'true',
  simplifyGroups: process.env.SIMPLIFY_GROUPS === 'true',
  aiMaxMultiplier: Number(process.env.AI_MAX_MULTIPLIER || 0),
  aiResidentialKeywords: (process.env.AI_RESIDENTIAL_KEYWORDS || '').split(';').map((s) => s.trim()).filter(Boolean),
  dailyNodeNames: (process.env.DAILY_NODE_NAMES || '').split(';').map((s) => s.trim()).filter(Boolean),
  adGroupEnabled: process.env.AD_GROUP_ENABLED === 'true',
  labelSeparator: process.env.NODE_LABEL_SEPARATOR || ' * ',
  baseSourceLabel: process.env.BASE_SOURCE_LABEL || '',
  usageGroups: process.env.USAGE_GROUPS === 'true',
  autoBackup: process.env.AUTO_BACKUP === 'true',
  unifiedRules: process.env.UNIFIED_RULES === 'true',
  dailyFallbackNames: (process.env.DAILY_FALLBACK_NAMES || '').split(';').filter(Boolean),
  downloadFallbackNames: (process.env.DOWNLOAD_FALLBACK_NAMES || '').split(';').filter(Boolean),
  videoFallbackNames: (process.env.VIDEO_FALLBACK_NAMES || '').split(';').filter(Boolean),
  downloadPreferred: process.env.DOWNLOAD_PREFERRED || '',
  videoPreferred: process.env.VIDEO_PREFERRED || '',
};

// 需要把新节点补进去的策略组（按名字匹配，不存在就跳过）
const NODE_GROUPS = (process.env.NODE_GROUPS || '🚀节点选择,♻️自动选择').split(',').map((s) => s.trim()).filter(Boolean);
const BUILTIN_TARGETS = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE']);

// 机场塞进来的「信息节点」（剩余流量、距离重置、套餐到期…）都是 127.0.0.1 假线路，
// 而且各机场/缓存里数值天天变，留着会让底座分组引用到「上一版名字」而校验失败
const INFO_NODE_RE = /^(?:[^ ]{1,12} (?:\*|·) )?(?:剩余流量|距离下次重置剩余|套餐到期|到期时间|剩余天数|流量重置|线路到期)\s*[:：]/;

// 分组改名：机场自带组名 → 仓库 override.js 里的统一组名（避免同义组出现两份）
// 默认把机场的「🤖AI网站」并到 override.js 的「🤖 AI 网站」
const GROUP_ALIASES = (() => {
  const raw = process.env.GROUP_ALIASES === undefined ? '🤖AI网站=🤖 AI 网站' : process.env.GROUP_ALIASES;
  const map = {};
  for (const pair of raw.split(';').map((s) => s.trim()).filter(Boolean)) {
    const idx = pair.indexOf('=');
    if (idx > 0) map[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return map;
})();

/**
 * 节点源解析：`SOURCES="酷狗=<url>;<url2>;赔钱=<url3>"`
 * - 分号分隔多个源，顺序决定去重时谁先赢（第一个源优先）
 * - 有标签的源，节点名统一加「标签 * 」前缀：`酷狗 * [ss]香港|家宽|砖线1`
 * - 没有标签（直接写 URL）的源保持原名，通常给「底座机场」用
 * - 不配 SOURCES 时退回单源 MERGE_URL（向后兼容老部署）
 */
function parseSources(raw) {
  return String(raw || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item) => {
      if (/^https?:\/\//i.test(item)) return { label: '', url: item };
      const idx = item.indexOf('=');
      if (idx <= 0) return { label: '', url: item };
      return { label: item.slice(0, idx).trim(), url: item.slice(idx + 1).trim() };
    })
    .filter((s) => s.url);
}

/** 给一个源的所有节点加「标签 * 」前缀；label 为空则原样返回 */
function prefixProxies(proxies, label, separator = CFG.labelSeparator) {
  if (!label) return proxies;
  const prefix = label + separator;
  return proxies.map((p) => Object.assign({}, p, { name: prefix + p.name }));
}

/** 日志/诊断里不暴露订阅 token */
function maskUrl(url) {
  try { return new URL(url).origin + '/…'; } catch (_) { return '<invalid URL>'; }
}

const state = {
  yaml: null,
  stats: null,
  at: 0,
  error: null,
  building: null,
};

function log(...args) {
  console.log(new Date().toISOString(), '[composer]', ...args);
}

function lastGoodPath() {
  return path.join(CFG.lastGoodDir, 'last-good.yaml');
}

async function fetchText(url, ua, timeout = CFG.fetchTimeout) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': ua || CFG.ua,
        Accept: '*/*',
        'Accept-Encoding': 'identity',
      },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${maskUrl(url)}`);
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function countProxies(text) {
  const m = text.match(/^\s*-\s+\S/gm);
  return m ? m.length : 0;
}

function parseProxyText(text) {
  const doc = yaml.load(text);
  if (!doc || typeof doc !== 'object') throw new Error('合并结果不是 YAML 映射');
  if (!Array.isArray(doc.proxies) || doc.proxies.length === 0) {
    throw new Error(`合并结果里没有 proxies（原文 ${countProxies(text)} 个列表项）`);
  }
  return doc.proxies.filter((p) => p && typeof p === 'object' && typeof p.name === 'string' && p.name);
}

function dedupeProxies(proxies) {
  const seen = new Set();
  const out = [];
  for (const p of proxies) {
    const key = p.name;
    if (seen.has(key)) {
      log('跳过重名节点：' + key);
      continue;
    }
    seen.add(key);
    out.push(p);
  }
  return out;
}

/** 可选源失败不影响其他源；只保存最近一次成功获取的节点，文件含节点凭据。 */
async function getOptionalProxies(src, opts = {}) {
  const dir = opts.cacheDir || CFG.lastGoodDir;
  const fetcher = opts.fetcher || ((url) => fetchText(url, undefined, 8000));
  const digest = crypto.createHash('sha256').update(src.label + '\n' + src.url).digest('hex');
  const file = path.join(dir, 'optional-' + digest + '.json');
  try {
    const proxies = parseProxyText(await fetcher(src.url));
    if (!proxies.length) throw new Error('empty proxies');
    const updatedAt = new Date().toISOString();
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ updatedAt, proxies }), { mode: 0o600 });
      fs.renameSync(tmp, file);
    } catch (_) { log('可选节点源缓存写入失败：' + (src.label || '未命名')); }
    return { proxies, status: 'from_substore', updatedAt };
  } catch (_) {
    try {
      const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(cached.proxies) || !cached.proxies.length) throw new Error('empty cache');
      return { proxies: cached.proxies, status: 'cached', updatedAt: cached.updatedAt || null };
    } catch (_) {
      return { proxies: [], status: 'unavailable', updatedAt: null };
    }
  }
}

/**
 * 按 SOURCES 依次拉取各机场节点，带标签的源加「标签 * 」前缀，最后按名字去重。
 * 顺序 = 优先级：第一个源（底座机场）的节点在重名时胜出。
 */
async function fetchProxies() {
  const sources = CFG.sources.length ? CFG.sources : [{ label: '', url: CFG.mergeUrl }];
  if (!sources.length || !sources[0].url) throw new Error('缺少节点源：请配置 SOURCES 或 MERGE_URL');

  const all = [];
  const per = [];
  for (const src of sources) {
    const text = await fetchText(src.url);
    const proxies = prefixProxies(parseProxyText(text), src.label);
    const prefix = src.label ? src.label + CFG.labelSeparator : '';
    per.push({ label: src.label || '', prefix, count: proxies.length, url: maskUrl(src.url) });
    log(`节点源「${src.label || '原名'}」：${proxies.length} 个` + (prefix ? `，前缀「${prefix}」` : '，不加前缀'));
    all.push(...proxies);
  }
  for (const src of CFG.optionalSources) {
    const result = await getOptionalProxies(src);
    const proxies = prefixProxies(result.proxies, src.label);
    const prefix = src.label ? src.label + CFG.labelSeparator : '';
    per.push({ label: src.label || '', prefix, count: proxies.length, url: maskUrl(src.url), optional: true, status: result.status, updatedAt: result.updatedAt });
    log(`可选节点源「${src.label || '原名'}」：${result.status}，${proxies.length} 个`);
    all.push(...proxies);
  }
  return { proxies: dedupeProxies(all), sources: per };
}

function loadOverrideMain() {
  if (!CFG.overrideFile || !fs.existsSync(CFG.overrideFile)) {
    log('没有 override.js，跳过规则层');
    return null;
  }
  const src = fs.readFileSync(CFG.overrideFile, 'utf8');
  const main = new Function(src + '\n;return main;')();
  if (typeof main !== 'function') throw new Error('override.js 里没有 main(config) 函数');
  return main;
}

/**
 * 把机场自带的分组「折叠」到仓库 override.js 的分组名上：
 * 例如机场的「🤖AI网站」删掉、引用全部改指「🤖 AI 网站」，
 * 这样 override.js 会新建（而不是复用）统一组，偏好节点置顶逻辑才会生效。
 */
function applyGroupAliases(config) {
  const aliases = GROUP_ALIASES;
  const keys = Object.keys(aliases);
  if (keys.length === 0) return { folded: [], targets: [] };

  const groups = Array.isArray(config['proxy-groups']) ? config['proxy-groups'] : [];
  const folded = [];
  const targets = new Set();

  const kept = [];
  for (const group of groups) {
    if (group && aliases[group.name]) {
      folded.push(group.name + ' ⇢ ' + aliases[group.name]);
      targets.add(aliases[group.name]);
      continue;
    }
    kept.push(group);
  }
  config['proxy-groups'] = kept;

  // 其余分组里的引用改指新名字
  for (const group of kept) {
    if (Array.isArray(group.proxies)) {
      group.proxies = [...new Set(group.proxies.map((ref) => aliases[ref] || ref))];
    }
  }

  // 规则目标（RULE-SET 在第 3 段，其余在最后一段）
  for (let i = 0; i < (config.rules || []).length; i++) {
    const rule = config.rules[i];
    if (typeof rule !== 'string') continue;
    const parts = rule.split(',');
    const idx = parts[0] === 'RULE-SET' ? 2 : parts.length - 1;
    if (idx > 0 && aliases[parts[idx]]) parts[idx] = aliases[parts[idx]];
    config.rules[i] = parts.join(',');
  }

  return { folded, targets: [...targets] };
}

/** 没有 override.js 时兜底：把被折叠掉的分组补回来，避免规则指向不存在的组 */
function ensureAliasTargets(config, targets) {
  const groups = Array.isArray(config['proxy-groups']) ? config['proxy-groups'] : [];
  const have = new Set(groups.map((g) => g && g.name));
  const nodes = (Array.isArray(config.proxies) ? config.proxies : []).map((p) => p && p.name).filter(Boolean);
  for (const name of targets) {
    if (have.has(name)) continue;
    groups.unshift({ name, type: 'select', proxies: [].concat(nodes, ['DIRECT']) });
    log('补建分组：' + name);
  }
  config['proxy-groups'] = groups;
}

function injectIntoGroups(config, newNames) {
  const groups = Array.isArray(config['proxy-groups']) ? config['proxy-groups'] : [];
  const added = [];
  for (const group of groups) {
    if (!NODE_GROUPS.includes(group.name)) continue;
    const list = Array.isArray(group.proxies) ? group.proxies : [];
    const present = new Set(list);
    for (const name of newNames) {
      if (present.has(name)) continue;
      list.push(name);
      present.add(name);
      added.push(`${group.name} ← ${name}`);
    }
    group.proxies = list;
  }
  return added;
}

/**
 * 剔除信息节点：从 proxies 删掉，并把所有分组里对它们的引用一起清掉。
 * 节点名可能是 `剩余流量：994.7 GB`，加了机场前缀就是 `酷狗 * 剩余流量：994.7 GB`。
 */
function stripInfoNodes(config) {
  const proxies = Array.isArray(config.proxies) ? config.proxies : [];
  const groups = Array.isArray(config['proxy-groups']) ? config['proxy-groups'] : [];
  const removed = [];
  config.proxies = proxies.filter((p) => {
    const name = p && p.name ? String(p.name).trim() : '';
    if (INFO_NODE_RE.test(name)) {
      removed.push(name);
      return false;
    }
    return true;
  });

  let refs = 0;
  for (const g of groups) {
    if (!g || !Array.isArray(g.proxies)) continue;
    const kept = g.proxies.filter((n) => !INFO_NODE_RE.test(String(n).trim()));
    refs += g.proxies.length - kept.length;
    g.proxies = kept;
  }

  if (removed.length || refs) {
    log(`剔除信息节点 ${removed.length} 个、分组引用 ${refs} 处` + (removed.length ? `：${removed.join('、')}` : ''));
  }
  return { removed, refs };
}

function validate(config) {
  const problems = [];
  const proxies = Array.isArray(config.proxies) ? config.proxies : [];
  if (proxies.length === 0) problems.push('proxies 为空');

  const names = new Set();
  for (const p of proxies) {
    if (names.has(p.name)) problems.push('节点重名：' + p.name);
    names.add(p.name);
  }

  const groups = Array.isArray(config['proxy-groups']) ? config['proxy-groups'] : [];
  const groupNames = new Set(groups.map((g) => g.name));
  const targets = new Set([...names, ...groupNames, ...BUILTIN_TARGETS]);

  for (const g of groups) {
    for (const ref of Array.isArray(g.proxies) ? g.proxies : []) {
      if (!targets.has(ref)) problems.push(`分组 ${g.name} 引用了不存在的节点/分组：${ref}`);
    }
  }

  const providers = config['rule-providers'] && typeof config['rule-providers'] === 'object'
    ? new Set(Object.keys(config['rule-providers']))
    : new Set();
  const rules = Array.isArray(config.rules) ? config.rules : [];
  if (rules.length === 0) problems.push('rules 为空');
  for (const rule of rules) {
    if (typeof rule !== 'string') continue;
    const parts = rule.split(',');
    if (parts[0] === 'RULE-SET') {
      if (!providers.has(parts[1])) problems.push('RULE-SET 引用了不存在的 provider：' + parts[1]);
      const target = parts[2];
      if (target && !targets.has(target)) problems.push(`RULE-SET ${parts[1]} 指向不存在的目标：${target}`);
    } else if (parts[0] === 'MATCH') {
      const target = parts[1];
      if (target && !targets.has(target)) problems.push('MATCH 指向不存在的目标：' + target);
    }
  }

  return { problems, stats: {
    proxies: proxies.length,
    groups: groups.length,
    rules: rules.length,
    ruleProviders: providers.size,
    aiRules: rules.filter((r) => typeof r === 'string' && r.includes('ai-chat')).length,
    customRules: rules.filter((r) => typeof r === 'string' && r.startsWith('DOMAIN-SUFFIX,') && r.includes(',DIRECT')).length,
  } };
}

/**
 * 把节点源合并进底座，顺序很重要：
 * ① 替换 proxies ② 剔除信息节点 ③ 再算「哪些是新增节点」④ 折叠分组别名 ⑤ 新节点补进策略组。
 * 先算新增再剔除，会把变过数值的「剩余流量：…」又补回策略组里 → 悬空引用。
 */
function assemble(base, merged, options = CFG) {
  if (options.baseSourceLabel) {
    const available = new Set(merged.map((p) => p && p.name));
    const rename = new Map((base.proxies || []).map((p) => [p.name, options.baseSourceLabel + (options.labelSeparator || ' * ') + p.name]).filter(([, n]) => available.has(n)));
    for (const g of base['proxy-groups'] || []) if (Array.isArray(g.proxies)) g.proxies = g.proxies.map((n) => rename.get(n) || n);
  }
  const beforeNames = new Set((Array.isArray(base.proxies) ? base.proxies : []).map((p) => p && p.name));
  base.proxies = merged;
  const info = stripInfoNodes(base);
  const newNames = base.proxies.map((p) => p && p.name).filter((n) => n && !beforeNames.has(n));
  const alias = applyGroupAliases(base);
  const adds = injectIntoGroups(base, newNames);
  return { info, alias, adds };
}

/** 节点名中支持 x6 和 5x 两类倍率标记，未知倍率返回 null。 */
function nodeMultiplier(name) {
  const match = String(name || '').match(/(?:^|[\s|丨])(?:x\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*x)(?=$|[\s|丨])/i);
  return match ? Number(match[1] || match[2]) : null;
}

/** 按机场标注分离出口；保留全部节点定义，不允许 AI 悄悄回落到日常或直连。 */
function enforceEgressPolicy(config, options = CFG) {
  if (!options.aiResidentialOnly && !options.dailyDatacenterOnly) return null;
  const proxies = config.proxies || [];
  const groups = config['proxy-groups'] || [];
  const aiName = '🤖 AI 网站';
  const autoName = '🏠 美国家宽自动';
  const ai = groups.find((g) => g.name === aiName);
  const residential = new Set(proxies.filter((p) => /家宽|住宅|residential/i.test(p.name)).map((p) => p.name));
  // 星链、蜂窝不等同于机房，也不擅自认定为适合 AI 的住宅出口。
  const special = new Set(proxies.filter((p) => /星链|蜂窝|starlink/i.test(p.name)).map((p) => p.name));
  const keywords = options.aiResidentialKeywords || [];
  const maxMultiplier = Number(options.aiMaxMultiplier || 0);
  const regions = options.aiAllowedRegions || (options.aiRegion ? [options.aiRegion] : []);
  const eligible = proxies.filter((p) => {
    if (!residential.has(p.name) || special.has(p.name) || (regions.length && !regions.some((r) => p.name.includes(r)))) return false;
    if (keywords.length && !keywords.some((k) => p.name.toLowerCase().includes(k.toLowerCase()))) return false;
    const multiplier = nodeMultiplier(p.name);
    return !maxMultiplier || (multiplier !== null && multiplier <= maxMultiplier);
  }).map((p) => p.name);
  if (options.aiResidentialOnly) {
    if (!ai || eligible.length === 0) throw new Error('AI 家宽策略没有符合地区条件的节点，拒绝回落到机房或直连');
    const allowed = new Set(eligible);
    const ordered = [...new Set([...(ai.proxies || []), ...eligible])].filter((n) => allowed.has(n));
    ai.type = 'select';
    ai.proxies = ordered;
    delete ai.use;
    delete ai['include-all'];
    delete ai['include-all-proxies'];
    delete ai['include-all-providers'];
    if (options.aiAutoFallback) {
      // 同一落地优先保留不同传输入口，其次才换其它美国家宽。避免按延迟频繁换 IP。
      const nodeByName = new Map(proxies.map((p) => [p.name, p]));
      const rank = (n) => (/DMIT2/i.test(n) ? 0 : 10) + (nodeByName.get(n).type === 'vless' ? 0 : nodeByName.get(n).type === 'hysteria2' ? 1 : 2);
      const autoRegion = options.aiAutoRegion || options.aiRegion;
      const fallbackNodes = ordered.filter((n) => !autoRegion || n.includes(autoRegion)).sort((a, b) => rank(a) - rank(b));
      if (!fallbackNodes.length) throw new Error('AI 自动回退地区没有符合条件的家宽节点');
      const auto = { name: autoName, type: 'fallback', proxies: fallbackNodes,
        url: 'https://www.gstatic.com/generate_204', interval: 120, timeout: 15000,
        lazy: false, 'max-failed-times': 3 };
      // 不限制 HTTP 状态：探活只检测 HTTPS 可达，403/429 不是换 IP 的充分理由。
      const oldAuto = groups.findIndex((g) => g.name === autoName);
      if (oldAuto >= 0) groups.splice(oldAuto, 1);
      groups.splice(groups.indexOf(ai) + 1, 0, auto);
      ai.proxies = [autoName, ...ordered];
    }
  }
  if (options.dailyDatacenterOnly) {
    for (const group of groups) {
      if (group.name === aiName || (options.aiAutoFallback && group.name === autoName)) continue;
      group.proxies = (group.proxies || []).filter((n) => !residential.has(n) && !special.has(n) && n !== aiName && n !== autoName);
      if (!group.proxies.length && !(group.use || []).length) throw new Error('日常组排除家宽后为空：' + group.name);
    }
  }
  return { aiRegion: options.aiRegion, aiAllowedRegions: regions, aiAutoRegion: options.aiAutoRegion || options.aiRegion || null, residentialLabelCount: residential.size, aiCandidates: options.aiResidentialOnly ? eligible.length : null, aiMaxMultiplier: maxMultiplier || null, aiAutoFallback: !!options.aiAutoFallback, dailyDatacenterOnly: options.dailyDatacenterOnly };
}

/** 精简界面：两个人工入口，两个隐藏的自动组；所有旧规则目标同步迁移。 */
function simplifyGroups(config, options = CFG) {
  const groups = config['proxy-groups'] || [];
  const primary = groups.find((g) => g.name === '🚀节点选择') || groups.find((g) => g.name === '🌐 日常上网');
  const ai = groups.find((g) => g.name === '🤖 AI 网站');
  if (!primary || !ai) throw new Error('精简分组需要日常和 AI 两个入口');
  const dailyName = '🌐 日常上网';
  const adName = '🛡️ 广告拦截';
  const helpers = groups.filter((g) => ['♻️自动选择', '🏠 美国家宽自动'].includes(g.name));
  const keep = new Set([primary.name, ai.name, ...helpers.map((g) => g.name)]);
  const aliases = new Map(groups.filter((g) => !keep.has(g.name)).map((g) => [g.name, /广告|拦截/.test(g.name) ? (options.adGroupEnabled ? adName : 'REJECT') : dailyName]));
  if (primary.name !== dailyName) aliases.set(primary.name, dailyName);
  primary.name = dailyName;
  const kept = [primary, ai];
  if (options.adGroupEnabled) kept.push({ name: adName, type: 'select', proxies: ['REJECT', 'DIRECT'] });
  kept.push(...helpers);
  for (const g of kept) {
    g.proxies = [...new Set((g.proxies || []).map((n) => aliases.get(n) || n))].filter((n) => n !== g.name);
    if (helpers.includes(g)) g.hidden = true;
    else delete g.hidden;
  }
  const rewrite = (rule) => {
    if (typeof rule !== 'string') return rule;
    const parts = rule.split(',');
    if (parts[0] === 'SUB-RULE') return rule;
    if (options.adGroupEnabled && parts[0] === 'RULE-SET' && parts[1] === 'up-reject' && parts[2] === 'REJECT') parts[2] = adName;
    let i = parts.length - 1;
    while (i > 0 && parts[i] === 'no-resolve') i--;
    if (aliases.has(parts[i])) parts[i] = aliases.get(parts[i]);
    return parts.join(',');
  };
  config.rules = (config.rules || []).map(rewrite);
  for (const rules of Object.values(config['sub-rules'] || {})) {
    if (Array.isArray(rules)) for (let i = 0; i < rules.length; i++) rules[i] = rewrite(rules[i]);
  }
  config['proxy-groups'] = kept;
  return { visible: kept.filter((g) => !g.hidden).map((g) => g.name), hidden: helpers.map((g) => g.name), removed: groups.filter((g) => !kept.includes(g)).map((g) => g.name) };
}

/** 只精简日常手动/自动候选，节点定义及 AI 组保留。 */
function curateDailyNodes(config, options = CFG) {
  const names = options.dailyNodeNames || [];
  if (!names.length) return null;
  const groups = config['proxy-groups'] || [];
  const daily = groups.find((g) => g.name === '🌐 日常上网');
  const auto = groups.find((g) => g.name === '♻️自动选择');
  if (!daily || !auto) throw new Error('精简日常节点需要日常和自动选择组');
  const allowed = new Set(auto.proxies || []);
  const chosen = [...new Set(names)].filter((n) => allowed.has(n));
  if (!chosen.length) throw new Error('日常精选节点全部不可用，拒绝生成空组');
  auto.proxies = chosen.slice();
  daily.proxies = [auto.name, ...chosen];
  return { requested: names.length, available: chosen.length };
}

/** 按明确域名分流，AI、直连和广告规则继续优先。 */
function addUsageGroups(config, options = CFG) {
  if (!options.usageGroups) return null;
  const groups = config['proxy-groups'] || [];
  const daily = groups.find(g => g.name === '🌐 日常上网');
  if (!daily) throw new Error('用途分组需要日常组');
  const candidates = (daily.proxies || []).filter(n => n.startsWith('赔钱机场 · '));
  if (!candidates.length) throw new Error('用途分组缺少赔钱机场节点');
  const add = (name, preferred) => {
    if (groups.some(g => g.name === name)) throw new Error('用途分组重复：' + name);
    if (preferred && !candidates.includes(preferred)) throw new Error('用途分组首选节点不存在：' + name);
    return { name, type: 'select', proxies: [...new Set([preferred || candidates[0], ...candidates, daily.name])] };
  };
  const download = add('📥 下载推荐', options.downloadPreferred);
  const video = add('📺 视频推荐', options.videoPreferred);
  groups.splice(groups.indexOf(daily) + 1, 0, download, video);
  config['rule-providers'] = Object.assign({}, config['rule-providers'] || {}, {
    'meta-youtube': {type:'http', behavior:'domain', format:'yaml', interval:86400,
      path:'./rules/meta-youtube.yaml', url:'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/youtube.yaml'},
    'meta-github': {type:'http', behavior:'domain', format:'yaml', interval:86400,
      path:'./rules/meta-github.yaml', url:'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/github.yaml'},
  });
  const entries = [
    ...['copilot-proxy.githubusercontent.com','copilot-workspace.githubnext.com','copilotprodattachments.blob.core.windows.net'].map(d => 'DOMAIN,' + d + ',🤖 AI 网站'),
    'RULE-SET,meta-github,' + download.name,
    'RULE-SET,meta-youtube,' + video.name,
  ];
  const rules = config.rules || [];
  const rejectIndex = rules.findIndex(r => typeof r === 'string' && r.startsWith('RULE-SET,up-reject,'));
  if (rejectIndex < 0) throw new Error('用途分组需要前置广告规则');
  rules.splice(rejectIndex + 1, 0, ...entries);
  return { download: download.proxies.length, video: video.proxies.length, rules: entries.length };
}

/** 三种用途各自探测，按顺序回退；手动选择原始节点仍可固定线路。 */
function addDefaultFallbacks(config, options = CFG) {
  if (!options.autoBackup) return null;
  const groups = config['proxy-groups'] || [];
  const nodes = new Map((config.proxies || []).map(p => [p.name,p]));
  const result = [];
  for (const [name, helper, configured, url, status] of [
    ['🌐 日常上网','🔁 日常默认与备用',options.dailyFallbackNames,'https://www.gstatic.com/generate_204','204'],
    ['📥 下载推荐','🔁 下载默认与备用',options.downloadFallbackNames,'https://github.com/robots.txt','200'],
    ['📺 视频推荐','🔁 视频默认与备用',options.videoFallbackNames,'https://www.youtube.com/generate_204','204'],
  ]) {
    const group = groups.find(g => g.name === name);
    if (!group) throw new Error('自动备用缺少用途组：'+name);
    const names = [...new Set(configured || [])];
    if (!names.length || names.some(n => !nodes.has(n) || /家宽|住宅|residential|星链|蜂窝/i.test(n))) throw new Error('自动备用节点无效或混入家宽：'+name);
    if (!names[0].startsWith('赔钱机场 · ')) throw new Error('自动备用必须首选赔钱机场：'+name);
    const fallback = {name:helper,type:'fallback',hidden:true,proxies:names,url,interval:120,timeout:10000,lazy:false,'max-failed-times':3,'expected-status':status};
    groups.push(fallback);
    group['default-selected'] = helper;
    group.proxies = [helper,...new Set([...names,...(group.proxies || []).filter(n => nodes.has(n))])];
    result.push({group:name,first:names[0],candidates:names.length});
  }
  // 旧日常测速组已不再被引用，清掉以免重复探测。
  const ai = groups.find(g => g.name === '🤖 AI 网站');
  if (ai && ai.proxies?.includes('🏠 美国家宽自动')) ai['default-selected'] = '🏠 美国家宽自动';
  config['proxy-groups'] = groups.filter(g => g.name !== '♻️自动选择');
  return result;
}

function prepareUnifiedRules(config, options = CFG) {
  if (!options.unifiedRules) return;
  config.rules = [];
  delete config['sub-rules'];
}

function finishUnifiedRules(config, options = CFG) {
  if (!options.unifiedRules) return;
  if (!(config.rules || []).some(r => r.startsWith('RULE-SET,ai-chat,'))) throw new Error('统一规则缺少 AI 层');
  config.rules.push('GEOIP,private,DIRECT,no-resolve','GEOIP,CN,DIRECT,no-resolve','MATCH,🌐 日常上网');
}

async function build() {
  if (!CFG.baseUrl) throw new Error('缺少 BASE_URL');
  if (!CFG.sources.length && !CFG.mergeUrl) throw new Error('缺少节点源：请配置 SOURCES 或 MERGE_URL');

  const t0 = Date.now();
  const baseText = await fetchText(CFG.baseUrl);
  const base = yaml.load(baseText);
  if (!base || typeof base !== 'object') throw new Error('底座不是 YAML 映射');

  const sourceInfo = await fetchProxies();

  const mainFn = loadOverrideMain();
  const asm = assemble(base, sourceInfo.proxies);
  const infoInfo = asm.info;
  const aliasInfo = asm.alias;
  const groupAdds = asm.adds;

  prepareUnifiedRules(base);
  let config = base;
  if (mainFn) {
    const ret = mainFn(config);
    if (ret && typeof ret === 'object') config = ret;
  } else {
    ensureAliasTargets(config, aliasInfo.targets);
  }

  const egressPolicy = enforceEgressPolicy(config);
  const compactGroups = CFG.simplifyGroups ? simplifyGroups(config) : null;
  const dailySelection = CFG.simplifyGroups ? curateDailyNodes(config) : null;
  const usageSelection = addUsageGroups(config);
  const defaultFallbacks = addDefaultFallbacks(config);
  finishUnifiedRules(config);
  const { problems, stats } = validate(config);
  if (problems.length) {
    throw new Error('校验失败（' + problems.length + ' 项）：' + problems.slice(0, 5).join('；'));
  }

  const text = yaml.dump(config, { lineWidth: -1, noRefs: true, sortKeys: false });
  stats.bytes = Buffer.byteLength(text);
  stats.sources = sourceInfo.sources;
  stats.customGroupAdds = groupAdds.length;
  stats.infoNodes = infoInfo;
  stats.groupFolded = aliasInfo.folded;
  stats.ms = Date.now() - t0;
  stats.at = new Date().toISOString();
  stats.egressPolicy = egressPolicy;
  stats.compactGroups = compactGroups;
  stats.dailySelection = dailySelection;
  stats.usageSelection = usageSelection;
  stats.defaultFallbacks = defaultFallbacks;
  log('构建完成', JSON.stringify(stats));
  return { text, stats };
}

function readLastGood() {
  try {
    const p = lastGoodPath();
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p, 'utf8');
  } catch (e) {
    return null;
  }
}

function writeLastGood(text) {
  try {
    fs.mkdirSync(CFG.lastGoodDir, { recursive: true });
    fs.writeFileSync(lastGoodPath(), text);
  } catch (e) {
    log('写 last-good 失败：' + e.message);
  }
}

async function getYaml(force) {
  const fresh = state.yaml && !force && Date.now() - state.at < CFG.cacheTtl;
  if (fresh) return state.yaml;

  if (state.building) return state.building;

  state.building = (async () => {
    try {
      const { text, stats } = await build();
      state.yaml = text;
      state.stats = stats;
      state.at = Date.now();
      state.error = null;
      writeLastGood(text);
      return text;
    } catch (e) {
      state.error = e.message;
      log('构建失败：' + e.message);
      const cached = state.yaml || readLastGood();
      if (cached) {
        state.at = Date.now(); // 缓存错峰，避免每次请求都重试
        return cached;
      }
      throw e;
    } finally {
      state.building = null;
    }
  })();

  return state.building;
}

function send(res, code, body, headers = {}) {
  res.writeHead(code, Object.assign({ 'Cache-Control': 'no-store' }, headers));
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname.replace(/\/+$/, '') || '/';

  if (p === '/health') return send(res, 200, 'ok\n', { 'Content-Type': 'text/plain; charset=utf-8' });

  if (p === '/diag') {
    return send(res, 200, JSON.stringify({
      ok: !state.error,
      error: state.error,
      stats: state.stats,
      cacheAgeSec: state.at ? Math.round((Date.now() - state.at) / 1000) : null,
      baseUrl: maskUrl(CFG.baseUrl),
      nodeSources: (CFG.sources.length ? CFG.sources : [{ label: '', url: CFG.mergeUrl }]).map((s) => ({
        label: s.label || '',
        prefix: s.label ? s.label + CFG.labelSeparator : '',
        url: maskUrl(s.url),
      })),
    }, null, 2), { 'Content-Type': 'application/json; charset=utf-8' });
  }

  const wantPath = CFG.secret;
  const okPaths = [wantPath, wantPath + '.yaml'];
  if (!okPaths.includes(p)) return send(res, 404, 'not found\n', { 'Content-Type': 'text/plain; charset=utf-8' });

  try {
    const force = url.searchParams.get('force') === '1';
    const text = await getYaml(force);
    return send(res, 200, text, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(CFG.filename).replace(/[!'()*]/g, encodeURIComponent),
    });
  } catch (e) {
    return send(res, 502, 'build failed: ' + e.message + '\n', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
});

if (require.main === module) {
  server.listen(CFG.port, CFG.host, () => {
    log(`listen http://${CFG.host}:${CFG.port}`);
    if (!CFG.baseUrl || !(CFG.sources.length || CFG.mergeUrl)) log('警告：BASE_URL / SOURCES 未配置，无法构建');
  });
}

module.exports = {
  build,
  validate,
  parseProxyText,
  getOptionalProxies,
  nodeMultiplier,
  parseSources,
  prefixProxies,
  dedupeProxies,
  injectIntoGroups,
  applyGroupAliases,
  ensureAliasTargets,
  stripInfoNodes,
  assemble,
  enforceEgressPolicy,
  maskUrl,
  simplifyGroups,
  curateDailyNodes,
  addUsageGroups,
  addDefaultFallbacks,
  prepareUnifiedRules,
  finishUnifiedRules,
};
