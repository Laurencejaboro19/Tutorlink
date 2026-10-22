import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { flutterwaveConfigured, flutterwaveMode } from "@/server/flutterwave";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ ok: true, db: "up", payments: flutterwaveConfigured() ? flutterwaveMode() : "unconfigured", time: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ ok: false, db: "down", error: e instanceof Error ? e.message : "unknown" }, { status: 503 });
  }
}
