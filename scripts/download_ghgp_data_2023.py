from __future__ import annotations

import argparse
import shutil
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]

# Source: https://www.epa.gov/ghgreporting/data-sets (2023 Data Summary Spreadsheets)
ZIP_URL_2023 = "https://www.epa.gov/system/files/other-files/2024-10/2023_data_summary_spreadsheets.zip"

DEFAULT_OUT = REPO_ROOT / "data" / "raw" / "ghgp_data_2023.xlsx"


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "datahacks-2026 downloader"})
    with urllib.request.urlopen(req) as resp, dest.open("wb") as f:  # noqa: S310 (trusted public URL)
        shutil.copyfileobj(resp, f)


def extract_member(zip_path: Path, *, member_suffix: str, out_path: Path) -> str:
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(zip_path) as z:
        members = z.namelist()
        matches = [m for m in members if m.lower().endswith(member_suffix.lower())]
        if not matches:
            raise RuntimeError(
                f"Could not find {member_suffix!r} inside {zip_path}. "
                f"Archive contained: {members[:20]}{'...' if len(members) > 20 else ''}"
            )
        member = matches[0]
        with z.open(member) as src, out_path.open("wb") as dst:
            shutil.copyfileobj(src, dst)
        return member


def main() -> int:
    parser = argparse.ArgumentParser(description="Download EPA GHGRP 2023 Excel to data/raw/ghgp_data_2023.xlsx")
    parser.add_argument("--url", default=ZIP_URL_2023, help="EPA zip URL to download")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="Output .xlsx path")
    args = parser.parse_args()

    out_path = Path(args.out).expanduser()
    if not out_path.is_absolute():
        out_path = (REPO_ROOT / out_path).resolve()

    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        zip_path = td_path / "2023_data_summary_spreadsheets.zip"

        print(f"Downloading: {args.url}")
        download(args.url, zip_path)

        print("Extracting ghgp_data_2023.xlsx")
        member = extract_member(zip_path, member_suffix="ghgp_data_2023.xlsx", out_path=out_path)

    size_mb = out_path.stat().st_size / (1024 * 1024)
    print(f"Saved: {out_path} ({size_mb:.2f} MiB) from zip member {member!r}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:  # noqa: BLE001
        print(f"ERROR: {e}", file=sys.stderr)
        raise

