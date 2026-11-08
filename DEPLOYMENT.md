# Host PyGlide for ₹0 with your computer off

Use a **Render Static Site** for the IDE and a **Render Free Web Service** for FastAPI. AI feedback uses the **Groq Free plan**. Supabase Free is optional unless you need shared example deletions to survive restarts.

The editor runs Python in each visitor's browser through Pyodide. Your computer and Ollama do not need to run after deployment. AI feedback sends code/error context to Groq; workspace files remain in that browser's local storage, so they do not sync between devices. Supported Python packages are those available in Pyodide, not arbitrary server-installed packages.

## 1. Publish this version to GitHub

The Render services must use the Git branch containing these deployment changes in `parthpathak719/PyGlide`. Do not upload `.env`, API keys, virtual environments, `node_modules`, or generated vector indexes. Those paths are ignored.

## 2. Create the backend on Render

In [Render Dashboard](https://dashboard.render.com), choose **New → Web Service**, connect the PyGlide repository, and select the branch containing this setup.

| Setting | Value |
| --- | --- |
| Runtime | Python 3 |
| Root Directory | Leave blank |
| Build Command | `pip install -r backend/requirements-hosted.txt` |
| Start Command | `uvicorn main:app --app-dir backend --host 0.0.0.0 --port $PORT` |
| Instance Type | **Free** |
| Health Check Path | `/health` |

Add these backend environment variables:

| Name | Value |
| --- | --- |
| `PYTHON_VERSION` | `3.12.8` |
| `PYGLIDE_HOSTED` | `true` |
| `LLM_PROVIDER` | `groq` |
| `GROQ_API_KEY` | Your key from [Groq Console](https://console.groq.com/keys) |
| `GROQ_MODEL` | `openai/gpt-oss-20b` |
| `SEMANTIC_DEBUGGER_EMBEDDER` | `hash` |
| `CORS_ORIGINS` | Initially `http://localhost:3000`; replace with the actual frontend HTTPS origin in step 4 |

Keep Groq on its Free plan. Enter its API key directly into Render's secret environment field. No AI key belongs in the frontend. The default model is currently listed in [Groq's free limits](https://console.groq.com/docs/rate-limits); check that page before changing models.

Deploy, then copy the backend's actual `https://…onrender.com` URL. Open `<backend-url>/health`; expect `{"status":"ok","llm_provider":"groq","hosted":true}`. Service names can change when a name is already taken; always copy the URL Render displays.

The hosted requirements omit PyTorch, sentence-transformers, and local LLM weights. Bug retrieval uses the existing deterministic hash embeddings and the eight bundled bug records; it does **not** run MiniLM. Imported datasets are not retained on Render's temporary disk, and the hosted import endpoint is disabled.

## 3. Create the frontend on Render

Choose **New → Static Site** and connect the same repository and branch.

| Setting | Value |
| --- | --- |
| Root Directory | Leave blank |
| Build Command | `npm ci && npm run build` |
| Publish Directory | `dist` |

Add these frontend environment variables before building:

| Name | Value |
| --- | --- |
| `NODE_VERSION` | `22` |
| `VITE_API_URL` | Actual backend HTTPS URL from step 2, without a trailing slash |
| `VITE_LLM_PROVIDER` | `groq` |
| `VITE_GROQ_MODEL` | `openai/gpt-oss-20b` (same as backend `GROQ_MODEL`) |

Variables beginning with `VITE_` are public and embedded during the build. Never put `GROQ_API_KEY`, `SARVAM_API_KEY`, a Supabase service key, or the deletion password there. Changes to frontend variables need a new build/deploy.

Deploy and copy the static site's actual HTTPS URL. Under its **Headers** settings, add `Cache-Control: no-cache` for `/sw.js` and `/index.html`, so browser runtime updates are picked up promptly.

## 4. Connect the two services

On the **backend**, replace `CORS_ORIGINS` with the exact frontend origin, for example `https://your-pyglide-site.onrender.com`, with no trailing slash or path. Save and redeploy the backend. Multiple allowed origins can be comma-separated.

Open the frontend and verify:

1. Wait for Python readiness, run `print("PyGlide is online")`, and check the console output.
2. Run `print(1 / 0)`. RCA and Groq AI feedback should appear.
3. Check the **Model Guide**: it should show Groq Hosted AI.
4. Test interactive input with `print(input("Name: "))`.
5. Upload a log containing a Python traceback and confirm log debugging works.

The existing local workflow still defaults to Ollama when you omit the cloud variables. Use the safe `.env.example` templates for local configuration.

## 5. Optional: persist shared example deletions

Without Supabase, bundled examples load normally, and attempts to delete shared examples are refused. Ordinary workspace files can still be created, edited, and deleted in the visitor's browser. There is no extra account needed for this basic deployment.

For persistent shared deletions:

1. Create a **Free** project in [Supabase](https://supabase.com/dashboard).
2. Run [`supabase/schema.sql`](supabase/schema.sql) once in its SQL Editor.
3. Add `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and a strong `EXAMPLE_DELETE_PASSWORD` to the **Render backend only**. Use a current Supabase secret API key (`sb_secret_...`) in this backend variable; legacy `service_role` JWT keys also work. Do not use an anonymous/publishable key. Keep the Data API enabled for the `public` schema.
4. Redeploy the backend. A password-authorized example deletion now writes a database tombstone. The example remains hidden after backend restarts and deployments, for all visitors.

Row-level security is enabled with no anonymous access policies. The backend uses the service-role key; visitors never receive it. If Supabase becomes unavailable, example listing returns a storage error instead of bringing deleted examples back. To restore a deleted example deliberately, remove its row in the Supabase dashboard; `__examples_folder__` is the folder-deletion marker.

Example source content ships in Git. Supabase stores deletion records. Workspace edits are saved locally in the browser, not in Supabase. Existing deletions made on a different local checkout are not migrated automatically.

## Optional Sarvam translation

Add `SARVAM_API_KEY` only to the backend if you want translation. Sarvam has separate credit limits; omit the key for a deployment using only the free Render and Groq services. An absent/exhausted translation key does not stop the Python editor or RCA.

## Free-tier behavior

- [Render Free](https://render.com/docs/free) sleeps after 15 idle minutes, takes about a minute to wake, and shares 750 free instance hours per workspace per month. Backend files reset on restarts. The static frontend remains independently available.
- Render bandwidth/build limits apply. Keep the workspace free and avoid adding a payment method if your requirement is strictly ₹0; without a payment method Render suspends services/builds when the relevant included quotas are exhausted. Do not choose paid compute or add a paid disk/database.
- [Groq Free](https://console.groq.com/docs/rate-limits) has request/token quotas shared by the account. PyGlide shows quota failures and retains basic RCA. Hosted mode adds a shared limit of eight AI, translation, or example-deletion requests per minute and caps request bodies at 256 KB. Groq context is capped at 14,000 characters plus the system instructions; long inputs are truncated for AI feedback. The upstream token quota can still be reached sooner.
- [Supabase Free](https://supabase.com/pricing) includes 500 MB database space and pauses projects after a week of inactivity; resume a paused project in its dashboard.
- This setup is suitable for a college project/demo within quotas. Free services do not promise uninterrupted availability or unlimited traffic. No keep-alive service is required, and your PC can stay off.

## Optional Blueprint

`render.yaml` defines the two Render services. If you use **New → Blueprint**, provide `GROQ_API_KEY`, `CORS_ORIGINS`, and `VITE_API_URL` when prompted. After creation, check the actual assigned service URLs and correct/redeploy the variables as needed. The sequential dashboard steps above avoid guessing URLs.

## Validation before publishing

```powershell
npm test
npm run build
python -m unittest discover -s backend/tests -v
```

Run the Python checks in an environment containing `backend/requirements-hosted.txt`. Tests use mocked Groq/Supabase responses and temporary example copies; live AI/database behavior still needs the deployment checks in step 4.
