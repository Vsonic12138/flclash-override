'use strict';
/**
 * 大狗叫订阅 · 服务器端合成器
 * ---------------------------------------------------------------
 * 作用：把「机场完整配置（底座）+ Sub-Store 合并出的节点 + 本仓库 override.js 的规则层」
 *      合成一份可以直接丢给 FlClash 订阅的完整 Clash 配置。
 *
 * 流程（每次重建）：
 *   1. 拉底座：BASE_URL（机场的完整 YAML，必须能被 Clash 解析）→ 提供 DNS/端口/分组/机场自带规则
 *   2. 拉节点：MERGE_URL（Sub-Store 的 /download/collection/merge 输出，只有 proxies）
 *   3. 用合并节点替换底座里的 proxies
 *   4. 把底座分组不认识的新节点（如 [酷狗] 前缀的）补进「🚀节点选择」「♻️自动选择」
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

async function build() {
  if (!CFG.baseUrl) throw new Error('缺少 BASE_URL');
  if (!CFG.mergeUrl) throw new Error('缺少 MERGE_URL');

  const t0 = Date.now();
  const baseText = await fetchText(CFG.baseUrl);
  const base = yaml.load(baseText);
  if (!base || typeof base !== 'object') throw new Error('底座不是 YAML 映射');

  const mergeText = await fetchText(CFG.mergeUrl);
  const merged = dedupeProxies(parseProxyText(mergeText));

  const beforeNames = new Set((Array.isArray(base.proxies) ? base.proxies : []).map((p) => p.name));
  base.proxies = merged;

  const mainFn = loadOverrideMain();
  const aliasInfo = applyGroupAliases(base);

  const newNames = merged.map((p) => p.name).filter((n) => !beforeNames.has(n));
  const groupAdds = injectIntoGroups(base, newNames);

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
  stats.customGroupAdds = groupAdds.length;
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
      sources: { baseUrl: CFG.baseUrl.replace(/\/[^/]{8,}$/, '/…'), mergeUrl: CFG.mergeUrl.replace(/\/[^/]{8,}$/, '/…') },
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
    if (!CFG.baseUrl || !CFG.mergeUrl) log('警告：BASE_URL / MERGE_URL 未配置，无法构建');
  });
}

module.exports = { build, validate, parseProxyText, dedupeProxies, injectIntoGroups, applyGroupAliases, ensureAliasTargets };
