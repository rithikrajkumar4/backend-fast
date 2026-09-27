import {
  S3Client,
  HeadObjectCommand,
  DeleteObjectsCommand,
  NotFound,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl as getCloudFrontSignedUrl } from "@aws-sdk/cloudfront-signer";
import { env } from "../config/env.js";

export interface PresignedUpload {
  /** POST a multipart/form-data body to this URL: every entry of `fields`, then the file as `file` (last). */
  url: string;
  fields: Record<string, string>;
  expiresAt: Date;
}

export interface StoredObject {
  sizeBytes: number;
  contentType: string | null;
}

export interface StorageService {
  createUpload(key: string, contentType: string, maxBytes: number): Promise<PresignedUpload>;
  headObject(key: string): Promise<StoredObject | null>;
  deleteObjects(keys: string[]): Promise<void>;
  /** URL the app uses to display the image (CloudFront, signed when a key pair is configured). */
  getViewUrl(key: string): string;
}

export class S3StorageService implements StorageService {
  private readonly client: S3Client;
  private readonly bucket = env.S3_BUCKET;
  private readonly privateKey = env.CLOUDFRONT_PRIVATE_KEY?.replace(/\\n/g, "\n");

  constructor(client?: S3Client) {
    this.client =
      client ??
      new S3Client({
        region: env.AWS_REGION,
        ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
      });
  }

  public async createUpload(key: string, contentType: string, maxBytes: number): Promise<PresignedUpload> {
    const expiresIn = env.UPLOAD_URL_TTL_SECONDS;
    // Presigned POST lets S3 itself enforce the exact key, content type and size limit.
    const { url, fields } = await createPresignedPost(this.client, {
      Bucket: this.bucket,
      Key: key,
      Conditions: [
        ["content-length-range", 1, maxBytes],
        ["eq", "$Content-Type", contentType],
      ],
      Fields: { "Content-Type": contentType },
      Expires: expiresIn,
    });
    return { url, fields, expiresAt: new Date(Date.now() + expiresIn * 1000) };
  }

  public async headObject(key: string): Promise<StoredObject | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { sizeBytes: res.ContentLength ?? 0, contentType: res.ContentType ?? null };
    } catch (err) {
      if (err instanceof NotFound || (err as { name?: string }).name === "NotFound") return null;
      throw err;
    }
  }

  public async deleteObjects(keys: string[]): Promise<void> {
    // DeleteObjects accepts at most 1000 keys per call.
    for (let i = 0; i < keys.length; i += 1000) {
      const chunk = keys.slice(i, i + 1000);
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
        })
      );
    }
  }

  public getViewUrl(key: string): string {
    const encodedKey = key.split("/").map(encodeURIComponent).join("/");
    const base = env.CDN_BASE_URL
      ? env.CDN_BASE_URL.replace(/\/+$/, "")
      : env.S3_ENDPOINT
        ? `${env.S3_ENDPOINT.replace(/\/+$/, "")}/${this.bucket}`
        : `https://${this.bucket}.s3.${env.AWS_REGION}.amazonaws.com`;
    const url = `${base}/${encodedKey}`;

    if (env.CDN_BASE_URL && env.CLOUDFRONT_KEY_PAIR_ID && this.privateKey) {
      return getCloudFrontSignedUrl({
        url,
        keyPairId: env.CLOUDFRONT_KEY_PAIR_ID,
        privateKey: this.privateKey,
        dateLessThan: new Date(Date.now() + env.CDN_URL_TTL_SECONDS * 1000).toISOString(),
      });
    }
    return url;
  }
}
