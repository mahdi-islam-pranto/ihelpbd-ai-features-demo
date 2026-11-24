# iHelp AI Showcase

A FastAPI + HTML/CSS/JS dashboard portal for demonstrating iHelp's AI features to clients.
Each AI feature has its own page: an input panel, a results panel and a short description.
API contracts for each feature are in [`api_docs/`](api_docs/).

## Quick start

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows  (macOS/Linux: source .venv/bin/activate)
pip install -r requirements.txt
copy .env.example .env          # then fill in API URLs/keys and DB_* (MySQL)
python run.py
```

Open http://127.0.0.1:8000. Backend API docs are at http://127.0.0.1:8000/api/docs.

## Demo mode vs live mode

* If `<FEATURE>_API_URL` is **empty** in `.env`, that feature runs in **demo mode** and returns realistic mock data (badge: *Demo data*).
* If it is **set**, requests go to your deployed API (badge: *Live API*).
* `FORCE_DEMO_MODE=true` makes every feature use mock data, which is useful when presenting offline.

API keys stay on the server. The browser only talks to this FastAPI app.

## Database (saved results)

Every AI result is saved to **MySQL**, so results survive page refreshes and can be reopened
from the **Saved results** list on each feature page.

* Set `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` and `DB_NAME` in `.env`.
  On startup the app creates the database (`utf8mb4`) and any missing tables automatically.
* There is **one table per feature**. Each table has the shared columns (`id`, `created_at`, `mode`, file info,
  `params` JSON, full `response` JSON) plus searchable columns for that feature.
  The full response is replayed through the same renderer, so a saved result looks exactly like a fresh one.

  | Feature | Table |
  |---|---|
  | Call Recording Analysis | `call_analysis_runs` |
  | Call Transcription | `call_transcription_runs` |
| Lead Finder AI | `lead_finder_runs` (one row per batch; `sources` maps each call to its file/link) |

* Uploaded recordings are copied to `storage/uploads/<feature>/<yyyy-mm>/` (set `SAVE_UPLOADS=false` to disable).
  For samples, only the file name is stored.
* Opening a saved result puts `?run=<id>` in the URL, so a refresh or a shared link reopens it.
* If MySQL is down, features still work but nothing is saved. The page shows why, and the app reconnects
  automatically (also right after you change `DB_*` in `.env`). `GET /api/health` reports the DB status.

> `create_all` only creates **missing** tables; it does not alter existing ones.
> If you change a table's columns later, run an `ALTER TABLE` (or drop the table on a dev machine).

## Sample data

| Folder | Used by | Formats |
|---|---|---|
| `sample-call-recordings/` | Call Analysis, Agent QA, Transcription, Lead Finder | mp3, wav, m4a, ogg, flac, webm, aac |
| `sample-call-recordings/urls.txt` | Transcription and Lead Finder (link samples) | one audio URL per line or comma separated |
| `sample-crm-datas/` | (not used yet) | csv, xlsx, xls, json |

Files you put in these folders appear automatically as one-click samples on the feature pages.

## Project structure

```
app/
  main.py                 FastAPI app, static mounts, error pages
  config.py               .env settings
  db/
    database.py           MySQL connection, auto-creates database + tables
    models.py             ONE TABLE PER FEATURE (+ HISTORY_MODELS registry)
  features.py             FEATURE REGISTRY (names, page content, env prefixes)
  templating.py           Jinja2 setup
  routers/
    pages.py              HTML pages:  /  and  /features/{slug}
    api.py                JSON API:    /run, /history, /samples, /health
  services/
    api_client.py         Calls the deployed AI APIs (one adapter per feature)
    mock_data.py          Demo-mode responses (= reference response shapes)
    history.py            Save / list / load / delete saved results
  templates/
    base.html             Dashboard shell: sidebar menu, top bar
    index.html            Homepage
    feature.html          Shared feature page (input | results | about)
    inputs/panel.html     Generic input panel built from Feature.form_fields
  static/
    css/style.css
    js/app.js             Nav + shared helpers
    js/feature.js         Upload / samples / run / tabs / saved results
    js/renderers.js       Result UI per feature
api_docs/                 One short API doc per AI feature
sample-call-recordings/
sample-crm-datas/
storage/                  Uploaded files of saved results (git-ignored)
```

## Adding / connecting a feature

1. **Register it** in `app/features.py` (slug, name, texts, `file_kind`, `form_fields`, `env_prefix`).
2. **Configure** `<ENV_PREFIX>_API_URL` / `_API_KEY` in `.env`.
3. **Adapter**: add an async function in `app/services/api_client.py` and register it in `ADAPTERS`.
   It must send the request in the format your API expects and return data in the shape the renderer uses.
4. **Renderer**: add `Renderers["<slug>"]` in `static/js/renderers.js` (optional; unknown shapes fall back to a JSON view).
5. **Table**: add a `XxxRun(RunMixin, Base)` model in `app/db/models.py` (columns + `extract()` + `card()`)
   and register it in `HISTORY_MODELS`. The table is created on the next start.
6. **Document** the API in `api_docs/<feature>.md`.

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for setting the portal up on a CentOS / RHEL server
(systemd + Nginx + MySQL).

## Connected APIs

| Feature | Status | Doc |
|---|---|---|
| Call Recording Analysis | Live | [api_docs/recording_analysis.md](api_docs/recording_analysis.md) |
| Call Center Agent Quality Check | Demo data | – |
| Call Transcription | Live | [api_docs/call_transcription.md](api_docs/call_transcription.md) |
| Lead Finder AI | Live | [api_docs/lead_finder.md](api_docs/lead_finder.md) |
