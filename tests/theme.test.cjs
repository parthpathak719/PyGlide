const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = html.match(/<script id="pyglide-theme">([\s\S]*?)<\/script>/)[1];

function start(saved, blocked = false) {
    const values = new Map(saved === undefined ? [] : [['pyglide_theme', saved]]);
    const root = { dataset: {}, style: {} };
    const meta = {};
    const window = {};
    const document = {
        documentElement: root,
        querySelector: () => ({ setAttribute: (key, value) => { meta[key] = value; } })
    };
    const localStorage = {
        getItem(key) { if (blocked) throw new Error('Storage denied'); return values.get(key) ?? null; },
        setItem(key, value) { if (blocked) throw new Error('Storage denied'); values.set(key, value); }
    };
    vm.runInNewContext(source, { window, document, localStorage });
    return { theme: window.PyGlideTheme, root, meta, values };
}

test('first visit has a dark theme before React and editor startup', () => {
    const state = start();
    assert.equal(state.theme.current(), 'dark');
    assert.equal(state.root.style.colorScheme, 'dark');
    assert.equal(state.meta.content, 'dark');
    assert.equal(state.values.size, 0);
});

test('saved light preference applies before the interface renders', () => {
    const state = start('light');
    assert.equal(state.root.dataset.theme, 'light');
    assert.equal(state.root.style.colorScheme, 'light');
    assert.equal(state.meta.content, 'light');
});

test('switches persist and are restored by a later page load', () => {
    const state = start();
    state.theme.apply('light');
    assert.equal(start(state.values.get('pyglide_theme')).theme.current(), 'light');
    state.theme.apply('dark');
    assert.equal(state.root.dataset.theme, 'dark');
    assert.equal(state.root.style.colorScheme, 'dark');
    assert.equal(state.meta.content, 'dark');
    assert.equal(start(state.values.get('pyglide_theme')).theme.current(), 'dark');
});

test('an invalid preference and denied browser storage do not prevent switching', () => {
    assert.equal(start('invalid').theme.current(), 'dark');
    const state = start('light', true);
    assert.equal(state.theme.current(), 'dark');
    assert.doesNotThrow(() => state.theme.apply('light'));
    assert.equal(state.theme.current(), 'light');
    assert.equal(state.root.style.colorScheme, 'light');
});
