'use strict';
/**
 * submerge —— 把两家机场的 Clash 订阅合并成一条订阅
 *
 * 为什么不用 Cloudflare Worker：workers.dev 在国内不通，且机场对 CF 出口返回 403。
 * 这个服务跑在 127.0.0.1，FlClash 把订阅地址填成 http://127.0.0.1:7788/sub 即可。
 *
 * 合并策略：以 config.base 指定的机场为「底」（保留它的规则和策略组），
 * 把另一家的节点加前缀后追加进 proxies，于是 override.js 里的 🤖 AI 网站 组
 * 就能选到家宽节点了。
 *
 * 密钥文件在仓库外：%USERPROFILE%\.submerge\config.json
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CLASH_UA = 'clash-verge/v2.4.2';
const DEFAULT_PORT = 7788;
const CONFIG_PATH =
  process.env.SUBMERGE_CONFIG || path.join(os.homedir(), '.submerge', 'config.json');
const CACHE_PATH = path.join(os.homedir(), '.submerge', 'last-good.yaml');

function writeCache(yaml) {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, yaml);
  } catch (err) {
    console.warn('[submerge] 写缓存失败：' + err.message);
  }
}

function readCache() {
  try {
    return fs.readFileSync(CACHE_PATH, 'utf8');
  } catch {
    return null;
  }
}

/* ---------------- 合并核心 ---------------- */

/** 取出某个顶层键（如 proxies）的整段文本 */
function sliceTopBlock(text, topKey) {
  const re = new RegExp('^' + topKey + ':[ \\t]*$', 'm');
  const m = re.exec(text);
  if (!m) return null;
  const start = m.index + m[0].length;
  const rest = text.slice(start);
  const nextMatch = rest.match(/^[A-Za-z_][A-Za-z0-9_-]*:/m);
  const end = nextMatch ? nextMatch.index : rest.length;
  return {
    before: text.slice(0, start),
    block: rest.slice(0, end),
    after: rest.slice(end),
  };
}

/** 给这一段里所有 name: 值加上前缀 */
function prefixNames(block, prefix) {
  return block.replace(
    /(^|[{\s,])name:[ \t]*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,\n}]+)/gm,
    (all, lead, value) => {
      const v = value.trim();
      if (v.startsWith('"') || v.startsWith("'")) {
        const q = v[0];
        return lead + 'name: ' + q + prefix + v.slice(1, -1) + q;
      }
      return lead + 'name: ' + prefix + v;
    }
  );
}

/** 统计 proxies 里有多少个条目（粗略但够用） */
function countProxies(block) {
  return (block.match(/^\s*-\s+\S/gm) || []).length;
}

/** proxies 段里条目的缩进宽度（第一个 "- " 前面的空格数） */
function itemIndent(block) {
  const m = block.match(/^([ \t]*)-[ \t]+\S/m);
  return m ? m[1] : '';
}

/** 把一段序列按 delta 空格整体平移缩进（只动非空行） */
function reindent(text, delta) {
  if (!delta) return text;
  return text
    .split('\n')
    .map((line) => {
      if (!line.trim()) return line;
      if (delta > 0) return ' '.repeat(delta) + line;
      const strip = ' '.repeat(-delta);
      return line.startsWith(strip) ? line.slice(-delta) : line;
    })
    .join('\n');
}

function mergeClash(baseText, extraText, extraPrefix) {
  const base = sliceTopBlock(baseText, 'proxies');
  const extra = sliceTopBlock(extraText, 'proxies');
  if (!base) throw new Error('底配置里找不到 proxies: 段落');
  if (!extra) throw new Error('追加配置里找不到 proxies: 段落');

  const preamble = countProxies(base.block);
  const incoming = countProxies(extra.block);
  if (incoming === 0) throw new Error('追加配置的 proxies 段是空的');

  // 两家机场的 YAML 风格未必一致：赔钱是 4 空格 + 流式 { }，酷狗是 2 空格块式。
  // 直接拼接会拼出非法缩进，所以先把追加段对齐到底配置的条目缩进。
  const baseIndent = itemIndent(base.block);
  const extraIndent = itemIndent(extra.block);
  const delta = baseIndent.length - extraIndent.length;

  const renamed = prefixNames(extra.block.replace(/^\s*\n/, ''), extraPrefix);
  const aligned = reindent(renamed, delta);
  const left = base.block.replace(/[ \t]+$/, '').replace(/\n*$/, '\n');
  const right = aligned.replace(/^[ \t]*\n+/, '').replace(/[ \t]+$/, '').replace(/\n*$/, '\n');

  const merged = base.before + left + right + base.after;
  return { yaml: merged, baseCount: preamble, extraCount: incoming };
}

/* ---------------- 抓取 + 缓存 ---------------- */

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(
      '缺少配置文件：' + CONFIG_PATH + '\n把 config.example.json 复制过去并填好订阅链接'
    );
  }
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  if (!cfg.subs || Object.keys(cfg.subs).length < 2) {
    throw new Error('配置里需要至少两家订阅（subs 至少两个键）');
  }
  cfg.port = cfg.port || DEFAULT_PORT;
  cfg.base = cfg.base || Object.keys(cfg.subs)[0];
  cfg.prefix = cfg.prefix || {};
  cfg.cacheSeconds = cfg.cacheSeconds || 1800;
  return cfg;
}

async function fetchSub(url) {
  // 本地文件支持：方便离线自测（subs 里可以直接写 yaml 路径）
  if (!/^https?:/i.test(url)) {
    const text = fs.readFileSync(url, 'utf8');
    return text;
  }
  const resp = await fetch(url, {
    headers: { 'user-agent': CLASH_UA, accept: '*/*' },
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error('HTTP ' + resp.status + ' ' + text.slice(0, 120));
  if (!/^\s*[A-Za-z_][A-Za-z0-9_-]*:\s*$/m.test(text)) {
    throw new Error('返回内容不是 Clash YAML（可能是 base64 订阅，或 UA 被识别错）');
  }
  return text;
}

const state = {
  yaml: null,
  builtAt: 0,
  diag: {},
};

/* ---------------- 结构校验 ---------------- */

/**
 * 合并是纯文本拼接，最怕拼出非法 YAML 或重名节点。
 * 这里用 js-yaml 真解析一遍，再核对组/规则引用，坏配置绝不发给 FlClash。
 */
function validateClash(yaml) {
  let doc;
  try {
    doc = require('js-yaml').load(yaml);
  } catch (err) {
    throw new Error('合并结果不是合法 YAML：' + err.message);
  }
  if (!doc || typeof doc !== 'object') throw new Error('合并结果不是对象');

  const proxies = Array.isArray(doc.proxies) ? doc.proxies : [];
  const groups = Array.isArray(doc['proxy-groups']) ? doc['proxy-groups'] : [];
  const rules = Array.isArray(doc.rules) ? doc.rules : [];

  const seen = new Set();
  const dup = [];
  for (const p of proxies) {
    const name = p && p.name;
    if (!name) throw new Error('有节点没有 name');
    if (seen.has(name)) dup.push(name);
    seen.add(name);
  }
  if (dup.length) throw new Error('合并后节点重名：' + dup.slice(0, 5).join(' / '));

  for (const g of groups) {
    if (!g || !g.name) throw new Error('有策略组没有 name');
    for (const ref of Array.isArray(g.proxies) ? g.proxies : []) {
      if (ref !== 'DIRECT' && ref !== 'REJECT' && !seen.has(ref) && !groups.some((x) => x.name === ref)) {
        throw new Error('策略组 ' + g.name + ' 引用了不存在的成员：' + ref);
      }
    }
  }

  const groupNames = new Set(groups.map((g) => g.name).concat(['DIRECT', 'REJECT', 'GLOBAL']));
  // 末尾可能跟 no-resolve / resolve / src 这类选项，出口是去掉它们后的最后一段
  const OPTIONS = new Set(['no-resolve', 'resolve', 'src']);
  const badRule = rules.find((r) => {
    const parts = String(r).split(',').map((s) => s.trim());
    while (parts.length > 2 && (OPTIONS.has(parts[parts.length - 1]) || parts[parts.length - 1] === '')) parts.pop();
    const target = parts[parts.length - 1];
    return target && !groupNames.has(target);
  });

  return {
    proxies: proxies.length,
    groups: groups.length,
    rules: rules.length,
    household: proxies.filter((p) => typeof p.name === 'string' && p.name.includes('家宽')).length,
    unknownRuleTarget: badRule || null,
  };
}

async function buildFresh(cfg) {
  const names = Object.keys(cfg.subs);
  const texts = {};
  await Promise.all(
    names.map(async (name) => {
      const started = Date.now();
      try {
        texts[name] = await fetchSub(cfg.subs[name]);
        state.diag[name] = {
          ok: true,
          size: texts[name].length,
          ms: Date.now() - started,
          at: new Date().toISOString(),
        };
      } catch (err) {
        state.diag[name] = { ok: false, error: String(err.message || err), at: new Date().toISOString() };
        throw new Error('拉取 ' + name + ' 失败：' + err.message);
      }
    })
  );

  const baseName = cfg.base;
  const others = names.filter((n) => n !== baseName);
  let yaml = texts[baseName];
  for (const name of others) {
    const prefix = cfg.prefix[name] || '[' + name + ']';
    const r = mergeClash(yaml, texts[name], prefix);
    yaml = r.yaml;
    state.diag[name].merged = r.extraCount;
  }

  // 坏配置绝不发给 FlClash：解析不过就抛错，由外层回落到磁盘上的上一份好配置
  const info = validateClash(yaml);
  if (info.unknownRuleTarget) {
    console.warn('[submerge] 警告：规则指向了不存在的策略组 -> ' + info.unknownRuleTarget);
  }
  state.diag.validate = Object.assign({}, info, { at: new Date().toISOString() });
  return yaml;
}

async function buildMerged(cfg, { force = false } = {}) {
  const fresh = state.yaml && Date.now() - state.builtAt < cfg.cacheSeconds * 1000;
  if (fresh && !force) return state.yaml;

  try {
    const yaml = await buildFresh(cfg);
    state.yaml = yaml;
    state.builtAt = Date.now();
    state.diag.merged = { bytes: yaml.length, at: new Date().toISOString() };
    writeCache(yaml);
    delete state.diag.fallback;
    return yaml;
  } catch (err) {
    // 服务挂了/机场临时抽风时，退回上一份成功合并的配置，FlClash 不至于断了订阅
    const cached = readCache();
    state.diag.lastError = { error: String(err.message || err), at: new Date().toISOString() };
    if (cached) {
      state.diag.fallback = { bytes: cached.length, at: new Date().toISOString() };
      console.warn('[submerge] 合并失败，改用磁盘缓存：' + err.message);
      state.yaml = cached;
      state.builtAt = Date.now();
      return cached;
    }
    throw err;
  }
}

/* ---------------- HTTP 服务 ---------------- */

function send(res, status, body, type) {
  res.writeHead(status, {
    'content-type': type || 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function startServer(cfg) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      if (url.pathname === '/health') return send(res, 200, 'ok');
      if (url.pathname === '/diag') return send(res, 200, JSON.stringify(state.diag, null, 2), 'application/json');
      if (url.pathname === '/sub') {
        const yaml = await buildMerged(cfg, { force: url.searchParams.has('force') });
        return send(res, 200, yaml, 'text/yaml; charset=utf-8');
      }
      if (url.pathname.startsWith('/raw/')) {
        const name = url.pathname.slice('/raw/'.length);
        const src = cfg.subs[name];
        if (!src) return send(res, 404, 'unknown source: ' + name);
        return send(res, 200, await fetchSub(src), 'text/yaml; charset=utf-8');
      }
      return send(res, 404, 'not found');
    } catch (err) {
      return send(res, 502, String(err.message || err));
    }
  });

  server.listen(cfg.port, '127.0.0.1', () => {
    console.log('[submerge] 合并订阅已就绪：http://127.0.0.1:' + cfg.port + '/sub');
    console.log('[submerge] 诊断信息：http://127.0.0.1:' + cfg.port + '/diag');
    console.log('[submerge] 底配置 = ' + cfg.base + '，缓存 ' + cfg.cacheSeconds + 's');
    buildMerged(cfg).catch((err) => console.error('[submerge] 首次合并失败：', err.message));
  });
}

/* ---------------- 入口 ---------------- */

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--check') {
    // 校验任意一份 clash 配置：node server.js --check 文件.yaml
    const file = args[1];
    const info = validateClash(fs.readFileSync(file, 'utf8'));
    console.log(JSON.stringify(info, null, 2));
    if (info.proxies === 0) process.exitCode = 2;
    return;
  }
  if (args[0] === '--merge-files') {
    // 离线自测：node server.js --merge-files base.yaml extra.yaml "[酷狗]"
    const [, baseFile, extraFile, prefix] = args;
    const r = mergeClash(fs.readFileSync(baseFile, 'utf8'), fs.readFileSync(extraFile, 'utf8'), prefix || '[extra]');
    const info = validateClash(r.yaml);
    process.stdout.write(r.yaml);
    console.error(
      '[test] base=' + r.baseCount + ' extra=' + r.extraCount + ' out=' + r.yaml.length + 'B  ' +
        'proxies=' + info.proxies + ' groups=' + info.groups + ' rules=' + info.rules + ' 家宽=' + info.household
    );
    return;
  }
  startServer(loadConfig());
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[submerge] 启动失败：', err.message);
    process.exit(1);
  });
}

module.exports = { mergeClash, sliceTopBlock, prefixNames, fetchSub, buildMerged };
