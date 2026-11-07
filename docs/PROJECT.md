# Project Record: @trysac/mcp-sqlite-readonly

- **Objective**: Provide a secure, read-only SQLite MCP server that strictly bounds resources and enforces read-only access at the engine layer.
- **Scope**: Includes loading SQLite database binary files in-memory, providing read-only MCP tools (list_tables, describe_table, query), and enforcing strict SQL validation.
- **Out-of-Scope**: Database write operations, support for database engines other than SQLite, schema introspection beyond table_info, and Streamable HTTP transport.

## Effort Table

| Task | Effort |
| :--- | :--- |
| Core Logic Implementation | pending measurement |
| Test Suite Coverage | pending measurement |
| Security hardening | pending measurement |

## Factory run u119 (measured from API usage)

| Phase | Model | Batch | Input | Output | Cache write | Cache read | Cost (USD) |
|---|---|---|---|---|---|---|---|
| generation | gemini-3.8-flash | yes | 4733 | 14572 | 0 | 0 | 0.0291 |
| fix-1 | gemini-3.8-flash | no | 63855 | 1169 | 0 | 441674 | 0.0854 |
| fix-2 | gemini-3.8-flash | no | 33865 | 970 | 0 | 65150 | 0.0339 |
| fix-3 | gemini-3.8-flash | no | 94820 | 1132 | 0 | 876736 | 0.1411 |
| fix-4 | gemini-3.8-flash | no | 101967 | 1080 | 0 | 678798 | 0.1314 |
| audit | gemini-3.1-flash-lite | no | 43820 | 629 | 0 | 132420 | 0.0152 |
| docs | gemini-3.1-flash-lite | no | 20711 | 1754 | 0 | 0 | 0.0078 |

Total: $0.4440. Prices: Anthropic list prices.
