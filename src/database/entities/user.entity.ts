import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

@Entity("users")
export class User {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  // Always OTP-verified when set. Null for users who signed up with email or SSO.
  @Index({ unique: true })
  @Column({ type: "varchar", length: 30, unique: true, nullable: true })
  phoneNumber!: string | null;

  @Index({ unique: true })
  @Column({ type: "varchar", length: 50, unique: true })
  username!: string;

  @Column({ type: "varchar", length: 255 })
  name!: string;

  @Column({ type: "int" })
  age!: number;

  @Column({ type: "varchar", length: 255, unique: true, nullable: true })
  email?: string | null;

  // True when the email was proven by an email OTP or a provider that verifies emails (Google, Apple).
  @Column({ type: "boolean", default: false })
  emailVerified!: boolean;

  @Column({ type: "boolean", default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
