import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for small secrets at rest (e.g. bank account numbers).
 * The key is derived from AUTH_SECRET (sha256), so rotating AUTH_SECRET invalidates
 * stored ciphertexts — re-collect the values after a rotation.
 *
 * Format: base64url(iv[12] || tag[16] || ciphertext), prefixed with "v1:".
 */

const PREFIX = "v1:";

function key(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) throw new Error("AUTH_SECRET is not configured (needed to encrypt stored secrets).");
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString("base64url");
}

export function decryptSecret(payload: string): string {
  if (!payload.startsWith(PREFIX)) throw new Error("Unknown ciphertext format.");
  const buf = Buffer.from(payload.slice(PREFIX.length), "base64url");
  if (buf.length < 28) throw new Error("Ciphertext too short.");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
