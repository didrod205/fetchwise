/**
 * fetchwise — a tiny, zero-dependency resilient wrapper around the native
 * `fetch` API. Adds retries with exponential backoff + jitter, per-attempt
 * timeouts, and `Retry-After` awareness, while staying 100% compatible with
 * the standard `fetch` signature.
 */

/** Information passed to the `onRetry` hook before each retry. */
export interface RetryContext {
  /** 1-based number of the attempt that just failed. */
  attempt: number;
  /** Total attempts that will be made (`retries` + 1). */
  attempts: number;
  /** Delay in milliseconds before the next attempt. */
  delay: number;
  /** The error thrown, if the attempt failed without a response. */
  error?: unknown;
  /** The response received, if the attempt completed but was retryable. */
  response?: Response;
}

export interface RetryOptions {
  /**
   * Number of *additional* attempts after the first one fails.
   * `retries: 3` means up to 4 requests in total. Default: `3`.
   */
  retries?: number;
  /** Base delay in milliseconds for the first retry. Default: `300`. */
  minDelay?: number;
  /** Maximum delay in milliseconds between attempts. Default: `30_000`. */
  maxDelay?: number;
  /** Exponential backoff multiplier. Default: `2`. */
  factor?: number;
  /** Apply full random jitter to each delay. Default: `true`. */
  jitter?: boolean;
  /**
   * Abort a single attempt after this many milliseconds. The request is
   * retried like any other failure. Default: `0` (disabled).
   */
  timeout?: number;
  /**
   * Which HTTP status codes should trigger a retry. Provide an array of codes
   * or a predicate. Default: `[408, 425, 429, 500, 502, 503, 504]`.
   */
  retryOnStatus?: number[] | ((status: number, response: Response) => boolean);
  /**
   * Decide whether a thrown error (network failure, timeout, …) is retryable.
   * Default: retry every error except an external `AbortSignal` abort.
   */
  retryOnError?: (error: unknown, context: RetryContext) => boolean;
  /**
   * Honor the `Retry-After` response header (seconds or HTTP-date) when present
   * on a retryable response. Default: `true`.
   */
  respectRetryAfter?: boolean;
  /** Called right before the runner sleeps and retries. */
  onRetry?: (context: RetryContext) => void;
}

export interface FetchwiseInit extends RequestInit {
  /** Resilience options. */
  retry?: RetryOptions;
}

export type Fetchwise = (
  input: RequestInfo | URL,
  init?: FetchwiseInit,
) => Promise<Response>;

const DEFAULTS: Required<Omit<RetryOptions, "retryOnError" | "onRetry">> = {
  retries: 3,
  minDelay: 300,
  maxDelay: 30_000,
  factor: 2,
  jitter: true,
  timeout: 0,
  retryOnStatus: [408, 425, 429, 500, 502, 503, 504],
  respectRetryAfter: true,
};

/** Error thrown when a per-attempt `timeout` elapses. */
export class TimeoutError extends Error {
  constructor(timeout: number) {
    super(`Request timed out after ${timeout}ms`);
    this.name = "TimeoutError";
  }
}

const isFunction = (value: unknown): value is (...args: never[]) => unknown =>
  typeof value === "function";

function shouldRetryStatus(
  response: Response,
  rule: NonNullable<RetryOptions["retryOnStatus"]>,
): boolean {
  return isFunction(rule)
    ? rule(response.status, response)
    : rule.includes(response.status);
}

/** Parse a `Retry-After` header into milliseconds, or `null` if absent/invalid. */
export function parseRetryAfter(
  value: string | null,
  now: number = Date.now(),
): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - now);
}

function backoffDelay(attempt: number, options: typeof DEFAULTS): number {
  const exponential = options.minDelay * options.factor ** (attempt - 1);
  const capped = Math.min(options.maxDelay, exponential);
  if (!options.jitter) return Math.round(capped);
  return Math.round(Math.random() * capped);
}

function delayBeforeRetry(
  attempt: number,
  options: typeof DEFAULTS,
  response?: Response,
): number {
  if (response && options.respectRetryAfter) {
    const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
    if (retryAfter !== null) return Math.min(options.maxDelay, retryAfter);
  }
  return backoffDelay(attempt, options);
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Run a single fetch attempt, layering an optional per-attempt timeout on top
 * of any caller-supplied `AbortSignal`.
 */
async function attemptFetch(
  input: RequestInfo | URL,
  init: RequestInit,
  timeout: number,
): Promise<Response> {
  if (timeout <= 0) return fetch(input, init);

  const controller = new AbortController();
  const external = init.signal;
  const onExternalAbort = () =>
    controller.abort(external?.reason ?? new DOMException("Aborted", "AbortError"));

  if (external) {
    if (external.aborted) onExternalAbort();
    else external.addEventListener("abort", onExternalAbort, { once: true });
  }

  const timer = setTimeout(() => controller.abort(new TimeoutError(timeout)), timeout);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    // Surface a clear TimeoutError instead of a generic AbortError.
    if (controller.signal.reason instanceof TimeoutError) {
      throw controller.signal.reason;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    external?.removeEventListener("abort", onExternalAbort);
  }
}

function isExternalAbort(error: unknown, signal?: AbortSignal | null): boolean {
  return Boolean(
    signal?.aborted &&
      error instanceof Error &&
      error.name === "AbortError",
  );
}

/**
 * A drop-in `fetch` that automatically retries failed requests.
 *
 * ```ts
 * const res = await fetchwise("https://api.example.com/data", {
 *   retry: { retries: 5, timeout: 4000 },
 * });
 * ```
 */
export async function fetchwise(
  input: RequestInfo | URL,
  init: FetchwiseInit = {},
): Promise<Response> {
  const { retry, ...requestInit } = init;
  const options = { ...DEFAULTS, ...retry };
  const attempts = Math.max(0, options.retries) + 1;
  const signal = requestInit.signal;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const isLast = attempt === attempts;
    try {
      const response = await attemptFetch(input, requestInit, options.timeout);
      if (isLast || !shouldRetryStatus(response, options.retryOnStatus)) {
        return response;
      }
      const delay = delayBeforeRetry(attempt, options, response);
      const context: RetryContext = { attempt, attempts, delay, response };
      retry?.onRetry?.(context);
      await sleep(delay, signal);
      // Drain the unused body so connections can be reused.
      response.body?.cancel().catch(() => {});
    } catch (error) {
      lastError = error;
      if (isExternalAbort(error, signal)) throw error;

      const delay = delayBeforeRetry(attempt, options);
      const context: RetryContext = { attempt, attempts, delay, error };
      const retryable = retry?.retryOnError
        ? retry.retryOnError(error, context)
        : !(error instanceof TimeoutError && isLast);

      if (isLast || !retryable) throw error;

      retry?.onRetry?.(context);
      await sleep(delay, signal);
    }
  }

  // Unreachable in practice: the loop always returns or throws above.
  throw lastError ?? new Error("fetchwise: exhausted retries");
}

/**
 * Create a preconfigured `fetchwise` instance. Per-call `retry` options are
 * shallow-merged over these defaults.
 *
 * ```ts
 * const api = create({ retries: 5, timeout: 5000 });
 * await api("/users");
 * ```
 */
export function create(defaults: RetryOptions = {}): Fetchwise {
  return (input, init = {}) =>
    fetchwise(input, { ...init, retry: { ...defaults, ...init.retry } });
}

/**
 * Thrown by {@link fetchJson} when the response status is not 2xx. Carries the
 * status and the `Response` so callers can inspect headers or read the body.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly response: Response;
  constructor(response: Response) {
    super(`HTTP ${response.status} ${response.statusText} for ${response.url}`);
    this.name = "HttpError";
    this.status = response.status;
    this.response = response;
  }
}

/**
 * Resilient fetch **plus** JSON: retries like {@link fetchwise}, throws
 * {@link HttpError} on a non-2xx status (so you never silently parse an error
 * page), and returns the decoded JSON typed as `T`. Pass `json` to serialize a
 * request body and set `Content-Type: application/json` automatically.
 *
 * ```ts
 * const user = await fetchJson<User>("/api/users/1");
 * const created = await fetchJson<User>("/api/users", { json: { name: "Ada" } });
 * ```
 */
export async function fetchJson<T = unknown>(
  input: RequestInfo | URL,
  init: FetchwiseInit & { json?: unknown } = {},
): Promise<T> {
  const { json, ...rest } = init;
  let final: FetchwiseInit = rest;
  if (json !== undefined) {
    const headers = new Headers(rest.headers);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    final = { ...rest, headers, body: JSON.stringify(json) };
    if (final.method === undefined) final.method = "POST";
  }
  const response = await fetchwise(input, final);
  if (!response.ok) throw new HttpError(response);
  if (response.status === 204) return undefined as T; // No Content
  return (await response.json()) as T;
}
