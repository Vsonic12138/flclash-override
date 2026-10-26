/**
 * FlClash / Clash Meta 订阅覆写脚本
 * ---------------------------------------------------------------
 * 四层结构（越靠前优先级越高）：
 *   ① 自定义直连层：本文件内联的精准规则（嘉立创 / 立创 / 飞书 / 字节 / B站）
 *   ② AI 层：内联 AI 域名 + MetaCubeX 的 AI 名单（204 条，日更）→ 收进「🤖 AI 网站」组
 *   ③ 上游层：引用 GitHub 高星大名单（Loyalsoldier/clash-rules ★28.9k，日更）
 *   ④ 订阅层：机场自带的规则，原样保留在后面
 *
 * 节点原样保留；会自动新增一个「🤖 AI 网站」策略组（订阅已有同名组时直接复用），
 * DNS 与 MATCH 兜底保持订阅原样不动。
 * 所以订阅每天自动更新不会影响这些规则；换机场只需把「覆写」指向同一个脚本。
 *
 * 在 FlClash 里的位置：配置 → 覆写脚本 → 新建 → 填入本文件 URL
 * 然后：配置 → 选中订阅 → 覆写 → 选择该脚本
 * ---------------------------------------------------------------
 */

// ============ 开关 ============
// 是否引用上游大名单（Loyalsoldier/clash-rules）作为第三层
// 打开后第一次启动内核要联网下载，代理没起来会失败一次（规则自动跳过，不影响启动），
// 之后 interval 到点自动重下。自定义层是内联的，永远不受影响。
const ENABLE_PROVIDERS = true;

// 是否额外引用 gfw 名单，把被墙域名强制送进代理组（默认关，机场订阅通常已覆盖）
const ENABLE_GFW_SET = false;

// 是否把 akamaized.net 也直连（B站海外备用源，直连可省代理流量）
const DIRECT_AKAMAI = true;

// 是否顺带修正 DNS（如果你在 FlClash 界面里自己调 DNS，请保持 false）
const APPLY_DNS = false;

// 是否创建「🤖 AI 网站」策略组（订阅里已有同名组时直接复用，不会重复创建）
const ENABLE_AI_GROUP = true;

// 是否引用 MetaCubeX 的 AI 名单（category-ai-chat-!cn，204 条，每天刷新）
const ENABLE_AI_PROVIDER = true;

// ============ 上游名单源 ============
// 官方源
const UPSTREAM = 'https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release';
// 拉不动时换成 jsDelivr 镜像：
// const UPSTREAM = 'https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release';

// AI 名单源（MetaCubeX 从 v2fly/domain-list-community 生成的 Clash 规则）
const AI_UPSTREAM = 'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite';
// 镜像：https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite

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

const AI_PROVIDERS = {
  'ai-chat': {
    type: 'http',
    behavior: 'domain',
    format: 'yaml',
    url: AI_UPSTREAM + '/category-ai-chat-!cn.yaml',
    path: './ruleset/ai-chat.yaml',
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

  // —— 网易 UU远程（远控要是走代理，画面会卡、鼠标延迟高，严重的直接连不上）——
  'nrd.nie.163.com',   // 主 API + 信令（api.nrd / sig-xxxx.nrd）
  'nie.163.com',
  'webapp.163.com',    // 登录页 / 充值页 / 云设备页
  'uu.163.com',
  'easebar.com',       // 统计（fcount-api.webapp.easebar.com）
];

if (DIRECT_AKAMAI) {
  DIRECT_DOMAINS.push('akamaized.net');
}

// 强制直连的进程：不看域名、不看 GeoIP，这个进程的全部流量都直连
// （UU远程的视频中转可能直连任意中转 IP，靠域名拦不住，用进程规则最稳）
const DIRECT_PROCESSES = [
  'GameViewer.exe',
  'GameViewerService.exe',
  'GameViewerServer.exe',
  'GameViewerHealthD.exe',
];

const PROCESS_RULES = DIRECT_PROCESSES.map((name) => `PROCESS-NAME,${name},DIRECT`);

const CUSTOM_RULES = PROCESS_RULES.concat(DIRECT_DOMAINS.map((domain) => `DOMAIN-SUFFIX,${domain},DIRECT`));

// ============ ② AI 层 ============
// 策略组名：FlClash 界面里会显示在最上面
const AI_GROUP = '🤖 AI 网站';

// AI 出口偏好：成员名里包含这个关键字(不区分大小写)的节点会排到组内第一位，
// 于是订阅每天更新后即便选择被重置，默认也会落回它（想要"纯家宽出口跑 AI"就填关键字）
// 留空 '' = 默认跟随主组
const AI_PREFERRED_NODE = 'DMIT2';

// 内联补充清单（补上游 AI 名单没覆盖到的站点；已覆盖的重复添加无副作用）
// 覆盖范围：OpenAI / ChatGPT / Sora / Gemini / NotebookLM / Claude / Copilot /
//          Grok & x.ai / Perplexity / Mistral / Cohere / Groq / HuggingFace /
//          Midjourney / Suno / Runway / Pika / Luma / Ideogram / Leonardo /
//          ElevenLabs / HeyGen / Synthesia / Stability / Character.AI /
//          Replicate / Together / Fireworks / OpenRouter / Ollama / LM Studio /
//          Cursor / Windsurf / Copilot 系编辑器 / LMArena ...
const AI_DOMAINS = [
  // —— 补 OpenAI 生态 ——
  'openai.com',
  'chatgpt.com',
  'oaistatic.com',
  'oaiusercontent.com',
  'sora.com',

  // —— 补 Google 系 ——
  'gemini.google.com',
  'aistudio.google.com',
  'generativelanguage.googleapis.com',
  'notebooklm.google.com',
  'jules.google',
  'deepmind.google',
  'makersuite.google.com',

  // —— 补 Anthropic / Claude ——
  'claude.ai',
  'anthropic.com',

  // —— 微软 Copilot / Bing Chat（订阅里有 microsoft.com 直连，必须抢在它前面）——
  'copilot.microsoft.com',
  'copilot.cloud.microsoft',
  'sydney.bing.com',
  'edgeservices.bing.com',
  'services.bingapis.com',
  'gateway.bingviz.microsoft.net',
  'designer.microsoft.com',

  // —— xAI / Grok ——
  'x.ai',
  'grok.com',
  'grok.x.com',
  'accounts.x.ai',
  'api.x.ai',

  // —— 检索 / 对话类 ——
  'perplexity.ai',
  'pplx.ai',
  'poe.com',
  'you.com',
  'phind.com',
  'pi.ai',
  'monica.im',

  // —— 模型服务 / 推理平台 ——
  'mistral.ai',
  'cohere.ai',
  'cohere.com',
  'groq.com',
  'cerebras.ai',
  'huggingface.co',
  'hf.co',
  'replicate.com',
  'together.ai',
  'together.xyz',
  'fireworks.ai',
  'deepinfra.com',
  'openrouter.ai',
  'ollama.com',
  'lmstudio.ai',

  // —— 生成式 / 创意 ——
  'midjourney.com',
  'suno.com',
  'suno.ai',
  'runwayml.com',
  'lumalabs.ai',
  'pika.art',
  'ideogram.ai',
  'leonardo.ai',
  'stability.ai',
  'elevenlabs.io',
  'elevenlabs.com',
  'heygen.com',
  'synthesia.io',
  'character.ai',
  'c.ai',

  // —— 编码类 AI ——
  'cursor.com',
  'cursor.sh',
  'windsurf.com',
  'githubcopilot.com',
  'v0.app',
  'v0.dev',
  'lovable.dev',
  'gamma.app',
  'lmarena.ai',
  'chat.lmsys.org',
];

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

/** 找一个可用的策略组名，作为兜底出口（不依赖任何硬编码组名） */
function pickProxyGroup(config) {
  const groups = Array.isArray(config['proxy-groups']) ? config['proxy-groups'] : [];
  for (const group of groups) {
    if (group && group.type === 'select' && Array.isArray(group.proxies) && group.proxies.length > 0) {
      return group.name;
    }
  }
  return null;
}

/**
 * 确保存在「🤖 AI 网站」策略组：
 * - 订阅里已有同名组 → 直接复用（尊重机场自己的编排）
 * - 没有 → 在最前面插入一个 select 组，成员 = 原策略组 + 所有节点 + DIRECT
 *   默认选中第一个：命中 AI_PREFERRED_NODE 关键字的节点优先，没有命中则= 原策略组（跟随主组）
 * 返回可用于规则出口的组名，无法创建时返回 null
 */
function ensureAiGroup(config, primary) {
  const groups = Array.isArray(config['proxy-groups']) ? config['proxy-groups'] : null;
  if (!groups || groups.length === 0) {
    return null;
  }

  const existing = groups.find((g) => g && g.name === AI_GROUP);
  if (existing) {
    return existing.name;
  }

  const candidates = [];
  const add = (name) => {
    if (typeof name === 'string' && name && name !== AI_GROUP && candidates.indexOf(name) === -1) {
      candidates.push(name);
    }
  };

  // 1) 原策略组放第一个 → AI 默认跟随主组，行为与现在完全一致
  add(primary);
  // 2) 其它组名（订阅可能的嵌套组）
  for (const group of groups) {
    add(group && group.name);
  }
  // 3) 直连节点（订阅用 proxy-providers 时这里为空，只剩组名，也不会报错）
  if (Array.isArray(config.proxies)) {
    for (const proxy of config.proxies) {
      add(proxy && proxy.name);
    }
  }
  if (candidates.length === 0) {
    return null;
  }
  add('DIRECT');

  // 4) 偏好节点置顶 → 订阅更新/选择被重置后，AI 默认仍走它
  if (AI_PREFERRED_NODE) {
    const keyword = String(AI_PREFERRED_NODE).toLowerCase();
    const nodeNames = (Array.isArray(config.proxies) ? config.proxies : [])
      .map((proxy) => proxy && proxy.name)
      .filter((name) => typeof name === 'string' && name);
    const preferred = nodeNames.filter((name) => name.toLowerCase().indexOf(keyword) !== -1)[0];
    const index = preferred ? candidates.indexOf(preferred) : -1;
    if (index > 0) {
      candidates.splice(index, 1);
      candidates.unshift(preferred);
    }
  }

  groups.unshift({ name: AI_GROUP, type: 'select', proxies: candidates });
  return AI_GROUP;
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

/** 构造 AI 层规则，出口优先用 AI 组，没有就用原策略组，都没有则跳过 */
function buildAiRules(config, primary) {
  const target = ENABLE_AI_GROUP ? ensureAiGroup(config, primary) : primary;
  if (!target) {
    console.log('[override] 没有可用的策略组，跳过 AI 层');
    return [];
  }

  const rules = [];
  if (ENABLE_AI_PROVIDER) {
    config['rule-providers'] = Object.assign({}, config['rule-providers'] || {}, AI_PROVIDERS);
    rules.push('RULE-SET,ai-chat,' + target);
  }
  for (const domain of AI_DOMAINS) {
    rules.push(`DOMAIN-SUFFIX,${domain},${target}`);
  }
  return rules;
}

function buildHead(config) {
  const head = CUSTOM_RULES.slice();
  // 先记下订阅原本的主策略组（此时还没插入 AI 组），gfw 名单也用它
  const primary = pickProxyGroup(config);

  if (ENABLE_AI_GROUP || ENABLE_AI_PROVIDER) {
    const aiRules = buildAiRules(config, primary);
    for (const rule of aiRules) {
      head.push(rule);
    }
  }

  if (!ENABLE_PROVIDERS) {
    return head;
  }

  config['rule-providers'] = Object.assign({}, config['rule-providers'] || {}, PROVIDERS);

  head.push('RULE-SET,up-private,DIRECT');
  head.push('RULE-SET,up-reject,REJECT');

  if (ENABLE_GFW_SET) {
    // 只认订阅原本的主策略组；没有就跳过（不把 gfw 名单指向我们新建的 AI 组）
    const gfwTarget = primary;
    if (gfwTarget) {
      head.push('RULE-SET,up-gfw,' + gfwTarget);
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
    '[override] 自定义直连 ' + CUSTOM_RULES.length + ' 条，' +
    'AI 域名 ' + AI_DOMAINS.length + ' 条' +
    (ENABLE_AI_PROVIDER ? '（已挂 AI 名单）' : '') + '，' +
    '总规则 ' + config.rules.length + ' 条' +
    (ENABLE_PROVIDERS ? '（已挂上游名单）' : '')
  );

  return config;
}
