import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "../env";

// Form photo storage by STORAGE_MODE (SPEC 9). Images are never public: the API streams them
// to signed-in staff only. `local` writes to apps/server/uploads/ (git-ignored); `s3` encrypts at rest.

export interface StoredImage {
  bytes: Uint8Array;
  contentType: string;
}

export interface ImageStorage {
  /** Returns the reference to keep in FormScan.imageRef. */
  put(key: string, bytes: Uint8Array, contentType: string): Promise<string>;
  get(ref: string, contentType: string): Promise<StoredImage | null>;
}

const SAFE_KEY = /^[a-zA-Z0-9-]+\.[a-z0-9]+$/;

export function localStorage(dir: string = env.uploadsDir): ImageStorage {
  return {
    async put(key, bytes) {
      if (!SAFE_KEY.test(key)) throw new Error("Invalid storage key");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, key), bytes);
      return `local:${key}`;
    },
    async get(ref, contentType) {
      const key = ref.replace(/^local:/, "");
      if (!SAFE_KEY.test(key)) return null;
      try {
        return { bytes: await readFile(join(dir, key)), contentType };
      } catch {
        return null;
      }
    },
  };
}

export function s3Storage(bucket: string = env.s3Bucket, client = new S3Client({ region: env.awsRegion })): ImageStorage {
  return {
    async put(key, bytes, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: `scans/${key}`,
          Body: bytes,
          ContentType: contentType,
          ServerSideEncryption: "AES256",
        }),
      );
      return `s3:scans/${key}`;
    },
    async get(ref, contentType) {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: ref.replace(/^s3:/, "") }));
      if (!res.Body) return null;
      return { bytes: await res.Body.transformToByteArray(), contentType: res.ContentType ?? contentType };
    },
  };
}

let storage: ImageStorage | null = null;
export function imageStorage(): ImageStorage {
  storage ??= env.storageMode === "s3" ? s3Storage() : localStorage();
  return storage;
}
