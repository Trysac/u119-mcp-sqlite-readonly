# Architecture

The system is layered to ensure inputs from AI agents cannot breach the read-only sandbox:

1. **CLI / Transport Layer**: Handles stdio or SDK transport.
2. **McpServer**: Registers `describe_table`, `list_tables`, and `query` tools.
3. **sql-check.ts**: Performs pre-parsing to ensure only `SELECT` or `WITH` queries are passed to the engine.
4. **Database Layer (`sql.js`)**: Executes queries in an in-memory instance with `PRAGMA query_only = ON`.
5. **Truncator**: Enforces output constraints (rows, bytes, cell characters) before returning results to the client.
