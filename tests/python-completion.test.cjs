const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const moduleURL = pathToFileURL(path.join(__dirname, '..', 'src/python-completion.js')).href;
const kinds = Object.fromEntries(['Function', 'Variable', 'Class', 'Module', 'Keyword', 'Snippet'].map(name => [name, name]));
const monaco = { languages: { CompletionItemKind: kinds, CompletionItemInsertTextRule: { InsertAsSnippet: 4 } } };

function model(initial) {
  let text = initial;
  let version = 1;
  let reads = 0;
  const lines = () => text.split('\n');
  return {
    getValueLength: () => text.length,
    getVersionId: () => version,
    getValue() { reads++; return text; },
    getOffsetAt: position => lines().slice(0, position.lineNumber - 1).reduce((count, line) => count + line.length + 1, 0) + position.column - 1,
    getLineContent: line => lines()[line - 1],
    getWordUntilPosition(position) {
      const before = lines()[position.lineNumber - 1].slice(0, position.column - 1);
      const word = before.match(/[A-Za-z_]\w*$/)?.[0] || '';
      return { word, startColumn: position.column - word.length, endColumn: position.column };
    },
    getWordAtPosition(position) {
      const line = lines()[position.lineNumber - 1];
      for (const match of line.matchAll(/[A-Za-z_]\w*/g)) {
        if (position.column - 1 >= match.index && position.column - 1 <= match.index + match[0].length) {
          return { word: match[0], startColumn: match.index + 1, endColumn: match.index + match[0].length + 1 };
        }
      }
      return null;
    },
    change(next) { text = next; version++; },
    reads: () => reads,
  };
}

async function setup(text) {
  const { createPythonCompletionProvider } = await import(moduleURL);
  return { provider: createPythonCompletionProvider(monaco), doc: model(text) };
}
const end = doc => ({ lineNumber: doc.getValue().split('\n').length,
  column: doc.getValue().split('\n').at(-1).length + 1 });
const suggest = (provider, doc, position = end(doc)) => provider.provideCompletionItems(doc, position).suggestions;
const names = list => list.map(item => typeof item.label === 'string' ? item.label : item.label.label);

test('pri offers print with help and replaces only the typed identifier', async () => {
  const { provider, doc } = await setup('    pri');
  const print = suggest(provider, doc).find(item => item.label === 'print');
  assert.ok(print);
  assert.equal(print.kind, 'Function');
  assert.equal(print.insertText, 'print');
  assert.match(print.documentation, /console/);
  assert.deepEqual(print.range, { startLineNumber: 1, endLineNumber: 1, startColumn: 5, endColumn: 8 });
});

test('completion in the middle of a word preserves existing parentheses and surrounding code', async () => {
  const { provider, doc } = await setup('value = prnt("hello")');
  const print = suggest(provider, doc, { lineNumber: 1, column: 11 }).find(item => item.label === 'print');
  assert.ok(print);
  const line = doc.getLineContent(1);
  const result = line.slice(0, print.range.startColumn - 1) + print.insertText + line.slice(print.range.endColumn - 1);
  assert.equal(result, 'value = print("hello")');
});

test('functions, classes, parameters, variables, loop targets and aliases come from the current file', async () => {
  const { provider, doc } = await setup([
    'import numpy as np',
    'from math import sqrt as root',
    'async def greet(name: str, count=1, *args, **kwargs):',
    '    total: int = count',
    '    for index, item in enumerate(args):',
    '        pass',
    'class Greeter:',
    '    pass',
    'left, right = (1, 2)',
    '',
  ].join('\n'));
  const list = suggest(provider, doc);
  for (const name of ['np', 'root', 'greet', 'name', 'count', 'args', 'kwargs', 'total', 'index', 'item', 'Greeter', 'left', 'right']) {
    assert.ok(names(list).includes(name), name);
  }
  assert.equal(list.find(item => item.label === 'greet').kind, 'Function');
  assert.equal(list.find(item => item.label === 'Greeter').kind, 'Class');
  assert.equal(list.find(item => item.label === 'np').kind, 'Module');
  assert.equal(list.find(item => item.label === 'int').detail, 'Python built-in');
});

test('comments and string contents do not become declared names', async () => {
  const { provider, doc } = await setup('# def phantom(value):\ntext = "def imaginary(arg):"\n"""def hidden(secret):\nfake = 1\n"""\n');
  const list = names(suggest(provider, doc));
  for (const name of ['phantom', 'value', 'imaginary', 'arg', 'hidden', 'secret', 'fake']) assert.equal(list.includes(name), false, name);
  assert.ok(list.includes('text'));
});

test('manual completion is suppressed inside comments and closed, open, multiline or escaped strings', async () => {
  for (const text of ['# pri', 'value = "pri', "value = 'pri", '"""example\npri', "'''example\npri", 'value = "escaped \\" pri']) {
    const { provider, doc } = await setup(text);
    assert.deepEqual(suggest(provider, doc), [], text);
  }
  const { provider, doc } = await setup('value = "pri"');
  assert.deepEqual(suggest(provider, doc, { lineNumber: 1, column: 13 }), []);
});

test('no globals are suggested as members or imported-library exports', async () => {
  for (const text of ['text.pri', 'text. pri', 'from math import pri', 'import pri']) {
    const { provider, doc } = await setup(text);
    assert.deepEqual(suggest(provider, doc), [], text);
  }
});

test('templates appear at statement boundaries with editable tab stops', async () => {
  const { provider, doc } = await setup('    fo');
  const loop = suggest(provider, doc).find(item => item.label === 'for loop');
  assert.ok(loop);
  assert.equal(loop.insertText, 'for ${1:item} in ${2:items}:\n\t$0');
  assert.equal(loop.insertTextRules, 4);
  doc.change('result = fo');
  assert.equal(names(suggest(provider, doc)).includes('for loop'), false);
});

test('local shadowing produces one item, not a duplicate built-in', async () => {
  const { provider, doc } = await setup('def print(value):\n    pass\npri');
  const list = suggest(provider, doc).filter(item => item.label === 'print');
  assert.equal(list.length, 1);
  assert.equal(list[0].detail, 'Defined in this file');
});

test('editing or switching the model invalidates names without leaking the previous file', async () => {
  const { provider, doc } = await setup('old_name = 1\n');
  suggest(provider, doc);
  const before = doc.reads();
  provider.provideCompletionItems(doc, { lineNumber: 2, column: 1 });
  assert.equal(doc.reads(), before);
  doc.change('new_name = 2\n');
  const list = names(suggest(provider, doc));
  assert.ok(list.includes('new_name'));
  assert.equal(list.includes('old_name'), false);
});

test('large documents and cancelled requests avoid scanning source', async () => {
  const { provider, doc } = await setup('x'.repeat(250001));
  assert.deepEqual(provider.provideCompletionItems(doc, { lineNumber: 1, column: 2 }).suggestions, []);
  assert.equal(doc.reads(), 0);
  doc.change('pri');
  assert.deepEqual(provider.provideCompletionItems(doc, { lineNumber: 1, column: 4 }, {}, { isCancellationRequested: true }).suggestions, []);
  assert.equal(doc.reads(), 0);
});

test('malformed incomplete function definitions stay bounded and still offer built-ins', async () => {
  const { provider, doc } = await setup('def unfinished(\n'.repeat(2000) + '\npri');
  assert.ok(names(suggest(provider, doc)).includes('print'));
});

test('registers a Python-only provider with a disposable lifecycle', async () => {
  const { registerPythonCompletions } = await import(moduleURL);
  const disposable = { dispose() {} };
  let language;
  const result = registerPythonCompletions({ languages: { ...monaco.languages,
    registerCompletionItemProvider(id, provider) {
      language = id;
      assert.equal(typeof provider.provideCompletionItems, 'function');
      return disposable;
    },
  } });
  assert.equal(language, 'python');
  assert.equal(result, disposable);
});
