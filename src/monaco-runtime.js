import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import { registerPythonCompletions } from './python-completion.js';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
const pythonCompletions = registerPythonCompletions(monaco);
if (import.meta.hot) import.meta.hot.dispose(() => pythonCompletions.dispose());
window.monaco = monaco;
window.dispatchEvent(new Event('pyglide-monaco-ready'));
