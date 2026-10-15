import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from "typeorm";

export type OtpChannel = "sms" | "whatsapp" | "email";

@Entity("verification_codes")
@Index(["target", "createdAt"])
export class VerificationCode {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  // Normalized phone number (E.164) or lowercased email
  @Column({ type: "varchar", length: 255 })
  target!: string;

  @Column({ type: "varchar", length: 16 })
  channel!: OtpChannel;

  // HMAC of target + code; the code itself is never stored
  @Column({ type: "varchar", length: 64 })
  codeHash!: string;

  @Column({ type: "int", default: 0 })
  attempts!: number;

  @Column({ type: "boolean", default: false })
  isUsed!: boolean;

  @Column({ type: "timestamptz" })
  expiresAt!: Date;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
