from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any

import pandas as pd
import requests
from dotenv import load_dotenv


REPO_ROOT = Path(__file__).resolve().parents[1]
EIA_ENDPOINT = "https://api.eia.gov/v2/electricity/retail-sales/data/"


def fetch_eia_page(*, api_key: str, offset: int, length: int) -> list[dict[str, Any]]:
    params = {
        "frequency": "monthly",
        "data[0]": "price",
        "data[1]": "sales",
        "data[2]": "customers",
        # "facets[sectorid][0]": "COM",
        # "facets[respondentid][0]": "SDGE",
        "sort[0][column]": "period",
        "sort[0][direction]": "desc",
        "offset": offset,
        "length": length,
        "api_key": api_key,
    }
    r = requests.get(EIA_ENDPOINT, params=params, timeout=60)
    r.raise_for_status()
    payload = r.json()

    data = payload.get("response", {}).get("data", None)
    if not isinstance(data, list):
        raise RuntimeError(f"Unexpected EIA response shape. Top-level keys: {list(payload.keys())}")
    if any(not isinstance(row, dict) for row in data):
        raise RuntimeError("Unexpected EIA response: response.data contained non-object rows")
    return data


def fetch_all_eia(*, api_key: str, page_size: int = 5000) -> pd.DataFrame:
    all_rows: list[dict[str, Any]] = []

    offset = 0
    while True:
        page = fetch_eia_page(api_key=api_key, offset=offset, length=page_size)
        all_rows.extend(page)

        if len(page) < page_size:
            break
        offset += page_size

    df = pd.DataFrame(all_rows)
    from datetime import datetime

    out_dir = REPO_ROOT / "data" / "eia"
    out_dir.mkdir(parents=True, exist_ok=True)

    out_path = out_dir / f"retail_sales_com_{datetime.now():%Y%m%d_%H%M%S}.csv"
    df.to_csv(out_path, index=False)

    print(f"Fetched total rows: {len(df)}")
    print(f"Saved CSV: {out_path}")
    return df


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Ingest EIA retail-sales (SDG&E commercial) by paginating through all results."
    )
    parser.add_argument("--page-size", type=int, default=5000, help="Pagination size (default: 5000)")
    args = parser.parse_args()

    load_dotenv(dotenv_path=REPO_ROOT / ".env")
    api_key = (os.getenv("EIA_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("Missing EIA_API_KEY. Add it to .env (see provided URL template).")

    fetch_all_eia(api_key=api_key, page_size=args.page_size)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:  # noqa: BLE001
        print(f"ERROR: {e}", file=sys.stderr)
        raise

