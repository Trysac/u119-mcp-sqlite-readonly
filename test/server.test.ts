import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import initSqlJs from "sql.js";
import { describe, expect, it } from "vitest";
import { createServer, openDatabase } from "../src/index.js";

describe("McpServer read-only tools", () => {
  it("Through an InMemoryTransport client, tools/list returns names ['describe_table', 'list_tables', 'query'] each with annotations.readOnlyHint === true, and calling query with sql 'DROP TABLE t' returns isError true with text 'NOT_READ_ONLY: only single SELECT or WITH statements are allowed'", async () => {
    const SQL = await initSqlJs();
    const base = new SQL.Database();
    base.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT);");
    const bytes = base.export();
    base.close();

    const db = await openDatabase(bytes);
    const server = createServer(db);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const toolsList = await client.listTools();
    const toolNames = toolsList.tools.map((t) => t.name);
    expect(toolNames).toEqual(["describe_table", "list_tables", "query"]);

    for (const tool of toolsList.tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }

    const dropRes = await client.callTool({
      name: "query",
      arguments: { sql: "DROP TABLE t" },
    });

    expect(dropRes.isError).toBe(true);
    const dropContent = dropRes.content as Array<{ type: string; text: string }>;
    const firstContent = dropContent[0];
    expect(firstContent?.text).toBe(
      "NOT_READ_ONLY: only single SELECT or WITH statements are allowed",
    );

    const listRes = await client.callTool({ name: "list_tables", arguments: {} });
    expect(listRes.isError).toBeFalsy();
    const listContent = listRes.content as Array<{ text: string }>;
    const listJson = JSON.parse(listContent[0]?.text ?? "");
    expect(listJson).toEqual(["t"]);

    const descRes = await client.callTool({ name: "describe_table", arguments: { table: "t" } });
    expect(descRes.isError).toBeFalsy();
    const descContent = descRes.content as Array<{ text: string }>;
    const descJson = JSON.parse(descContent[0]?.text ?? "");
    expect(descJson.length).toBe(2);

    const descError = await client.callTool({
      name: "describe_table",
      arguments: { table: "unknown" },
    });
    expect(descError.isError).toBe(true);
    const descErrorContent = descError.content as Array<{ text: string }>;
    expect(descErrorContent[0]?.text).toContain("UNKNOWN_TABLE");

    await client.close();
    db.close();
  });
});
