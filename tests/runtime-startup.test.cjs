const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const parser = require('@babel/parser');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = html.match(/<script type="text\/babel">([\s\S]*?)<\/script>/)[1];
const ast = parser.parse(source, { plugins: ['jsx'] });
const declaration = ast.program.body.find(node => node.type === 'VariableDeclaration' &&
  node.declarations.some(item => item.id.name === 'runtimeServiceWorkerController'));
const context = vm.createContext({ setTimeout, clearTimeout });
const connect = vm.runInContext(source.slice(declaration.start, declaration.end) +
  '\nruntimeServiceWorkerController', context);
const settle = () => new Promise(resolve => setImmediate(resolve));

function container() {
  const listeners = new Set();
  let ready;
  const sw = {
    controller: null,
    ready: new Promise(resolve => { ready = resolve; }),
    addEventListener: (_, callback) => listeners.add(callback),
    removeEventListener: (_, callback) => listeners.delete(callback),
    registration: { active: null },
    register: async () => sw.registration,
    control(controller) {
      sw.controller = controller;
      [...listeners].forEach(callback => callback());
    },
    activate(active) {
      sw.registration.active = active;
      ready(sw.registration);
    },
    listenerCount: () => listeners.size,
  };
  return sw;
}

test('hard refresh reconnects through the already active service worker', async () => {
  const sw = container();
  const active = { postMessage(message) {
    assert.equal(message.type, 'claim_runtime_clients');
    sw.control(active);
  } };
  sw.registration.active = active;
  assert.equal(await connect(sw, 100), active);
  assert.equal(sw.listenerCount(), 0);
});

test('first visit waits for installation and activation, then connects', async () => {
  const sw = container();
  const active = { postMessage() { sw.control(active); } };
  const pending = connect(sw, 100);
  await settle();
  assert.equal(sw.controller, null);
  sw.activate(active);
  assert.equal(await pending, active);
  assert.equal(sw.listenerCount(), 0);
});

test('normal reload starts immediately with its existing controller', async () => {
  const sw = container();
  const active = {};
  sw.controller = active;
  assert.equal(await connect(sw, 100), active);
  assert.equal(sw.listenerCount(), 0);
});

test('missing controller is an actionable timeout, never an indefinite loading state', async () => {
  const sw = container();
  sw.registration.active = { postMessage() {} };
  await assert.rejects(connect(sw, 20), /RETRY RUNTIME/);
  assert.equal(sw.listenerCount(), 0);
});

test('registration failures reject promptly and a later retry can reconnect', async () => {
  const sw = container();
  sw.register = async () => { throw new Error('registration unavailable'); };
  await assert.rejects(connect(sw, 100), /registration unavailable/);
  assert.equal(sw.listenerCount(), 0);
  const active = { postMessage() { sw.control(active); } };
  sw.register = async () => ({ active });
  assert.equal(await connect(sw, 100), active);
});

test('browsers without service-worker support can still initialize Python', async () => {
  assert.equal(await connect(undefined), null);
});
