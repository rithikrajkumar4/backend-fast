import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { IsNull } from "typeorm";
import { Album } from "../database/entities/album.entity.js";
import { ShareLink } from "../database/entities/share-link.entity.js";
import { User } from "../database/entities/user.entity.js";
import { MediaService } from "./media.service.js";
import { AppError } from "../utils/errors.js";
import { env } from "../config/env.js";
import type { ImageResponseDto, ShareLinkDto } from "../dtos/index.js";

export interface SharedAlbumView {
  album: { id: string; title: string; ownerUsername: string | null };
  images: Omit<ImageResponseDto, "uploaderId">[];
  expiresAt: Date | null;
}

export class ShareService {
  public static toShareLinkResponse(link: ShareLink): ShareLinkDto {
    return {
      id: link.id,
      token: link.token,
      url: `${env.SHARE_BASE_URL.replace(/\/+$/, "")}/${link.token}`,
      expiresAt: link.expiresAt ?? null,
      revokedAt: link.revokedAt ?? null,
      viewCount: link.viewCount,
      createdAt: link.createdAt,
    };
  }

  public static async createLink(
    albumId: string,
    createdById: string,
    expiresInHours: number | undefined,
    fastify: FastifyInstance
  ): Promise<ShareLinkDto> {
    const repo = fastify.db.getRepository(ShareLink);
    const link = await repo.save(
      repo.create({
        albumId,
        createdById,
        token: crypto.randomBytes(24).toString("base64url"), // 192 bits, unguessable
        expiresAt: expiresInHours ? new Date(Date.now() + expiresInHours * 3_600_000) : null,
      })
    );
    return this.toShareLinkResponse(link);
  }

  public static async listLinks(albumId: string, fastify: FastifyInstance): Promise<ShareLinkDto[]> {
    const links = await fastify.db
      .getRepository(ShareLink)
      .find({ where: { albumId }, order: { createdAt: "DESC" } });
    return links.map((l) => this.toShareLinkResponse(l));
  }

  public static async revokeLink(albumId: string, linkId: string, fastify: FastifyInstance): Promise<void> {
    const result = await fastify.db
      .getRepository(ShareLink)
      .update({ id: linkId, albumId, revokedAt: IsNull() }, { revokedAt: new Date() });
    if (!result.affected) throw AppError.notFound("Active share link not found");
  }

  /** Public view of an album through a share link — no login required. */
  public static async viewSharedAlbum(token: string, fastify: FastifyInstance): Promise<SharedAlbumView> {
    const repo = fastify.db.getRepository(ShareLink);
    const link = await repo.findOne({ where: { token } });
    if (!link || link.revokedAt) throw AppError.notFound("Share link not found");
    if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) {
      throw new AppError(410, "This share link has expired");
    }

    const album = await fastify.db.getRepository(Album).findOne({ where: { id: link.albumId } });
    if (!album) throw AppError.notFound("Share link not found");
    const owner = await fastify.db
      .getRepository(User)
      .findOne({ where: { id: album.ownerId }, select: { username: true } });

    await repo.increment({ id: link.id }, "viewCount", 1);

    const images = await MediaService.listImages(album.id, fastify);
    return {
      album: { id: album.id, title: album.title, ownerUsername: owner?.username ?? null },
      images: images.map(({ uploaderId: _uploaderId, ...image }) => image),
      expiresAt: link.expiresAt ?? null,
    };
  }
}
