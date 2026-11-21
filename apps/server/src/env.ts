import { fileURLToPath } from "node:url";

// Load the repository-level .env if it exists (Node >= 21.7). Real environment variables win.
try {
  process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch {
  // No .env file: defaults below are enough for local development.
}

export const env = {
  port: Number(process.env.PORT ?? 3001),
  valkeyUrl: process.env.VALKEY_URL ?? "redis://localhost:6379",
  isProduction: process.env.NODE_ENV === "production",
  // Block 3a: form photo reading and image storage (SPEC 6.4, 9). Defaults run without AWS.
  ocrMode: process.env.OCR_MODE === "textract" ? ("textract" as const) : ("mock" as const),
  storageMode: process.env.STORAGE_MODE === "s3" ? ("s3" as const) : ("local" as const),
  uploadsDir: process.env.UPLOADS_DIR ?? fileURLToPath(new URL("../uploads/", import.meta.url)),
  awsRegion: process.env.AWS_REGION ?? "us-east-1",
  s3Bucket: process.env.S3_BUCKET ?? "",
};
