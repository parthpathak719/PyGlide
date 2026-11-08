# PyGlide

A web-based Python IDE for writing code, running programs and understanding errors through AI-assisted root cause analysis.

**[Try the live IDE](https://pyglide-web.onrender.com/)**

## Features

- Python editor with syntax highlighting, autocomplete and code snippets.
- Multi-file workspace and an interactive console with `input()` support.
- Error analysis with traceback details, similar past bugs and suggested fixes.
- Log debugging, including text, CSV and Excel uploads.
- AI feedback through Groq or local Ollama models, with optional Sarvam translation.
- Resizable dark interface, saved workspaces, ZIP downloads and usage statistics.

Built with React, Monaco Editor, Pyodide and FastAPI.

## Getting started

Install **Node.js 22.12+** and **Python 3.12** first.

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

For translation, add `SARVAM_API_KEY` to `backend/.env`. Keep API keys in the backend file.

You can also use Ollama: keep both provider settings as `ollama`, start `ollama serve`, then run `ollama pull qwen2.5-coder:1.5b` in another terminal.

### 3. Start the app

Start the backend from the project root, with the Python environment activated:

```bash
python -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000
```

In a second terminal, start the frontend:

```bash
npm run dev
```

Open **[localhost:3000](http://localhost:3000)**, select or create a Python file, wait for **PYTHON READY**, and click **EXECUTE RUNTIME**. Use **LOG DEBUGGER** to upload a log instead.

For hosting on Render with Groq and optional Supabase storage, see the [deployment guide](DEPLOYMENT.md).
