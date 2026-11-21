-- Existing campaigns were one day long: endDate starts equal to date.
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "municipality" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "localityIds" TEXT NOT NULL
);
INSERT INTO "new_Campaign" ("date", "endDate", "id", "localityIds", "municipality", "name", "state") SELECT "date", "date", "id", "localityIds", "municipality", "name", "state" FROM "Campaign";
DROP TABLE "Campaign";
ALTER TABLE "new_Campaign" RENAME TO "Campaign";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

