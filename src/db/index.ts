import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

declare global {
  // eslint-disable-next-line no-var
  var __tutorlinkPool: Pool | undefined;
}

function createPool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return new Pool({
    connectionString: url,
    max: process.env.NODE_ENV === "production" ? 5 : 10,
    ssl: /sslmode=require|neon\.tech|supabase\.co|vercel-storage/.test(url) ? { rejectUnauthorized: false } : undefined,
  });
}

// Reuse the pool across hot reloads / serverless invocations in the same process.
const pool = global.__tutorlinkPool ?? createPool();
if (process.env.NODE_ENV !== "production") global.__tutorlinkPool = pool;

export const db = drizzle(pool, { schema, casing: "snake_case" });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export { schema, pool };
