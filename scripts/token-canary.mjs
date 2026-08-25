#!/usr/bin/env node
/**
 * Verifies that a server-side token never becomes browser-visible.
 *
 * Build and start the server with a *fake* token, then run this against it. It
 * checks page responses, response headers, every JavaScript and CSS chunk the
 * page actually loads, and the API payloads.
 *
 *     CANARY=ghp_not_a_real_token_0000000000000000000
 *     GITHUB_TOKEN=$CANARY npm run build
 *     GITHUB_TOKEN=$CANARY npx next start -p 3411 &
 *     RTM_CANARY=$CANARY RTM_BASE_URL=http://127.0.0.1:3411 npm run token-canary
 *
 * Never run it with a real token.
 */

const CANARY = process.env.RTM_CANARY;
const BASE = process.env.RTM_BASE_URL ?? 'http://127.0.0.1:3411';
if (!CANARY) throw new Error('RTM_CANARY is required');

let fail = 0;
const check = (name, leaked) => {
  console.log(`${leaked ? 'FAIL' : 'PASS'} ${name}`);
  if (leaked) fail += 1;
};

const paths = [
  '/',
  '/?repo=demo%2Flearning-platform',
  '/api/gh/repo?owner=demo&repo=learning-platform',
  '/api/gh/commits?owner=demo&repo=learning-platform&page=1',
  '/api/gh/tags?owner=demo&repo=learning-platform',
  '/api/gh/repo?owner=rtm-fixtures&repo=sample-app',
];

for (const path of paths) {
  const response = await fetch(`${BASE}${path}`);
  const body = await response.text();
  const headers = [...response.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n');
  check(`response ${path}`, body.includes(CANARY) || headers.includes(CANARY));
}

const html = await (await fetch(`${BASE}/?repo=demo%2Flearning-platform`)).text();
const chunks = [...new Set([...html.matchAll(/\/_next\/static\/[^"']+\.(?:js|css)/g)].map((m) => m[0]))];
let leaked = 0;
for (const chunk of chunks) {
  const text = await (await fetch(`${BASE}${chunk}`)).text();
  if (text.includes(CANARY)) {
    console.log(`FAIL canary in ${chunk}`);
    leaked += 1;
  }
}
check(`${chunks.length} browser JS/CSS chunks`, leaked > 0);

const repo = await (await fetch(`${BASE}/api/gh/repo?owner=demo&repo=learning-platform`)).json();
console.log(
  `\nexposed metadata only: tokenConfigured=${repo.data.tokenConfigured} dataSource=${repo.data.meta.dataSource} rateLimit=${JSON.stringify(repo.rateLimit)}`,
);
const keys = Object.keys(repo.data).concat(Object.keys(repo));
console.log(`payload keys: ${[...new Set(keys)].join(', ')}`);

console.log(fail === 0 ? '\nno canary anywhere browser-visible' : `\n${fail} leak(s)`);
process.exit(fail === 0 ? 0 : 1);
