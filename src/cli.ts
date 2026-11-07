import { readFile } from "node:fs/promises";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { openDatabase } from "./database.js";
import { createServer } from "./server.js";

export interface CliIo {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

/**
 * Runs the CLI over stdio.
 * @param argv - Argument list (e.g. process.argv.slice(2))
 * @param io - Output hooks
 * @returns Exit code: 0 on success, 1 on domain error, 2 on usage/IO error
 */
export async function run(argv: string[], io: CliIo): Promise<number> {
  const [path] = argv;
  if (!path) {
    io.stderr("Usage: mcp-sqlite-readonly <database-path>\n");
    return 2;
  }

  let bytes: Uint8Array;
  try {
    bytes = await readFile(path);
  } catch (err) {
    io.stderr(`Failed to read SQLite file: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  try {
    const db = await openDatabase(bytes);
    const server = createServer(db);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    return 0;
  } catch (err) {
    io.stderr(`Failed to start server: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}
