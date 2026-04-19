from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import pandas as pd

from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import (
    Disposition,
    ExecuteStatementRequestOnWaitTimeout,
    Format,
    StatementResponse,
    StatementState,
)
from dotenv import load_dotenv


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_EXCEL_PATH = REPO_ROOT / "data" / "raw" / "ghgp_data_2023.xlsx"


def _sql_ident(name: str) -> str:
    return f"`{name.replace('`', '``')}`"


def _sql_string(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _sql_literal(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return "NULL"
    if isinstance(value, (dict, list)):
        return _sql_string(json.dumps(value, ensure_ascii=False))
    return _sql_string(str(value))


def chunked(items: list[Any], n: int) -> Iterable[list[Any]]:
    for i in range(0, len(items), n):
        yield items[i : i + n]


@dataclass(frozen=True)
class DatabricksEnv:
    host: str
    token: str
    warehouse_id: str


def load_databricks_env_from_dotenv(*, dotenv_path: Path) -> DatabricksEnv:
    load_dotenv(dotenv_path=dotenv_path)

    host = (os.getenv("DATABRICKS_HOST") or "").strip()
    token = (os.getenv("DATABRICKS_TOKEN") or "").strip()
    warehouse_id = (os.getenv("DATABRICKS_WAREHOUSE_ID") or "").strip()

    missing = [k for k, v in {
        "DATABRICKS_HOST": host,
        "DATABRICKS_TOKEN": token,
        "DATABRICKS_WAREHOUSE_ID": warehouse_id,
    }.items() if not v]
    if missing:
        raise RuntimeError(
            "Missing required environment variables: "
            + ", ".join(missing)
            + f". Fill them in {dotenv_path}."
        )

    return DatabricksEnv(host=host, token=token, warehouse_id=warehouse_id)


def workspace_client(env: DatabricksEnv) -> WorkspaceClient:
    return WorkspaceClient(host=env.host, token=env.token)


def _statement_state(resp: StatementResponse) -> StatementState | None:
    if resp.status is None:
        return None
    return resp.status.state


def execute_sql_inline(
    env: DatabricksEnv,
    statement: str,
    *,
    row_limit: int = 100,
    poll_interval_s: float = 0.5,
    timeout_s: float = 300.0,
) -> tuple[list[str], list[dict[str, Any]]]:
    """
    Execute a SQL statement on a Databricks SQL Warehouse.

    Returns (columns, rows) for small inline result sets.
    """
    w = workspace_client(env)
    resp = w.statement_execution.execute_statement(
        statement=statement,
        warehouse_id=env.warehouse_id,
        disposition=Disposition.INLINE,
        format=Format.JSON_ARRAY,
        row_limit=row_limit,
        wait_timeout="5s",
        on_wait_timeout=ExecuteStatementRequestOnWaitTimeout.CONTINUE,
    )

    statement_id = resp.statement_id
    if not statement_id:
        raise RuntimeError("Databricks did not return a statement_id")

    deadline = time.time() + timeout_s
    while True:
        state = _statement_state(resp)
        if state in {
            StatementState.SUCCEEDED,
            StatementState.FAILED,
            StatementState.CANCELED,
            StatementState.CLOSED,
        }:
            break
        if time.time() >= deadline:
            raise TimeoutError(f"Timed out waiting for statement to finish (statement_id={statement_id})")
        time.sleep(poll_interval_s)
        resp = w.statement_execution.get_statement(statement_id=statement_id)

    state = _statement_state(resp)
    if state != StatementState.SUCCEEDED:
        msg = "Statement did not succeed."
        if resp.status and resp.status.error and resp.status.error.message:
            msg = resp.status.error.message
        raise RuntimeError(f"Databricks SQL failed ({state}): {msg}")

    cols: list[str] = []
    if resp.manifest and resp.manifest.schema and resp.manifest.schema.columns:
        cols = [c.name or f"col_{i}" for i, c in enumerate(resp.manifest.schema.columns)]

    rows: list[dict[str, Any]] = []
    if resp.result and resp.result.data_array:
        for row in resp.result.data_array:
            if cols:
                rows.append({cols[i]: row[i] if i < len(row) else None for i in range(len(cols))})
            else:
                rows.append({str(i): v for i, v in enumerate(row)})
    return cols, rows


def _norm_col(s: str) -> list[str]:
    return "".join(ch.lower() if ch.isalnum() else " " for ch in s).split()


def _find_col_by_keywords(df: pd.DataFrame, *, keywords: set[str]) -> str:
    scored: list[tuple[int, str]] = []
    for c in df.columns:
        tokens = set(_norm_col(str(c)))
        scored.append((len(tokens & keywords), str(c)))
    scored.sort(reverse=True)
    best_score, best_col = scored[0] if scored else (0, "")
    if best_score < max(1, min(2, len(keywords))):
        raise RuntimeError(
            f"Could not find a column matching keywords={sorted(keywords)}. "
            f"Top candidates: {scored[:8]}"
        )
    return best_col


def load_and_filter_excel(path: Path) -> pd.DataFrame:
    path = path.expanduser()
    if not path.is_absolute():
        # Interpret relative paths from the repo root, so `--excel data/raw/...` works
        # no matter what your current working directory is.
        path = (REPO_ROOT / path).resolve()

    if not path.exists():
        raise FileNotFoundError(
            "Excel file not found. "
            f"Resolved path: {path}. "
            "Place the file at `data/raw/ghgp_data_2023.xlsx` or pass `--excel /absolute/path/to/file.xlsx`."
        )

    # The EPA "data summary spreadsheets" package includes a "Direct Emitters" sheet.
    # If it isn't present (file format changed), fall back to the first sheet.
    try:
        xls = pd.ExcelFile(path)
        sheet = "Direct Emitters" if "Direct Emitters" in xls.sheet_names else 0
        df = pd.read_excel(xls, sheet_name=sheet)
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"Failed to read Excel file: {path}. Error: {e}") from e

    state_col = _find_col_by_keywords(df, keywords={"state"})
    city_col = _find_col_by_keywords(df, keywords={"city"})
    county_col = _find_col_by_keywords(df, keywords={"county"})

    facility_name_col = _find_col_by_keywords(df, keywords={"facility", "name"})
    lat_col = _find_col_by_keywords(df, keywords={"latitude"})
    lon_col = _find_col_by_keywords(df, keywords={"longitude"})
    emissions_col = _find_col_by_keywords(df, keywords={"total", "reported", "direct", "emissions"})

    state = df[state_col].astype("string").str.strip().str.upper()
    city = df[city_col].astype("string")
    county = df[county_col].astype("string")

    mask = state.isin({"CA", "CALIFORNIA"}) & (
        city.str.contains("San Diego", case=False, na=False)
        | county.str.contains("San Diego", case=False, na=False)
    )
    out = df.loc[mask, [facility_name_col, city_col, county_col, lat_col, lon_col, emissions_col]].copy()

    out.columns = [
        "facility name",
        "city",
        "county",
        "latitude",
        "longitude",
        "total reported direct emissions",
    ]

    out["latitude"] = pd.to_numeric(out["latitude"], errors="coerce")
    out["longitude"] = pd.to_numeric(out["longitude"], errors="coerce")
    out["total reported direct emissions"] = pd.to_numeric(out["total reported direct emissions"], errors="coerce")

    out = out.where(pd.notnull(out), None)
    return out


def ensure_schema_and_table(
    *,
    env: DatabricksEnv,
    schema: str,
    table: str,
) -> list[str]:
    execute_sql_inline(env, f"CREATE SCHEMA IF NOT EXISTS {_sql_ident(schema)}")

    ddl = (
        f"CREATE OR REPLACE TABLE {_sql_ident(schema)}.{_sql_ident(table)} ("
        f"{_sql_ident('facility name')} STRING, "
        f"{_sql_ident('city')} STRING, "
        f"{_sql_ident('county')} STRING, "
        f"{_sql_ident('latitude')} DOUBLE, "
        f"{_sql_ident('longitude')} DOUBLE, "
        f"{_sql_ident('total reported direct emissions')} DOUBLE, "
        f"{_sql_ident('ingested_at')} TIMESTAMP"
        f") USING DELTA"
    )
    execute_sql_inline(env, ddl)
    return [
        "facility name",
        "city",
        "county",
        "latitude",
        "longitude",
        "total reported direct emissions",
    ]


def insert_rows(
    *,
    env: DatabricksEnv,
    schema: str,
    table: str,
    columns: list[str],
    rows: list[dict[str, Any]],
    chunk_size: int,
) -> None:
    table_ref = f"{_sql_ident(schema)}.{_sql_ident(table)}"

    col_list = ", ".join(_sql_ident(c) for c in columns + ["ingested_at"])

    for batch in chunked(rows, chunk_size):
        values_sql = []
        for row in batch:
            vals = [_sql_literal(row.get(c)) for c in columns]
            vals.append("current_timestamp()")
            values_sql.append("(" + ", ".join(vals) + ")")

        stmt = f"INSERT INTO {table_ref} ({col_list}) VALUES\n" + ",\n".join(values_sql)
        execute_sql_inline(env, stmt)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Ingest GHGRP facility rows for San Diego, CA from a local Excel file into a Databricks Delta table."
    )
    parser.add_argument(
        "--excel",
        default=str(DEFAULT_EXCEL_PATH),
        help="Path to local Excel file (default: data/raw/ghgp_data_2023.xlsx)",
    )
    parser.add_argument(
        "--table",
        default="zenpower.epa_ghg_san_diego",
        help="Target table as schema.table (default: zenpower.epa_ghg_san_diego)",
    )
    parser.add_argument("--chunk-size", type=int, default=200, help="Rows per INSERT statement.")
    args = parser.parse_args()

    env = load_databricks_env_from_dotenv(dotenv_path=REPO_ROOT / ".env")

    if args.table.count(".") != 1:
        raise RuntimeError(f"--table must be schema.table (got: {args.table})")
    schema, table = args.table.split(".", 1)

    filtered = load_and_filter_excel(Path(args.excel))
    rows: list[dict[str, Any]] = filtered.to_dict(orient="records")
    if not rows:
        raise RuntimeError("Filtered dataset is empty (no rows matched California + San Diego).")

    columns = ensure_schema_and_table(env=env, schema=schema, table=table)
    insert_rows(env=env, schema=schema, table=table, columns=columns, rows=rows, chunk_size=args.chunk_size)

    _, count_rows = execute_sql_inline(
        env,
        f"SELECT COUNT(*) AS n FROM {_sql_ident(schema)}.{_sql_ident(table)}",
        row_limit=10,
    )
    warehouse_n = count_rows[0]["n"] if count_rows and "n" in count_rows[0] else None
    print(
        json.dumps(
            {
                "table": args.table,
                "rows_ingested": len(rows),
                "warehouse_count": warehouse_n,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:  # noqa: BLE001
        print(f"ERROR: {e}", file=sys.stderr)
        raise

