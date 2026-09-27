import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { In, LessThan } from "typeorm";
import { Album } from "../database/entities/album.entity.js";
import { Image } from "../database/entities/image.entity.js";
import { AppError } from "../utils/errors.js";
import { env } from "../config/env.js";
import { IMAGE_EXTENSIONS, type RequestUploadsInput } from "../schemas/album.schema.js";
import type { ImageResponseDto, UploadTargetDto } from "../dtos/index.js";

export interface CompleteUploadsResult {
  uploaded: ImageResponseDto[];
  failed: { imageId: string; reason: string }[];
}

export class MediaService {
  public static toImageResponse(image: Image, fastify: FastifyInstance): ImageResponseDto {
    return {
      id: image.id,
      fileName: image.fileName,
      contentType: image.contentType,
      sizeBytes: image.sizeBytes,
      sortOrder: image.sortOrder,
      uploaderId: image.uploaderId,
      url: fastify.storage.getViewUrl(image.s3Key),
      createdAt: image.createdAt,
    };
  }

  /** Uploaded images of an album in display order. */
  public static async listImages(albumId: string, fastify: FastifyInstance): Promise<ImageResponseDto[]> {
    const images = await fastify.db.getRepository(Image).find({
      where: { albumId, status: "uploaded" },
      order: { sortOrder: "ASC", createdAt: "ASC" },
    });
    return images.map((image) => this.toImageResponse(image, fastify));
  }

  /**
   * Step 1 of an upload: reserve an image row per selected file (keeping the order the
   * user swiped them in) and hand back a presigned S3 POST for each. The app uploads the
   * bytes straight to S3, so they never pass through this server.
   */
  public static async requestUploads(
    albumId: string,
    uploaderId: string,
    files: RequestUploadsInput["files"],
    fastify: FastifyInstance
  ): Promise<UploadTargetDto[]> {
    const repo = fastify.db.getRepository(Image);

    const images = await fastify.db.transaction(async (manager) => {
      // Lock the album row so concurrent upload requests get non-overlapping sort orders.
      await manager.getRepository(Album).findOne({ where: { id: albumId }, lock: { mode: "pessimistic_write" } });
      const { max } = (await manager
        .getRepository(Image)
        .createQueryBuilder("image")
        .select('COALESCE(MAX(image."sortOrder"), -1)', "max")
        .where('image."albumId" = :albumId', { albumId })
        .getRawOne()) as { max: number };

      const rows = files.map((file, index) => {
        const id = crypto.randomUUID();
        return repo.create({
          id,
          albumId,
          uploaderId,
          s3Key: `albums/${albumId}/${id}.${IMAGE_EXTENSIONS[file.contentType]}`,
          fileName: file.fileName,
          contentType: file.contentType,
          sizeBytes: file.sizeBytes,
          sortOrder: Number(max) + 1 + index,
          status: "pending",
        });
      });
      return manager.getRepository(Image).save(rows);
    });

    return Promise.all(
      images.map(async (image) => {
        const upload = await fastify.storage.createUpload(image.s3Key, image.contentType, env.UPLOAD_MAX_BYTES);
        return {
          imageId: image.id,
          fileName: image.fileName,
          sortOrder: image.sortOrder,
          upload: { method: "POST" as const, ...upload },
        };
      })
    );
  }

  /**
   * Step 2 of an upload: confirm which objects actually landed in S3. Images that are
   * missing or don't match what was requested are reported as failed and dropped.
   */
  public static async completeUploads(
    albumId: string,
    uploaderId: string,
    imageIds: string[],
    fastify: FastifyInstance
  ): Promise<CompleteUploadsResult> {
    const repo = fastify.db.getRepository(Image);
    const images = await repo.find({ where: { id: In(imageIds), albumId, uploaderId } });
    const byId = new Map(images.map((i) => [i.id, i]));

    const result: CompleteUploadsResult = { uploaded: [], failed: [] };
    const rejectedKeys: string[] = [];
    const rejectedIds: string[] = [];

    for (const imageId of new Set(imageIds)) {
      const image = byId.get(imageId);
      if (!image) {
        result.failed.push({ imageId, reason: "Unknown upload" });
        continue;
      }
      if (image.status === "uploaded") {
        result.uploaded.push(this.toImageResponse(image, fastify));
        continue;
      }

      const stored = await fastify.storage.headObject(image.s3Key);
      if (!stored) {
        result.failed.push({ imageId, reason: "File was not uploaded" });
        continue; // keep the reservation so the app can retry while the upload URL is valid
      }
      if (stored.sizeBytes > env.UPLOAD_MAX_BYTES || (stored.contentType && stored.contentType !== image.contentType)) {
        result.failed.push({ imageId, reason: "Uploaded file does not match the requested image" });
        rejectedKeys.push(image.s3Key);
        rejectedIds.push(image.id);
        continue;
      }

      image.status = "uploaded";
      image.sizeBytes = stored.sizeBytes;
      await repo.save(image);
      result.uploaded.push(this.toImageResponse(image, fastify));
    }

    if (rejectedKeys.length) {
      await fastify.storage.deleteObjects(rejectedKeys);
      await repo.delete({ id: In(rejectedIds) });
    }
    result.uploaded.sort((a, b) => a.sortOrder - b.sortOrder);
    return result;
  }

  /** Applies a new display order. `imageIds` must list every uploaded image in the album exactly once. */
  public static async reorderImages(albumId: string, imageIds: string[], fastify: FastifyInstance): Promise<void> {
    await fastify.db.transaction(async (manager) => {
      const repo = manager.getRepository(Image);
      const current = await repo.find({ where: { albumId, status: "uploaded" }, select: { id: true } });
      const currentIds = new Set(current.map((i) => i.id));
      if (currentIds.size !== imageIds.length || imageIds.some((id) => !currentIds.has(id))) {
        throw AppError.badRequest("imageIds must contain every image in the album exactly once");
      }
      await Promise.all(imageIds.map((id, sortOrder) => repo.update({ id, albumId }, { sortOrder })));
    });
  }

  public static async deleteImage(album: Album, image: Image, fastify: FastifyInstance): Promise<void> {
    await fastify.storage.deleteObjects([image.s3Key]);
    await fastify.db.getRepository(Image).delete({ id: image.id });
    if (album.coverImageId === image.id) {
      await fastify.db.getRepository(Album).update({ id: album.id }, { coverImageId: null });
    }
  }

  /** Removes reservations whose upload URL expired without the file ever arriving. */
  public static async purgeStalePending(fastify: FastifyInstance): Promise<number> {
    const cutoff = new Date(Date.now() - env.UPLOAD_URL_TTL_SECONDS * 1000 * 2);
    const repo = fastify.db.getRepository(Image);
    const stale = await repo.find({ where: { status: "pending", createdAt: LessThan(cutoff) }, select: { id: true, s3Key: true } });
    if (!stale.length) return 0;
    await fastify.storage.deleteObjects(stale.map((i) => i.s3Key));
    await repo.delete({ id: In(stale.map((i) => i.id)) });
    return stale.length;
  }
}
