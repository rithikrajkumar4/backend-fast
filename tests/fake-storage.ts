import type { PresignedUpload, StorageService, StoredObject } from "../src/services/storage.service.js";

/** In-memory stand-in for S3 + CloudFront. */
export class FakeStorage implements StorageService {
  readonly objects = new Map<string, StoredObject>();
  readonly uploads = new Map<string, { contentType: string; maxBytes: number }>();
  readonly deleted: string[] = [];

  async createUpload(key: string, contentType: string, maxBytes: number): Promise<PresignedUpload> {
    this.uploads.set(key, { contentType, maxBytes });
    return {
      url: "https://test-bucket.s3.amazonaws.com/",
      fields: { key, "Content-Type": contentType, Policy: "fake", "X-Amz-Signature": "fake" },
      expiresAt: new Date(Date.now() + 600_000),
    };
  }

  async headObject(key: string): Promise<StoredObject | null> {
    return this.objects.get(key) ?? null;
  }

  async deleteObjects(keys: string[]): Promise<void> {
    for (const key of keys) {
      this.objects.delete(key);
      this.deleted.push(key);
    }
  }

  getViewUrl(key: string): string {
    return `https://cdn.example.test/${key}`;
  }

  /** Simulates the app POSTing the file to the presigned URL. */
  put(key: string, sizeBytes: number, contentType?: string) {
    const upload = this.uploads.get(key);
    if (!upload) throw new Error(`No presigned upload for ${key}`);
    this.objects.set(key, { sizeBytes, contentType: contentType ?? upload.contentType });
  }
}
