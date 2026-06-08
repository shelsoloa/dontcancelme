import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * App-side AES-256-GCM for the OAuth token blob stored in `connection_secrets`.
 * The 256-bit key comes from `APP_ENCRYPTION_KEY` (base64). A fresh 12-byte
 * nonce is generated per write (the `secret_nonce` column); the 16-byte GCM auth
 * tag is appended to the ciphertext stored in `secret_enc`.
 */

const ALGO = "aes-256-gcm";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

function key(): Buffer {
  const b64 = process.env.APP_ENCRYPTION_KEY;
  if (!b64) throw new Error("APP_ENCRYPTION_KEY is not set");
  const k = Buffer.from(b64, "base64");
  if (k.length !== 32) {
    throw new Error("APP_ENCRYPTION_KEY must decode to 32 bytes (base64)");
  }
  return k;
}

export type EncryptedSecret = { enc: Buffer; nonce: Buffer };

/** Encrypt a JSON-serializable value. `enc` = ciphertext || authTag. */
export function encryptSecret(value: unknown): EncryptedSecret {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGO, key(), nonce);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { enc: Buffer.concat([ciphertext, tag]), nonce };
}

/** Decrypt a blob produced by {@link encryptSecret}. */
export function decryptSecret<T = unknown>(enc: Buffer, nonce: Buffer): T {
  const tag = enc.subarray(enc.length - TAG_BYTES);
  const ciphertext = enc.subarray(0, enc.length - TAG_BYTES);
  const decipher = createDecipheriv(ALGO, key(), nonce);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}

/** Encode a Buffer for a Postgres `bytea` column (hex input format). */
export function toBytea(buf: Buffer): string {
  return `\\x${buf.toString("hex")}`;
}

/** Decode a `bytea` value returned by PostgREST (hex `\x…`) back to a Buffer. */
export function fromBytea(value: string): Buffer {
  return Buffer.from(value.startsWith("\\x") ? value.slice(2) : value, "hex");
}
