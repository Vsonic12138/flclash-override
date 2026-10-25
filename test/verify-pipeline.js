/** 用真实订阅结构验证 override.js 的输出（离线全链路检查） */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'override.js'), 'utf8');
const mod = { exports: {} };
new Function('module', 'console', src + '\nmodule.exports = main;')(mod, { log: () => {} });
const main = mod.exports;

const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = main(cfg);

const groups = out['proxy-groups'] || [];
const ai = groups[0] || {};
const rules = out.rules;
const summary = {
  groupCount: groups.length,
  aiGroupName: ai.name,
  aiGroupType: ai.type,
  aiMemberCount: (ai.proxies || []).length,
  aiFirstThree: (ai.proxies || []).slice(0, 3),
  aiLast: (ai.proxies || []).slice(-1),
  ruleCount: rules.length,
  firstRules: rules.slice(0, 3),
  hasAiRuleset: rules.some((r) => r.startsWith('RULE-SET,ai-chat,')),
  aiRulesetRule: rules.find((r) => r.startsWith('RULE-SET,ai-chat,')),
  copilotRule: rules.find((r) => r.startsWith('DOMAIN-SUFFIX,copilot.microsoft.com')),
  copilotIndex: rules.findIndex((r) => r.startsWith('DOMAIN-SUFFIX,copilot.microsoft.com')),
  providerKeys: Object.keys(out['rule-providers'] || {}),
  lastRule: rules[rules.length - 1],
  duplicateCount: rules.length - new Set(rules.map((r) => r.split(',').slice(0, 2).join(',').toLowerCase())).size,
};
fs.writeFileSync(path.join(__dirname, '..', 'pipeline-result.json'), JSON.stringify(summary, null, 2));
console.log('pipeline ok');
