import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { User } from "./user.entity.js";

export type ClientType = "web" | "app";

@Entity("user_sessions")
export class UserSession {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column({ type: "uuid" })
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user?: User;

  @Column({ type: "varchar", length: 10, default: "web" })
  clientType!: ClientType;

  @Index()
  @Column({ type: "varchar", length: 255 })
  refreshToken!: string;

  @Column({ type: "timestamptz" })
  refreshTokenExpiresAt!: Date;

  @Column({ type: "text", nullable: true })
  userAgent?: string | null;

  @Column({ type: "varchar", length: 45, nullable: true })
  ipAddress?: string | null;

  @Column({ type: "boolean", default: true })
  isActive!: boolean;

  @Column({ type: "timestamptz" })
  lastActivityAt!: Date;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
