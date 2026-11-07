# @trysac/mcp-sqlite-readonly

Read-only MCP server over a SQLite database file loaded into memory with sql.js.

## The Problem

Most SQLite MCP servers open real files with write access and rely on trust to ensure models only execute read-only queries. This package is read-only by construction, preventing accidental or malicious modification of your database files.

## Installation

Install the package as a dependency:

```bash
npm install @trysac/mcp-sqlite-readonly
```

## Usage Example

```typescript
import { openDatabase, createServer } from "@trysac/mcp-sqlite-readonly";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFile } from "node:fs/promises";

const dbBytes = await readFile("sample.db");
const db = await openDatabase(dbBytes);
const server = createServer(db);
await server.connect(new StdioServerTransport());
```

## API Summary

- `openDatabase(bytes: Uint8Array, opts?: { maxDbBytes?: number }): Promise<ReadonlyDb>`
- `createServer(db: ReadonlyDb, opts?: { name?: string, version?: string }): McpServer`
- `checkSql(sql: string): void` (Validates read-only keywords: SELECT/WITH)
- `SqliteMcpError`: Thrown for `NOT_READ_ONLY`, `MULTIPLE_STATEMENTS`, `SQL_ERROR`, `UNKNOWN_TABLE`, `TOO_LARGE`, `INVALID_PARAMS`.

### Limits

- **maxDbBytes**: Default 100 MiB.
- **maxRows**: Default 1,000.
- **maxResultBytes**: Default 1 MiB.
- **maxCellChars**: Default 10,000.
- **MAX_PARAMS_COUNT**: 100.

## Why not the reference SQLite MCP server?

Unlike reference implementations that trust the model to behave, this library enforces read-only access via the SQLite engine and loader, rather than relying on model prompt compliance.

## Security

See [docs/SECURITY.md](docs/SECURITY.md) for the threat model and defense boundaries.
