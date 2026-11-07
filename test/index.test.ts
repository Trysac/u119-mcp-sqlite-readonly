import { describe, expect, it } from "vitest";
import { checkSql, createServer, openDatabase, SqliteMcpError } from "../src/index.js";

describe("public exports", () => {
  it("exports core APIs", () => {
    expect(typeof openDatabase).toBe("function");
    expect(typeof createServer).toBe("function");
    expect(typeof checkSql).toBe("function");
    expect(typeof SqliteMcpError).toBe("function");
  });
});
