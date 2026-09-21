## Development Guidelines

- Use `pnpm` for package management.
- The frontend is built with Astro. Use the Astro MCP whenever possible to produce high-quality, framework-aligned code.
- The backend is built with FastAPI. Follow FastAPI best practices and use:
  - `@llm-docs/fastapi/llm.txt`
  - `@docs/fastapi/DOCS_MAP.md`
  as the primary documentation sources.

- For Supabase, use the Supabase MCP for all database operations, schema management, migrations, and data access whenever possible.
- For Qdrant, use the available skills/tools to manage collections, vectors, indexing, querying, and related operations instead of building custom solutions.

- Do not reinvent the wheel. Prefer best-in-class, well-maintained libraries over custom implementations. Ask for permission before adding new dependencies.
- Use `Vitest` for testing.
- Do not write slow tests. Keep tests fast, deterministic, and efficient.
- Keep your code modular and reusable, and avoid duplication wherever possible.
- If a file grows beyond 400 lines, consider splitting it into smaller, more manageable modules.
- Write clear and concise documentation to make the code easier to understand and maintain.
- Regularly review and refactor code to improve quality and maintainability.
- Maintain high code quality, strong reusability, and meaningful test coverage.
- Write tests to ensure correctness and catch regressions early.
- Write tests that verify actual behavior, so they fail when the underlying implementation is removed or broken.
- Maintain a strong ESLint configuration and address issues rather than suppressing them.
- Follow clean code principles and established best practices for Astro, FastAPI, TypeScript, and Vitest.