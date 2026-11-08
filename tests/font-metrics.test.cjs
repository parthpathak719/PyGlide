const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const moduleURL = pathToFileURL(path.join(__dirname, '..', 'src/font-metrics.js')).href;
const settle = () => new Promise(resolve => setImmediate(resolve));

function fontSet() {
    const fonts = new EventTarget();
    fonts.ready = new Promise((resolve, reject) => { fonts.finish = resolve; fonts.fail = reject; });
    return fonts;
}

test('late web fonts refresh cached metrics without blocking startup', async () => {
    const { observeFontMetrics } = await import(moduleURL);
    const fonts = fontSet();
    let refreshes = 0;
    const dispose = observeFontMetrics(fonts, () => refreshes++);
    assert.equal(typeof dispose, 'function');
    assert.equal(refreshes, 0);
    fonts.finish();
    await settle();
    assert.equal(refreshes, 1);
    fonts.dispatchEvent(new Event('loadingdone'));
    assert.equal(refreshes, 2);
    dispose();
});

test('cached fonts also refresh measurements', async () => {
    const { observeFontMetrics } = await import(moduleURL);
    let refreshes = 0;
    const dispose = observeFontMetrics({ ready: Promise.resolve() }, () => refreshes++);
    await settle();
    assert.equal(refreshes, 1);
    dispose();
});

test('failed fonts refresh fallback metrics without an unhandled rejection', async () => {
    const { observeFontMetrics } = await import(moduleURL);
    const fonts = fontSet();
    let refreshes = 0;
    const dispose = observeFontMetrics(fonts, () => refreshes++);
    fonts.fail(new Error('offline font'));
    await settle();
    assert.equal(refreshes, 1);
    fonts.dispatchEvent(new Event('loadingerror'));
    assert.equal(refreshes, 2);
    dispose();
});

test('disposal ignores a pending font load and later font events', async () => {
    const { observeFontMetrics } = await import(moduleURL);
    const fonts = fontSet();
    let refreshes = 0;
    const dispose = observeFontMetrics(fonts, () => refreshes++);
    dispose();
    fonts.finish();
    fonts.dispatchEvent(new Event('loadingdone'));
    fonts.dispatchEvent(new Event('loadingerror'));
    await settle();
    assert.equal(refreshes, 0);
});

test('browsers without the font API can start normally', async () => {
    const { observeFontMetrics } = await import(moduleURL);
    const dispose = observeFontMetrics(undefined, () => assert.fail('unexpected refresh'));
    dispose();
});
