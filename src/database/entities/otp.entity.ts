import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

@Entity("otps")
export class Otp {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column({ type: "varchar", length: 30 })
  phoneNumber!: string;

  @Column({ type: "varchar", length: 10 })
  otp!: string;

  @Column({ type: "timestamptz" })
  expiresAt!: Date;

  @Column({ type: "boolean", default: false })
  isUsed!: boolean;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
