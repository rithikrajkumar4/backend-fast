import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("admin_users")
export class AdminUser {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  // Login name, stored lowercased. Any handle works, including an email address.
  @Column({ type: "varchar", length: 255, unique: true })
  username!: string;

  @Column({ type: "varchar", length: 255, select: false })
  passwordHash!: string;

  @Column({ type: "varchar", length: 255, default: "" })
  name!: string;

  @Column({ type: "boolean", default: true })
  isActive!: boolean;

  @Column({ type: "timestamptz", nullable: true })
  lastLoginAt!: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
