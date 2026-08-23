import type { Repository } from "typeorm";
import { MoreThan } from "typeorm";
import { Otp } from "../database/entities/otp.entity.js";
import { env } from "../config/env.js";

export class OtpService {
  /**
   * Generates a 6-digit OTP and saves it to the database with a 5-minute expiry.
   */
  public static async sendOtp(
    phoneNumber: string,
    otpRepository: Repository<Otp>
  ): Promise<{ otp: string; expiresAt: Date }> {
    const formattedPhone = phoneNumber.trim();

    // Use DEFAULT_OTP in dev/test or generate random 6 digits
    const otpCode =
      env.NODE_ENV === "production"
        ? Math.floor(100000 + Math.random() * 900000).toString()
        : env.DEFAULT_OTP || "123456";

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes validity

    // Invalidate any previous unused OTPs for this phone number
    await otpRepository.update(
      { phoneNumber: formattedPhone, isUsed: false },
      { isUsed: true }
    );

    const newOtp = otpRepository.create({
      phoneNumber: formattedPhone,
      otp: otpCode,
      expiresAt,
      isUsed: false,
    });

    await otpRepository.save(newOtp);

    return { otp: otpCode, expiresAt };
  }

  /**
   * Verifies the submitted OTP against active records for the given phone number.
   */
  public static async verifyOtp(
    phoneNumber: string,
    submittedOtp: string,
    otpRepository: Repository<Otp>
  ): Promise<boolean> {
    const formattedPhone = phoneNumber.trim();
    const cleanOtp = submittedOtp.trim();

    // Find the latest active OTP for this phone number
    const activeOtp = await otpRepository.findOne({
      where: {
        phoneNumber: formattedPhone,
        otp: cleanOtp,
        isUsed: false,
        expiresAt: MoreThan(new Date()),
      },
      order: { createdAt: "DESC" },
    });

    if (!activeOtp) {
      return false;
    }

    // Mark as used
    activeOtp.isUsed = true;
    await otpRepository.save(activeOtp);

    return true;
  }
}
