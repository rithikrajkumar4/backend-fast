/**
 * Load tests with autocannon against a real listening server backed by the test DB.
 *
 *   npm run test:load                 # all scenarios, 10s each
 *   DURATION=20 CONNECTIONS=50 npm run test:load
 *   SCENARIOS=health,me npm run test:load
 *
 * Exits non-zero if any scenario has errors/timeouts, unexpected non-2xx responses,
 * or p99 latency above its budget.
 */
import autocannon, { type Result } from "autocannon";
import { buildTestApp, registerUser, uniquePhone, bearer, OTP } from "../helpers.js";

const DURATION = Number(process.env.DURATION ?? 10);
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 20);
const ONLY = process.env.SCENARIOS?.split(",").map((s) => s.trim());

interface Scenario {
  name: string;
  p99BudgetMs: number;
  opts: Partial<autocannon.Options>;
  /** Responses that are expected by design (e.g. 400 for an invalid OTP). */
  expectNon2xx?: boolean;
}

function run(url: string, s: Scenario): Promise<Result> {
  return new Promise((resolve, reject) => {
    const instance = autocannon(
      { url, connections: CONNECTIONS, duration: DURATION, ...s.opts },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    autocannon.track(instance, { renderProgressBar: false, renderResultsTable: false });
  });
}

async function main() {
  const app = await buildTestApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  const url = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  console.log(`Server listening at ${url} (${CONNECTIONS} connections, ${DURATION}s per scenario)\n`);

  const { tokens } = await registerUser(app);
  const json = { "content-type": "application/json" };

  const scenarios: Scenario[] = [
    { name: "health", p99BudgetMs: 100, opts: { url: `${url}/health` } },
    { name: "hello", p99BudgetMs: 50, opts: { url: `${url}/api/v1/hello?name=load` } },
    {
      name: "me",
      p99BudgetMs: 150,
      opts: { url: `${url}/api/v1/auth/me`, headers: bearer(tokens.accessToken) },
    },
    {
      name: "suggest-username",
      p99BudgetMs: 200,
      opts: { url: `${url}/api/v1/auth/suggest-username` },
    },
    {
      name: "check-username",
      p99BudgetMs: 150,
      opts: {
        url: `${url}/api/v1/auth/check-username`,
        method: "POST",
        headers: json,
        body: JSON.stringify({ username: "load_test_handle" }),
      },
    },
    {
      // Every request uses a fresh phone number → exercises the write path (OTP insert).
      name: "send-otp",
      p99BudgetMs: 250,
      opts: {
        url: `${url}/api/v1/auth/send-otp`,
        method: "POST",
        headers: json,
        requests: [
          { setupRequest: (req) => ({ ...req, body: JSON.stringify({ phoneNumber: uniquePhone() }) }) },
        ],
      },
    },
    {
      // Full signup: send-otp → verify-otp → complete-profile, chained per connection.
      name: "signup-flow",
      p99BudgetMs: 400,
      opts: {
        url,
        headers: json,
        requests: [
          {
            method: "POST",
            path: "/api/v1/auth/send-otp",
            setupRequest: (req, ctx: any) => {
              ctx.phone = uniquePhone();
              return { ...req, body: JSON.stringify({ phoneNumber: ctx.phone }) };
            },
          },
          {
            method: "POST",
            path: "/api/v1/auth/verify-otp",
            setupRequest: (req, ctx: any) => ({ ...req, body: JSON.stringify({ phoneNumber: ctx.phone, otp: OTP }) }),
            onResponse: (_status, body, ctx: any) => {
              ctx.tempToken = JSON.parse(body).data?.tempToken;
            },
          },
          {
            method: "POST",
            path: "/api/v1/auth/complete-profile",
            setupRequest: (req, ctx: any) => ({
              ...req,
              body: JSON.stringify({ tempToken: ctx.tempToken, name: "Load User", age: 30 }),
            }),
          },
        ],
      },
    },
    {
      name: "invalid-otp (400 expected)",
      p99BudgetMs: 150,
      expectNon2xx: true,
      opts: {
        url: `${url}/api/v1/auth/verify-otp`,
        method: "POST",
        headers: json,
        body: JSON.stringify({ phoneNumber: "+15550000000", otp: "999999" }),
      },
    },
  ];

  const rows: Record<string, unknown>[] = [];
  let failed = false;

  for (const s of scenarios) {
    if (ONLY && !ONLY.some((n) => s.name.startsWith(n))) continue;
    process.stdout.write(`▶ ${s.name} ... `);
    const r = await run(url, s);
    const problems: string[] = [];
    if (r.errors) problems.push(`${r.errors} errors`);
    if (r.timeouts) problems.push(`${r.timeouts} timeouts`);
    if (!s.expectNon2xx && r.non2xx) problems.push(`${r.non2xx} non-2xx`);
    if (s.expectNon2xx && r["2xx"]) problems.push(`${r["2xx"]} unexpected 2xx`);
    if (r.latency.p99 > s.p99BudgetMs) problems.push(`p99 ${r.latency.p99}ms > ${s.p99BudgetMs}ms`);
    if (problems.length) failed = true;
    console.log(problems.length ? `FAIL (${problems.join(", ")})` : "ok");

    rows.push({
      scenario: s.name,
      "req/s": Math.round(r.requests.average),
      total: r.requests.total,
      "p50 ms": r.latency.p50,
      "p99 ms": r.latency.p99,
      "max ms": r.latency.max,
      "2xx": r["2xx"],
      non2xx: r.non2xx,
      errors: r.errors + r.timeouts,
      result: problems.length ? "FAIL" : "PASS",
    });
  }

  console.log();
  console.table(rows);
  await app.close();
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
