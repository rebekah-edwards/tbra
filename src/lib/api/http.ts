import { NextResponse } from "next/server";

/** Standard error body: { error: string } with the given status. */
export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/** Success body: { ok: true, ...data }. */
export function jsonOk(data: Record<string, unknown> = {}, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}

/** Parse a JSON request body, returning null on malformed/non-object input. */
export async function parseJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

export function asOptionalString(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return typeof v === "string" ? v : undefined;
}

export function asOptionalBoolean(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

/** A non-empty array of strings, or null if the value isn't one. */
export function asStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  return v.every((x) => typeof x === "string") ? (v as string[]) : null;
}

/** True iff a and b contain exactly the same members (order-independent). */
export function sameMembers(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  if (setB.size !== a.length) return false; // duplicates in a
  return a.every((x) => setB.has(x));
}
