-- CreateTable
CREATE TABLE "Locality" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "municipality" TEXT NOT NULL,
    "hasSignal" BOOLEAN NOT NULL
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "municipality" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "localityIds" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Patient" (
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
    "createdBy" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "fieldVersions" TEXT NOT NULL DEFAULT '{}',
    "linkedToId" TEXT,
    CONSTRAINT "Patient_localityId_fkey" FOREIGN KEY ("localityId") REFERENCES "Locality" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Patient_linkedToId_fkey" FOREIGN KEY ("linkedToId") REFERENCES "Patient" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Visit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "folio" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "Visit_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Visit_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "visitId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "data" TEXT NOT NULL DEFAULT '{}',
    "formImageRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "confirmedBy" TEXT,
    "confirmedAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "Service_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MatchReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientAId" TEXT NOT NULL,
    "patientBId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "reasons" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "decidedBy" TEXT,
    "decidedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SyncConflict" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "serverValue" TEXT,
    "deviceValue" TEXT,
    "deviceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clinical" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolvedBy" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "FormScan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "imageRef" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "extracted" TEXT,
    "visitId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AppliedOp" (
    "opId" TEXT NOT NULL PRIMARY KEY,
    "deviceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,
    "deviceId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "detail" TEXT
);

-- CreateIndex
CREATE INDEX "Patient_birthDate_idx" ON "Patient"("birthDate");

-- CreateIndex
CREATE INDEX "Patient_formId_idx" ON "Patient"("formId");

-- CreateIndex
CREATE INDEX "AuditLog_entityId_idx" ON "AuditLog"("entityId");
