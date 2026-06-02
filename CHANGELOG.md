# Changelog

All notable changes to this project are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0]

### Added

- **`fetchJson<T>(input, init?)`** — resilient fetch + JSON in one call: retries like `fetchwise`, throws `HttpError` on a non-2xx status (no silently-parsed error pages), returns typed JSON, and serializes a `json` body (setting `Content-Type` + `POST`). 204 → `undefined`.
- **`HttpError`** class carrying `status` and the `Response`.

## [0.1.0]

### Added

- Initial release.
- `fetchwise(input, init?)` — drop-in resilient `fetch` with retries.
- Exponential backoff with full jitter, configurable `minDelay` / `maxDelay` / `factor`.
- Per-attempt `timeout` built on `AbortController`.
- `Retry-After` header support (seconds and HTTP-date).
- Configurable `retryOnStatus` and `retryOnError` policies.
- `onRetry` hook with retry context.
- `create(defaults)` factory for preconfigured clients.
- `parseRetryAfter` and `TimeoutError` exports.
- Ships ESM + CJS with full TypeScript types.

[Unreleased]: https://github.com/didrod205/fetchwise/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/didrod205/fetchwise/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/didrod205/fetchwise/releases/tag/v0.1.0
