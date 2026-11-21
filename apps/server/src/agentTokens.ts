import { createHash, randomBytes } from "node:crypto";
import { createMiddleware } from "hono/factory";
import { AGENT_TOKEN_PREFIX, type AgentTokenView } from "@er/shared";
import { db } from "./db";
import { valkey } from "./valkey";
import { AGENT_ACTOR_PREFIX } from "./imports/service";

// Tokens for AI agents (SPEC 5, 6.7). Only the SHA-256 of a token is stored; the plain token is
// returned once on creation. An agent token acts with role intake on the /api/agent routes ONLY:
// every other route reads the staff session cookie, so a Bearer token there gets 401.
// Tokens are never logged or written to the audit log.

export const AGENT_RATE_LIMIT = 60;
const RATE_WINDOW_SECONDS = 60;
const TOKEN_PATTERN = new RegExp(`^${AGENT_TOKEN_PREFIX}[A-Za-z0-9_-]{43}$`);

/** New plain token: hr_agent_ + 32 random bytes in base64url (43 characters). */
export function generateAgentToken(): string {
  return `${AGENT_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function hashAgentToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isAgentTokenShape(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

export function toAgentTokenView(row: { id: string; name: string; createdAt: Date; revokedAt: Date | null }): AgentTokenView {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

export interface AgentIdentity {
  tokenId: string;
  name: string;
  /** Audit actor and batch creator: "agent:<token name>". */
  actorId: string;
}

/** Resolves a plain token to its active (non-revoked) agent, or null. */
export async function resolveAgentToken(token: string): Promise<AgentIdentity | null> {
  if (!isAgentTokenShape(token)) return null;
  const row = await db.agentToken.findUnique({ where: { tokenHash: hashAgentToken(token) } });
  if (!row || row.revokedAt) return null;
  return { tokenId: row.id, name: row.name, actorId: `${AGENT_ACTOR_PREFIX}${row.name}` };
}

/** Fixed window per token in Valkey. True while the token is under the limit. */
async function underRateLimit(tokenId: string): Promise<boolean> {
  const key = `ratelimit:agent:${tokenId}`;
  const count = await valkey.incr(key);
  if (count === 1) await valkey.expire(key, RATE_WINDOW_SECONDS);
  return count <= AGENT_RATE_LIMIT;
}

export type AgentEnv = { Variables: { agent: AgentIdentity } };

/** Authorization: Bearer hr_agent_... -> active agent (role intake). 401 otherwise, 429 over the limit. */
export const requireAgent = createMiddleware<AgentEnv>(async (c, next) => {
  const match = /^Bearer\s+(\S+)$/.exec(c.req.header("authorization") ?? "");
  const agent = match ? await resolveAgentToken(match[1]) : null;
  if (!agent) return c.json({ error: "A valid, non-revoked agent token is required." }, 401);
  if (!(await underRateLimit(agent.tokenId))) {
    return c.json({ error: `Rate limit: at most ${AGENT_RATE_LIMIT} requests per minute per token.` }, 429);
  }
  c.set("agent", agent);
  await next();
});
