import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import { registerPythonCompletions } from './python-completion.js';
import { observeFontMetrics } from './font-metrics.js';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
const pythonCompletions = registerPythonCompletions(monaco);
const stopFontObserver = observeFontMetrics(document.fonts, () => monaco.editor.remeasureFonts());
if (import.meta.hot) import.meta.hot.dispose(() => {
    pythonCompletions.dispose();
    stopFontObserver();
});
window.monaco = monaco;
window.dispatchEvent(new Event('pyglide-monaco-ready'));
