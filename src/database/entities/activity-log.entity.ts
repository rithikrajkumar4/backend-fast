import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

@Entity("activity_logs")
export class ActivityLog {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column({ type: "varchar", length: 100 })
  requestId!: string;

  @Index()
  @Column({ type: "uuid", nullable: true })
  sessionId?: string | null;

  @Index()
  @Column({ type: "uuid", nullable: true })
  userId?: string | null;

  @Column({ type: "varchar", length: 10 })
  method!: string;

  @Column({ type: "varchar", length: 255 })
  route!: string;

  @Column({ type: "text" })
  url!: string;

  @Column({ type: "int" })
  statusCode!: number;

  @Column({ type: "varchar", length: 45, nullable: true })
  ipAddress?: string | null;

  @Column({ type: "text", nullable: true })
  userAgent?: string | null;

  @Column({ type: "numeric", precision: 10, scale: 2, default: 0 })
  durationMs!: number;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
