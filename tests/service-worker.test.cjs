const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

function serviceWorker() {
  const handlers = {};
  const messages = { A: [], B: [] };
  const clients = Object.fromEntries(Object.keys(messages).map(id => [id, {
    id, type: 'window', postMessage: message => messages[id].push(message),
  }]));
  vm.runInNewContext(source, { URL, Response, self: {
    addEventListener: (name, callback) => { handlers[name] = callback; },
    clients: { get: async id => clients[id] },
  } });
  const input = (id, uid) => {
    let response;
    handlers.fetch({ request: { url: 'https://pyglide.test/__pyglide_input__?' +
      new URLSearchParams({ uid, client_id: id, owner: 'runtime-' + id }) },
      respondWith(value) { response = value; } });
    return response;
  };
  const provide = (clientId, uid, owner, value) => {
    let response;
    handlers.fetch({ clientId, request: { url: 'https://pyglide.test/__pyglide_provide_input__',
      formData: async () => new Map([['uid', uid], ['owner', owner], ['value', value]]) },
      respondWith(value) { response = value; } });
    return response;
  };
  return { handlers, messages, input, provide };
}

test('simultaneous tabs receive and answer only their own Python input', async () => {
  const sw = serviceWorker();
  const a = sw.input('A', 'request-A');
  const b = sw.input('B', 'request-B');
  await settle();
  assert.deepEqual(sw.messages.A.map(message => message.uid), ['request-A']);
  assert.deepEqual(sw.messages.B.map(message => message.uid), ['request-B']);
  assert.equal((await sw.provide('B', 'request-A', 'runtime-A', 'wrong tab')).status, 409);
  assert.equal((await sw.provide('A', 'request-A', 'stale-runtime', 'stale')).status, 409);
  assert.equal((await sw.provide('A', 'request-A', 'runtime-A', 'Alice')).status, 200);
  assert.equal(await (await a).text(), 'Alice');
  assert.equal((await sw.provide('B', 'request-B', 'runtime-B', 'Bob')).status, 200);
  assert.equal(await (await b).text(), 'Bob');
});

test('stop cancels only the matching window and runtime', async () => {
  const sw = serviceWorker();
  const a = sw.input('A', 'request-A');
  const b = sw.input('B', 'request-B');
  await settle();
  sw.handlers.message({ source: { id: 'A' }, data: { type: 'cancel_inputs', ownerId: 'runtime-A' } });
  assert.equal((await a).status, 410);
  assert.equal((await sw.provide('B', 'request-B', 'runtime-B', '')).status, 200);
  assert.equal(await (await b).text(), '');
});

test('input routing works after service-worker restart without an in-memory owner registry', async () => {
  const sw = serviceWorker();
  let identity;
  sw.handlers.message({ source: { id: 'A' }, data: { type: 'input_client_id' },
    ports: [{ postMessage: value => { identity = value.clientId; } }] });
  assert.equal(identity, 'A');
  const response = sw.input(identity, 'fresh-request');
  await settle();
  await sw.provide('A', 'fresh-request', 'runtime-A', 'works');
  assert.equal(await (await response).text(), 'works');
  assert.equal((await sw.input('closed-window', 'missing')).status, 410);
});
