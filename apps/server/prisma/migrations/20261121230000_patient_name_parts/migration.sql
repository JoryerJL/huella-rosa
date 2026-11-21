-- Name parts used to propose the EIRA ID (SPEC 6.1.1). Additive and nullable.
ALTER TABLE "Patient" ADD COLUMN "givenNames" TEXT;
ALTER TABLE "Patient" ADD COLUMN "paternalSurname" TEXT;
ALTER TABLE "Patient" ADD COLUMN "maternalSurname" TEXT;
