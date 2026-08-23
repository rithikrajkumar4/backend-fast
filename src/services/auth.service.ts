import type { FastifyInstance } from "fastify";
import type { Repository } from "typeorm";
import { User } from "../database/entities/user.entity.js";
import { Otp } from "../database/entities/otp.entity.js";
import { OtpService } from "./otp.service.js";
import { UsernameService } from "./username.service.js";
import {
  SessionService,
  type AuthTokens,
  type SessionMetadata,
} from "./session.service.js";
import type { ClientType } from "../database/entities/session.entity.js";
import { AppError } from "../utils/errors.js";

export interface SendOtpResult {
  isNewUser: boolean;
  phoneNumber: string;
  otp: string;
  expiresAt: Date;
}

export type VerifyOtpResult =
  | {
      isNewUser: false;
      user: User;
      tokens: AuthTokens;
    }
  | {
      isNewUser: true;
      phoneNumber: string;
      suggestedUsername: string;
      tempToken: string;
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

export class AuthService {
  /**
   * Sends OTP to phone number and checks if user exists.
   */
  public static async sendOtp(
    phoneNumber: string,
    fastify: FastifyInstance
  ): Promise<SendOtpResult> {
    const userRepository: Repository<User> = fastify.db.getRepository(User);
    const otpRepository: Repository<Otp> = fastify.db.getRepository(Otp);

    const formattedPhone = phoneNumber.trim();

    const existingUser = await userRepository.findOne({
      where: { phoneNumber: formattedPhone },
      select: { id: true, phoneNumber: true },
    });

    const { otp, expiresAt } = await OtpService.sendOtp(formattedPhone, otpRepository);

    return {
      isNewUser: !existingUser,
      phoneNumber: formattedPhone,
      otp,
      expiresAt,
    };
  }

  /**
   * Verifies OTP.
   * If existing user -> logs in, creates session & tokens.
   * If new user -> creates temp registration token and suggests a collision-free username.
   */
  public static async verifyOtp(
    phoneNumber: string,
    otp: string,
    clientType: ClientType = "web",
    meta: SessionMetadata,
    fastify: FastifyInstance
  ): Promise<VerifyOtpResult> {
    const userRepository: Repository<User> = fastify.db.getRepository(User);
    const otpRepository: Repository<Otp> = fastify.db.getRepository(Otp);

    const formattedPhone = phoneNumber.trim();

    const isValidOtp = await OtpService.verifyOtp(formattedPhone, otp, otpRepository);
    if (!isValidOtp) {
      throw AppError.badRequest("Invalid or expired OTP");
    }

    const existingUser = await userRepository.findOne({
      where: { phoneNumber: formattedPhone },
    });

    if (existingUser) {
      if (!existingUser.isActive) {
        throw AppError.forbidden("User account is deactivated");
      }

      const tokens = await SessionService.createSession(
        existingUser,
        clientType,
        meta,
        fastify
      );

      return {
        isNewUser: false,
        user: existingUser,
        tokens,
      };
    }

    // New user flow: Generate collision-free username suggestion and short-lived temp token
    const suggestedUsername = await UsernameService.generateUniqueUsername(userRepository);
    const tempToken = fastify.jwt.sign(
      {
        phoneNumber: formattedPhone,
        isOtpVerified: true,
        purpose: "registration",
      },
      { expiresIn: "15m" }
    );

    return {
      isNewUser: true,
      phoneNumber: formattedPhone,
      suggestedUsername,
      tempToken,
    };
  }

  /**
   * Completes registration for a new user with verified temp token.
   */
  public static async completeProfile(
    input: CompleteProfileInput,
    fastify: FastifyInstance
  ): Promise<{ user: User; tokens: AuthTokens }> {
    const userRepository: Repository<User> = fastify.db.getRepository(User);

    // Verify temp registration token
    let decoded: any;
    try {
      decoded = fastify.jwt.verify(input.tempToken);
    } catch {
      throw AppError.badRequest("Invalid or expired registration session. Please request a new OTP.");
    }

    if (!decoded || decoded.purpose !== "registration" || !decoded.phoneNumber) {
      throw AppError.badRequest("Invalid registration token");
    }

    const phoneNumber = String(decoded.phoneNumber).trim();

    // Ensure phone number isn't already registered
    const phoneExists = await userRepository.findOne({
      where: { phoneNumber },
      select: { id: true },
    });
    if (phoneExists) {
      throw AppError.conflict("A user with this phone number already exists. Please log in.");
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

    // Validate email uniqueness if provided
    if (input.email) {
      const emailExists = await userRepository.findOne({
        where: { email: input.email.trim().toLowerCase() },
        select: { id: true },
      });
      if (emailExists) {
        throw AppError.conflict("This email is already associated with another account.");
      }
    }

    // Create and save user
    const newUser = userRepository.create({
      phoneNumber,
      username: finalUsername,
      name: input.name.trim(),
      age: input.age,
      email: input.email ? input.email.trim().toLowerCase() : null,
      isActive: true,
    });

    const savedUser = await userRepository.save(newUser);

    // Create active session
    const tokens = await SessionService.createSession(
      savedUser,
      input.clientType || "web",
      input.meta,
      fastify
    );

    return {
      user: savedUser,
      tokens,
    };
  }
}
