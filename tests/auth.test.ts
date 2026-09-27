import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import {
  buildTestApp,
  uniquePhone,
  uniqueHandle,
  sendOtp,
  verifyOtp,
  getTempToken,
  registerUser,
  bearer,
  OTP,
} from "./helpers.js";

let app: FastifyInstance;

before(async () => {
  app = await buildTestApp();
});

after(async () => {
  await app?.close();
});

describe("POST /api/v1/auth/send-otp", () => {
  it("returns isNewUser=true for an unregistered phone", async () => {
    const phone = uniquePhone();
    const res = await sendOtp(app, phone);
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.isNewUser, true);
    assert.equal(body.data.phoneNumber, phone);
    assert.equal(body.data.otp, OTP);
    assert.ok(new Date(body.data.expiresAt).getTime() > Date.now());
  });

  it("returns isNewUser=false for a registered phone", async () => {
    const { phoneNumber } = await registerUser(app);
    const res = await sendOtp(app, phoneNumber);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().data.isNewUser, false);
  });

  it("trims trailing whitespace from the phone number", async () => {
    const phone = uniquePhone();
    const res = await sendOtp(app, `${phone}  `);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().data.phoneNumber, phone);
  });

  for (const [label, payload] of [
    ["missing phone", {}],
    ["too short", { phoneNumber: "123" }],
    ["too long", { phoneNumber: "+1".padEnd(25, "1") }],
    ["letters", { phoneNumber: "+1555abcdefg" }],
    ["non-string", { phoneNumber: 15551234567 }],
  ] as const) {
    it(`rejects ${label} with 400`, async () => {
      const res = await app.inject({ method: "POST", url: "/api/v1/auth/send-otp", payload });
      assert.equal(res.statusCode, 400);
      const body = res.json();
      assert.equal(body.error, "Bad Request");
      assert.ok(Array.isArray(body.details));
    });
  }

  it("rejects a malformed JSON body with 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/send-otp",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    assert.equal(res.statusCode, 400);
  });
});

describe("POST /api/v1/auth/verify-otp", () => {
  it("new user: returns suggested username and temp token", async () => {
    const phone = uniquePhone();
    await sendOtp(app, phone);
    const res = await verifyOtp(app, phone);
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.isNewUser, true);
    assert.match(body.data.suggestedUsername, /^[a-z0-9_]{3,30}$/);
    assert.ok(body.data.tempToken.length > 10);
  });

  it("existing user: logs in and returns tokens", async () => {
    const { phoneNumber, user } = await registerUser(app);
    await sendOtp(app, phoneNumber);
    const res = await verifyOtp(app, phoneNumber, OTP, { clientType: "app" });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.isNewUser, false);
    assert.equal(body.data.user.id, user.id);
    assert.equal(body.data.tokens.clientType, "app");
    assert.ok(body.data.tokens.accessToken);
    assert.ok(body.data.tokens.refreshToken);
  });

  it("uses x-client-type header when body clientType is omitted", async () => {
    // Schema defaults clientType to "web", so the header fallback is never reached.
    const { phoneNumber } = await registerUser(app);
    await sendOtp(app, phoneNumber);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-otp",
      headers: { "x-client-type": "app" },
      payload: { phoneNumber, otp: OTP },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().data.tokens.clientType, "app");
  });

  it("app sessions get a longer refresh TTL than web sessions", async () => {
    const web = await registerUser(app, { clientType: "web" });
    const mobile = await registerUser(app, { clientType: "app" });
    const days = (iso: string) => (new Date(iso).getTime() - Date.now()) / 86_400_000;
    assert.ok(Math.abs(days(web.tokens.refreshTokenExpiresAt) - 7) < 0.1);
    assert.ok(Math.abs(days(mobile.tokens.refreshTokenExpiresAt) - 90) < 0.1);
  });

  it("rejects a wrong OTP", async () => {
    const phone = uniquePhone();
    await sendOtp(app, phone);
    const res = await verifyOtp(app, phone, "000000");
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().message, "Invalid or expired OTP");
  });

  it("rejects an OTP that was never requested", async () => {
    const res = await verifyOtp(app, uniquePhone());
    assert.equal(res.statusCode, 400);
  });

  it("OTP is single-use", async () => {
    const phone = uniquePhone();
    await sendOtp(app, phone);
    assert.equal((await verifyOtp(app, phone)).statusCode, 200);
    assert.equal((await verifyOtp(app, phone)).statusCode, 400);
  });

  it("OTP length must be exactly 6", async () => {
    const phone = uniquePhone();
    await sendOtp(app, phone);
    const res = await verifyOtp(app, phone, "12345");
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().message, "OTP must be 6 digits");
  });

  it("rejects an invalid clientType", async () => {
    const phone = uniquePhone();
    await sendOtp(app, phone);
    const res = await verifyOtp(app, phone, OTP, { clientType: "desktop" });
    assert.equal(res.statusCode, 400);
  });

  it("concurrent verifies of one OTP: only one succeeds", async () => {
    const phone = uniquePhone();
    await sendOtp(app, phone);
    const results = await Promise.all(Array.from({ length: 5 }, () => verifyOtp(app, phone)));
    const ok = results.filter((r) => r.statusCode === 200).length;
    assert.equal(ok, 1, `expected exactly 1 success, got ${ok}`);
  });
});

describe("POST /api/v1/auth/complete-profile", () => {
  it("creates a user with a custom (lowercased) username", async () => {
    const { phoneNumber, tempToken } = await getTempToken(app);
    const handle = uniqueHandle("Mixed");
    const email = `Jane.${uniqueHandle()}@Example.com`;
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/complete-profile",
      payload: { tempToken, name: "  Jane  ", age: 30, username: handle, email },
    });
    assert.equal(res.statusCode, 201);
    const { user, tokens } = res.json().data;
    assert.equal(user.username, handle.toLowerCase());
    assert.equal(user.phoneNumber, phoneNumber);
    assert.equal(user.name, "Jane");
    assert.equal(user.email, email.toLowerCase());
    assert.ok(tokens.accessToken && tokens.refreshToken && tokens.sessionId);
  });

  it("auto-generates a username when none is provided", async () => {
    const { user } = await registerUser(app);
    assert.match(user.username, /^[a-z0-9_]{3,30}$/);
  });

  it("returns 409 for a taken username (case-insensitive)", async () => {
    const { user } = await registerUser(app, { username: uniqueHandle() });
    const { tempToken } = await getTempToken(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/complete-profile",
      payload: { tempToken, name: "Dup", age: 20, username: user.username.toUpperCase() },
    });
    assert.equal(res.statusCode, 409);
  });

  it("returns 409 for a taken email", async () => {
    const email = `${uniqueHandle()}@example.com`;
    await registerUser(app, { email });
    const { tempToken } = await getTempToken(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/complete-profile",
      payload: { tempToken, name: "Dup", age: 20, email: email.toUpperCase() },
    });
    assert.equal(res.statusCode, 409);
  });

  it("returns 409 when the temp token is reused after registration", async () => {
    const { tempToken } = await getTempToken(app);
    const payload = { tempToken, name: "Once", age: 20 };
    const first = await app.inject({ method: "POST", url: "/api/v1/auth/complete-profile", payload });
    assert.equal(first.statusCode, 201);
    const second = await app.inject({ method: "POST", url: "/api/v1/auth/complete-profile", payload });
    assert.equal(second.statusCode, 409);
  });

  it("rejects a garbage temp token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/complete-profile",
      payload: { tempToken: "not-a-real-jwt-token", name: "X", age: 20 },
    });
    assert.equal(res.statusCode, 400);
  });

  it("rejects an access token used as a registration token", async () => {
    const { tokens } = await registerUser(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/complete-profile",
      payload: { tempToken: tokens.accessToken, name: "X", age: 20 },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().message, "Invalid registration token");
  });

  for (const [label, patch, message] of [
    ["age 0", { age: 0 }, "Age must be at least 1"],
    ["age 131", { age: 131 }, "Age must be realistic"],
    ["fractional age", { age: 20.5 }, "Age must be an integer"],
    ["empty name", { name: "" }, "Name cannot be empty"],
    ["short username", { username: "ab" }, "Username must be at least 3 characters"],
    ["username with dash", { username: "bad-name" }, undefined],
    ["invalid email", { email: "nope" }, "Invalid email address"],
  ] as const) {
    it(`validation: rejects ${label}`, async () => {
      const { tempToken } = await getTempToken(app);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/complete-profile",
        payload: { tempToken, name: "Valid", age: 20, ...(patch as Record<string, unknown>) },
      });
      assert.equal(res.statusCode, 400);
      if (message) assert.equal(res.json().message, message);
    });
  }

  it("coerces a numeric-string age", async () => {
    const { tempToken } = await getTempToken(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/complete-profile",
      payload: { tempToken, name: "Str Age", age: "42" },
    });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().data.user.age, 42);
  });
});

describe("Username endpoints", () => {
  it("GET /suggest-username returns a free handle", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/auth/suggest-username" });
    assert.equal(res.statusCode, 200);
    const { suggestedUsername } = res.json();
    const check = await app.inject({
      method: "POST",
      url: "/api/v1/auth/check-username",
      payload: { username: suggestedUsername },
    });
    assert.equal(check.json().isAvailable, true);
  });

  it("POST /check-username reports taken vs available", async () => {
    const { user } = await registerUser(app, { username: uniqueHandle() });
    const taken = await app.inject({
      method: "POST",
      url: "/api/v1/auth/check-username",
      payload: { username: user.username.toUpperCase() },
    });
    assert.equal(taken.statusCode, 200);
    assert.equal(taken.json().isAvailable, false);

    const free = await app.inject({
      method: "POST",
      url: "/api/v1/auth/check-username",
      payload: { username: uniqueHandle("free") },
    });
    assert.equal(free.json().isAvailable, true);
  });

  it("POST /check-username validates format", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/check-username",
      payload: { username: "a b" },
    });
    assert.equal(res.statusCode, 400);
  });
});

describe("Authenticated routes", () => {
  it("GET /me returns the user and current session", async () => {
    const { user, tokens } = await registerUser(app, { clientType: "app" });
    const res = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: bearer(tokens.accessToken) });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.data.user.id, user.id);
    assert.equal(body.data.session.id, tokens.sessionId);
    assert.equal(body.data.session.clientType, "app");
    assert.equal(body.data.session.isActive, true);
  });

  for (const [label, headers] of [
    ["no auth header", {}],
    ["malformed bearer", { authorization: "Bearer abc.def.ghi" }],
    ["wrong scheme", { authorization: "Basic dXNlcjpwYXNz" }],
  ] as const) {
    it(`GET /me: 401 with ${label}`, async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers });
      assert.equal(res.statusCode, 401);
    });
  }

  it("GET /me: 401 with a token signed by another secret", async () => {
    const { createHmac } = await import("node:crypto");
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const unsigned = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ id: "x", sessionId: "y", clientType: "web" })}`;
    const forged = `${unsigned}.${createHmac("sha256", "some-other-secret").update(unsigned).digest("base64url")}`;
    const res = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: bearer(forged) });
    assert.equal(res.statusCode, 401);
  });

  it("GET /me: 401 with an expired token", async () => {
    const { user, tokens } = await registerUser(app);
    const expired = app.jwt.sign(
      { id: user.id, sessionId: tokens.sessionId, clientType: "web" },
      { expiresIn: 1 }
    );
    await new Promise((r) => setTimeout(r, 1100));
    const res = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: bearer(expired) });
    assert.equal(res.statusCode, 401);
  });

  it("GET /me: registration temp token must NOT authenticate", async () => {
    await registerUser(app); // ensure at least one user exists
    const { tempToken } = await getTempToken(app);
    const res = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: bearer(tempToken) });
    assert.equal(res.statusCode, 401, `temp token was accepted and returned: ${res.body}`);
  });

  it("GET /activity returns this user's request trail", async () => {
    const { user, tokens } = await registerUser(app);
    const headers = bearer(tokens.accessToken);
    await app.inject({ method: "GET", url: "/api/v1/auth/me", headers });
    await app.inject({ method: "GET", url: "/api/v1/auth/me", headers });
    await new Promise((r) => setTimeout(r, 300)); // activity logs are persisted asynchronously

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/auth/activity?limit=10&sessionOnly=true",
      headers,
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.currentSessionId, tokens.sessionId);
    assert.ok(body.count >= 2, `expected >=2 activities, got ${body.count}`);
    assert.ok(body.activities.every((a: any) => a.sessionId === tokens.sessionId));
    assert.ok(body.activities.some((a: any) => a.route === "/api/v1/auth/me" && a.statusCode === 200));
    assert.ok(user.id);
  });

  it("GET /activity caps limit at 100 and validates query", async () => {
    const { tokens } = await registerUser(app);
    const ok = await app.inject({
      method: "GET",
      url: "/api/v1/auth/activity?limit=5000",
      headers: bearer(tokens.accessToken),
    });
    assert.equal(ok.statusCode, 200);
    assert.ok(ok.json().count <= 100);

    const bad = await app.inject({
      method: "GET",
      url: "/api/v1/auth/activity?limit=-1",
      headers: bearer(tokens.accessToken),
    });
    assert.equal(bad.statusCode, 400);
  });

  it("GET /activity requires auth", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/auth/activity" });
    assert.equal(res.statusCode, 401);
  });
});

describe("Session lifecycle", () => {
  it("refresh rotates the refresh token; the old one stops working", async () => {
    const { user, tokens } = await registerUser(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh-token",
      payload: { refreshToken: tokens.refreshToken },
    });
    assert.equal(res.statusCode, 200);
    const { tokens: next, user: refreshedUser } = res.json().data;
    assert.equal(refreshedUser.id, user.id);
    assert.equal(next.sessionId, tokens.sessionId);
    assert.notEqual(next.refreshToken, tokens.refreshToken);

    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh-token",
      payload: { refreshToken: tokens.refreshToken },
    });
    assert.equal(replay.statusCode, 401);
  });

  it("refresh rejects an unknown token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh-token",
      payload: { refreshToken: "f".repeat(96) },
    });
    assert.equal(res.statusCode, 401);
  });

  it("refresh validates the body", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/refresh-token", payload: { refreshToken: "short" } });
    assert.equal(res.statusCode, 400);
  });

  it("logout deactivates the session and blocks refresh", async () => {
    const { tokens } = await registerUser(app);
    const out = await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: bearer(tokens.accessToken) });
    assert.equal(out.statusCode, 200);

    const refresh = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh-token",
      payload: { refreshToken: tokens.refreshToken },
    });
    assert.equal(refresh.statusCode, 401);
  });

  it("logout requires auth", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/logout" });
    assert.equal(res.statusCode, 401);
  });

  it("access token must NOT work after logout", async () => {
    const { tokens } = await registerUser(app);
    const headers = bearer(tokens.accessToken);
    await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers });
    const res = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers });
    assert.equal(res.statusCode, 401, "revoked session's access token still accepted");
  });

  it("each login creates an independent session", async () => {
    const { phoneNumber, tokens: first } = await registerUser(app);
    await sendOtp(app, phoneNumber);
    const second = (await verifyOtp(app, phoneNumber)).json().data.tokens;
    assert.notEqual(first.sessionId, second.sessionId);

    await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: bearer(first.accessToken) });
    const stillValid = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh-token",
      payload: { refreshToken: second.refreshToken },
    });
    assert.equal(stillValid.statusCode, 200);
  });
});
