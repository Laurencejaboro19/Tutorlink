/**
 * Lets Node/tsx scripts import `server-only` modules (the real package throws outside the
 * Next.js server runtime). Usage: npx tsx --require ./scripts/server-only-shim.cjs <script>
 */
const Module = require("node:module");
const path = require("node:path");
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only") return path.resolve(__dirname, "../src/__tests__/empty.ts");
  return orig.call(this, request, ...rest);
};
