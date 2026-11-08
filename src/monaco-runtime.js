import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
window.monaco = monaco;
window.dispatchEvent(new Event('pyglide-monaco-ready'));
