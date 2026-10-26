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
const yaml = require('js-yaml');

const CFG = {
  port: parseInt(process.env.PORT || '13200', 10),
  host: process.env.HOST || '127.0.0.1',
  baseUrl: process.env.BASE_URL || '',
  mergeUrl: process.env.MERGE_URL || '',
  sources: parseSources(process.env.SOURCES || ''),
  ua: process.env.UA || 'clash-verge/v2.4.2',
  secret: (process.env.SECRET || '/dgc').replace(/\/+$/, '') || '/dgc',
  overrideFile: process.env.OVERRIDE_FILE || path.join(__dirname, 'override.js'),
  cacheTtl: parseInt(process.env.CACHE_TTL || '300', 10) * 1000,
  lastGoodDir: process.env.LAST_GOOD_DIR || path.join(__dirname, 'data'),
  fetchTimeout: parseInt(process.env.FETCH_TIMEOUT || '30000', 10),
  filename: process.env.FILENAME || '大狗叫订阅.yaml',
};

// 需要把新节点补进去的策略组（按名字匹配，不存在就跳过）
const NODE_GROUPS = (process.env.NODE_GROUPS || '🚀节点选择,♻️自动选择').split(',').map((s) => s.trim()).filter(Boolean);
const BUILTIN_TARGETS = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE']);

// 机场塞进来的「信息节点」（剩余流量、距离重置、套餐到期…）都是 127.0.0.1 假线路，
// 而且各机场/缓存里数值天天变，留着会让底座分组引用到「上一版名字」而校验失败
const INFO_NODE_RE = /^(?:[^ ]{1,12} \* )?(?:剩余流量|距离下次重置剩余|套餐到期|到期时间|剩余天数|流量重置|线路到期)\s*[:：]/;

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
function prefixProxies(proxies, label) {
  if (!label) return proxies;
  const prefix = label + ' * ';
  return proxies.map((p) => Object.assign({}, p, { name: prefix + p.name }));
}

/** 日志/诊断里不暴露订阅 token */
function maskUrl(url) {
  return String(url || '').replace(/\/[^/]{8,}$/, '/…');
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

async function fetchText(url, ua) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CFG.fetchTimeout);
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
      throw new Error(`HTTP ${res.status} ${url} :: ${text.slice(0, 200).replace(/\s+/g, ' ')}`);
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
    const prefix = src.label ? src.label + ' * ' : '';
    per.push({ label: src.label || '', prefix, count: proxies.length, url: maskUrl(src.url) });
    log(`节点源「${src.label || '原名'}」：${proxies.length} 个` + (prefix ? `，前缀「${prefix}」` : '，不加前缀'));
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
function assemble(base, merged) {
  const beforeNames = new Set((Array.isArray(base.proxies) ? base.proxies : []).map((p) => p && p.name));
  base.proxies = merged;
  const info = stripInfoNodes(base);
  const newNames = base.proxies.map((p) => p && p.name).filter((n) => n && !beforeNames.has(n));
  const alias = applyGroupAliases(base);
  const adds = injectIntoGroups(base, newNames);
  return { info, alias, adds };
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

  let config = base;
  if (mainFn) {
    const ret = mainFn(config);
    if (ret && typeof ret === 'object') config = ret;
  } else {
    ensureAliasTargets(config, aliasInfo.targets);
  }

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
        prefix: s.label ? s.label + ' * ' : '',
        url: maskUrl(s.url),
      })),
    }, null, 2), { 'Content-Type': 'application/json; charset=utf-8' });
  }

  const wantPath = CFG.secret;
  const okPaths = [wantPath, wantPath + '.yaml', '/'];
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
    log(`listen http://${CFG.host}:${CFG.port}  订阅路径 ${CFG.secret}`);
    if (!CFG.baseUrl || !(CFG.sources.length || CFG.mergeUrl)) log('警告：BASE_URL / SOURCES 未配置，无法构建');
  });
}

module.exports = {
  build,
  validate,
  parseProxyText,
  parseSources,
  prefixProxies,
  dedupeProxies,
  injectIntoGroups,
  applyGroupAliases,
  ensureAliasTargets,
  stripInfoNodes,
  assemble,
};
