import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildTestApp, uniquePhone, uniqueHandle } from "./helpers.js";

let app: FastifyInstance;

before(async () => {
  app = await buildTestApp();
});

after(async () => {
  await app?.close();
});

describe("Root & health", () => {
  it("GET / returns service info", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().status, "online");
  });

  it("GET /health reports DB connected", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().status, "ok");
    assert.equal(res.json().database, "connected");
  });

  it("GET /health/db returns DB details", async () => {
    const res = await app.inject({ method: "GET", url: "/health/db" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().data.database, process.env.DB_NAME);
  });

  it("sets security headers via helmet", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.ok(res.headers["x-frame-options"]);
  });

  it("answers CORS preflight", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/auth/send-otp",
      headers: { origin: "http://example.com", "access-control-request-method": "POST" },
    });
    assert.ok(res.statusCode === 204 || res.statusCode === 200);
    assert.ok(res.headers["access-control-allow-origin"]);
  });

  it("unknown routes return a JSON 404", async () => {
    const res = await app.inject({ method: "GET", url: "/nope" });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().message, "Route GET:/nope not found");
  });
});

describe("v1 utility routes", () => {
  it("GET /hello greets by name", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/hello?name=Ada" });
    assert.equal(res.json().message, "Hello, Ada!");
  });

  it("GET /hello defaults to World", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/hello" });
    assert.equal(res.json().message, "Hello, World!");
  });

  it("POST /echo echoes JSON", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/echo", payload: { a: 1 } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json().received, { a: 1 });
  });

  it("POST /echo rejects a missing body", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/echo" });
    assert.equal(res.statusCode, 400);
  });

  it("GET /db-time returns DB time", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/db-time" });
    assert.equal(res.statusCode, 200);
    assert.ok(res.json().dbTime);
  });

  it("POST /users creates and GET /users lists", async () => {
    const username = uniqueHandle("crud");
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      payload: { name: "Crud", phoneNumber: uniquePhone(), username, age: 33 },
    });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().username, username);

    const list = await app.inject({ method: "GET", url: "/api/v1/users" });
    assert.equal(list.statusCode, 200);
    assert.ok(list.json().count <= 50);
    assert.ok(list.json().users.some((u: any) => u.username === username));
  });

  it("POST /users rejects missing fields", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/users", payload: { name: "x" } });
    assert.equal(res.statusCode, 400);
  });

  it("POST /users rejects duplicate username", async () => {
    const username = uniqueHandle("dupe");
    const payload = { name: "A", username, age: 20 };
    await app.inject({ method: "POST", url: "/api/v1/users", payload: { ...payload, phoneNumber: uniquePhone() } });
    const res = await app.inject({ method: "POST", url: "/api/v1/users", payload: { ...payload, phoneNumber: uniquePhone() } });
    assert.equal(res.statusCode, 400);
  });
});
