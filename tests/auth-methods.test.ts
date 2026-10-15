import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import {
  buildTestApp,
  setAuthSettings,
  sentMessages,
  uniquePhone,
  uniqueHandle,
  sendOtp,
  verifyOtp,
  registerUser,
  OTP,
  GOOGLE_CLIENT_ID,
} from "./helpers.js";
import { VerificationCode } from "../src/database/entities/verification-code.entity.js";

let app: FastifyInstance;
let failDelivery = false;

before(async () => {
  app = await buildTestApp({
    otpSender: async (message) => {
      if (failDelivery) throw new Error("provider down");
      sentMessages.push(message);
    },
  });
});

after(async () => {
  await setAuthSettings(app);
  await app?.close();
});

beforeEach(async () => {
  failDelivery = false;
  await setAuthSettings(app);
});

const uniqueEmail = () => `${uniqueHandle("mail")}@example.com`;

function sendEmailOtp(email: string) {
  return app.inject({ method: "POST", url: "/api/v1/auth/send-otp", payload: { email } });
}
function verifyEmailOtp(email: string, otp = OTP) {
  return app.inject({ method: "POST", url: "/api/v1/auth/verify-otp", payload: { email, otp } });
}
function completeProfile(tempToken: string, extra: Record<string, unknown> = {}) {
  return app.inject({
    method: "POST",
    url: "/api/v1/auth/complete-profile",
    payload: { tempToken, name: "Mail User", age: 30, ...extra },
  });
}

describe("GET /api/v1/auth/config", () => {
  it("reports enabled methods and public SSO ids, without secrets", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/auth/config" });
    assert.equal(res.statusCode, 200);
    const { data } = res.json();
    assert.equal(data.email.enabled, true);
    assert.deepEqual(data.phone.channels, ["sms", "whatsapp"]);
    assert.equal(data.otp.length, 6);
    assert.deepEqual(data.sso.google.clientIds, [GOOGLE_CLIENT_ID]);
    assert.equal(data.sso.facebook.appId, "1234567890");
    assert.ok(!res.body.includes("test-facebook-secret"), "secret leaked");
  });

  it("follows admin changes immediately", async () => {
    await setAuthSettings(app, { phone: { whatsapp: false }, sso: { google: { enabled: false } } });
    const { data } = (await app.inject({ method: "GET", url: "/api/v1/auth/config" })).json();
    assert.deepEqual(data.phone.channels, ["sms"]);
    assert.equal(data.sso.google.enabled, false);
    assert.deepEqual(data.sso.google.clientIds, []);
  });
});

describe("Email OTP", () => {
  it("registers a new user with a verified email and logs them back in", async () => {
    const email = uniqueEmail();
    const sent = await sendEmailOtp(email.toUpperCase());
    assert.equal(sent.statusCode, 200);
    assert.equal(sent.json().data.email, email);
    assert.equal(sent.json().data.channel, "email");
    assert.equal(sent.json().data.isNewUser, true);
    const message = sentMessages.at(-1)!;
    assert.equal(message.channel, "email");
    assert.equal(message.to, email);
    assert.equal(message.code, OTP);

    const verified = await verifyEmailOtp(email);
    assert.equal(verified.statusCode, 200);
    assert.equal(verified.json().isNewUser, true);
    assert.equal(verified.json().data.email, email);

    // The verified email wins over a different one in the form
    const created = await completeProfile(verified.json().data.tempToken, { email: "other@example.com" });
    assert.equal(created.statusCode, 201, created.body);
    const { user } = created.json().data;
    assert.equal(user.email, email);
    assert.equal(user.emailVerified, true);
    assert.equal(user.phoneNumber, null);

    await sendEmailOtp(email);
    const login = await verifyEmailOtp(email);
    assert.equal(login.json().isNewUser, false);
    assert.equal(login.json().data.user.id, user.id);

    const me = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${login.json().data.tokens.accessToken}` },
    });
    assert.equal(me.statusCode, 200);
  });

  it("won't log into an account whose email was typed in but never verified", async () => {
    const email = uniqueEmail();
    await registerUser(app, { email }); // phone signup with an unverified email
    await sendEmailOtp(email);
    const res = await verifyEmailOtp(email);
    assert.equal(res.statusCode, 409);
  });

  it("rejects both phone and email, and an email channel", async () => {
    const both = await app.inject({
      method: "POST",
      url: "/api/v1/auth/send-otp",
      payload: { email: uniqueEmail(), phoneNumber: uniquePhone() },
    });
    assert.equal(both.statusCode, 400);
    const channel = await app.inject({
      method: "POST",
      url: "/api/v1/auth/send-otp",
      payload: { email: uniqueEmail(), channel: "sms" },
    });
    assert.equal(channel.statusCode, 400);
  });

  it("returns 403 when email login is disabled", async () => {
    await setAuthSettings(app, { email: { enabled: false } });
    const res = await sendEmailOtp(uniqueEmail());
    assert.equal(res.statusCode, 403);
  });
});

describe("Phone OTP channels", () => {
  it("sends over WhatsApp when asked", async () => {
    const phone = uniquePhone();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/send-otp",
      payload: { phoneNumber: phone, channel: "whatsapp" },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().data.channel, "whatsapp");
    assert.equal(sentMessages.at(-1)!.channel, "whatsapp");
    assert.equal((await verifyOtp(app, phone)).statusCode, 200);
  });

  it("uses the admin's default channel", async () => {
    await setAuthSettings(app, { phone: { defaultChannel: "whatsapp" } });
    const res = await sendOtp(app, uniquePhone());
    assert.equal(res.json().data.channel, "whatsapp");
  });

  it("returns 403 for a disabled channel", async () => {
    await setAuthSettings(app, { phone: { whatsapp: false } });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/send-otp",
      payload: { phoneNumber: uniquePhone(), channel: "whatsapp" },
    });
    assert.equal(res.statusCode, 403);
  });

  it("normalizes numbers and applies the default country code", async () => {
    await setAuthSettings(app, { phone: { defaultCountryCode: "+91" } });
    const local = `9${String(Date.now()).slice(-9)}`;
    const formatted = `${local.slice(0, 5)} ${local.slice(5)}`;
    const res = await sendOtp(app, formatted);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().data.phoneNumber, `+91${local}`);
    // Same person typing the full international form gets the same account
    const verified = await verifyOtp(app, `+91 (${local.slice(0, 5)}) ${local.slice(5)}`);
    assert.equal(verified.statusCode, 200);
    assert.equal(verified.json().data.phoneNumber, `+91${local}`);
  });
});

describe("OTP protections", () => {
  it("enforces the resend cooldown", async () => {
    await setAuthSettings(app, { otp: { resendCooldownSeconds: 60 } });
    const phone = uniquePhone();
    assert.equal((await sendOtp(app, phone)).statusCode, 200);
    const again = await sendOtp(app, phone);
    assert.equal(again.statusCode, 429);
    assert.ok(again.json().details.retryAfterSeconds > 0);
  });

  it("caps codes per hour per identifier", async () => {
    await setAuthSettings(app, { otp: { maxSendsPerHour: 2 } });
    const phone = uniquePhone();
    assert.equal((await sendOtp(app, phone)).statusCode, 200);
    assert.equal((await sendOtp(app, phone)).statusCode, 200);
    assert.equal((await sendOtp(app, phone)).statusCode, 429);
  });

  it("burns the code after too many wrong guesses", async () => {
    await setAuthSettings(app, { otp: { maxAttempts: 3 } });
    const phone = uniquePhone();
    await sendOtp(app, phone);
    const first = await verifyOtp(app, phone, "000000");
    assert.equal(first.statusCode, 400);
    assert.equal(first.json().details.attemptsRemaining, 2);
    await verifyOtp(app, phone, "000000");
    const third = await verifyOtp(app, phone, "000000");
    assert.match(third.json().message, /Too many incorrect attempts/);
    const correct = await verifyOtp(app, phone, OTP);
    assert.equal(correct.statusCode, 400, "code should be burned");
  });

  it("stores only a hash of the code", async () => {
    const phone = uniquePhone();
    await sendOtp(app, phone);
    const row = await app.db.getRepository(VerificationCode).findOneByOrFail({ target: phone });
    assert.notEqual(row.codeHash, OTP);
    assert.equal(row.codeHash.length, 64);
  });

  it("returns 502 and burns the code when delivery fails", async () => {
    const phone = uniquePhone();
    failDelivery = true;
    const res = await sendOtp(app, phone);
    assert.equal(res.statusCode, 502);
    failDelivery = false;
    assert.equal((await verifyOtp(app, phone)).statusCode, 400);
  });

  it("respects a configured code length", async () => {
    await setAuthSettings(app, { otp: { length: 4 } });
    const phone = uniquePhone();
    const sent = await sendOtp(app, phone);
    assert.equal(sent.json().data.otp, OTP.slice(0, 4));
    assert.equal((await verifyOtp(app, phone, OTP)).json().message, "OTP must be 4 digits");
    assert.equal((await verifyOtp(app, phone, OTP.slice(0, 4))).statusCode, 200);
  });
});

describe("Test accounts", () => {
  it("accept their fixed code and never send a message", async () => {
    const phone = uniquePhone();
    const email = uniqueEmail();
    await setAuthSettings(app, {
      testAccounts: [
        { identifier: phone, code: "424242" },
        { identifier: email.toUpperCase(), code: "135790" },
      ],
    });
    const before = sentMessages.length;
    await sendOtp(app, phone);
    await sendEmailOtp(email);
    assert.equal(sentMessages.length, before, "test accounts must not receive messages");
    assert.equal((await verifyOtp(app, phone, OTP)).statusCode, 400);
    await sendOtp(app, phone);
    assert.equal((await verifyOtp(app, phone, "424242")).statusCode, 200);
    assert.equal((await verifyEmailOtp(email, "135790")).statusCode, 200);
  });
});
