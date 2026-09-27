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

@Entity("albums")
export class Album {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column({ type: "uuid" })
  ownerId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "ownerId" })
  owner?: User;

  @Column({ type: "varchar", length: 120 })
  title!: string;

  @Column({ type: "uuid", nullable: true })
  coverImageId?: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
