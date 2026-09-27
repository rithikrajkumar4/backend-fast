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
import { User } from "./user.entity.js";

/** viewer: can see the album. editor: can also upload, reorder and remove images. */
export type AlbumRole = "viewer" | "editor";

@Entity("album_members")
@Index(["albumId", "userId"], { unique: true })
export class AlbumMember {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  albumId!: string;

  @ManyToOne(() => Album, { onDelete: "CASCADE" })
  @JoinColumn({ name: "albumId" })
  album?: Album;

  @Index()
  @Column({ type: "uuid" })
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user?: User;

  @Column({ type: "varchar", length: 10, default: "viewer" })
  role!: AlbumRole;

  @Column({ type: "uuid" })
  addedById!: string;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
