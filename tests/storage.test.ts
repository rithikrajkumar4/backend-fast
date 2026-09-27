import "./helpers.js";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

// Real AWS SDK with dummy credentials: presigning and CloudFront signing are offline operations.
const { S3StorageService } = await import("../src/services/storage.service.js");
const { env } = await import("../src/config/env.js");

describe("S3StorageService", () => {
  it("creates a presigned POST that pins key, content type and max size", async () => {
    const storage = new S3StorageService();
    const key = "albums/abc/img.jpg";
    const { url, fields, expiresAt } = await storage.createUpload(key, "image/jpeg", 5_000);

    assert.match(url, /test-bucket/);
    assert.equal(fields.key, key);
    assert.equal(fields["Content-Type"], "image/jpeg");
    assert.ok(fields["X-Amz-Signature"]);
    assert.ok(expiresAt.getTime() > Date.now());

    const policy = JSON.parse(Buffer.from(fields.Policy, "base64").toString("utf8"));
    assert.deepEqual(
      policy.conditions.find((c: unknown) => Array.isArray(c) && c[0] === "content-length-range"),
      ["content-length-range", 1, 5_000]
    );
    assert.ok(policy.conditions.some((c: unknown) => JSON.stringify(c) === JSON.stringify(["eq", "$Content-Type", "image/jpeg"])));
    assert.ok(policy.conditions.some((c: any) => c.key === key));
  });

  it("builds CDN view URLs from CDN_BASE_URL", () => {
    const storage = new S3StorageService();
    assert.equal(storage.getViewUrl("albums/a b/c.jpg"), "https://cdn.example.test/albums/a%20b/c.jpg");
  });

  it("signs CloudFront URLs when a key pair is configured", () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    Object.assign(env, { CLOUDFRONT_KEY_PAIR_ID: "KTESTKEYPAIR", CLOUDFRONT_PRIVATE_KEY: pem.replace(/\n/g, "\\n") });
    try {
      const url = new URL(new S3StorageService().getViewUrl("albums/x/y.jpg"));
      assert.equal(url.origin + url.pathname, "https://cdn.example.test/albums/x/y.jpg");
      assert.equal(url.searchParams.get("Key-Pair-Id"), "KTESTKEYPAIR");

      const expires = Number(url.searchParams.get("Expires"));
      assert.ok(Math.abs(expires - (Date.now() / 1000 + env.CDN_URL_TTL_SECONDS)) < 5);

      // Verify the canned-policy signature the way CloudFront does.
      const policy = JSON.stringify({
        Statement: [{ Resource: "https://cdn.example.test/albums/x/y.jpg", Condition: { DateLessThan: { "AWS:EpochTime": expires } } }],
      });
      const signature = Buffer.from(
        url.searchParams.get("Signature")!.replace(/-/g, "+").replace(/_/g, "=").replace(/~/g, "/"),
        "base64"
      );
      assert.ok(crypto.verify("RSA-SHA1", Buffer.from(policy), publicKey, signature));
    } finally {
      Object.assign(env, { CLOUDFRONT_KEY_PAIR_ID: undefined, CLOUDFRONT_PRIVATE_KEY: undefined });
    }
  });
});
