import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet, type JWTPayload, type CryptoKey } from "jose";
import {
  buildTestApp,
  setAuthSettings,
  uniqueHandle,
  registerUser,
  bearer,
  OTP,
  GOOGLE_CLIENT_ID,
  APPLE_CLIENT_ID,
  FACEBOOK_APP_ID,
} from "./helpers.js";
import { IdentityVerifier } from "../src/services/identity-verifier.service.js";
import { User } from "../src/database/entities/user.entity.js";
import { AuthIdentity } from "../src/database/entities/auth-identity.entity.js";

let app: FastifyInstance;
let signingKey: CryptoKey;
let strangerKey: CryptoKey;

/** Fake Graph API: access token -> Facebook user, for the debug_token and /me calls */
const facebookUsers = new Map<string, { id: string; name: string; email?: string; appId?: string }>();

const fakeFetch = (async (input: string | URL) => {
  const url = new URL(String(input));
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  if (url.pathname === "/debug_token") {
    assert.equal(url.searchParams.get("access_token"), `${FACEBOOK_APP_ID}|test-facebook-secret`);
    const user = facebookUsers.get(url.searchParams.get("input_token")!);
    if (!user) return json({ data: { is_valid: false } });
    return json({ data: { is_valid: true, app_id: user.appId ?? FACEBOOK_APP_ID, user_id: user.id } });
  }
  if (url.pathname === "/me") {
    const token = url.searchParams.get("access_token")!;
    const expectedProof = crypto.createHmac("sha256", "test-facebook-secret").update(token).digest("hex");
    if (url.searchParams.get("appsecret_proof") !== expectedProof) return json({ error: { message: "bad proof" } }, 400);
    const user = facebookUsers.get(token);
    return user ? json({ id: user.id, name: user.name, email: user.email }) : json({ error: {} }, 400);
  }
  return json({ error: "unexpected" }, 404);
}) as typeof fetch;

before(async () => {
  const pair = await generateKeyPair("RS256");
  signingKey = pair.privateKey;
  strangerKey = (await generateKeyPair("RS256")).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "test-key", alg: "RS256" };
  const jwks = createLocalJWKSet({ keys: [jwk] });

  app = await buildTestApp({
    identityVerifier: new IdentityVerifier({ googleJwks: jwks, appleJwks: jwks, facebookJwks: jwks, fetch: fakeFetch }),
  });
});

after(async () => {
  await setAuthSettings(app);
  await app?.close();
});

beforeEach(async () => {
  await setAuthSettings(app);
});

const ISSUERS = {
  google: "https://accounts.google.com",
  apple: "https://appleid.apple.com",
  facebook: "https://www.facebook.com",
};
const AUDIENCES = { google: GOOGLE_CLIENT_ID, apple: APPLE_CLIENT_ID, facebook: FACEBOOK_APP_ID };

function idToken(
  provider: "google" | "apple" | "facebook",
  claims: JWTPayload = {},
  opts: { key?: CryptoKey; issuer?: string; audience?: string; expiresIn?: string | number } = {}
) {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setSubject(String(claims.sub ?? `${provider}-${uniqueHandle()}`))
    .setIssuer(opts.issuer ?? ISSUERS[provider])
    .setAudience(opts.audience ?? AUDIENCES[provider])
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? "10m")
    .sign(opts.key ?? signingKey);
}

function sso(provider: string, payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url: `/api/v1/auth/sso/${provider}`, payload });
}

function completeProfile(tempToken: string, extra: Record<string, unknown> = {}) {
  return app.inject({
    method: "POST",
    url: "/api/v1/auth/complete-profile",
    payload: { tempToken, name: "SSO User", age: 28, ...extra },
  });
}

const uniqueEmail = () => `${uniqueHandle("sso")}@example.com`;

describe("Google sign-in", () => {
  it("registers a new user, then logs the same user back in", async () => {
    const sub = `g-${uniqueHandle()}`;
    const email = uniqueEmail();
    const token = await idToken("google", { sub, email, email_verified: true, name: "Grace Hopper" });

    const first = await sso("google", { idToken: token, clientType: "app" });
    assert.equal(first.statusCode, 200, first.body);
    const body = first.json();
    assert.equal(body.isNewUser, true);
    assert.equal(body.data.email, email);
    assert.deepEqual(body.data.prefill, { name: "Grace Hopper", email });

    const created = await completeProfile(body.data.tempToken, { clientType: "app" });
    assert.equal(created.statusCode, 201, created.body);
    const { user, tokens } = created.json().data;
    assert.equal(user.email, email);
    assert.equal(user.emailVerified, true);
    assert.equal(user.phoneNumber, null);
    assert.equal(tokens.clientType, "app");

    const again = await sso("google", { idToken: await idToken("google", { sub, email, email_verified: true }) });
    assert.equal(again.json().isNewUser, false);
    assert.equal(again.json().data.user.id, user.id);
    const me = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: bearer(again.json().data.tokens.accessToken) });
    assert.equal(me.statusCode, 200);
  });

  it("refuses to reuse a registration token", async () => {
    const token = await idToken("google", { email: uniqueEmail(), email_verified: true });
    const { tempToken } = (await sso("google", { idToken: token })).json().data;
    assert.equal((await completeProfile(tempToken)).statusCode, 201);
    assert.equal((await completeProfile(tempToken)).statusCode, 409);
  });

  for (const [label, makeToken] of [
    ["another client's audience", () => idToken("google", {}, { audience: "someone-else.apps.googleusercontent.com" })],
    ["a wrong issuer", () => idToken("google", {}, { issuer: "https://evil.example.com" })],
    ["an expired token", () => idToken("google", {}, { expiresIn: Math.floor(Date.now() / 1000) - 3600 })],
    ["a token signed by an unknown key", () => idToken("google", {}, { key: strangerKey })],
  ] as const) {
    it(`rejects ${label} with 401`, async () => {
      const res = await sso("google", { idToken: await makeToken() });
      assert.equal(res.statusCode, 401);
    });
  }

  it("checks the nonce (raw or SHA-256) when the client sends one", async () => {
    const nonce = "random-client-nonce";
    const hashed = crypto.createHash("sha256").update(nonce).digest("hex");
    assert.equal((await sso("google", { idToken: await idToken("google", { nonce }), nonce })).statusCode, 200);
    assert.equal((await sso("google", { idToken: await idToken("google", { nonce: hashed }), nonce })).statusCode, 200);
    assert.equal((await sso("google", { idToken: await idToken("google", { nonce: "other" }), nonce })).statusCode, 401);
  });

  it("returns 403 when Google sign-in is disabled", async () => {
    await setAuthSettings(app, { sso: { google: { enabled: false } } });
    assert.equal((await sso("google", { idToken: await idToken("google") })).statusCode, 403);
  });

  it("validates the provider and body", async () => {
    assert.equal((await sso("twitter", { idToken: await idToken("google") })).statusCode, 400);
    assert.equal((await sso("google", {})).statusCode, 400);
  });
});

describe("Account linking by verified email", () => {
  async function registerVerifiedEmailUser(email: string) {
    await app.inject({ method: "POST", url: "/api/v1/auth/send-otp", payload: { email } });
    const v = await app.inject({ method: "POST", url: "/api/v1/auth/verify-otp", payload: { email, otp: OTP } });
    return (await completeProfile(v.json().data.tempToken)).json().data.user as { id: string };
  }

  it("links Google to the user who verified the same email", async () => {
    const email = uniqueEmail();
    const user = await registerVerifiedEmailUser(email);
    const sub = `g-${uniqueHandle()}`;
    const res = await sso("google", { idToken: await idToken("google", { sub, email, email_verified: true }) });
    assert.equal(res.json().isNewUser, false);
    assert.equal(res.json().data.user.id, user.id);
    const link = await app.db.getRepository(AuthIdentity).findOneBy({ provider: "google", providerUserId: sub });
    assert.equal(link?.userId, user.id);
  });

  it("doesn't link when the admin turned linking off", async () => {
    await setAuthSettings(app, { sso: { autoLinkByVerifiedEmail: false } });
    const email = uniqueEmail();
    await registerVerifiedEmailUser(email);
    const res = await sso("google", { idToken: await idToken("google", { email, email_verified: true }) });
    assert.equal(res.json().isNewUser, true);
    assert.equal(res.json().data.email, undefined, "taken email must not be carried into registration");
    const created = await completeProfile(res.json().data.tempToken);
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().data.user.email, null);
  });

  it("doesn't link when Google says the email is unverified", async () => {
    const email = uniqueEmail();
    await registerVerifiedEmailUser(email);
    const res = await sso("google", { idToken: await idToken("google", { email, email_verified: false }) });
    assert.equal(res.json().isNewUser, true);
  });

  it("doesn't link to a user who never verified that email", async () => {
    const email = uniqueEmail();
    await registerUser(app, { email }); // phone signup, email typed in
    const res = await sso("google", { idToken: await idToken("google", { email, email_verified: true }) });
    assert.equal(res.json().isNewUser, true);
  });

  it("blocks deactivated users", async () => {
    const email = uniqueEmail();
    const user = await registerVerifiedEmailUser(email);
    await app.db.getRepository(User).update(user.id, { isActive: false });
    const res = await sso("google", { idToken: await idToken("google", { email, email_verified: true }) });
    assert.equal(res.statusCode, 403);
  });
});

describe("Apple sign-in", () => {
  it("uses the name the app sends and trusts Apple's email", async () => {
    const email = `${uniqueHandle()}@privaterelay.appleid.com`;
    const res = await sso("apple", {
      idToken: await idToken("apple", { email, email_verified: "true", is_private_email: "true" }),
      name: "Tim Apple",
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json().data.prefill, { name: "Tim Apple", email });
    const created = await completeProfile(res.json().data.tempToken);
    assert.equal(created.json().data.user.emailVerified, true);
  });

  it("rejects a Google token sent as Apple", async () => {
    const res = await sso("apple", { idToken: await idToken("google") });
    assert.equal(res.statusCode, 401);
  });
});

describe("Facebook login", () => {
  it("verifies an access token with debug_token and appsecret_proof", async () => {
    const accessToken = `EAAB${uniqueHandle()}xxxxxxxxxxxxxxxx`;
    const email = uniqueEmail();
    facebookUsers.set(accessToken, { id: `fb${Date.now()}`, name: "Mark", email });
    const res = await sso("facebook", { accessToken });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().isNewUser, true);
    // Facebook emails are a pre-fill only, never treated as verified
    assert.deepEqual(res.json().data.prefill, { name: "Mark", email });
    assert.equal(res.json().data.email, undefined);
    const created = await completeProfile(res.json().data.tempToken, { email });
    assert.equal(created.json().data.user.emailVerified, false);

    const again = await sso("facebook", { accessToken });
    assert.equal(again.json().data.user.id, created.json().data.user.id);
  });

  it("rejects a token issued to another app", async () => {
    const accessToken = `EAAB${uniqueHandle()}yyyyyyyyyyyyyyyy`;
    facebookUsers.set(accessToken, { id: "999", name: "Other", appId: "42" });
    assert.equal((await sso("facebook", { accessToken })).statusCode, 401);
  });

  it("rejects an invalid token", async () => {
    assert.equal((await sso("facebook", { accessToken: "EAAB-not-a-real-token-123" })).statusCode, 401);
  });

  it("never auto-links on a Facebook email", async () => {
    const email = uniqueEmail();
    await app.inject({ method: "POST", url: "/api/v1/auth/send-otp", payload: { email } });
    const v = await app.inject({ method: "POST", url: "/api/v1/auth/verify-otp", payload: { email, otp: OTP } });
    await completeProfile(v.json().data.tempToken);

    const accessToken = `EAAB${uniqueHandle()}zzzzzzzzzzzzzzzz`;
    facebookUsers.set(accessToken, { id: `fb${Date.now()}2`, name: "Spoof", email });
    const res = await sso("facebook", { accessToken });
    assert.equal(res.json().isNewUser, true);
    assert.equal(res.json().data.prefill.email, null);
  });

  it("accepts an iOS Limited Login ID token", async () => {
    const res = await sso("facebook", { idToken: await idToken("facebook", { name: "Limited" }) });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().data.prefill.name, "Limited");
  });
});
