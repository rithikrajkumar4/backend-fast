import { Entity, PrimaryColumn, Column, UpdateDateColumn } from "typeorm";

/** Runtime configuration edited from the admin panel, one JSON document per key. */
@Entity("app_settings")
export class AppSetting {
  @PrimaryColumn({ type: "varchar", length: 64 })
  key!: string;

  @Column({ type: "jsonb" })
  value!: Record<string, unknown>;

  @Column({ type: "uuid", nullable: true })
  updatedBy!: string | null;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
