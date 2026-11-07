import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ReadonlyDb } from "./database.js";
import { SqliteMcpError } from "./errors.js";

export interface CreateServerOptions {
  name?: string;
  version?: string;
}

/**
 * Creates an MCP server wrapping a ReadonlyDb handle.
 * Registers three tools with readOnlyHint: describe_table, list_tables, query.
 *
 * @param db - ReadonlyDb instance to query.
 * @param opts - Server naming and version options.
 * @returns Configured McpServer instance.
 */
export function createServer(db: ReadonlyDb, opts: CreateServerOptions = {}): McpServer {
  const server = new McpServer({
    name: opts.name ?? "mcp-sqlite-readonly",
    version: opts.version ?? "0.1.0",
  });

  server.registerTool(
    "describe_table",
    {
      description: "Describe columns and types for a table in the database",
      inputSchema: z.object({
        table: z.string().describe("Table name to inspect"),
      }),
      annotations: {
        readOnlyHint: true,
      },
    },
    async (input) => {
      try {
        const columns = db.describeTable(input.table);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(columns, null, 2),
            },
          ],
        };
      } catch (err) {
        const code = err instanceof SqliteMcpError ? err.code : "SQL_ERROR";
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `${code}: ${msg}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "list_tables",
    {
      description: "List all user table names in the database",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
      },
    },
    async () => {
      try {
        const tables = db.listTables();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(tables, null, 2),
            },
          ],
        };
      } catch (err) {
        const code = err instanceof SqliteMcpError ? err.code : "SQL_ERROR";
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `${code}: ${msg}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "query",
    {
      description:
        "Execute a single read-only SELECT query against the SQLite database with bound parameters",
      inputSchema: z.object({
        sql: z.string().describe("Single SELECT or WITH query"),
        params: z
          .array(z.union([z.string(), z.number(), z.null()]))
          .optional()
          .describe("Positional parameter bindings"),
      }),
      annotations: {
        readOnlyHint: true,
      },
    },
    async (input) => {
      try {
        const result = db.query(input.sql, input.params);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        const code = err instanceof SqliteMcpError ? err.code : "SQL_ERROR";
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `${code}: ${msg}`,
            },
          ],
        };
      }
    },
  );

  return server;
}
