# PyGlide — Python Web IDE with Semantic Log Debugging & Root Cause Analysis

A web-based Python IDE for writing code, running programs and understanding errors through AI-assisted root cause analysis.

PyGlide brings the editor, interactive console and debugging tools into one workspace. When a program fails, it shows the traceback, finds related bug patterns and explains possible causes and fixes. You can also upload an existing log for analysis.

**[Try the live IDE](https://pyglide-web.onrender.com/)**

## Features

- **Python editor** — syntax highlighting, autocomplete and code snippets.
- **Interactive execution** — browser-based Python, a console, `input()` support and Stop.
- **Root cause analysis** — traceback details, similar past bugs, suggested fixes and prevention tips.
- **Log debugger** — upload text logs, CSV files or Excel workbooks for analysis.
- **AI and translation** — Groq or local Ollama feedback, with optional Sarvam translation into Indian languages.
- **Flexible workspace** — files, folders, multiple tabs, resizable panels, saved work, ZIP downloads and usage statistics.

Built with **React, Monaco Editor, Pyodide and FastAPI**. Python code runs in the browser; the backend handles debugging, AI feedback and translation.

## Getting started

Install **Node.js 22.12+** and **Python 3.12** first. Internet access is needed to load the browser runtime and use cloud services.

### 1. Install the project

```bash
git clone https://github.com/parthpathak719/PyGlide.git
cd PyGlide
npm ci
python -m venv .venv
```

Activate the Python environment:

- **Windows PowerShell:** `.\.venv\Scripts\Activate.ps1`
- **macOS / Linux:** `source .venv/bin/activate`

Then install the backend dependencies and copy the configuration templates:

```bash
python -m pip install -r backend/requirements-hosted.txt
cp .env.example .env
cp backend/.env.example backend/.env
```

### 2. Configure AI feedback

To use Groq, update these settings:

| File | Setting |
| --- | --- |
| Root `.env` | `VITE_LLM_PROVIDER="groq"` |
| `backend/.env` | `LLM_PROVIDER="groq"` and your `GROQ_API_KEY` |

The default Groq model is `openai/gpt-oss-20b`. For translation, add `SARVAM_API_KEY` to `backend/.env`. Keep API keys in the backend file; the root `.env` contains public frontend settings.

You can also use **Ollama**: keep both provider settings as `ollama`, start `ollama serve`, then run `ollama pull qwen2.5-coder:1.5b` in another terminal. The toolbar also supports `llama3.2:1b` and `phi4-mini:latest`; pull a model before selecting it.

### 3. Start the app

Start the backend from the project root, with the Python environment activated:

```bash
python -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000
```

In a second terminal, start the frontend:

```bash
npm run dev
```

Open **[localhost:3000](http://localhost:3000)**. The backend runs on **[localhost:8000](http://localhost:8000)**.

## Using PyGlide

1. Open an example or create a Python file in the Explorer. The bundled examples intentionally demonstrate common errors.
2. Wait for **PYTHON READY**, then click **EXECUTE RUNTIME**. View output and answer `input()` prompts in the console.
3. If the program fails, review the **Root Cause Analysis** panel for the traceback, explanation and suggested repairs.
4. Use **LOG DEBUGGER** to inspect a log, or choose a language and click **CONVERT** after AI feedback finishes to translate it.

For a quick demonstration:

```python
name = input("Your name: ")
print(f"Hello, {name}!")
print(1 / 0)  # Try the error analysis.
```

### Editor and workspace tips

- Type `pri` to see suggestions such as `print`. Use the arrow keys to select one and `Tab` or `Enter` to accept it. `Ctrl+Space` opens suggestions manually. Basic completion covers built-ins and names in the current file.
- Drag panel edges to resize the workspace. Toggle Explorer, Console and Analysis from the toolbar; closing a panel preserves its contents.
- Use the sun/moon button to switch between light and dark themes. Your choice is saved in the current browser.
- Files and layout preferences are saved in the current browser. Use **Download Workspace** to export a ZIP; saved work does not sync between devices.
- Workspace files can import sibling modules and read relative data files. Third-party packages must be compatible with Pyodide.

## Hosting

The hosted setup uses **Render** for the frontend and API, **Groq** for AI feedback and optional **Supabase** storage for shared-example deletion records. Visitors run Python in their browsers, so your computer can stay off.

See the **[deployment guide](DEPLOYMENT.md)** for hosting steps, backend secrets and free-tier limits.
