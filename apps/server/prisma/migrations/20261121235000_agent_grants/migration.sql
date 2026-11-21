-- AlterTable
ALTER TABLE "ImportBatch" ADD COLUMN "agentGrantId" TEXT;

-- CreateTable
CREATE TABLE "OAuthClient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientName" TEXT NOT NULL,
    "redirectUris" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AgentGrant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT 'imports',
    "accessTokenHash" TEXT NOT NULL,
    "accessExpiresAt" DATETIME NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "refreshExpiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME,
    "revokedAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentGrant_accessTokenHash_key" ON "AgentGrant"("accessTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "AgentGrant_refreshTokenHash_key" ON "AgentGrant"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "AgentGrant_userId_idx" ON "AgentGrant"("userId");

