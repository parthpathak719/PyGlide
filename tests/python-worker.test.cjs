const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'pyworker.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

function worker(load) {
  const messages = [];
  const context = { URL, URLSearchParams, crypto: require('node:crypto').webcrypto,
    location: { href: 'https://pyglide.test/pyworker.js?client_id=tab-A&owner=runtime-A' },
    importScripts() {}, loadPyodide: load, postMessage: value => messages.push(value) };
  context.self = context;
  vm.runInNewContext(source, context);
  return { context, messages };
}

test('runtime announces readiness only after Python initialization completes', async () => {
  let ready;
  const pending = new Promise(resolve => { ready = resolve; });
  const { messages } = worker(() => pending);
  assert.equal(messages.length, 0);
  ready({ globals: { set() {} }, async runPythonAsync() {}, setStdin() {} });
  await settle();
  assert.deepEqual(messages.map(message => message.type), ['ready']);
});

test('initialization failures are explicit and queued runs fail without hanging', async () => {
  const { context, messages } = worker(async () => { throw new Error('download failed'); });
  await settle();
  assert.equal(messages[0].type, 'init_error');
  await context.onmessage({ data: { type: 'run', id: 'run_main', code: 'print(1)' } });
  assert.equal(messages.at(-1).type, 'error');
  assert.equal(messages.at(-1).id, 'run_main');
});

test('execution errors retain their operation identity', async () => {
  const { context, messages } = worker(async () => ({ globals: { set() {} }, setStdin() {},
    async runPythonAsync(code) { if (code === 'bad code') throw new Error('SyntaxError: fixture'); } }));
  await settle();
  await context.onmessage({ data: { type: 'run', id: 'example-run', code: 'bad code' } });
  assert.equal(messages.at(-1).type, 'error');
  assert.equal(messages.at(-1).id, 'example-run');
});

test('workspace files and data are available beside the executed file, including edits and deletions', async () => {
  const disk = new Map();
  const calls = [];
  const runtime = {
    globals: { set() {} }, setStdin() {},
    FS: { mkdirTree() {}, writeFile: (path, text) => disk.set(path, text), unlink: path => disk.delete(path) },
    async runPythonAsync(code, options) { calls.push({ code, options }); },
  };
  const { context, messages } = worker(async () => runtime);
  await settle();
  const workspace = { filename: 'project/main.py', files: [
    { path: 'project/main.py', content: 'import helper' },
    { path: 'project/helper.py', content: 'answer = 42' },
    { path: 'project/data.txt', content: 'hello' },
  ] };
  await context.onmessage({ data: { type: 'run', id: 'workspace', code: 'import helper', workspace } });
  assert.equal(disk.get('/home/pyglide/project/helper.py'), 'answer = 42');
  assert.equal(disk.get('/home/pyglide/project/data.txt'), 'hello');
  assert.equal(calls.at(-1).options.filename, '/home/pyglide/project/main.py');
  workspace.files = [{ path: 'project/main.py', content: 'print(2)' }];
  await context.onmessage({ data: { type: 'run', id: 'edited', code: 'print(2)', workspace } });
  assert.equal(disk.get('/home/pyglide/project/main.py'), 'print(2)');
  assert.equal(disk.has('/home/pyglide/project/helper.py'), false);
  assert.equal(messages.at(-1).type, 'done');
});

test('workspace paths cannot escape the dedicated Python workspace', async () => {
  const { context, messages } = worker(async () => ({
    globals: { set() {} }, setStdin() {}, async runPythonAsync() {},
    FS: { writeFile() { throw new Error('must not write'); } },
  }));
  await settle();
  await context.onmessage({ data: { type: 'run', id: 'invalid', code: '', workspace: {
    filename: '../main.py', files: [{ path: '../main.py', content: '' }],
  } } });
  assert.equal(messages.at(-1).type, 'error');
  assert.match(messages.at(-1).error, /Invalid workspace paths/);
});
