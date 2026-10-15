import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildTestApp, setAuthSettings, sentMessages, uniqueHandle, registerUser, bearer } from "./helpers.js";
import { AdminService } from "../src/services/admin.service.js";
import { AdminUser } from "../src/database/entities/admin-user.entity.js";
import { AppSetting } from "../src/database/entities/app-setting.entity.js";

let app: FastifyInstance;
let failDelivery = false;
const PASSWORD = "correct-horse-battery";

before(async () => {
  app = await buildTestApp({
    otpSender: async (message) => {
      if (failDelivery) throw new Error("Authenticate: invalid Twilio credentials");
      sentMessages.push(message);
    },
  });
});

after(async () => {
  await setAuthSettings(app);
  await app?.close();
});

async function createAdmin() {
  const username = uniqueHandle("admin");
  await AdminService.upsertAdmin(app.db, username, PASSWORD, "Test Admin");
  const res = await app.inject({ method: "POST", url: "/api/admin/auth/login", payload: { username, password: PASSWORD } });
  assert.equal(res.statusCode, 200, res.body);
  return { username, token: res.json().data.token as string };
}

const getSettings = (token: string) =>
  app.inject({ method: "GET", url: "/api/admin/settings/auth", headers: bearer(token) });
const putSettings = (token: string, payload: unknown) =>
  app.inject({ method: "PUT", url: "/api/admin/settings/auth", headers: bearer(token), payload: payload as object });

describe("Admin login", () => {
  it("rejects a wrong password and an unknown username the same way", async () => {
    const { username } = await createAdmin();
    const wrong = await app.inject({ method: "POST", url: "/api/admin/auth/login", payload: { username, password: "nope-nope-nope" } });
    const unknown = await app.inject({
      method: "POST",
      url: "/api/admin/auth/login",
      payload: { username: "nobody", password: PASSWORD },
    });
    assert.equal(wrong.statusCode, 401);
    assert.equal(unknown.statusCode, 401);
    assert.equal(wrong.json().message, unknown.json().message);
  });

  it("accepts a plain username like zeus, case-insensitively", async () => {
    const username = `zeus_${uniqueHandle()}`;
    await AdminService.upsertAdmin(app.db, username, PASSWORD);
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/auth/login",
      payload: { username: username.toUpperCase(), password: PASSWORD },
    });
    assert.equal(res.statusCode, 200, res.body);
  });

  it("never returns the password hash", async () => {
    const { username } = await createAdmin();
    const res = await app.inject({ method: "POST", url: "/api/admin/auth/login", payload: { username, password: PASSWORD } });
    assert.ok(!res.body.includes("scrypt$"));
    const me = await app.inject({ method: "GET", url: "/api/admin/auth/me", headers: bearer(res.json().data.token) });
    assert.equal(me.json().data.admin.username, username);
    assert.ok(!me.body.includes("passwordHash"));
  });

  it("keeps admin and user tokens apart", async () => {
    const { token } = await createAdmin();
    const { tokens } = await registerUser(app);
    assert.equal((await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: bearer(token) })).statusCode, 401);
    assert.equal((await getSettings(tokens.accessToken)).statusCode, 401);
    assert.equal((await app.inject({ method: "GET", url: "/api/admin/overview" })).statusCode, 401);
  });

  it("locks out a deactivated admin's existing token", async () => {
    const { username, token } = await createAdmin();
    await app.db.getRepository(AdminUser).update({ username }, { isActive: false });
    assert.equal((await getSettings(token)).statusCode, 401);
  });

  it("changes the password", async () => {
    const { username, token } = await createAdmin();
    const url = "/api/admin/auth/change-password";
    const bad = await app.inject({
      method: "POST", url, headers: bearer(token),
      payload: { currentPassword: "wrong-password", newPassword: "a-brand-new-password" },
    });
    assert.equal(bad.statusCode, 400);
    const short = await app.inject({
      method: "POST", url, headers: bearer(token),
      payload: { currentPassword: PASSWORD, newPassword: "short" },
    });
    assert.equal(short.statusCode, 400);
    const ok = await app.inject({
      method: "POST", url, headers: bearer(token),
      payload: { currentPassword: PASSWORD, newPassword: "a-brand-new-password" },
    });
    assert.equal(ok.statusCode, 200);
    const login = (password: string) =>
      app.inject({ method: "POST", url: "/api/admin/auth/login", payload: { username, password } });
    assert.equal((await login(PASSWORD)).statusCode, 401);
    assert.equal((await login("a-brand-new-password")).statusCode, 200);
  });
});

describe("Admin auth settings", () => {
  it("hides secrets and reports which are set", async () => {
    const { token } = await createAdmin();
    const res = await getSettings(token);
    assert.equal(res.statusCode, 200);
    const { settings, secrets } = res.json().data;
    assert.equal(settings.sso.facebook.appSecret, "");
    assert.equal(secrets["sso.facebook.appSecret"], true);
    assert.equal(secrets["delivery.twilio.authToken"], false);
    assert.ok(!res.body.includes("test-facebook-secret"));
  });

  it("keeps a secret on blank, replaces it on a value, clears it on null, and encrypts it at rest", async () => {
    const { token } = await createAdmin();
    const { settings } = (await getSettings(token)).json().data;

    settings.delivery.sms.provider = "twilio";
    settings.delivery.twilio.accountSid = "AC123";
    settings.delivery.twilio.smsFrom = "+15005550006";
    settings.delivery.twilio.authToken = "super-secret-twilio-token";
    let res = await putSettings(token, settings);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().data.secrets["delivery.twilio.authToken"], true);

    const row = await app.db.getRepository(AppSetting).findOneByOrFail({ key: "auth" });
    const raw = JSON.stringify(row.value);
    assert.ok(!raw.includes("super-secret-twilio-token"), "secret stored in plain text");
    assert.ok(!raw.includes("test-facebook-secret"), "secret stored in plain text");

    // Blank keeps it (the admin panel always sends secrets blank)
    settings.delivery.twilio.authToken = "";
    res = await putSettings(token, settings);
    assert.equal(res.json().data.secrets["delivery.twilio.authToken"], true);

    // null clears it, which now fails validation because Twilio SMS needs it
    settings.delivery.twilio.authToken = null;
    res = await putSettings(token, settings);
    assert.equal(res.statusCode, 400);
    assert.match(res.json().message, /Auth Token/);

    settings.delivery.sms.provider = "console";
    res = await putSettings(token, settings);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().data.secrets["delivery.twilio.authToken"], false);
    await setAuthSettings(app);
  });

  it("rejects incomplete provider config with every problem listed", async () => {
    const { token } = await createAdmin();
    const { settings } = (await getSettings(token)).json().data;
    settings.sso.google.clientIds = [];
    settings.sso.apple.clientIds = [];
    const res = await putSettings(token, settings);
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().details.length, 2);
  });

  it("rejects turning every login method off", async () => {
    const { token } = await createAdmin();
    const { settings } = (await getSettings(token)).json().data;
    settings.email.enabled = false;
    settings.phone.enabled = false;
    settings.sso.google.enabled = false;
    settings.sso.apple.enabled = false;
    settings.sso.facebook.enabled = false;
    assert.equal((await putSettings(token, settings)).statusCode, 400);
  });

  it("rejects out-of-range values", async () => {
    const { token } = await createAdmin();
    const { settings } = (await getSettings(token)).json().data;
    settings.otp.length = 12;
    assert.equal((await putSettings(token, settings)).statusCode, 400);
  });

  it("changes take effect for the app right away", async () => {
    const { token } = await createAdmin();
    const { settings } = (await getSettings(token)).json().data;
    settings.phone.whatsapp = false;
    settings.appName = "Renamed";
    assert.equal((await putSettings(token, settings)).statusCode, 200);
    const config = (await app.inject({ method: "GET", url: "/api/v1/auth/config" })).json().data;
    assert.deepEqual(config.phone.channels, ["sms"]);
    assert.equal(config.appName, "Renamed");
    await setAuthSettings(app);
  });

  it("normalizes test account identifiers", async () => {
    const { token } = await createAdmin();
    const { settings } = (await getSettings(token)).json().data;
    settings.testAccounts = [{ identifier: " Reviewer@Example.com ", code: "111111" }, { identifier: "+1 (415) 555-0100", code: "222222" }];
    const res = await putSettings(token, settings);
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(
      res.json().data.settings.testAccounts.map((t: { identifier: string }) => t.identifier),
      ["reviewer@example.com", "+14155550100"]
    );
    await setAuthSettings(app);
  });
});

describe("Admin tools", () => {
  it("sends a test message through the configured provider", async () => {
    const { token } = await createAdmin();
    const res = await app.inject({
      method: "POST", url: "/api/admin/settings/auth/test-delivery", headers: bearer(token),
      payload: { channel: "whatsapp", to: "+1 415 555 0100" },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(sentMessages.at(-1)!.to, "+14155550100");
    assert.equal(sentMessages.at(-1)!.channel, "whatsapp");
  });

  it("shows the provider's error when a test message fails", async () => {
    const { token } = await createAdmin();
    failDelivery = true;
    const res = await app.inject({
      method: "POST", url: "/api/admin/settings/auth/test-delivery", headers: bearer(token),
      payload: { channel: "sms", to: "+14155550100" },
    });
    failDelivery = false;
    assert.equal(res.statusCode, 502);
    assert.match(res.json().message, /invalid Twilio credentials/);
  });

  it("returns overview stats", async () => {
    const { token } = await createAdmin();
    await registerUser(app);
    const res = await app.inject({ method: "GET", url: "/api/admin/overview", headers: bearer(token) });
    assert.equal(res.statusCode, 200);
    const { data } = res.json();
    assert.ok(data.users.total >= 1);
    assert.ok(data.codesSentLast24h.sms >= 1);
  });

  it("serves the admin panel", async () => {
    const redirect = await app.inject({ method: "GET", url: "/admin" });
    assert.equal(redirect.statusCode, 302);
    assert.equal(redirect.headers.location, "/admin/");
    const page = await app.inject({ method: "GET", url: "/admin/" });
    assert.equal(page.statusCode, 200);
    assert.match(page.headers["content-type"] as string, /text\/html/);
    assert.match(page.body, /admin\.js/);
    const script = await app.inject({ method: "GET", url: "/admin/admin.js" });
    assert.equal(script.statusCode, 200);
  });
});
