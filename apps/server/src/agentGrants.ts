import { createHash, randomBytes } from "node:crypto";
import { createMiddleware } from "hono/factory";
import { isRole, type AgentGrantView, type Role } from "@er/shared";
import { db } from "./db";
import { valkey } from "./valkey";

// AI agents connected to a staff account (SPEC 6.7). A person signs in on the OAuth page and the
// agent receives tokens bound to that account: it acts AS that person, with that person's role,
// but only on the /api/agent routes (every other route reads the staff session cookie, so a
// Bearer token there gets 401). Tokens are stored as SHA-256 only and never logged or audited.

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const AGENT_RATE_LIMIT = 60;
const RATE_WINDOW_SECONDS = 60;
export const AGENT_SCOPE = "imports";

const ACCESS_PREFIX = "hr_at_";
const REFRESH_PREFIX = "hr_rt_";

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const randomToken = (prefix: string) => `${prefix}${randomBytes(32).toString("base64url")}`;

/** How the agent appears in the audit log and on batches: "agente de <staff name>". */
export const agentActorLabel = (userName: string) => `agente de ${userName}`;

/** Client names come from the agent itself (dynamic registration): plain text, bounded. */
export function cleanClientName(raw: unknown): string {
  const text = typeof raw === "string" ? raw.replace(/[\p{C}<>]/gu, " ").replace(/\s+/g, " ").trim() : "";
  return text.slice(0, 80) || "Agente de IA";
}

export interface IssuedTokens {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

function newTokenPair(now = Date.now()) {
  const access = randomToken(ACCESS_PREFIX);
  const refresh = randomToken(REFRESH_PREFIX);
  return {
    access,
    refresh,
    data: {
      accessTokenHash: sha256(access),
      accessExpiresAt: new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000),
      refreshTokenHash: sha256(refresh),
      refreshExpiresAt: new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000),
    },
  };
}

const issued = (access: string, refresh: string): IssuedTokens => ({
  access_token: access,
  token_type: "Bearer",
  expires_in: ACCESS_TOKEN_TTL_SECONDS,
  refresh_token: refresh,
  scope: AGENT_SCOPE,
});

/** New grant for a staff user after they signed in and approved the agent. */
export async function createGrant(input: { userId: string; clientId: string; clientName: string }) {
  const pair = newTokenPair();
  const grant = await db.agentGrant.create({
    data: { userId: input.userId, clientId: input.clientId, clientName: input.clientName, scopes: AGENT_SCOPE, ...pair.data },
  });
  return { grant, tokens: issued(pair.access, pair.refresh) };
}

/** Refresh: rotates both tokens. Null when the refresh token is unknown, expired, revoked or not this client's. */
export async function refreshGrant(refreshToken: string, clientId: string) {
  if (!refreshToken.startsWith(REFRESH_PREFIX)) return null;
  const grant = await db.agentGrant.findUnique({ where: { refreshTokenHash: sha256(refreshToken) } });
  if (!grant || grant.revokedAt || grant.refreshExpiresAt <= new Date() || grant.clientId !== clientId) return null;
  const user = await db.user.findUnique({ where: { id: grant.userId }, select: { active: true } });
  if (!user?.active) return null;
  const pair = newTokenPair();
  // Only the holder of the current refresh token can rotate it (no double use).
  const rotated = await db.agentGrant.updateMany({
    where: { id: grant.id, refreshTokenHash: grant.refreshTokenHash, revokedAt: null },
    data: pair.data,
  });
  if (rotated.count === 0) return null;
  return { grant, tokens: issued(pair.access, pair.refresh) };
}

export interface AgentIdentity {
  grantId: string;
  userId: string;
  userName: string;
  role: Role;
  clientName: string;
  /** Audit actor and batch creator: "agente de <staff name>". */
  actorId: string;
}

/** Resolves an access token to its live grant and active staff user, or null. */
export async function resolveAccessToken(token: string): Promise<AgentIdentity | null> {
  if (!token.startsWith(ACCESS_PREFIX)) return null;
  const grant = await db.agentGrant.findUnique({ where: { accessTokenHash: sha256(token) } });
  if (!grant || grant.revokedAt || grant.accessExpiresAt <= new Date()) return null;
  const user = await db.user.findUnique({ where: { id: grant.userId } });
  if (!user || !user.active || !isRole(user.role)) return null;
  return {
    grantId: grant.id,
    userId: user.id,
    userName: user.name,
    role: user.role,
    clientName: grant.clientName,
    actorId: agentActorLabel(user.name),
  };
}

export type AgentEnv = { Variables: { agent: AgentIdentity } };

/** Authorization: Bearer <access token> -> the staff user the agent acts as. 401 otherwise. */
export const requireAgent = createMiddleware<AgentEnv>(async (c, next) => {
  const match = /^Bearer\s+(\S+)$/.exec(c.req.header("authorization") ?? "");
  const agent = match ? await resolveAccessToken(match[1]) : null;
  if (!agent) {
    c.header("WWW-Authenticate", 'Bearer error="invalid_token"');
    return c.json({ error: "Invalid, expired or revoked access token. Sign in again." }, 401);
  }
  c.set("agent", agent);
  await next();
});

/** Fixed window per grant in Valkey; also records when the agent was last used. */
export const agentRateLimit = createMiddleware<AgentEnv>(async (c, next) => {
  const agent = c.get("agent");
  const key = `ratelimit:agent:${agent.grantId}`;
  const count = await valkey.incr(key);
  if (count === 1) await valkey.expire(key, RATE_WINDOW_SECONDS);
  if (count > AGENT_RATE_LIMIT) {
    return c.json({ error: `Demasiadas solicitudes: máximo ${AGENT_RATE_LIMIT} por minuto. Espera un momento.` }, 429);
  }
  await db.agentGrant.update({ where: { id: agent.grantId }, data: { lastUsedAt: new Date() } });
  await next();
});

export function toGrantView(
  grant: { id: string; clientName: string; userId: string; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null },
  userName: string,
  viewerId: string,
): AgentGrantView {
  return {
    id: grant.id,
    clientName: grant.clientName,
    userName,
    isMine: grant.userId === viewerId,
    createdAt: grant.createdAt.toISOString(),
    lastUsedAt: grant.lastUsedAt?.toISOString() ?? null,
    revokedAt: grant.revokedAt?.toISOString() ?? null,
  };
}
