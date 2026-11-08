// Lightweight, browser-only completion. This is not Python type/scope analysis.
const MAX_SOURCE_LENGTH = 250000;
const MAX_SYMBOLS = 500;
const MAX_SUGGESTIONS = 200;
const KEYWORDS = new Set(('False None True and as assert async await break class continue def del elif else ' +
  'except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case').split(' '));
const BUILTINS = ('abs all any ascii bin bool breakpoint bytearray bytes callable chr classmethod complex dict dir ' +
  'divmod enumerate filter float format frozenset getattr globals hasattr hash help hex id input int isinstance ' +
  'issubclass iter len list locals map max memoryview min next object oct open ord pow print property range repr ' +
  'reversed round set setattr slice sorted staticmethod str sum super tuple type vars zip').split(' ');
const TYPES = new Set('bool bytearray bytes complex dict float frozenset int list memoryview object range set slice str tuple type'.split(' '));
const EXCEPTIONS = ('Exception AssertionError AttributeError FileNotFoundError ImportError IndexError KeyError ' +
  'ModuleNotFoundError NameError RuntimeError StopIteration TypeError ValueError ZeroDivisionError').split(' ');
const HELP = {
  print: 'Write values to the console.',
  input: 'Read a line from the interactive console.',
  len: 'Return the number of items in a value.',
  range: 'Generate a sequence of integers.',
  enumerate: 'Iterate over index/value pairs.',
  zip: 'Iterate over matching items from multiple iterables.',
  sorted: 'Return a new sorted list.',
  sum: 'Add the values from an iterable.',
  open: 'Open a file in the browser Python filesystem.',
};
const SNIPPETS = [
  ['def', 'def function', 'def ${1:function_name}(${2}):\n\t$0', 'Define a function.'],
  ['class', 'class definition', 'class ${1:ClassName}:\n\t$0', 'Define a class.'],
  ['for', 'for loop', 'for ${1:item} in ${2:items}:\n\t$0', 'Iterate over a sequence.'],
  ['if', 'if block', 'if ${1:condition}:\n\t$0', 'Run a conditional block.'],
  ['while', 'while loop', 'while ${1:condition}:\n\t$0', 'Repeat while a condition is true.'],
  ['try', 'try / except', 'try:\n\t${1:pass}\nexcept ${2:Exception} as ${3:error}:\n\t$0', 'Handle an exception.'],
  ['ifmain', 'if __name__ main', 'if __name__ == "__main__":\n\t$0', 'Run code when this file is the entry point.'],
];
const IDENTIFIER = /^[A-Za-z_]\w*$/;
const NON_CODE = /'''(?:\\[\s\S]?|(?!''')[^\\])*(?:'''|$)|"""(?:\\[\s\S]?|(?!""")[^\\])*(?:"""|$)|"(?:\\[\s\S]?|[^"\\\r\n])*"?|'(?:\\[\s\S]?|[^'\\\r\n])*'?|#[^\r\n]*/g;

function analyzeSource(source) {
  const excluded = [];
  const code = source.replace(NON_CODE, (text, start) => {
    const delimiter = text.startsWith("'''") || text.startsWith('"""') ? text.slice(0, 3) : text[0];
    const closing = text.length - delimiter.length;
    let slashes = 0;
    for (let i = closing - 1; i >= 0 && text[i] === '\\'; i--) slashes++;
    const closed = delimiter !== '#' && text.length >= delimiter.length * 2 &&
      text.endsWith(delimiter) && slashes % 2 === 0;
    excluded.push({ start, end: start + text.length, open: !closed });
    return text.replace(/[^\r\n]/g, ' ');
  });
  const symbols = new Map();
  const add = (name, kind = 'Variable') => {
    if (!IDENTIFIER.test(name) || KEYWORDS.has(name) || symbols.size >= MAX_SYMBOLS) return;
    const priority = { Variable: 0, Module: 1, Function: 2, Class: 2 };
    if (!symbols.has(name) || priority[kind] > priority[symbols.get(name)]) symbols.set(name, kind);
  };
  // Definitions and their parameter names. Nested defaults/annotations are
  // skipped so commas inside a call or type don't become new parameters.
  let parameterTokens = 20000;
  for (const match of code.matchAll(/\b(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/g)) {
    add(match[1], 'Function');
    if (parameterTokens <= 0) continue;
    const start = match.index + match[0].length;
    const tail = code.slice(start, start + 2000);
    let depth = 1;
    let parameter = true;
    for (const token of tail.matchAll(/[A-Za-z_]\w*|[^\s]/g)) {
      if (--parameterTokens < 0) break;
      const value = token[0];
      if ('([{'.includes(value)) depth++;
      else if (')]}'.includes(value)) { if (--depth === 0) break; }
      else if (depth === 1 && value === ',') parameter = true;
      else if (depth === 1 && parameter && IDENTIFIER.test(value)) {
        add(value);
        parameter = false;
      }
    }
    if (symbols.size >= MAX_SYMBOLS) break;
  }
  for (const match of code.matchAll(/\bclass\s+([A-Za-z_]\w*)/g)) add(match[1], 'Class');
  for (const match of code.matchAll(/^\s*([A-Za-z_]\w*(?:\s*,\s*\*?[A-Za-z_]\w*)*)\s*(?::[^=\n]+)?\s*=(?!=)/gm)) {
    match[1].split(',').forEach(name => add(name.trim().replace(/^\*/, '')));
    const tail = code.slice(match.index + match[0].length).split('\n', 1)[0];
    for (const chained of tail.matchAll(/(?:^|=)\s*([A-Za-z_]\w*)\s*=(?!=)/g)) add(chained[1]);
  }
  for (const match of code.matchAll(/\bfor\s+([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s+in\b/g)) {
    match[1].split(',').forEach(name => add(name.trim()));
  }
  for (const match of code.matchAll(/\bas\s+([A-Za-z_]\w*)/g)) add(match[1]);
  for (const match of code.matchAll(/^\s*import\s+([^\n;]+)/gm)) {
    for (const part of match[1].split(',')) {
      const imported = part.trim().match(/^([A-Za-z_]\w*)(?:\.[\w.]+)*(?:\s+as\s+([A-Za-z_]\w*))?$/);
      if (imported) add(imported[2] || imported[1], 'Module');
    }
  }
  for (const match of code.matchAll(/^\s*from\s+[\w.]+\s+import\s+(?:\(([\s\S]*?)\)|([^\n;]+))/gm)) {
    for (const part of (match[1] || match[2] || '').split(',')) {
      const imported = part.trim().match(/^([A-Za-z_]\w*)(?:\s+as\s+([A-Za-z_]\w*))?$/);
      if (imported) add(imported[2] || imported[1]);
    }
  }
  return { symbols, excluded };
}

export function createPythonCompletionProvider(monaco) {
  const cache = new WeakMap();
  const kinds = monaco.languages.CompletionItemKind;
  return {
    provideCompletionItems(model, position, _context, cancellation) {
      if (cancellation?.isCancellationRequested || model.getValueLength() > MAX_SOURCE_LENGTH) return { suggestions: [] };
      const version = model.getVersionId();
      let data = cache.get(model);
      if (!data || data.version !== version) {
        data = { version, ...analyzeSource(model.getValue()) };
        cache.set(model, data);
      }
      const offset = model.getOffsetAt(position);
      if (data.excluded.some(part => offset > part.start &&
        (offset < part.end || (offset === part.end && part.open)))) return { suggestions: [] };
      const word = model.getWordUntilPosition(position);
      const line = model.getLineContent(position.lineNumber);
      const before = line.slice(0, word.startColumn - 1);
      // Member/type-aware suggestions need a real language service. Do not
      // offer unrelated globals after a dot or while entering an import.
      if (/\.\s*$/.test(before) || /^\s*(?:from|import)\s/.test(before)) return { suggestions: [] };
      const fullWord = model.getWordAtPosition(position);
      const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
        startColumn: word.startColumn, endColumn: fullWord?.endColumn || position.column };
      const prefix = word.word.toLowerCase();
      const suggestions = [];
      const add = (name, kind, detail, sort = '1', insertText = name, extra = {}) => {
        if (!name.toLowerCase().startsWith(prefix)) return;
        suggestions.push({ label: name, kind: kinds[kind], detail, insertText, range,
          sortText: sort + ':' + name, ...extra });
      };
      for (const [name, kind] of data.symbols) add(name, kind, 'Defined in this file', '0');
      for (const name of BUILTINS) {
        if (data.symbols.has(name)) continue;
        add(name, TYPES.has(name) ? 'Class' : 'Function', 'Python built-in', '1', name,
          { documentation: HELP[name] || 'Python built-in name.' });
      }
      for (const name of EXCEPTIONS) {
        if (!data.symbols.has(name)) add(name, 'Class', 'Python exception');
      }
      for (const name of KEYWORDS) add(name, 'Keyword', 'Python keyword');
      if (/^\s*$/.test(before)) {
        for (const [trigger, label, insertText, documentation] of SNIPPETS) {
          if (!trigger.startsWith(prefix)) continue;
          suggestions.push({ label, kind: kinds.Snippet, detail: 'Python snippet',
            filterText: trigger, insertText, range, sortText: '2:' + trigger, documentation,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet });
        }
      }
      suggestions.sort((a, b) => a.sortText.localeCompare(b.sortText));
      return { suggestions: suggestions.slice(0, MAX_SUGGESTIONS), incomplete: true };
    },
  };
}

export function registerPythonCompletions(monaco) {
  return monaco.languages.registerCompletionItemProvider('python', createPythonCompletionProvider(monaco));
}
