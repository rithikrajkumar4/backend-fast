import "reflect-metadata";
import { DataSource, type DataSourceOptions } from "typeorm";
import { env } from "../config/env.js";
import { User } from "./entities/user.entity.js";
import { Otp } from "./entities/otp.entity.js";
import { UserSession } from "./entities/session.entity.js";
import { ActivityLog } from "./entities/activity-log.entity.js";

const getDataSourceOptions = (): DataSourceOptions => {
  const baseOptions = {
    type: "postgres" as const,
    synchronize: env.DB_SYNC,
    logging: env.DB_LOG,
    entities: [User, Otp, UserSession, ActivityLog],
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
