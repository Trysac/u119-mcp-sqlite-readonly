# Security and Threat Model

`@trysac/mcp-sqlite-readonly` provides read-only access to SQLite database files. The threat model is built on defense-in-depth.

## Defended

1. **Writes reaching storage**: SQLite files are loaded into memory; there is no disk write-back mechanism.
2. **Engine write operations**: `PRAGMA query_only = ON` is enforced; attempts to modify data or structure (including via CTEs) fail at the engine level.
3. **Multiple SQL statements**: Statements are validated to be single-statement only; chaining commands (e.g., `SELECT 1; DROP TABLE t;`) is blocked.
4. **Non-query keywords**: `ATTACH`, `PRAGMA` modifications, `VACUUM`, and other management commands are explicitly blocked by `checkSql`.
5. **SQL Injection**: Parameter binding uses `Statement.bind()`; interpolation is not used.
6. **Resource Exhaustion**: Hard limits on rows, cell size, and total payload bytes prevent large query overflows.

## Not Defended

1. **CPU/Memory exhaustion**: SQLite does not support query interruption; long-running joins cannot be cancelled.
2. **Confidentiality**: All tables and columns within the loaded file are accessible to the connected agent.
3. **Side channels**: Query execution time variations are not masked.
