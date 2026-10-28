/**
 * 订阅中转 / 合并 Worker
 *
 * 路由：
 *   GET /health
 *   GET /<PATH_KEY>/raw/kg | /<PATH_KEY>/raw/pq   单机场原文（调试用）
 *   GET /<PATH_KEY>/sub                           合并后的订阅（FlClash 用这条）
 *   诊断：cron 定时把上游状态写进 KV，便于在国内网络下排查
 *         （workers.dev 在国内被墙，本地 curl 不到 Worker 时用 KV 回读）
 *
 * Secrets / vars:
 *   PATH_KEY     随机路径前缀
 *   SUB_KG       酷狗机场订阅链接
 *   SUB_PQ       赔钱机场订阅链接
 * Binding:
 *   SUBKV        KV，存诊断信息 + 合并结果缓存
 */

const CLASH_UA = 'clash-verge/v2.4.2';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response('ok', { headers: { 'content-type': 'text/plain' } });
    }

    const key = env.PATH_KEY || '';
    const parts = url.pathname.split('/').filter(Boolean);
    if (!key || parts[0] !== key) {
      return new Response('not found', { status: 404 });
    }

    // /<key>/raw/<src>
    if (parts[1] === 'raw' && parts[2]) {
      const src = { kg: env.SUB_KG, pq: env.SUB_PQ }[parts[2]];
      if (!src) return new Response('unknown source', { status: 404 });
      const r = await proxyRaw(src);
      return r;
    }

    // /<key>/sub
    if (parts[1] === 'sub') {
      const cached = await env.SUBKV.get('merged');
      if (cached) {
        return new Response(cached, {
          headers: { 'content-type': 'text/yaml; charset=utf-8' },
        });
      }
      const r = await buildMerged(env);
      if (r.error) return new Response(r.error, { status: 502 });
      await env.SUBKV.put('merged', r.yaml, { expirationTtl: 900 });
      return new Response(r.yaml, {
        headers: { 'content-type': 'text/yaml; charset=utf-8' },
      });
    }

    return new Response('not found', { status: 404 });
  },

  async scheduled(controller, env, ctx) {
    const report = {};
    for (const [name, src] of [['kg', env.SUB_KG], ['pq', env.SUB_PQ]]) {
      if (!src) {
        report[name] = { ok: false, reason: 'secret missing' };
        continue;
      }
      try {
        const resp = await fetch(src, {
          headers: { 'user-agent': CLASH_UA, accept: '*/*' },
        });
        const text = await resp.text();
        report[name] = {
          status: resp.status,
          size: text.length,
          head: text.slice(0, 600),
          at: new Date().toISOString(),
        };
      } catch (err) {
        report[name] = { ok: false, reason: String(err), at: new Date().toISOString() };
      }
    }
    await env.SUBKV.put('diag', JSON.stringify(report, null, 2));

    // 顺手刷新合并结果
    const r = await buildMerged(env);
    if (!r.error) {
      await env.SUBKV.put('merged', r.yaml, { expirationTtl: 3600 });
      report.merged = { ok: true, size: r.yaml.length };
    } else {
      report.merged = { ok: false, reason: r.error };
    }
    await env.SUBKV.put('diag', JSON.stringify(report, null, 2));
  },
};

async function proxyRaw(src) {
  try {
    const resp = await fetch(src, { headers: { 'user-agent': CLASH_UA, accept: '*/*' } });
    if (!resp.ok) return new Response(`upstream ${resp.status}`, { status: 502 });
    return new Response(await resp.text(), {
      headers: { 'content-type': 'text/yaml; charset=utf-8' },
    });
  } catch (err) {
    return new Response(`upstream fetch failed: ${err.message}`, { status: 502 });
  }
}

/** 拉两家配置，文本级合并：以赔钱为底，追加酷狗节点（加前缀） */
async function buildMerged(env) {
  if (!env.SUB_PQ || !env.SUB_KG) return { error: 'secret missing' };
  try {
    const [pqResp, kgResp] = await Promise.all([
      fetch(env.SUB_PQ, { headers: { 'user-agent': CLASH_UA, accept: '*/*' } }),
      fetch(env.SUB_KG, { headers: { 'user-agent': CLASH_UA, accept: '*/*' } }),
    ]);
    if (!pqResp.ok) return { error: `pq upstream ${pqResp.status}` };
    if (!kgResp.ok) return { error: `kg upstream ${kgResp.status}` };
    const [pq, kg] = await Promise.all([pqResp.text(), kgResp.text()]);
    const yaml = mergeClash(pq, kg, '[酷狗]');
    return { yaml };
  } catch (err) {
    return { error: `merge failed: ${err.message}` };
  }
}

/** 从 clash yaml 文本里截出 proxies: 段落（到下一个顶层键为止） */
function sliceBlock(text, topKey) {
  const re = new RegExp(`^${topKey}:\\s*$`, 'm');
  const m = re.exec(text);
  if (!m) return null;
  const start = m.index + m[0].length;
  const rest = text.slice(start);
  const next = rest.search(/^[a-zA-Z][a-zA-Z0-9_-]*:/m);
  return {
    before: text.slice(0, start),
    block: next === -1 ? rest : rest.slice(0, next),
    after: next === -1 ? '' : rest.slice(next),
  };
}

function mergeClash(base, extra, prefix) {
  const baseProxies = sliceBlock(base, 'proxies');
  const extraProxies = sliceBlock(extra, 'proxies');
  if (!baseProxies) return base; // 兜底：解析不了就原样返回
  if (!extraProxies) return base;

  // 给酷狗的节点名加前缀：name: "xxx"  ->  name: "[酷狗] xxx"
  const renamed = extraProxies.block.replace(/(name:\s*)(["'])(.*?)\2/g, (all, k, q, name) => {
    return `${k}${q}${prefix}${name}${q}`;
  });

  return baseProxies.before + baseProxies.block.replace(/\s*$/, '\n') + renamed.replace(/^\s+/, '  ') + baseProxies.after;
}
