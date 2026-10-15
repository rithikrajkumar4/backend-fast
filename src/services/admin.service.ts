import type { FastifyInstance } from "fastify";
import { MoreThan, type DataSource } from "typeorm";
import { AdminUser } from "../database/entities/admin-user.entity.js";
import { User } from "../database/entities/user.entity.js";
import { AuthIdentity } from "../database/entities/auth-identity.entity.js";
import { UserSession } from "../database/entities/session.entity.js";
import { VerificationCode, type OtpChannel } from "../database/entities/verification-code.entity.js";
import type { AdminJwtPayload } from "../plugins/jwt.js";
import { SettingsService } from "./settings.service.js";
import { hashPassword, verifyPassword, generateNumericCode } from "../utils/crypto.js";
import { normalizeEmail, normalizePhone } from "../utils/identifiers.js";
import { AppError } from "../utils/errors.js";
import { env } from "../config/env.js";

// Compared against when the email is unknown, so response time doesn't reveal which admins exist
const DUMMY_HASH_PROMISE = hashPassword("dummy-password-for-timing");

export class AdminService {
  public static async login(
    email: string,
    password: string,
    fastify: FastifyInstance
  ): Promise<{ admin: AdminUser; token: string; expiresIn: string }> {
    const repo = fastify.db.getRepository(AdminUser);
    const admin = await repo.findOne({
      where: { email: normalizeEmail(email) },
      select: { id: true, email: true, name: true, isActive: true, passwordHash: true, lastLoginAt: true, createdAt: true, updatedAt: true },
    });

    const valid = await verifyPassword(password, admin?.passwordHash ?? (await DUMMY_HASH_PROMISE));
    if (!admin || !valid || !admin.isActive) {
      throw AppError.unauthorized("Invalid email or password");
    }

    await repo.update(admin.id, { lastLoginAt: new Date() });
    const payload: AdminJwtPayload = { kind: "admin", adminId: admin.id, email: admin.email };
    const token = fastify.jwt.sign(payload, { expiresIn: env.ADMIN_JWT_EXPIRY });
    const { passwordHash: _omit, ...safe } = admin;
    return { admin: safe as AdminUser, token, expiresIn: env.ADMIN_JWT_EXPIRY };
  }

  public static async changePassword(
    adminId: string,
    currentPassword: string,
    newPassword: string,
    fastify: FastifyInstance
  ): Promise<void> {
    const repo = fastify.db.getRepository(AdminUser);
    const admin = await repo.findOne({ where: { id: adminId }, select: { id: true, passwordHash: true } });
    if (!admin || !(await verifyPassword(currentPassword, admin.passwordHash))) {
      throw AppError.badRequest("Current password is incorrect");
    }
    await repo.update(adminId, { passwordHash: await hashPassword(newPassword) });
  }

  /** Creates an admin, or resets the password of an existing one. Used by `npm run admin:create`. */
  public static async upsertAdmin(
    db: DataSource,
    email: string,
    password: string,
    name = ""
  ): Promise<{ admin: AdminUser; created: boolean }> {
    const repo = db.getRepository(AdminUser);
    const normalized = normalizeEmail(email);
    const passwordHash = await hashPassword(password);
    const existing = await repo.findOneBy({ email: normalized });
    if (existing) {
      await repo.update(existing.id, { passwordHash, isActive: true, ...(name ? { name } : {}) });
      return { admin: existing, created: false };
    }
    const admin = await repo.save(repo.create({ email: normalized, passwordHash, name, isActive: true }));
    return { admin, created: true };
  }

  /** Sends a test code through the saved provider config, so the admin can check credentials. */
  public static async sendTestMessage(
    channel: OtpChannel,
    to: string,
    fastify: FastifyInstance
  ): Promise<{ to: string }> {
    SettingsService.invalidateCache();
    const settings = await SettingsService.getAuthSettings(fastify);
    const target = channel === "email" ? normalizeEmail(to) : normalizePhone(to, settings.phone.defaultCountryCode);
    try {
      await fastify.otpSender({ channel, to: target, code: generateNumericCode(settings.otp.length), settings });
    } catch (err) {
      if (err instanceof AppError) throw err;
      // Show the provider's error: this endpoint exists to debug provider credentials
      throw AppError.badGateway(err instanceof Error ? err.message : "Delivery failed");
    }
    return { to: target };
  }

  public static async getOverview(fastify: FastifyInstance) {
    const db = fastify.db;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [totalUsers, activeUsers, phoneUsers, verifiedEmailUsers, newUsers24h, activeSessions] = await Promise.all([
      db.getRepository(User).count(),
      db.getRepository(User).count({ where: { isActive: true } }),
      db.getRepository(User).createQueryBuilder("u").where('u."phoneNumber" IS NOT NULL').getCount(),
      db.getRepository(User).count({ where: { emailVerified: true } }),
      db.getRepository(User).count({ where: { createdAt: MoreThan(since) } }),
      db.getRepository(UserSession).count({ where: { isActive: true, refreshTokenExpiresAt: MoreThan(new Date()) } }),
    ]);

    const identityRows: Array<{ provider: string; count: string }> = await db
      .getRepository(AuthIdentity)
      .createQueryBuilder("i")
      .select("i.provider", "provider")
      .addSelect("COUNT(*)", "count")
      .groupBy("i.provider")
      .getRawMany();

    const codeRows: Array<{ channel: string; count: string }> = await db
      .getRepository(VerificationCode)
      .createQueryBuilder("c")
      .select("c.channel", "channel")
      .addSelect("COUNT(*)", "count")
      .where('c."createdAt" > :since', { since })
      .groupBy("c.channel")
      .getRawMany();

    const byProvider = Object.fromEntries(identityRows.map((r) => [r.provider, Number(r.count)]));
    const byChannel = Object.fromEntries(codeRows.map((r) => [r.channel, Number(r.count)]));

    return {
      users: {
        total: totalUsers,
        active: activeUsers,
        newLast24h: newUsers24h,
        withPhone: phoneUsers,
        withVerifiedEmail: verifiedEmailUsers,
        google: byProvider.google ?? 0,
        apple: byProvider.apple ?? 0,
        facebook: byProvider.facebook ?? 0,
      },
      activeSessions,
      codesSentLast24h: {
        sms: byChannel.sms ?? 0,
        whatsapp: byChannel.whatsapp ?? 0,
        email: byChannel.email ?? 0,
      },
    };
  }
}
