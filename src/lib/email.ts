import "server-only";

/**
 * Email delivery. Uses Resend when RESEND_API_KEY is configured. Otherwise the
 * message is logged server-side and (outside production only) the verification
 * link is returned so the UI can show it — delivery is never claimed when it
 * has not happened.
 */
export type SentEmail = { delivered: boolean; debugLink?: string; error?: string };

export async function sendEmail(opts: { to: string; subject: string; html: string; text: string; debugLink?: string }): Promise<SentEmail> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.info(`[email:not-configured] to=${opts.to} subject="${opts.subject}"${opts.debugLink ? ` link=${opts.debugLink}` : ""}`);
    return { delivered: false, debugLink: process.env.NODE_ENV === "production" ? undefined : opts.debugLink };
  }
  try {
    const { Resend } = await import("resend");
    const resend = new Resend(key);
    const res = await resend.emails.send({
      from: process.env.EMAIL_FROM ?? "TutorLink <onboarding@resend.dev>",
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });
    if (res.error) return { delivered: false, error: res.error.message };
    return { delivered: true };
  } catch (e) {
    return { delivered: false, error: e instanceof Error ? e.message : "send failed" };
  }
}

export function appUrl(path = "") {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return base + path;
}
