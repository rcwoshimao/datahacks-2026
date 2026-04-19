from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

import requests
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import (
    Disposition,
    ExecuteStatementRequestOnWaitTimeout,
    Format,
    StatementResponse,
    StatementState,
)

from .config import DatabricksEnv


@dataclass(frozen=True)
class SqlResult:
    columns: list[str]
    rows: list[dict[str, Any]]
    statement_id: str
    truncated: bool


def workspace_client(env: DatabricksEnv) -> WorkspaceClient:
    return WorkspaceClient(host=env.host, token=env.token)


def _statement_state(resp: StatementResponse) -> StatementState | None:
    if resp.status is None:
        return None
    return resp.status.state


def _result_to_rows(resp: StatementResponse) -> tuple[list[str], list[dict[str, Any]]]:
    cols = []
    if resp.manifest and resp.manifest.schema and resp.manifest.schema.columns:
        cols = [c.name or f"col_{i}" for i, c in enumerate(resp.manifest.schema.columns)]

    data = []
    if resp.result and resp.result.data_array:
        for row in resp.result.data_array:
            if cols:
                data.append({cols[i]: row[i] if i < len(row) else None for i in range(len(cols))})
            else:
                data.append({str(i): v for i, v in enumerate(row)})
    return cols, data


def execute_sql_inline(
    env: DatabricksEnv,
    statement: str,
    *,
    row_limit: int = 100,
    poll_interval_s: float = 0.5,
    timeout_s: float = 30.0,
) -> SqlResult:
    """
    Executes a SQL statement on a Databricks SQL Warehouse and returns JSON results inline.

    This is intentionally tuned for small result sets used by APIs (<= 25 MiB inline limit).
    """

    w = workspace_client(env)

    resp = w.statement_execution.execute_statement(
        statement=statement,
        warehouse_id=env.warehouse_id,
        catalog=env.catalog,
        schema=env.schema,
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
        if state in {StatementState.SUCCEEDED, StatementState.FAILED, StatementState.CANCELED, StatementState.CLOSED}:
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

    columns, rows = _result_to_rows(resp)
    truncated = bool(resp.manifest.truncated) if resp.manifest and resp.manifest.truncated is not None else False
    return SqlResult(columns=columns, rows=rows, statement_id=statement_id, truncated=truncated)


def invoke_serving_endpoint(
    env: DatabricksEnv,
    *,
    endpoint: str | None = None,
    payload: dict[str, Any],
    timeout_s: float = 60.0,
) -> dict[str, Any]:
    """
    Calls a Databricks Model Serving endpoint using plain HTTP.

    `endpoint` can be a full endpoint name (e.g. "databricks-dbrx-instruct") or left None
    to use DATABRICKS_SERVING_ENDPOINT from env.
    """

    endpoint_name = endpoint or env.serving_endpoint
    if not endpoint_name:
        raise RuntimeError(
            "Missing serving endpoint. Set DATABRICKS_SERVING_ENDPOINT in your .env "
            "or pass endpoint=... explicitly."
        )

    url = f"{env.host.rstrip('/')}/serving-endpoints/{endpoint_name}/invocations"
    r = requests.post(
        url,
        headers={"Authorization": f"Bearer {env.token}"},
        json=payload,
        timeout=timeout_s,
    )
    r.raise_for_status()
    return r.json()

