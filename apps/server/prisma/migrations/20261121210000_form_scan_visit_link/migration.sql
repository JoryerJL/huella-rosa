-- Block 3a: form photos linked to a visit by folio, uploader and confirmation per role.
ALTER TABLE "FormScan" ADD COLUMN "campaignId" TEXT;
ALTER TABLE "FormScan" ADD COLUMN "folio" TEXT;
ALTER TABLE "FormScan" ADD COLUMN "originalName" TEXT;
ALTER TABLE "FormScan" ADD COLUMN "mimeType" TEXT;
ALTER TABLE "FormScan" ADD COLUMN "uploadedBy" TEXT;
ALTER TABLE "FormScan" ADD COLUMN "confirmedRoles" TEXT NOT NULL DEFAULT '[]';

-- CreateIndex
CREATE INDEX "FormScan_visitId_idx" ON "FormScan"("visitId");

-- CreateIndex
CREATE INDEX "FormScan_campaignId_folio_idx" ON "FormScan"("campaignId", "folio");
