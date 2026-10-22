/** Uniform return shape for server actions used with useActionState. */
export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export function fail(error: string, fieldErrors?: Record<string, string[]>): ActionResult<never> {
  return { ok: false, error, fieldErrors };
}

export function succeed<T>(data?: T, message?: string): ActionResult<T> {
  return { ok: true, data, message };
}

export class DomainError extends Error {
  constructor(
    message: string,
    public code: string = "domain_error",
  ) {
    super(message);
  }
}

/** Convert thrown errors into ActionResult without leaking internals. */
export function toActionError(e: unknown): ActionResult<never> {
  if (e instanceof DomainError) return fail(e.message);
  if (e && typeof e === "object" && "status" in e && "message" in e) return fail(String((e as { message: unknown }).message));
  console.error(e);
  return fail("Something went wrong. Please try again.");
}
