# [Project demo](https://datahacks-2026-iota.vercel.app/)
# datahacks-2026
Team repo for datahacks 2026 
## Frontend (React)

The React frontend lives in `frontend/` (Vite + React).

```bash
cd frontend
npm install
npm run dev
```

## Databricks (SDK + SQL Warehouse)

### One-time setup in the Databricks UI
- Create a **SQL Warehouse** (so you have a `warehouse_id`)
- Generate a **Personal Access Token** (Settings → Developer)
- Sanity-check your tables exist in Catalog Explorer

### Local setup (Cursor-friendly)
1) Copy `.env.example` to `.env` and fill in:
- `DATABRICKS_HOST`
- `DATABRICKS_TOKEN`
- `DATABRICKS_WAREHOUSE_ID`

2) Create/activate your Python environment and install deps:

```bash
python -m venv datahack26
source datahack26/bin/activate
pip install -r requirements-backend.txt
```

3) Smoke-test Databricks connectivity:

```bash
python scripts/databricks_smoketest.py
```

### Download GHGRP 2023 Excel (required for local ingest)

This downloads the EPA “2023 Data Summary Spreadsheets” zip and extracts `ghgp_data_2023.xlsx` to `data/raw/ghgp_data_2023.xlsx`:

```bash
python scripts/download_ghgp_data_2023.py
```

### Ingest GHGRP San Diego facilities into Delta

This reads the local Excel file and overwrites a Databricks Delta table.

Defaults:
- Excel: `data/raw/ghgp_data_2023.xlsx`
- Table: `zenpower.epa_ghg_san_diego`

```bash
python scripts/ingest_epa_ghg_emitters_san_diego.py
```

## Backend (FastAPI)

Run locally:

```bash
source datahack26/bin/activate
uvicorn backend.app.main:app --reload --port 8000
```

Example request:

```bash
curl -X POST http://localhost:8000/api/databricks/sql \
  -H "Content-Type: application/json" \
  -d '{"statement":"SELECT 1 AS ok","row_limit":10}'
```

# Environment 
If updated environment, run:
```bash
python -m venv datahack26
source datahack26/bin/activate        # Mac/Linux
datahack26\Scripts\activate           # Windows

pip install fastapi uvicorn pandas numpy ...
pip freeze > requirements.txt
```
To set up environment from existing requirements:
```bash
python -m venv datahack26
source datahack26/bin/activate        # Mac/Linux
datahack26\Scripts\activate           # Windows
pip install -r requirements.txt
```
