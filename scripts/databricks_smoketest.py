from __future__ import annotations

import json

from backend.app.config import load_databricks_env
from backend.app.databricks import execute_sql_inline


def main() -> None:
    env = load_databricks_env()

    result = execute_sql_inline(
        env,
        "SELECT 1 AS ok",
        row_limit=10,
    )
    print(json.dumps({"columns": result.columns, "rows": result.rows}, indent=2))


if __name__ == "__main__":
    main()

