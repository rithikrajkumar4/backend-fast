import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { User } from "./user.entity.js";

export type SsoProvider = "google" | "apple" | "facebook";

/** Links a user to an external sign-in provider account. */
@Entity("auth_identities")
@Index(["provider", "providerUserId"], { unique: true })
export class AuthIdentity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column({ type: "uuid" })
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user?: User;

  @Column({ type: "varchar", length: 20 })
  provider!: SsoProvider;

  // The provider's stable user id (the `sub` claim for Google/Apple, the app-scoped id for Facebook)
  @Column({ type: "varchar", length: 255 })
  providerUserId!: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  email!: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
