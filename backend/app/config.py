from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv


@dataclass(frozen=True)
class DatabricksEnv:
    host: str
    token: str
    warehouse_id: str
    catalog: str | None
    schema: str | None
    serving_endpoint: str | None


def _opt(value: str | None) -> str | None:
    if value is None:
        return None
    v = value.strip()
    return v or None


def load_databricks_env() -> DatabricksEnv:
    """
    Loads Databricks config from environment variables (optionally via .env).

    Required:
    - DATABRICKS_HOST
    - DATABRICKS_TOKEN
    - DATABRICKS_WAREHOUSE_ID
    """

    load_dotenv()

    host = _opt(os.getenv("DATABRICKS_HOST"))
    token = _opt(os.getenv("DATABRICKS_TOKEN"))
    warehouse_id = _opt(os.getenv("DATABRICKS_WAREHOUSE_ID"))

    missing = [k for k, v in {
        "DATABRICKS_HOST": host,
        "DATABRICKS_TOKEN": token,
        "DATABRICKS_WAREHOUSE_ID": warehouse_id,
    }.items() if not v]
    if missing:
        raise RuntimeError(
            "Missing required environment variables: "
            + ", ".join(missing)
            + ". Copy .env.example to .env and fill it in."
        )

    return DatabricksEnv(
        host=host,  # type: ignore[arg-type]
        token=token,  # type: ignore[arg-type]
        warehouse_id=warehouse_id,  # type: ignore[arg-type]
        catalog=_opt(os.getenv("DATABRICKS_CATALOG")),
        schema=_opt(os.getenv("DATABRICKS_SCHEMA")),
        serving_endpoint=_opt(os.getenv("DATABRICKS_SERVING_ENDPOINT")),
    )

