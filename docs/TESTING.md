# Testing Strategy

Testing is performed via Vitest, covering functionality and security edge cases.

## Test Files

- `test/database.test.ts`: Covers `ReadonlyDb` lifecycle, query execution, parameter handling, truncation logic, and read-only pragma enforcement.
- `test/server.test.ts`: Covers MCP tool registration, annotation enforcement (`readOnlyHint: true`), and tool-level error handling.
- `test/cli.test.ts`: Covers `run()` function in the CLI, including IO handling and exit code propagation.
- `test/security.test.ts`: Adversarial testing. Each test verifies a specific defense in the threat model (e.g., blocking write keywords, blocking multiple statements, SQL injection mitigation).
- `test/index.test.ts`: Smoke test for package exports.
