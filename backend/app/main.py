from __future__ import annotations

import csv
import json
import os
from pathlib import Path
from threading import Lock
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


_CO2_COST_LOCK = Lock()
_CO2_COST_BY_ZIP: dict[str, dict[str, dict[int, dict[str, float]]]] | None = None
_CO2_COST_SOURCE_PATH: str | None = None
_CO2_COST_SOURCE_MTIME: float | None = None


def _repo_root() -> Path:
    # backend/app/main.py -> backend/app -> backend -> repo root
    return Path(__file__).resolve().parents[2]


def _co2_cost_csv_path() -> Path:
    raw = (os.getenv("CO2_COST_CSV_PATH") or "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    return _repo_root() / "data" / "co2_cost" / "co2_emissions_cost_electricity.csv"


def _to_int(value) -> int | None:
    try:
        if value is None:
            return None
        s = str(value).strip()
        if not s:
            return None
        return int(float(s))
    except Exception:  # noqa: BLE001
        return None


def _to_float(value) -> float | None:
    try:
        if value is None:
            return None
        s = str(value).strip()
        if not s:
            return None
        return float(s)
    except Exception:  # noqa: BLE001
        return None


def _load_co2_cost_index() -> tuple[dict[str, dict[str, dict[int, dict[str, float]]]], str]:
    """
    Loads and indexes `co2_emissions_cost_electricity.csv` into:
      zip -> sector -> year -> aggregated yearly totals (sum of quarters).

    Shape for year payload:
      {
        "electricity_cost_no_solar_usd": float,
        "electricity_cost_with_solar_usd": float,
        "co2_emissions_no_solar_tons": float,
        "co2_emissions_with_solar_tons": float,
      }
    """
    global _CO2_COST_BY_ZIP, _CO2_COST_SOURCE_PATH, _CO2_COST_SOURCE_MTIME  # noqa: PLW0603

    path = _co2_cost_csv_path()
    if not path.exists():
        raise RuntimeError(f"CO2 cost CSV not found at {path}")

    mtime = path.stat().st_mtime
    if (
        _CO2_COST_BY_ZIP is not None
        and _CO2_COST_SOURCE_PATH == str(path)
        and _CO2_COST_SOURCE_MTIME == mtime
    ):
        return _CO2_COST_BY_ZIP, str(path)

    indexed: dict[str, dict[str, dict[int, dict[str, float]]]] = {}
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            z = (row.get("zip_code") or "").strip()
            sector = (row.get("sector") or "").strip().lower()
            year = _to_int(row.get("year"))
            if not z or not sector or year is None:
                continue

            co2_no = _to_float(row.get("co2_emissions_no_solar_tons")) or 0.0
            co2_yes = _to_float(row.get("co2_emissions_with_solar_tons")) or 0.0
            cost_no = _to_float(row.get("electricity_cost_no_solar_usd")) or 0.0
            cost_yes = _to_float(row.get("electricity_cost_with_solar_usd")) or 0.0

            by_sector = indexed.setdefault(z, {})
            by_year = by_sector.setdefault(sector, {})
            agg = by_year.setdefault(
                int(year),
                {
                    "electricity_cost_no_solar_usd": 0.0,
                    "electricity_cost_with_solar_usd": 0.0,
                    "co2_emissions_no_solar_tons": 0.0,
                    "co2_emissions_with_solar_tons": 0.0,
                },
            )
            agg["electricity_cost_no_solar_usd"] += float(cost_no)
            agg["electricity_cost_with_solar_usd"] += float(cost_yes)
            agg["co2_emissions_no_solar_tons"] += float(co2_no)
            agg["co2_emissions_with_solar_tons"] += float(co2_yes)

    _CO2_COST_BY_ZIP = indexed
    _CO2_COST_SOURCE_PATH = str(path)
    _CO2_COST_SOURCE_MTIME = mtime
    return indexed, str(path)


def _pick_sector_for_zip(by_sector: dict[str, dict[int, dict[str, float]]]) -> str | None:
    # Prefer residential if it has meaningful data; otherwise pick the sector with highest baseline cost.
    if "r" in by_sector:
        total_r = sum(v.get("electricity_cost_no_solar_usd", 0.0) for v in by_sector["r"].values())
        if total_r > 0:
            return "r"

    best = None
    best_total = -1.0
    for sector, by_year in by_sector.items():
        total = sum(v.get("electricity_cost_no_solar_usd", 0.0) for v in by_year.values())
        if total > best_total:
            best_total = total
            best = sector
    return best


@app.get("/api/co2_cost_series")
def co2_cost_series(zip: str, sector: str | None = None):
    normalized_zip = "".join(ch for ch in str(zip).strip() if ch.isdigit())
    if len(normalized_zip) not in {5, 9}:
        raise HTTPException(status_code=400, detail="zip must be a 5- or 9-digit zipcode")

    with _CO2_COST_LOCK:
        indexed, source_path = _load_co2_cost_index()

    by_sector = indexed.get(normalized_zip)
    if not by_sector:
        raise HTTPException(status_code=404, detail=f"No CO2/cost series found for zip {normalized_zip}")

    chosen_sector = (sector or "").strip().lower() or _pick_sector_for_zip(by_sector)
    if not chosen_sector or chosen_sector not in by_sector:
        raise HTTPException(
            status_code=404,
            detail=f"No CO2/cost series found for zip {normalized_zip} (sector={sector or 'auto'})",
        )

    by_year = by_sector[chosen_sector]
    years = []
    for y in sorted(by_year.keys()):
        payload = by_year[y]
        years.append(
            {
                "year": int(y),
                "electricity_cost_no_solar_usd": round(float(payload.get("electricity_cost_no_solar_usd", 0.0)), 2),
                "electricity_cost_with_solar_usd": round(float(payload.get("electricity_cost_with_solar_usd", 0.0)), 2),
                "co2_emissions_no_solar_tons": round(float(payload.get("co2_emissions_no_solar_tons", 0.0)), 4),
                "co2_emissions_with_solar_tons": round(float(payload.get("co2_emissions_with_solar_tons", 0.0)), 4),
            }
        )

    return {
        "zip_code": normalized_zip,
        "sector": chosen_sector,
        "years": years,
        "source": {"path": source_path, "unit": {"cost": "usd/year", "co2": "tons/year"}},
    }


def _pick_column(columns: list[str], candidates: list[str]) -> str | None:
    lowered = {c.lower(): c for c in columns}
    for cand in candidates:
        if cand.lower() in lowered:
            return lowered[cand.lower()]

    for col in columns:
        cl = col.lower()
        if any(cand.lower() in cl for cand in candidates):
            return col
    return None


def _parse_geometry(value):
    if value is None:
        return None

    if isinstance(value, dict):
        if value.get("type") in {"Feature", "FeatureCollection"}:
            return value
        if "type" in value and "coordinates" in value:
            return value
        return None

    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        if s[0] in {"{", "["}:
            try:
                return json.loads(s)
            except Exception:  # noqa: BLE001 - best-effort parsing
                return None
        return None

    return None


def _hash_to_unit_interval(text: str) -> float:
    # Mirror the frontend's EstimatePanel.hashToUnitInterval (FNV-1a-ish).
    h = 2166136261
    for ch in text:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return (h % 10000) / 10000.0


def _optimality_score(zipcode: str | None) -> int | None:
    z = (zipcode or "").strip()
    if not z:
        return None
    seed = _hash_to_unit_interval(z)
    return int(round(55 + seed * 40))  # 55..95


@app.get("/api/zipcode_geojson")
def zipcode_geojson(limit: int = 200):
    """
    Returns a GeoJSON FeatureCollection built from the Databricks `zipcode_geojson` table/view.

    Configure the source via env var:
    - ZIPCODE_GEOJSON_TABLE (default: "zipcode_geojson")
    """
    if limit < 1 or limit > 1000:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 1000")

    table = (os.getenv("ZIPCODE_GEOJSON_TABLE") or "zipcode_geojson").strip()
    if not table:
        raise HTTPException(status_code=500, detail="ZIPCODE_GEOJSON_TABLE is empty")

    env = None
    try:
        env = load_databricks_env()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(e)) from e

    # Some Databricks types (notably GEOMETRY) can fail when returning `SELECT *`
    # inline as JSON. So we:
    # 1) discover columns via DESCRIBE
    # 2) select only zip + geometry, converting geometry -> GeoJSON if possible
    try:
        desc = execute_sql_inline(env, f"DESCRIBE {table}", row_limit=2000)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(e)) from e

    # DESCRIBE output varies; look for likely column name fields.
    col_name_field = _pick_column(desc.columns, ["col_name", "column_name", "col_name", "name"])
    if not col_name_field:
        # fall back to first column
        col_name_field = desc.columns[0] if desc.columns else None

    discovered_cols: list[str] = []
    if col_name_field:
        for row in desc.rows:
            v = row.get(col_name_field)
            if v is None:
                continue
            s = str(v).strip()
            if not s or s.startswith("#"):
                continue
            # Some DESCRIBE variants insert a blank row between schema and partition info.
            if s.lower().startswith("partition"):
                continue
            discovered_cols.append(s)

    if not discovered_cols:
        raise HTTPException(status_code=500, detail=f"Could not discover columns for {table} via DESCRIBE")

    zip_col = os.getenv("ZIPCODE_GEOJSON_ZIP_COLUMN") or _pick_column(
        discovered_cols,
        ["zipcode", "zip", "postal_code", "zcta", "zcta5ce10", "zcta5ce20", "zcta5"],
    )
    geom_col = os.getenv("ZIPCODE_GEOJSON_GEOM_COLUMN") or _pick_column(
        discovered_cols,
        ["geojson", "geometry", "geom", "shape", "boundary", "polygon"],
    )

    if not zip_col:
        raise HTTPException(status_code=500, detail=f"Could not find a zipcode column in {table}. Columns: {discovered_cols}")
    if not geom_col:
        raise HTTPException(status_code=500, detail=f"Could not find a geometry column in {table}. Columns: {discovered_cols}")

    # Default to San Diego-ish zip prefixes so we don't ship statewide geometry.
    # Override with:
    # - ZIPCODE_GEOJSON_ZIP_PREFIXES="919,920,921"
    # - or ZIPCODE_GEOJSON_WHERE="CAST(zipcode AS STRING) LIKE '921%'"
    raw_where = (os.getenv("ZIPCODE_GEOJSON_WHERE") or "").strip()
    where_clause = ""
    if raw_where:
        where_clause = f"WHERE {raw_where}"
    else:
        raw_prefixes = os.getenv("ZIPCODE_GEOJSON_ZIP_PREFIXES") or "919,920,921"
        prefixes: list[str] = []
        for p in raw_prefixes.split(","):
            digits = "".join(ch for ch in p.strip() if ch.isdigit())
            if len(digits) >= 3:
                prefixes.append(digits[:5])
        prefixes = list(dict.fromkeys(prefixes))  # stable de-dupe
        if prefixes:
            likes = " OR ".join([f"CAST({zip_col} AS STRING) LIKE '{p}%'" for p in prefixes])
            where_clause = f"WHERE {likes}"

    explicit_stmt = os.getenv("ZIPCODE_GEOJSON_SELECT")
    statements_to_try = []
    if explicit_stmt and explicit_stmt.strip():
        statements_to_try.append(explicit_stmt.strip())
    else:
        # Preferred: convert geometry -> GeoJSON in SQL, aliased as geojson.
        statements_to_try.append(
            f"SELECT CAST({zip_col} AS STRING) AS zipcode, ST_AsGeoJSON({geom_col}) AS geojson FROM {table} {where_clause} LIMIT {int(limit)}"
        )
        # Fallback: geometry already stored as geojson (string/object)
        statements_to_try.append(
            f"SELECT CAST({zip_col} AS STRING) AS zipcode, {geom_col} AS geojson FROM {table} {where_clause} LIMIT {int(limit)}"
        )

    last_error: str | None = None
    result = None
    for stmt in statements_to_try:
        try:
            result = execute_sql_inline(env, stmt, row_limit=limit)
            last_error = None
            break
        except Exception as e:  # noqa: BLE001
            last_error = str(e)
            continue

    if result is None:
        raise HTTPException(status_code=500, detail=last_error or "Failed to query zipcode GeoJSON")

    zip_field = _pick_column(result.columns, ["zipcode", "zip"]) or "zipcode"
    geojson_field = _pick_column(result.columns, ["geojson", "geometry", "geom"]) or "geojson"

    features = []
    for row in result.rows:
        z = row.get(zip_field)
        geom_raw = row.get(geojson_field)
        parsed = _parse_geometry(geom_raw)
        if parsed is None:
            continue

        # If query returned a FeatureCollection already, return it directly.
        if isinstance(parsed, dict) and parsed.get("type") == "FeatureCollection":
            return parsed

        if isinstance(parsed, dict) and parsed.get("type") == "Feature":
            features.append(parsed)
            continue

        if isinstance(parsed, dict) and parsed.get("type") and parsed.get("coordinates") is not None:
            features.append(
                {
                    "type": "Feature",
                    "geometry": parsed,
                    "properties": {
                        "zip": z,
                        "optimalityScore": _optimality_score(str(z) if z is not None else None),
                    },
                }
            )

    return {"type": "FeatureCollection", "features": features}

