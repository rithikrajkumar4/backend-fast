import type { FastifyInstance } from "fastify";
import { MoreThan } from "typeorm";
import {
  VerificationCode,
  type OtpChannel,
} from "../database/entities/verification-code.entity.js";
import type { AuthSettings } from "../schemas/settings.schema.js";
import { generateNumericCode, hashCode, safeEqualHex } from "../utils/crypto.js";
import { AppError } from "../utils/errors.js";
import { env } from "../config/env.js";

export interface SendCodeResult {
  expiresAt: Date;
  resendAvailableAt: Date;
  /** Only outside production, so local clients and tests can complete the flow */
  devCode?: string;
}

export class OtpService {
  /** Throws unless the admin has enabled this channel. */
  public static assertChannelEnabled(channel: OtpChannel, settings: AuthSettings): void {
    const enabled =
      channel === "email"
        ? settings.email.enabled
        : settings.phone.enabled && settings.phone[channel];
    if (!enabled) {
      const label = channel === "email" ? "Email" : channel === "sms" ? "SMS" : "WhatsApp";
      throw AppError.forbidden(`${label} login is disabled`);
    }
  }

  private static pickCode(target: string, settings: AuthSettings): { code: string; isTestAccount: boolean } {
    const testAccount = settings.testAccounts.find((t) => t.identifier === target);
    if (testAccount) return { code: testAccount.code, isTestAccount: true };
    if (env.NODE_ENV !== "production") {
      return { code: env.DEFAULT_OTP.repeat(2).slice(0, settings.otp.length), isTestAccount: false };
    }
    return { code: generateNumericCode(settings.otp.length), isTestAccount: false };
  }

  /**
   * Creates a code for `target` (normalized phone or email) and delivers it on `channel`.
   * Enforces the resend cooldown and the hourly cap per target.
   */
  public static async sendCode(
    target: string,
    channel: OtpChannel,
    settings: AuthSettings,
    fastify: FastifyInstance
  ): Promise<SendCodeResult> {
    this.assertChannelEnabled(channel, settings);
    const repo = fastify.db.getRepository(VerificationCode);
    const now = Date.now();
    const { otp } = settings;

    const latest = await repo.findOne({ where: { target }, order: { createdAt: "DESC" } });
    if (latest && otp.resendCooldownSeconds > 0) {
      const availableAt = latest.createdAt.getTime() + otp.resendCooldownSeconds * 1000;
      if (availableAt > now) {
        const retryAfterSeconds = Math.ceil((availableAt - now) / 1000);
        throw AppError.tooManyRequests(`Please wait ${retryAfterSeconds}s before requesting another code`, {
          retryAfterSeconds,
        });
      }
    }

    const sentLastHour = await repo.count({
      where: { target, createdAt: MoreThan(new Date(now - 60 * 60 * 1000)) },
    });
    if (sentLastHour >= otp.maxSendsPerHour) {
      throw AppError.tooManyRequests("Too many codes requested. Please try again later.");
    }

    const { code, isTestAccount } = this.pickCode(target, settings);
    const expiresAt = new Date(now + otp.ttlSeconds * 1000);

    // Only the newest code for a target is valid
    await repo.update({ target, isUsed: false }, { isUsed: true });
    const record = await repo.save(
      repo.create({ target, channel, codeHash: hashCode(target, code), expiresAt, isUsed: false, attempts: 0 })
    );

    if (!isTestAccount) {
      try {
        await fastify.otpSender({ channel, to: target, code, settings });
      } catch (err) {
        await repo.update(record.id, { isUsed: true });
        if (err instanceof AppError) throw err;
        fastify.log.error({ err, channel }, "OTP delivery failed");
        throw AppError.badGateway("We couldn't send the verification code. Please try again.");
      }
    }

    return {
      expiresAt,
      resendAvailableAt: new Date(now + otp.resendCooldownSeconds * 1000),
      ...(env.NODE_ENV !== "production" ? { devCode: code } : {}),
    };
  }

  /**
   * Checks `code` against the newest active code for `target` and consumes it.
   * Each wrong guess counts toward maxAttempts; the code is burned once the limit is reached.
   * Returns the channel the code was sent on.
   */
  public static async verifyCode(
    target: string,
    code: string,
    settings: AuthSettings,
    fastify: FastifyInstance
  ): Promise<OtpChannel> {
    // A malformed code is a client error, not a guess, so it doesn't use up an attempt
    if (code.trim().length !== settings.otp.length) {
      throw AppError.badRequest(`OTP must be ${settings.otp.length} digits`);
    }

    const repo = fastify.db.getRepository(VerificationCode);
    const active = await repo.findOne({
      where: { target, isUsed: false, expiresAt: MoreThan(new Date()) },
      order: { createdAt: "DESC" },
    });
    if (!active) {
      throw AppError.badRequest("Invalid or expired OTP");
    }

    if (!safeEqualHex(active.codeHash, hashCode(target, code.trim()))) {
      // Atomic increment; burn the code when this guess hits the limit
      const rows: Array<{ attempts: number }> = await repo.query(
        `UPDATE verification_codes
            SET attempts = attempts + 1,
                "isUsed" = (attempts + 1 >= $2)
          WHERE id = $1 AND "isUsed" = false
          RETURNING attempts`,
        [active.id, settings.otp.maxAttempts]
      ).then((r: any) => (Array.isArray(r[0]) ? r[0] : r));
      const attempts = rows[0]?.attempts ?? settings.otp.maxAttempts;
      if (attempts >= settings.otp.maxAttempts) {
        throw AppError.badRequest("Too many incorrect attempts. Please request a new code.");
      }
      throw AppError.badRequest("Invalid or expired OTP", {
        attemptsRemaining: settings.otp.maxAttempts - attempts,
      });
    }

    // Consume atomically so two concurrent requests can't both use the same code
    const consumed = await repo.update({ id: active.id, isUsed: false }, { isUsed: true });
    if (!consumed.affected) {
      throw AppError.badRequest("Invalid or expired OTP");
    }
    return active.channel;
  }
}
