/**
 * Creates an admin for the panel at /admin, or resets the password of an existing one.
 *
 *   npm run admin:create -- --email you@example.com --password 'a-long-password' [--name "Your Name"]
 *
 * ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME work too (handy in containers).
 */
import { parseArgs } from "node:util";
import { AppDataSource } from "../src/database/data-source.js";
import { AdminService } from "../src/services/admin.service.js";
import { adminPasswordSchema } from "../src/schemas/admin.schema.js";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    password: { type: "string" },
    name: { type: "string" },
  },
});

const email = values.email ?? process.env.ADMIN_EMAIL;
const password = values.password ?? process.env.ADMIN_PASSWORD;
const name = values.name ?? process.env.ADMIN_NAME ?? "";

if (!email || !password) {
  console.error("Usage: npm run admin:create -- --email you@example.com --password '<at least 10 chars>' [--name 'Name']");
  process.exit(1);
}
const passwordCheck = adminPasswordSchema.safeParse(password);
if (!passwordCheck.success) {
  console.error(`❌ ${passwordCheck.error.errors[0]?.message}`);
  process.exit(1);
}

await AppDataSource.initialize();
try {
  const { admin, created } = await AdminService.upsertAdmin(AppDataSource, email, password, name);
  console.log(created ? `✅ Admin created: ${admin.email}` : `✅ Password reset for existing admin: ${admin.email}`);
} finally {
  await AppDataSource.destroy();
}
