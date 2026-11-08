importScripts("https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.js");

let pyodideReadyPromise;
const inputParams = new URL(self.location.href).searchParams;
const inputClientId = inputParams.get('client_id') || '';
const inputOwnerId = inputParams.get('owner') || '';
const WORKSPACE_ROOT = '/home/pyglide';
let previousWorkspacePaths = new Set();

async function syncWorkspace(pyodide, workspace) {
    if (!workspace) return undefined;
    const safePath = path => typeof path === 'string' && path.split('/').every(
        part => part && part !== '.' && part !== '..' && !part.includes('\\') && !part.includes('\0')
    );
    const files = workspace.files || [];
    if (!safePath(workspace.filename) || files.some(file => !safePath(file.path) || typeof file.content !== 'string')) {
        throw new Error('Invalid workspace paths. Rename the affected files and retry.');
    }
    const next = new Set(files.map(file => WORKSPACE_ROOT + '/' + file.path));
    for (const path of previousWorkspacePaths) {
        if (!next.has(path)) pyodide.FS.unlink(path);
    }
    for (const file of files) {
        const path = WORKSPACE_ROOT + '/' + file.path;
        pyodide.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
        pyodide.FS.writeFile(path, file.content, { encoding: 'utf8' });
    }
    previousWorkspacePaths = next;
    const filename = WORKSPACE_ROOT + '/' + workspace.filename;
    const directory = filename.slice(0, filename.lastIndexOf('/'));
    pyodide.FS.mkdirTree(directory);
    pyodide.globals.set('__pyglide_directory__', directory);
    pyodide.globals.set('__pyglide_root__', WORKSPACE_ROOT);
    await pyodide.runPythonAsync(`
import os as __pyglide_os, sys as __pyglide_sys, importlib as __pyglide_importlib
__pyglide_os.chdir(__pyglide_directory__)
__pyglide_sys.path[:] = [__pyglide_directory__, __pyglide_root__] + [
    p for p in __pyglide_sys.path if p not in (__pyglide_directory__, __pyglide_root__)
]
__pyglide_importlib.invalidate_caches()
`);
    return filename;
}

async function initPyodide() {
    const pyodide = await loadPyodide({
        indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.0/full/"
    });
    
    self.printToTerminal = (type, msg) => {
        postMessage({ type, msg });
    };

    await pyodide.runPythonAsync(`
import sys
from js import printToTerminal

class CustomStream:
    def __init__(self, type_name):
        self.type_name = type_name
    def write(self, text):
        if text:
            printToTerminal(self.type_name, text)
    def flush(self):
        pass

sys.stdout = CustomStream('stdout')
sys.stderr = CustomStream('stderr')
    `);
    
    pyodide.setStdin({
        stdin: () => {
            
            if (!inputClientId || !inputOwnerId) {
                throw new Error('Interactive input needs a service worker. Reload this page over HTTPS or localhost and retry.');
            }
            const uid = crypto.randomUUID();
            
            // Perform a synchronous XHR to the Service Worker
            const xhr = new XMLHttpRequest();
            const params = new URLSearchParams({ uid, client_id: inputClientId, owner: inputOwnerId });
            xhr.open('GET', '/__pyglide_input__?' + params, false);
            
            try {
                xhr.send(null);
                if (xhr.status === 200) {
                    return xhr.responseText;
                }
            } catch(e) {
                console.error("XHR Sync Input Error:", e);
            }
            throw new Error('Input request expired. Stop and run the program again.');
        }
    });
    
    return pyodide;
}

pyodideReadyPromise = initPyodide().then(pyodide => {
    postMessage({ type: 'ready' });
    return pyodide;
}).catch(error => {
    postMessage({ type: 'init_error', error: String(error) });
    return null;
});

self.onmessage = async (e) => {
    const pyodide = await pyodideReadyPromise;
    const { id, type, code, workspace } = e.data;
    if (!pyodide) {
        postMessage({ type: 'error', id, error: 'Python runtime is unavailable. Retry the runtime before running code.' });
        return;
    }
    
    if (type === 'run') {
        try {
            const filename = await syncWorkspace(pyodide, workspace);
            // First check for syntax errors / compile
            pyodide.globals.set('__preflight_code__', code);
            await pyodide.runPythonAsync("compile(__preflight_code__, '<user_code>', 'exec')");
            
            // Execute
            await pyodide.runPythonAsync(code, filename ? { filename } : undefined);
            postMessage({ type: 'done', id });
        } catch (error) {
            postMessage({ type: 'error', id, error: error.toString() });
        }
    } else if (type === 'repl') {
        try {
            await syncWorkspace(pyodide, workspace);
            const result = await pyodide.runPythonAsync(code);
            postMessage({ type: 'done', id, result: result !== undefined ? String(result) : undefined });
        } catch (error) {
            postMessage({ type: 'error', id, error: error.toString() });
        }
    }
};
