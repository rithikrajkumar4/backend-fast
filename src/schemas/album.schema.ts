import { z } from "zod";
import { env } from "../config/env.js";

/** Image MIME types accepted for upload, mapped to the S3 key extension. */
export const IMAGE_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/gif": "gif",
  "image/avif": "avif",
} as const;

export type ImageContentType = keyof typeof IMAGE_EXTENSIONS;

const contentTypes = Object.keys(IMAGE_EXTENSIONS) as [ImageContentType, ...ImageContentType[]];
const uuid = (label: string) => z.string({ required_error: `${label} is required` }).uuid(`Invalid ${label}`);

export const albumIdParamsSchema = z.object({ albumId: uuid("album id") });
export const imageParamsSchema = z.object({ albumId: uuid("album id"), imageId: uuid("image id") });
export const memberParamsSchema = z.object({ albumId: uuid("album id"), userId: uuid("user id") });
export const shareLinkParamsSchema = z.object({ albumId: uuid("album id"), linkId: uuid("link id") });
export const shareTokenParamsSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, "Invalid share link"),
});

export const createAlbumSchema = z.object({
  title: z
    .string({ required_error: "Title is required" })
    .trim()
    .min(1, "Title cannot be empty")
    .max(120, "Title cannot exceed 120 characters"),
});

export const updateAlbumSchema = z
  .object({
    title: z.string().trim().min(1, "Title cannot be empty").max(120, "Title cannot exceed 120 characters").optional(),
    coverImageId: z.string().uuid("Invalid cover image id").nullable().optional(),
  })
  .refine((v) => v.title !== undefined || v.coverImageId !== undefined, "Nothing to update");

/**
 * The images the user swiped right on, in the order they picked them.
 * Images swiped left never reach the server.
 */
export const requestUploadsSchema = z.object({
  files: z
    .array(
      z.object({
        fileName: z.string().trim().min(1, "File name is required").max(255, "File name is too long"),
        contentType: z.enum(contentTypes, {
          errorMap: () => ({ message: `Unsupported image type. Allowed: ${contentTypes.join(", ")}` }),
        }),
        sizeBytes: z
          .number({ required_error: "File size is required" })
          .int()
          .positive("File cannot be empty")
          .max(env.UPLOAD_MAX_BYTES, `Each image must be at most ${env.UPLOAD_MAX_BYTES} bytes`),
      }),
      { required_error: "files is required" }
    )
    .min(1, "Select at least one image")
    .max(env.UPLOAD_MAX_FILES, `You can upload at most ${env.UPLOAD_MAX_FILES} images at once`),
});

export const completeUploadsSchema = z.object({
  imageIds: z.array(z.string().uuid("Invalid image id")).min(1, "imageIds cannot be empty").max(env.UPLOAD_MAX_FILES),
});

export const reorderImagesSchema = z.object({
  imageIds: z
    .array(z.string().uuid("Invalid image id"))
    .min(1, "imageIds cannot be empty")
    .refine((ids) => new Set(ids).size === ids.length, "imageIds must not contain duplicates"),
});

export const addMemberSchema = z.object({
  username: z.string({ required_error: "Username is required" }).trim().min(3).max(30),
  role: z.enum(["viewer", "editor"]).default("viewer"),
});

export const updateMemberSchema = z.object({
  role: z.enum(["viewer", "editor"], { required_error: "Role is required" }),
});

export const createShareLinkSchema = z
  .object({
    /** Omit for a link that never expires (it can still be revoked). */
    expiresInHours: z.number().int().min(1).max(24 * 365).optional(),
  })
  .default({});

export type CreateAlbumInput = z.infer<typeof createAlbumSchema>;
export type UpdateAlbumInput = z.infer<typeof updateAlbumSchema>;
export type RequestUploadsInput = z.infer<typeof requestUploadsSchema>;
export type CompleteUploadsInput = z.infer<typeof completeUploadsSchema>;
export type ReorderImagesInput = z.infer<typeof reorderImagesSchema>;
export type AddMemberInput = z.infer<typeof addMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
export type CreateShareLinkInput = z.infer<typeof createShareLinkSchema>;
