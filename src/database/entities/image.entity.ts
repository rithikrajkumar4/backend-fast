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
import { Album } from "./album.entity.js";

export type ImageStatus = "pending" | "uploaded";

@Entity("images")
@Index(["albumId", "sortOrder"])
export class Image {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column({ type: "uuid" })
  albumId!: string;

  @ManyToOne(() => Album, { onDelete: "CASCADE" })
  @JoinColumn({ name: "albumId" })
  album?: Album;

  @Index()
  @Column({ type: "uuid" })
  uploaderId!: string;

  @Index({ unique: true })
  @Column({ type: "varchar", length: 255 })
  s3Key!: string;

  @Column({ type: "varchar", length: 255 })
  fileName!: string;

  @Column({ type: "varchar", length: 50 })
  contentType!: string;

  @Column({ type: "bigint", transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  sizeBytes!: number;

  @Column({ type: "int", default: 0 })
  sortOrder!: number;

  @Column({ type: "varchar", length: 10, default: "pending" })
  status!: ImageStatus;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
