// Run with: node examples/basic.mjs
// (after `npm run build`, this imports the built bundle)
import { create, fetchwise } from "../dist/index.js";

// 1. Drop-in usage — retries transient failures automatically.
const res = await fetchwise("https://httpbin.org/status/503", {
  retry: {
    retries: 2,
    minDelay: 200,
    onRetry: ({ attempt, delay, response }) =>
      console.log(`retry #${attempt} after ${delay}ms (status ${response?.status})`),
  },
});
console.log("final status:", res.status);

// 2. Preconfigured client with a per-attempt timeout.
const api = create({ retries: 3, timeout: 5_000 });
const ok = await api("https://httpbin.org/json");
console.log("json keys:", Object.keys(await ok.json()));
