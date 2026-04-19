from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .config import load_databricks_env
from .databricks import execute_sql_inline


app = FastAPI(title="datahacks-2026 backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Vite dev server
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SqlRequest(BaseModel):
    statement: str = Field(..., min_length=1, max_length=16000)
    row_limit: int = Field(100, ge=1, le=1000)


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/api/databricks/sql")
def databricks_sql(req: SqlRequest):
    stmt = req.statement.strip()

    # Hackathon-safe guardrail: only allow SELECT statements via this endpoint.
    if not stmt.lower().startswith("select"):
        raise HTTPException(status_code=400, detail="Only SELECT statements are allowed.")

    try:
        env = load_databricks_env()
        result = execute_sql_inline(env, stmt, row_limit=req.row_limit)
        return {
            "statement_id": result.statement_id,
            "truncated": result.truncated,
            "columns": result.columns,
            "rows": result.rows,
        }
    except Exception as e:  # noqa: BLE001 - surface a clean message to client
        raise HTTPException(status_code=500, detail=str(e)) from e

