-- Username login (SPEC 6.8 item 1) and change tracking for GET /api/sync/pull.
-- Hand-edited so it also applies to non-empty databases: existing rows get
-- updatedAt = createdAt and username = id (run `npm run seed` for the demo usernames).
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Patient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "formId" TEXT,
    "fullName" TEXT NOT NULL,
    "birthDate" TEXT NOT NULL,
    "birthState" TEXT,
    "phone" TEXT,
    "mobile" TEXT,
    "residence" TEXT,
    "localityId" TEXT,
    "affiliation" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdBy" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "fieldVersions" TEXT NOT NULL DEFAULT '{}',
    "linkedToId" TEXT,
    CONSTRAINT "Patient_localityId_fkey" FOREIGN KEY ("localityId") REFERENCES "Locality" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Patient_linkedToId_fkey" FOREIGN KEY ("linkedToId") REFERENCES "Patient" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Patient" ("affiliation", "birthDate", "birthState", "createdAt", "updatedAt", "createdBy", "deviceId", "fieldVersions", "formId", "fullName", "id", "linkedToId", "localityId", "mobile", "phone", "residence", "version") SELECT "affiliation", "birthDate", "birthState", "createdAt", "createdAt", "createdBy", "deviceId", "fieldVersions", "formId", "fullName", "id", "linkedToId", "localityId", "mobile", "phone", "residence", "version" FROM "Patient";
DROP TABLE "Patient";
ALTER TABLE "new_Patient" RENAME TO "Patient";
CREATE INDEX "Patient_birthDate_idx" ON "Patient"("birthDate");
CREATE INDEX "Patient_formId_idx" ON "Patient"("formId");
CREATE INDEX "Patient_updatedAt_idx" ON "Patient"("updatedAt");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL
);
INSERT INTO "new_User" ("id", "username", "name", "pinHash", "role") SELECT "id", lower("id"), "name", "pinHash", "role" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE TABLE "new_Visit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "folio" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdBy" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "Visit_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Visit_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Visit" ("campaignId", "createdAt", "updatedAt", "createdBy", "date", "deviceId", "folio", "id", "patientId", "version") SELECT "campaignId", "createdAt", "createdAt", "createdBy", "date", "deviceId", "folio", "id", "patientId", "version" FROM "Visit";
DROP TABLE "Visit";
ALTER TABLE "new_Visit" RENAME TO "Visit";
CREATE INDEX "Visit_updatedAt_idx" ON "Visit"("updatedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
