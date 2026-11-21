-- CreateTable
CREATE TABLE "VisitStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "visitId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "completedBy" TEXT,
    "completedAt" DATETIME,
    "reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VisitStep_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "folioPrefix" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Service" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "visitId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "data" TEXT NOT NULL DEFAULT '{}',
    "fieldVersions" TEXT NOT NULL DEFAULT '{}',
    "formImageRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "confirmedBy" TEXT,
    "confirmedAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "Service_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Service" ("confirmedAt", "confirmedBy", "data", "formImageRef", "id", "status", "templateId", "type", "version", "visitId") SELECT "confirmedAt", "confirmedBy", "data", "formImageRef", "id", "status", "templateId", "type", "version", "visitId" FROM "Service";
DROP TABLE "Service";
ALTER TABLE "new_Service" RENAME TO "Service";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "VisitStep_updatedAt_idx" ON "VisitStep"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "VisitStep_visitId_role_key" ON "VisitStep"("visitId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Device_folioPrefix_key" ON "Device"("folioPrefix");

-- CreateIndex
CREATE UNIQUE INDEX "Visit_campaignId_folio_key" ON "Visit"("campaignId", "folio");

