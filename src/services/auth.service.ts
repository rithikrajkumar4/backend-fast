import type { FastifyInstance } from "fastify";
import type { Repository } from "typeorm";
import { User } from "../database/entities/user.entity.js";
import { AuthIdentity, type SsoProvider } from "../database/entities/auth-identity.entity.js";
import type { OtpChannel } from "../database/entities/verification-code.entity.js";
import { OtpService } from "./otp.service.js";
import { SettingsService } from "./settings.service.js";
import { UsernameService } from "./username.service.js";
import type { SsoCredentials, VerifiedIdentity } from "./identity-verifier.service.js";
import {
  SessionService,
  type AuthTokens,
  type SessionMetadata,
} from "./session.service.js";
import type { ClientType } from "../database/entities/session.entity.js";
import type { TempRegistrationPayload } from "../plugins/jwt.js";
import { normalizeEmail, normalizePhone } from "../utils/identifiers.js";
import { AppError } from "../utils/errors.js";

/** A phone number or an email, as sent by the client. */
export interface OtpTargetInput {
  phoneNumber?: string;
  email?: string;
  channel?: "sms" | "whatsapp";
}

export interface SendOtpResult {
  isNewUser: boolean;
  phoneNumber?: string;
  email?: string;
  channel: OtpChannel;
  expiresAt: Date;
  resendAvailableAt: Date;
  otp?: string;
}

export type LoginResult =
  | {
      isNewUser: false;
      user: User;
      tokens: AuthTokens;
    }
  | {
      isNewUser: true;
      phoneNumber?: string;
      email?: string;
      suggestedUsername: string;
      tempToken: string;
      prefill?: { name: string | null; email: string | null };
    };

export interface CompleteProfileInput {
  tempToken: string;
  name: string;
  age: number;
  username?: string;
  email?: string | null;
  clientType?: ClientType;
  meta: SessionMetadata;
}

const REGISTRATION_TOKEN_TTL = "15m";

export class AuthService {
  private static async resolveTarget(input: OtpTargetInput, fastify: FastifyInstance) {
    const settings = await SettingsService.getAuthSettings(fastify);
    if (input.email) {
      return { settings, kind: "email" as const, target: normalizeEmail(input.email), channel: "email" as OtpChannel };
    }
    const target = normalizePhone(input.phoneNumber ?? "", settings.phone.defaultCountryCode);
    const channel: OtpChannel = input.channel ?? settings.phone.defaultChannel;
    return { settings, kind: "phone" as const, target, channel };
  }

  private static findUserByTarget(kind: "email" | "phone", target: string, repo: Repository<User>) {
    return repo.findOne({ where: kind === "email" ? { email: target } : { phoneNumber: target } });
  }

  /**
   * Sends a verification code to a phone number (SMS/WhatsApp) or an email and reports whether
   * the identifier already belongs to an account.
   */
  public static async sendOtp(input: OtpTargetInput, fastify: FastifyInstance): Promise<SendOtpResult> {
    const { settings, kind, target, channel } = await this.resolveTarget(input, fastify);
    const userRepository = fastify.db.getRepository(User);

    const result = await OtpService.sendCode(target, channel, settings, fastify);
    const existingUser = await this.findUserByTarget(kind, target, userRepository);

    return {
      isNewUser: !existingUser,
      ...(kind === "email" ? { email: target } : { phoneNumber: target }),
      channel,
      expiresAt: result.expiresAt,
      resendAvailableAt: result.resendAvailableAt,
      ...(result.devCode ? { otp: result.devCode } : {}),
    };
  }

  /**
   * Verifies an OTP.
   * Existing user -> logs in, creates session & tokens.
   * New user -> returns a registration temp token and a collision-free username suggestion.
   */
  public static async verifyOtp(
    input: OtpTargetInput & { otp: string },
    clientType: ClientType,
    meta: SessionMetadata,
    fastify: FastifyInstance
  ): Promise<LoginResult> {
    const { settings, kind, target } = await this.resolveTarget(input, fastify);
    const userRepository = fastify.db.getRepository(User);

    const channel = await OtpService.verifyCode(target, input.otp, settings, fastify);
    // The admin may have turned the channel off after the code was sent
    OtpService.assertChannelEnabled(channel, settings);

    const existingUser = await this.findUserByTarget(kind, target, userRepository);
    if (existingUser) {
      if (kind === "email" && !existingUser.emailVerified) {
        // The email was typed in during another signup and never proven; don't hand that account over
        throw AppError.conflict(
          "This email is attached to an account that hasn't verified it. Sign in with that account's phone number or provider instead."
        );
      }
      return this.login(existingUser, clientType, meta, fastify);
    }

    const payload: TempRegistrationPayload =
      kind === "email" ? { purpose: "registration", email: target } : { purpose: "registration", phoneNumber: target };
    return {
      isNewUser: true,
      ...(kind === "email" ? { email: target } : { phoneNumber: target }),
      suggestedUsername: await UsernameService.generateUniqueUsername(userRepository),
      tempToken: fastify.jwt.sign(payload, { expiresIn: REGISTRATION_TOKEN_TTL }),
    };
  }

  /**
   * Signs in with Google, Apple or Facebook.
   * 1. A known provider account logs straight in.
   * 2. Otherwise, if enabled, a verified email matching a user's verified email links the provider.
   * 3. Otherwise the user registers through /complete-profile with the returned temp token.
   */
  public static async ssoLogin(
    provider: SsoProvider,
    credentials: SsoCredentials & { name?: string },
    clientType: ClientType,
    meta: SessionMetadata,
    fastify: FastifyInstance
  ): Promise<LoginResult> {
    const settings = await SettingsService.getAuthSettings(fastify);
    const identity = await fastify.identityVerifier.verify(provider, credentials, settings);
    const userRepository = fastify.db.getRepository(User);
    const identityRepository = fastify.db.getRepository(AuthIdentity);

    const linked = await identityRepository.findOne({
      where: { provider, providerUserId: identity.providerUserId },
      relations: { user: true },
    });
    if (linked?.user) {
      return this.login(linked.user, clientType, meta, fastify);
    }

    const emailOwner = identity.email
      ? await userRepository.findOne({ where: { email: identity.email } })
      : null;

    if (emailOwner && identity.emailVerified && emailOwner.emailVerified && settings.sso.autoLinkByVerifiedEmail) {
      await this.linkIdentity(emailOwner.id, identity, identityRepository);
      return this.login(emailOwner, clientType, meta, fastify);
    }

    // Carry the email into registration only if it's proven and still free
    const registrationEmail = identity.emailVerified && !emailOwner ? identity.email : null;
    const payload: TempRegistrationPayload = {
      purpose: "registration",
      identity: { provider, providerUserId: identity.providerUserId, email: identity.email },
      ...(registrationEmail ? { email: registrationEmail } : {}),
    };

    return {
      isNewUser: true,
      ...(registrationEmail ? { email: registrationEmail } : {}),
      suggestedUsername: await UsernameService.generateUniqueUsername(userRepository),
      tempToken: fastify.jwt.sign(payload, { expiresIn: REGISTRATION_TOKEN_TTL }),
      prefill: {
        name: credentials.name ?? identity.name,
        email: emailOwner ? null : identity.email,
      },
    };
  }

  private static async login(
    user: User,
    clientType: ClientType,
    meta: SessionMetadata,
    fastify: FastifyInstance
  ): Promise<LoginResult> {
    if (!user.isActive) {
      throw AppError.forbidden("User account is deactivated");
    }
    const tokens = await SessionService.createSession(user, clientType, meta, fastify);
    return { isNewUser: false, user, tokens };
  }

  private static async linkIdentity(
    userId: string,
    identity: VerifiedIdentity,
    identityRepository: Repository<AuthIdentity>
  ): Promise<void> {
    await identityRepository.save(
      identityRepository.create({
        userId,
        provider: identity.provider,
        providerUserId: identity.providerUserId,
        email: identity.email,
      })
    );
  }

  /**
   * Completes registration for a new user with a verified temp token.
   */
  public static async completeProfile(
    input: CompleteProfileInput,
    fastify: FastifyInstance
  ): Promise<{ user: User; tokens: AuthTokens }> {
    let decoded: Partial<TempRegistrationPayload> & Record<string, unknown>;
    try {
      decoded = fastify.jwt.verify(input.tempToken);
    } catch {
      throw AppError.badRequest("Invalid or expired registration session. Please request a new OTP.");
    }

    if (!decoded || decoded.purpose !== "registration" || (!decoded.phoneNumber && !decoded.email && !decoded.identity)) {
      throw AppError.badRequest("Invalid registration token");
    }

    const phoneNumber = decoded.phoneNumber ? String(decoded.phoneNumber) : null;
    const verifiedEmail = decoded.email ? normalizeEmail(String(decoded.email)) : null;
    const identity = decoded.identity ?? null;
    // A proven email wins over whatever the form sends
    const email = verifiedEmail ?? (input.email ? normalizeEmail(input.email) : null);

    return fastify.db.transaction(async (manager) => {
      const userRepository = manager.getRepository(User);
      const identityRepository = manager.getRepository(AuthIdentity);

      if (phoneNumber && (await userRepository.exists({ where: { phoneNumber } }))) {
        throw AppError.conflict("A user with this phone number already exists. Please log in.");
      }
      if (
        identity &&
        (await identityRepository.exists({
          where: { provider: identity.provider, providerUserId: identity.providerUserId },
        }))
      ) {
        throw AppError.conflict("This account is already registered. Please sign in.");
      }
      if (email && (await userRepository.exists({ where: { email } }))) {
        throw AppError.conflict("This email is already associated with another account.");
      }

      // Determine and validate username
      let finalUsername: string;
      if (input.username && input.username.trim().length > 0) {
        const customUsername = input.username.trim().toLowerCase();

        if (!UsernameService.isValidFormat(customUsername)) {
          throw AppError.badRequest(
            "Invalid username format. Must be 3-30 characters and contain only letters, numbers, and underscores."
          );
        }

        const isAvailable = await UsernameService.isUsernameAvailable(customUsername, userRepository);
        if (!isAvailable) {
          throw AppError.conflict(`Username '${customUsername}' is already taken. Please choose another.`);
        }

        finalUsername = customUsername;
      } else {
        finalUsername = await UsernameService.generateUniqueUsername(userRepository);
      }

      const savedUser = await userRepository.save(
        userRepository.create({
          phoneNumber,
          username: finalUsername,
          name: input.name.trim(),
          age: input.age,
          email,
          emailVerified: !!verifiedEmail,
          isActive: true,
        })
      );

      if (identity) {
        await identityRepository.save(
          identityRepository.create({
            userId: savedUser.id,
            provider: identity.provider,
            providerUserId: identity.providerUserId,
            email: identity.email,
          })
        );
      }

      const tokens = await SessionService.createSession(
        savedUser,
        input.clientType || "web",
        input.meta,
        fastify,
        manager
      );

      return { user: savedUser, tokens };
    }).catch((err) => {
      // Unique violation from a concurrent registration with the same phone/email/username
      if ((err as { code?: string })?.code === "23505") {
        throw AppError.conflict("This account was just registered. Please log in.");
      }
      throw err;
    });
  }
}
