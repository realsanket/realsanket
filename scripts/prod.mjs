// "Deploy to Sanket's prod": a visitor game played through GitHub Issues.
// A visitor opens an issue titled `prod: ship`, `prod: rollback` or
// `prod: chaos`. The workflow runs this script, which updates the state in
// data/prod.json, redraws assets/prod-status.svg, rewrites the release log in
// README.md, and writes the reply for the issue to reply.md. No dependencies.
//
//   node scripts/prod.mjs                        (reads ISSUE_TITLE, ISSUE_USER)
//   ISSUE_TITLE="prod: ship" ISSUE_USER=octocat node scripts/prod.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';

const STATE = 'data/prod.json';
const SVG = 'assets/prod-status.svg';
const README = 'README.md';
const LOG_SIZE = 6;

const title = (process.env.ISSUE_TITLE ?? '').trim().toLowerCase();
const user = (process.env.ISSUE_USER ?? '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 39) || 'someone';
const action = /^prod:\s*(ship|rollback|chaos)\b/.exec(title)?.[1];
if (!action) {
  writeFileSync('reply.md', "🤔 I only understand `prod: ship`, `prod: rollback` and `prod: chaos`. Try one of the buttons on the profile!");
  process.exit(0);
}

const state = JSON.parse(readFileSync(STATE, 'utf8'));
const now = new Date();
const friday = now.getUTCDay() === 5;
let result;

if (action === 'ship') {
  state.build += 1;
  state.deploys += 1;
  if (state.status !== 'healthy') {
    result = `🩹 Hotfix #${state.build} shipped. Production is healthy again, thanks to you.`;
    state.status = 'healthy';
    state.healthySince = now.toISOString();
  } else if (friday) {
    result = `🔥 Build #${state.build} deployed… on a Friday. Production is on fire. Someone ship a fix or roll back!`;
    state.status = 'on-fire';
    state.incidents += 1;
  } else {
    result = `✅ Build #${state.build} deployed. All health checks green.`;
  }
} else if (action === 'rollback') {
  state.rollbacks += 1;
  if (state.status !== 'healthy') {
    result = `⏪ Rolled back to a known good build. Incident resolved, production is healthy.`;
    state.status = 'healthy';
    state.healthySince = now.toISOString();
  } else {
    result = `⏪ Rolled back build #${state.build}. Nothing was wrong, but caution is a virtue.`;
  }
} else {
  state.chaos += 1;
  if (state.status === 'healthy' && randomInt(3) === 0) {
    result = `💥 The chaos monkey took out an availability zone. Production is degraded: ship a hotfix or roll back!`;
    state.status = 'degraded';
    state.incidents += 1;
  } else if (state.status !== 'healthy') {
    result = `🐒 More chaos while production is already down? Bold. It is still ${state.status}.`;
  } else {
    result = `🛡️ Chaos test passed: an availability zone went down and production didn't notice.`;
  }
}

state.log.unshift({ build: state.build, user, action, result, at: now.toISOString() });
state.log = state.log.slice(0, LOG_SIZE);
state.lastPlayer = user;
writeFileSync(STATE, `${JSON.stringify(state, null, 2)}\n`);

// ------------------------------------------------------------ Dashboard SVG
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const STATUS = {
  healthy: { label: 'HEALTHY', color: '#34d399', note: `healthy since ${state.healthySince.slice(0, 10)}` },
  degraded: { label: 'DEGRADED', color: '#fbbf24', note: 'an availability zone is down' },
  'on-fire': { label: 'ON FIRE', color: '#fb7185', note: 'someone deployed on a Friday' }
}[state.status];
const FONT = "'Segoe UI','Inter',Helvetica,Arial,sans-serif";
const MONO = "'JetBrains Mono','SFMono-Regular',Consolas,monospace";
const SERIF = "'Instrument Serif',Georgia,serif";
const stats = [
  ['builds', state.build, '#7dd3fc'],
  ['deploys', state.deploys, '#34d399'],
  ['rollbacks', state.rollbacks, '#a78bfa'],
  ['chaos tests', state.chaos, '#fbbf24'],
  ['incidents', state.incidents, '#fb7185']
];
const cells = stats
  .map(([label, value, color], i) => {
    const x = 460 + i * 168;
    return `<text x="${x}" y="98" text-anchor="middle" font-family="${SERIF}" font-size="44" fill="${color}">${value}</text>
<text x="${x}" y="126" text-anchor="middle" font-family="${FONT}" font-size="14" fill="#aab6d6">${label}</text>`;
  })
  .join('\n');
writeFileSync(
  SVG,
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="190" viewBox="0 0 1200 190" role="img" aria-label="sanket-prod status: ${STATUS.label}. ${state.build} builds, ${state.deploys} deploys, ${state.rollbacks} rollbacks, ${state.chaos} chaos tests, ${state.incidents} incidents. Last change by ${esc(user)}.">
<style>.beat{animation:beat 1.6s ease-in-out infinite;transform-origin:62px 92px}@keyframes beat{50%{transform:scale(1.35);opacity:.55}}@media (prefers-reduced-motion: reduce){.beat{animation:none}}</style>
<rect x="1" y="1" width="1198" height="188" rx="16" fill="#0a0f22" stroke="${STATUS.color}" stroke-opacity="0.45"/>
<text x="40" y="44" font-family="${MONO}" font-size="14" fill="#8190b5">sanket-prod · live status · played by visitors</text>
<circle class="beat" cx="62" cy="92" r="12" fill="${STATUS.color}"/>
<text x="88" y="104" font-family="${SERIF}" font-size="42" fill="${STATUS.color}">${STATUS.label}</text>
<text x="40" y="146" font-family="${FONT}" font-size="15" fill="#aab6d6">${esc(STATUS.note)}</text>
<text x="40" y="170" font-family="${MONO}" font-size="13" fill="#8190b5">last change by @${esc(user)}</text>
<line x1="350" y1="40" x2="350" y2="160" stroke="#ffffff" stroke-opacity="0.1"/>
${cells}
</svg>
`
);

// -------------------------------------------------------------- README log
const ACTION = { ship: '🚀 ship', rollback: '⏪ rollback', chaos: '🐒 chaos' };
const rows = state.log
  .map((e) => `| #${e.build} | [@${e.user}](https://github.com/${e.user}) | ${ACTION[e.action]} | ${e.result} | ${e.at.slice(0, 10)} |`)
  .join('\n');
const table = `| Build | Who | Action | Result | Date |\n|---|---|---|---|---|\n${rows}`;
const readme = readFileSync(README, 'utf8');
writeFileSync(README, readme.replace(/(<!-- PROD-LOG:START -->)[\s\S]*?(<!-- PROD-LOG:END -->)/, `$1\n${table}\n$2`));

writeFileSync(
  'reply.md',
  `${result}\n\nThanks for playing, @${user}! Your change is in the [release log](https://github.com/realsanket) on my profile.\n\n<sub>This issue was handled by a GitHub Actions pipeline and closes itself.</sub>`
);
console.log(result);
