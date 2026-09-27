import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { Album } from "./album.entity.js";

@Entity("share_links")
export class ShareLink {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column({ type: "uuid" })
  albumId!: string;

  @ManyToOne(() => Album, { onDelete: "CASCADE" })
  @JoinColumn({ name: "albumId" })
  album?: Album;

  @Index({ unique: true })
  @Column({ type: "varchar", length: 64 })
  token!: string;

  @Column({ type: "uuid" })
  createdById!: string;

  @Column({ type: "timestamptz", nullable: true })
  expiresAt?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  revokedAt?: Date | null;

  @Column({ type: "int", default: 0 })
  viewCount!: number;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
