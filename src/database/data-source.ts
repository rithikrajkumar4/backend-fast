import "reflect-metadata";
import { DataSource, type DataSourceOptions } from "typeorm";
import { env } from "../config/env.js";
import { User } from "./entities/user.entity.js";
import { VerificationCode } from "./entities/verification-code.entity.js";
import { AuthIdentity } from "./entities/auth-identity.entity.js";
import { AppSetting } from "./entities/app-setting.entity.js";
import { AdminUser } from "./entities/admin-user.entity.js";
import { UserSession } from "./entities/session.entity.js";
import { ActivityLog } from "./entities/activity-log.entity.js";
import { Album } from "./entities/album.entity.js";
import { Image } from "./entities/image.entity.js";
import { AlbumMember } from "./entities/album-member.entity.js";
import { ShareLink } from "./entities/share-link.entity.js";

const getDataSourceOptions = (): DataSourceOptions => {
  const baseOptions = {
    type: "postgres" as const,
    synchronize: env.DB_SYNC,
    logging: env.DB_LOG,
    entities: [
      User,
      VerificationCode,
      AuthIdentity,
      UserSession,
      ActivityLog,
      Album,
      Image,
      AlbumMember,
      ShareLink,
      AppSetting,
      AdminUser,
    ],
    extra: {
      max: env.DB_MAX_CONNECTIONS,
    },
    ssl: env.DB_SSL ? { rejectUnauthorized: false } : false,
  };

  if (env.DATABASE_URL) {
    return {
      ...baseOptions,
      url: env.DATABASE_URL,
    };
  }

  return {
    ...baseOptions,
    host: env.DB_HOST,
    port: env.DB_PORT,
    username: env.DB_USER,
    password: env.DB_PASSWORD || undefined,
    database: env.DB_NAME,
  };
};

export const AppDataSource = new DataSource(getDataSourceOptions());
