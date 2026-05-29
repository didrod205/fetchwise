<div align="center">

# fetchwise

**A tiny, zero-dependency resilient `fetch` — retries, exponential backoff, timeouts and `Retry-After`, in ~1 KB gzipped.**

[![npm version](https://img.shields.io/npm/v/fetchwise.svg?color=success)](https://www.npmjs.com/package/fetchwise)
[![bundle size](https://img.shields.io/bundlephobia/minzip/fetchwise?label=gzip)](https://bundlephobia.com/package/fetchwise)
[![CI](https://github.com/didrod205/fetchwise/actions/workflows/ci.yml/badge.svg)](https://github.com/didrod205/fetchwise/actions/workflows/ci.yml)
[![types](https://img.shields.io/npm/types/fetchwise.svg)](https://www.npmjs.com/package/fetchwise)
[![license](https://img.shields.io/npm/l/fetchwise.svg)](./LICENSE)

</div>

`fetchwise` wraps the **native `fetch`** you already use and makes it survive flaky
networks and overloaded servers — without changing the API you know.

```ts
import { fetchwise } from "fetchwise";

// Exactly like fetch, but it retries transient failures automatically.
const res = await fetchwise("https://api.example.com/users");
const users = await res.json();
```

---

## Why fetchwise?

- 🪶 **Zero dependencies.** ~1 KB gzipped. Nothing to audit, nothing to bloat your bundle.
- 🔁 **Smart retries.** Exponential backoff with full jitter, configurable per request.
- ⏱️ **Per-attempt timeouts.** Built on `AbortController` — no hanging requests.
- 🚦 **Respects `Retry-After`.** Honors the server's own backoff hints on `429` / `503`.
- 🌍 **Runs everywhere.** Node 18+, Deno, Bun, Cloudflare Workers and the browser — anywhere `fetch` exists.
- 🧩 **Drop-in.** Same signature as `fetch`. Add resilience by passing one extra `retry` option.
- 🛡️ **Type-safe.** Written in TypeScript, ships full type declarations.

## Install

```bash
npm install fetchwise
# or: pnpm add fetchwise  /  yarn add fetchwise  /  bun add fetchwise
```

No build step needed — it ships ESM **and** CommonJS.

```ts
import { fetchwise } from "fetchwise";       // ESM / TypeScript
const { fetchwise } = require("fetchwise");  // CommonJS
```

## Usage

### Drop-in replacement

Anywhere you call `fetch`, call `fetchwise` instead. By default it makes up to
**4 attempts** (1 + 3 retries) on network errors and on the status codes
`408, 425, 429, 500, 502, 503, 504`.

```ts
const res = await fetchwise("/api/data");
```

### Tune the retry behavior

```ts
const res = await fetchwise("/api/data", {
  method: "POST",
  body: JSON.stringify({ hello: "world" }),
  headers: { "content-type": "application/json" },
  retry: {
    retries: 5,        // up to 6 attempts total
    minDelay: 200,     // first backoff (ms)
    maxDelay: 10_000,  // cap (ms)
    timeout: 4_000,    // abort & retry any attempt slower than 4s
    onRetry: ({ attempt, delay, error, response }) => {
      console.warn(`retry #${attempt} in ${delay}ms`, error ?? response?.status);
    },
  },
});
```

### Create a preconfigured client

Share defaults across your whole app — per-call options are merged on top.

```ts
import { create } from "fetchwise";

const api = create({ retries: 5, timeout: 5_000 });

await api("/users");                       // uses the defaults
await api("/report", { retry: { retries: 0 } }); // override per call
```

### Cancel with an AbortSignal

External aborts are respected immediately and are **never** retried.

```ts
const res = await fetchwise(url, { signal: AbortSignal.timeout(10_000) });
```

### Retry only what you want

```ts
await fetchwise(url, {
  retry: {
    // Custom status policy (array or predicate)
    retryOnStatus: (status) => status >= 500,
    // Custom error policy — e.g. don't retry DNS failures
    retryOnError: (err) => !String(err).includes("ENOTFOUND"),
  },
});
```

## API

### `fetchwise(input, init?) => Promise<Response>`

Identical to `fetch(input, init)`, plus an optional `init.retry` object.
Returns the final `Response`. Retryable statuses are returned as-is once retries
are exhausted (it does **not** throw on HTTP errors — same as `fetch`).

### `create(defaults?) => fetchwise`

Returns a `fetchwise` function with the given `RetryOptions` baked in.

### `RetryOptions`

| Option              | Type                                              | Default                              | Description                                              |
| ------------------- | ------------------------------------------------- | ------------------------------------ | -------------------------------------------------------- |
| `retries`           | `number`                                          | `3`                                  | Additional attempts after the first failure.             |
| `minDelay`          | `number`                                          | `300`                                | Base backoff delay in ms.                                |
| `maxDelay`          | `number`                                          | `30000`                              | Maximum delay between attempts in ms.                    |
| `factor`            | `number`                                          | `2`                                  | Exponential backoff multiplier.                          |
| `jitter`            | `boolean`                                         | `true`                               | Apply full random jitter to each delay.                  |
| `timeout`           | `number`                                          | `0` (off)                            | Per-attempt timeout in ms.                               |
| `retryOnStatus`     | `number[] \| (status, response) => boolean`       | `[408,425,429,500,502,503,504]`      | Which statuses to retry.                                 |
| `retryOnError`      | `(error, context) => boolean`                     | retry all but external aborts        | Whether a thrown error is retryable.                     |
| `respectRetryAfter` | `boolean`                                         | `true`                               | Honor the `Retry-After` response header.                 |
| `onRetry`           | `(context) => void`                               | —                                    | Hook fired before each retry.                            |

### Other exports

- `TimeoutError` — thrown internally when a `timeout` elapses (retried like any error).
- `parseRetryAfter(value, now?)` — parse a `Retry-After` header into milliseconds.

## How backoff works

Each retry waits `min(maxDelay, minDelay × factor^(attempt-1))`, then — with
`jitter` on (the default) — a random value between `0` and that ceiling. Full
jitter spreads out retries from many clients so they don't stampede a recovering
server. If the response carries a `Retry-After` header, that value wins.

## Comparison

|                          | `fetchwise` | hand-rolled `try/catch` loop | heavier HTTP clients |
| ------------------------ | :---------: | :--------------------------: | :------------------: |
| Zero dependencies        |     ✅      |              ✅              |          ❌          |
| Native `fetch` signature |     ✅      |              ⚠️              |          ❌          |
| Backoff + jitter         |     ✅      |              ❌              |          ✅          |
| `Retry-After` support    |     ✅      |              ❌              |         ⚠️           |
| Per-attempt timeout      |     ✅      |              ❌              |          ✅          |
| ~1 KB gzipped            |     ✅      |              —               |          ❌          |

## Contributing

Contributions are very welcome! Please read [CONTRIBUTING.md](./CONTRIBUTING.md)
and our [Code of Conduct](./CODE_OF_CONDUCT.md). Good first issues are labeled
[`good first issue`](https://github.com/didrod205/fetchwise/labels/good%20first%20issue).

```bash
git clone https://github.com/didrod205/fetchwise.git
cd fetchwise
npm install
npm test
```

## 💖 Sponsor

`fetchwise` is free and MIT-licensed, built and maintained in spare time. If it
saves you from writing yet another retry loop, please consider supporting it —
every bit helps keep the project healthy and the issues answered.

- ⭐ **Star this repo** — the simplest, free way to help others discover it.
- 🍋 **[Sponsor via Lemon Squeezy](https://elab-studio.lemonsqueezy.com/checkout/buy/5d059b89-51d0-456b-b33a-ed56994f7010)** — one-time or recurring support.

> Sponsoring? Open an issue and we'll add your name/logo here. Thank you! 🙏

## License

[MIT](./LICENSE) © fetchwise contributors
