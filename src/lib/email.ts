import "server-only";

/**
 * Email delivery. Providers, in order of preference:
 *   1. SMTP (SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS) — e.g. Gmail with an App Password
 *   2. Resend (RESEND_API_KEY)
 * When neither is configured the message is logged server-side. The verification link is
 * returned to the UI only outside production, or when EMAIL_DEBUG_LINKS=true (a temporary
 * operator switch for first setup — turn it off once a provider is configured, because it
 * lets anyone complete verification without owning the inbox).
 * Delivery is never claimed when it has not happened.
 */
export type SentEmail = { delivered: boolean; debugLink?: string; error?: string };

function debugLinksAllowed() {
  return process.env.NODE_ENV !== "production" || process.env.EMAIL_DEBUG_LINKS === "true";
}

export async function sendEmail(opts: { to: string; subject: string; html: string; text: string; debugLink?: string }): Promise<SentEmail> {
  const from = process.env.EMAIL_FROM ?? "TutorLink <no-reply@tutorlink.ng>";
  const debugLink = debugLinksAllowed() ? opts.debugLink : undefined;

  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      const nodemailer = await import("nodemailer");
      const port = Number(process.env.SMTP_PORT ?? 465);
      const transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: port === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
      await transport.sendMail({ from, to: opts.to, subject: opts.subject, text: opts.text, html: opts.html });
      return { delivered: true };
    } catch (e) {
      console.error("[email:smtp] failed", e instanceof Error ? e.message : e);
      return { delivered: false, error: e instanceof Error ? e.message : "send failed", debugLink };
    }
  }

  const key = process.env.RESEND_API_KEY;
  if (key) {
    try {
      const { Resend } = await import("resend");
      const resend = new Resend(key);
      const res = await resend.emails.send({ from, to: opts.to, subject: opts.subject, html: opts.html, text: opts.text });
      if (res.error) return { delivered: false, error: res.error.message, debugLink };
      return { delivered: true };
    } catch (e) {
      return { delivered: false, error: e instanceof Error ? e.message : "send failed", debugLink };
    }
  }

  console.info(`[email:not-configured] to=${opts.to} subject="${opts.subject}"${opts.debugLink ? ` link=${opts.debugLink}` : ""}`);
  return { delivered: false, debugLink };
}

export function appUrl(path = "") {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return base + path;
}
