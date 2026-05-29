import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  create,
  fetchwise,
  parseRetryAfter,
  TimeoutError,
} from "../src/fetchwise.js";

/** Build a minimal Response-like object for assertions. */
function res(status: number, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : "body", { status, headers });
}

describe("fetchwise", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("returns immediately on a successful response", async () => {
    const mock = vi.fn().mockResolvedValue(res(200));
    vi.stubGlobal("fetch", mock);

    const response = await fetchwise("https://x.test");

    expect(response.status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("retries retryable status codes and eventually succeeds", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(res(503))
      .mockResolvedValueOnce(res(503))
      .mockResolvedValueOnce(res(200));
    vi.stubGlobal("fetch", mock);

    const promise = fetchwise("https://x.test", { retry: { jitter: false } });
    await vi.runAllTimersAsync();
    const response = await promise;

    expect(response.status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-retryable status codes", async () => {
    const mock = vi.fn().mockResolvedValue(res(404));
    vi.stubGlobal("fetch", mock);

    const response = await fetchwise("https://x.test");

    expect(response.status).toBe(404);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("stops after the configured number of retries", async () => {
    const mock = vi.fn().mockResolvedValue(res(500));
    vi.stubGlobal("fetch", mock);

    const promise = fetchwise("https://x.test", {
      retry: { retries: 2, jitter: false },
    });
    await vi.runAllTimersAsync();
    const response = await promise;

    expect(response.status).toBe(500);
    expect(mock).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("retries thrown network errors", async () => {
    const mock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network error"))
      .mockResolvedValueOnce(res(200));
    vi.stubGlobal("fetch", mock);

    const promise = fetchwise("https://x.test", { retry: { jitter: false } });
    await vi.runAllTimersAsync();
    const response = await promise;

    expect(response.status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("invokes the onRetry hook with context", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(res(503))
      .mockResolvedValueOnce(res(200));
    vi.stubGlobal("fetch", mock);
    const onRetry = vi.fn();

    const promise = fetchwise("https://x.test", {
      retry: { jitter: false, onRetry },
    });
    await vi.runAllTimersAsync();
    await promise;

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0]?.[0]).toMatchObject({
      attempt: 1,
      attempts: 4,
      response: expect.any(Response),
    });
  });

  it("honors the Retry-After header (seconds)", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(res(429, { "retry-after": "5" }))
      .mockResolvedValueOnce(res(200));
    vi.stubGlobal("fetch", mock);
    const onRetry = vi.fn();

    const promise = fetchwise("https://x.test", {
      retry: { jitter: false, onRetry },
    });
    await vi.runAllTimersAsync();
    await promise;

    expect(onRetry.mock.calls[0]?.[0].delay).toBe(5000);
  });

  it("applies a custom retryOnStatus predicate", async () => {
    const mock = vi.fn().mockResolvedValue(res(418));
    vi.stubGlobal("fetch", mock);

    const promise = fetchwise("https://x.test", {
      retry: { retries: 1, jitter: false, retryOnStatus: [418] },
    });
    await vi.runAllTimersAsync();
    await promise;

    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("times out a slow attempt and retries", async () => {
    const mock = vi
      .fn()
      .mockImplementationOnce(
        (_input, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(init.signal?.reason),
            );
          }),
      )
      .mockResolvedValueOnce(res(200));
    vi.stubGlobal("fetch", mock);

    const promise = fetchwise("https://x.test", {
      retry: { timeout: 1000, jitter: false },
    });
    await vi.runAllTimersAsync();
    const response = await promise;

    expect(response.status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("respects an external AbortSignal without retrying", async () => {
    const controller = new AbortController();
    const mock = vi.fn().mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          controller.signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    vi.stubGlobal("fetch", mock);

    const promise = fetchwise("https://x.test", { signal: controller.signal });
    const assertion = expect(promise).rejects.toThrow(/Aborted/);
    controller.abort();
    await assertion;

    expect(mock).toHaveBeenCalledTimes(1);
  });
});

describe("create", () => {
  afterEach(() => vi.restoreAllMocks());

  it("merges per-call options over instance defaults", async () => {
    const mock = vi.fn().mockResolvedValue(res(200));
    vi.stubGlobal("fetch", mock);

    const api = create({ retries: 7 });
    await api("https://x.test");

    expect(mock).toHaveBeenCalledTimes(1);
  });
});

describe("parseRetryAfter", () => {
  it("parses a delay in seconds", () => {
    expect(parseRetryAfter("12")).toBe(12_000);
  });

  it("parses an HTTP date relative to now", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    const later = new Date(now + 4000).toUTCString();
    expect(parseRetryAfter(later, now)).toBe(4000);
  });

  it("returns null for missing or invalid values", () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("not-a-date")).toBeNull();
  });
});
