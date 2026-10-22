/**
 * Loads .env.test into process.env. Imported first by setup.ts so that modules which
 * read env at import time (the db pool) see the test configuration.
 */
import fs from "node:fs";
import path from "node:path";

const file = path.resolve(process.cwd(), ".env.test");
if (fs.existsSync(file)) {
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
}
if (!process.env.DATABASE_URL?.includes("_test")) {
  throw new Error("Refusing to run tests: DATABASE_URL in .env.test must point at a *_test database.");
}
