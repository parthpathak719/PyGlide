const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const parser = require('@babel/parser');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = html.match(/<script type="text\/babel">([\s\S]*?)<\/script>/)[1];
const ast = parser.parse(source, { plugins: ['jsx'] });
let refresh;
function walk(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'VariableDeclarator' && node.id.name === 'refreshExamples') refresh = node.init;
  Object.values(node).forEach(value => Array.isArray(value) ? value.forEach(walk) : walk(value));
}
walk(ast);

async function refreshError(fetch) {
  let message = '';
  const context = vm.createContext({
    AbortController, TypeError, EXAMPLES_API: '/examples', IS_HOSTED_AI: true,
    deletingRef: { current: false }, examplesRequestRef: { current: null },
    setExamplesLoading() {}, setExamplesError(value) { message = value; }, fetch,
  });
  await vm.runInContext('(' + source.slice(refresh.start, refresh.end) + ')()', context);
  return message;
}

test('Supabase errors preserve their actionable cause', async () => {
  const message = await refreshError(async () => ({ ok: false, json: async () => ({
    detail: 'Example storage is unavailable. Check Supabase and retry.',
  }) }));
  assert.match(message, /Check Supabase/);
  assert.doesNotMatch(message, /waking/);
});

test('only a connection failure uses hosted wake-up guidance', async () => {
  const message = await refreshError(async () => { throw new TypeError('Failed to fetch'); });
  assert.match(message, /waking up/);
});

test('an HTML gateway error gives a useful error instead of an uncaught JSON failure', async () => {
  const message = await refreshError(async () => ({ ok: false, json: async () => { throw new SyntaxError('HTML'); } }));
  assert.equal(message, 'Could not load the example files.');
});
