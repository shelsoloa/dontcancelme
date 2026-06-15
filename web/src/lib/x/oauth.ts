import "server-only";
import type { Session } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  decryptSecret,
  encryptSecret,
  fromBytea,
  toBytea,
} from "@/lib/crypto";

/**
 * X OAuth 2.0 token lifecycle (confidential client). Tokens live encrypted in
 * `connection_secrets` (service-role only) and are refreshed against X's token
 * endpoint as needed. Nothing here is ever returned to the browser.
 */

const TOKEN_URL = "https://api.x.com/2/oauth2/token";
/** X access tokens last ~2h; we refresh within this window of expiry. */
const REFRESH_SKEW_MS = 60_000;
const DEFAULT_EXPIRES_SEC = 7200;

type StoredTokens = { access_token: string; refresh_token?: string };

function clientCreds() {
  const id = process.env.X_CLIENT_ID;
  const secret = process.env.X_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error("X_CLIENT_ID / X_CLIENT_SECRET are not set");
  }
  return { id, secret };
}

type RefreshResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
};

async function refreshAccessToken(refreshToken: string): Promise<RefreshResponse> {
  const { id, secret } = clientCreds();
  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: id,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`X token refresh failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/** Encrypt + upsert a token set for a connection and update its expiry. */
async function saveConnectionTokens(
  connectionId: string,
  tokens: StoredTokens,
  expiresInSec = DEFAULT_EXPIRES_SEC,
): Promise<void> {
  const admin = createAdminClient();
  const { enc, nonce } = encryptSecret(tokens);
  const { error } = await admin.from("connection_secrets").upsert({
    connection_id: connectionId,
    secret_enc: toBytea(enc),
    secret_nonce: toBytea(nonce),
  });
  if (error) throw new Error(`Failed to store connection secret: ${error.message}`);

  await admin
    .from("connections")
    .update({
      token_expires_at: new Date(Date.now() + expiresInSec * 1000).toISOString(),
      status: "active",
    })
    .eq("id", connectionId);
}

/**
 * Capture the X tokens from a freshly-exchanged Supabase session: upsert the
 * `connections` row and store the encrypted token blob. Best-effort — the caller
 * should not fail login if this throws.
 */
export async function captureXConnection(session: Session): Promise<void> {
  const user = session.user;
  if (user.app_metadata?.provider !== "x") return;
  if (!session.provider_token) return;

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const handle =
    (meta.user_name as string) ??
    (meta.preferred_username as string) ??
    (meta.screen_name as string) ??
    "unknown";
  const platformUserId = String(
    meta.provider_id ?? meta.sub ?? meta.user_id ?? user.id,
  );

  const admin = createAdminClient();
  const { data: conn, error } = await admin
    .from("connections")
    .upsert(
      {
        user_id: user.id,
        platform: "x",
        handle,
        platform_user_id: platformUserId,
        scopes: ["users.read", "tweet.read", "tweet.write", "like.read", "like.write", "offline.access"],
        status: "active",
      },
      { onConflict: "user_id,platform,platform_user_id" },
    )
    .select("id")
    .single();
  if (error || !conn) throw error ?? new Error("connection upsert failed");

  await saveConnectionTokens(conn.id, {
    access_token: session.provider_token,
    refresh_token: session.provider_refresh_token ?? undefined,
  });
}

/** Resolve the connection to use for a job (job's own, else newest active). */
export async function resolveConnectionId(
  userId: string,
  jobConnectionId?: string | null,
): Promise<string | null> {
  if (jobConnectionId) return jobConnectionId;
  const admin = createAdminClient();
  const { data } = await admin
    .from("connections")
    .select("id")
    .eq("user_id", userId)
    .eq("platform", "x")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

/** Return a valid access token for a connection, refreshing if near expiry. */
export async function getValidToken(connectionId: string): Promise<string> {
  const admin = createAdminClient();
  const { data: secret, error } = await admin
    .from("connection_secrets")
    .select("secret_enc, secret_nonce")
    .eq("connection_id", connectionId)
    .maybeSingle();
  if (error || !secret) throw new Error("No stored credentials for this connection.");

  const tokens = decryptSecret<StoredTokens>(
    fromBytea(secret.secret_enc),
    fromBytea(secret.secret_nonce),
  );

  const { data: conn } = await admin
    .from("connections")
    .select("token_expires_at")
    .eq("id", connectionId)
    .maybeSingle();

  const expMs = conn?.token_expires_at
    ? new Date(conn.token_expires_at).getTime()
    : 0;
  const needsRefresh = !expMs || expMs - Date.now() < REFRESH_SKEW_MS;

  if (needsRefresh && tokens.refresh_token) {
    const refreshed = await refreshAccessToken(tokens.refresh_token);
    await saveConnectionTokens(
      connectionId,
      {
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token ?? tokens.refresh_token,
      },
      refreshed.expires_in,
    );
    return refreshed.access_token;
  }

  return tokens.access_token;
}
