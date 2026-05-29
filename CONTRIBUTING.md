# Contributing to fetchwise

Thanks for taking the time to contribute! 🎉 This project aims to stay tiny,
dependency-free and easy to reason about — contributions are reviewed with that
in mind.

## Getting started

```bash
git clone https://github.com/USER/fetchwise.git
cd fetchwise
npm install
```

Common scripts:

| Command             | What it does                          |
| ------------------- | ------------------------------------- |
| `npm test`          | Run the test suite once (Vitest).     |
| `npm run test:watch`| Re-run tests on change.               |
| `npm run typecheck` | Type-check without emitting.          |
| `npm run coverage`  | Run tests with coverage.              |
| `npm run build`     | Build the `dist/` bundle (tsup).      |

## Pull requests

1. Fork the repo and create a topic branch (`fix/retry-after-date`).
2. Add or update tests — every behavior change needs coverage.
3. Make sure `npm run typecheck` and `npm test` pass.
4. Keep the public API small and the bundle zero-dependency.
5. Open the PR with a clear description of the problem and the fix.

## Reporting bugs

Open an issue with a minimal reproduction (a code snippet or a failing test is
ideal), plus your runtime (Node/Deno/Bun/browser) and version.

## Code style

The project uses TypeScript in `strict` mode. There's no separate linter — the
compiler is the source of truth. Prefer clarity over cleverness.

By contributing you agree that your contributions are licensed under the
project's [MIT License](./LICENSE).
