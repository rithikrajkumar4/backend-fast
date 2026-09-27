import type { FastifyInstance } from "fastify";
import { In } from "typeorm";
import { Album } from "../database/entities/album.entity.js";
import { AlbumMember, type AlbumRole } from "../database/entities/album-member.entity.js";
import { Image } from "../database/entities/image.entity.js";
import { User } from "../database/entities/user.entity.js";
import { AppError } from "../utils/errors.js";
import type { AccessRole, AlbumSummaryDto, AlbumMemberDto } from "../dtos/index.js";

export interface AlbumAccess {
  album: Album;
  role: AccessRole;
}

const ROLE_RANK: Record<AccessRole, number> = { viewer: 0, editor: 1, owner: 2 };

export class AlbumService {
  /**
   * Resolves the caller's role on an album. Albums the caller cannot see are reported
   * as 404 (not 403) so their existence is not leaked.
   */
  public static async getAccess(
    albumId: string,
    userId: string,
    fastify: FastifyInstance,
    minRole: AccessRole = "viewer"
  ): Promise<AlbumAccess> {
    const album = await fastify.db.getRepository(Album).findOne({ where: { id: albumId } });
    if (!album) throw AppError.notFound("Album not found");

    let role: AccessRole | null = album.ownerId === userId ? "owner" : null;
    if (!role) {
      const member = await fastify.db
        .getRepository(AlbumMember)
        .findOne({ where: { albumId, userId }, select: { role: true } });
      role = member?.role ?? null;
    }
    if (!role) throw AppError.notFound("Album not found");

    if (ROLE_RANK[role] < ROLE_RANK[minRole]) {
      throw AppError.forbidden(`This action requires the '${minRole}' role on the album`);
    }
    return { album, role };
  }

  public static async createAlbum(ownerId: string, title: string, fastify: FastifyInstance): Promise<Album> {
    const repo = fastify.db.getRepository(Album);
    return repo.save(repo.create({ ownerId, title }));
  }

  /** Albums the user owns or was added to, newest first. */
  public static async listAlbums(userId: string, fastify: FastifyInstance): Promise<AlbumSummaryDto[]> {
    const memberships = await fastify.db.getRepository(AlbumMember).find({ where: { userId } });
    const memberRole = new Map(memberships.map((m) => [m.albumId, m.role]));

    const albums = await fastify.db.getRepository(Album).find({
      where: [{ ownerId: userId }, ...(memberships.length ? [{ id: In([...memberRole.keys()]) }] : [])],
      order: { createdAt: "DESC" },
    });
    if (!albums.length) return [];

    const albumIds = albums.map((a) => a.id);
    const counts: { albumId: string; count: string }[] = await fastify.db
      .getRepository(Image)
      .createQueryBuilder("image")
      .select('image."albumId"', "albumId")
      .addSelect("COUNT(*)", "count")
      .where('image."albumId" IN (:...albumIds)', { albumIds })
      .andWhere("image.status = 'uploaded'")
      .groupBy('image."albumId"')
      .getRawMany();
    const countByAlbum = new Map(counts.map((c) => [c.albumId, Number(c.count)]));

    const covers = await this.resolveCovers(albums, fastify);

    return albums.map((album) => ({
      id: album.id,
      title: album.title,
      ownerId: album.ownerId,
      role: album.ownerId === userId ? "owner" : (memberRole.get(album.id) as AlbumRole),
      imageCount: countByAlbum.get(album.id) ?? 0,
      coverUrl: covers.get(album.id) ?? null,
      createdAt: album.createdAt,
      updatedAt: album.updatedAt,
    }));
  }

  /** Cover = explicit coverImageId, otherwise the first image in sort order. */
  private static async resolveCovers(albums: Album[], fastify: FastifyInstance): Promise<Map<string, string>> {
    const rows: { albumId: string; s3Key: string }[] = await fastify.db
      .getRepository(Image)
      .createQueryBuilder("image")
      .innerJoin(Album, "album", 'album.id = image."albumId"')
      .select('DISTINCT ON (image."albumId") image."albumId"', "albumId")
      .addSelect('image."s3Key"', "s3Key")
      .where('image."albumId" IN (:...albumIds)', { albumIds: albums.map((a) => a.id) })
      .andWhere("image.status = 'uploaded'")
      .orderBy('image."albumId"')
      .addOrderBy('CASE WHEN image.id = album."coverImageId" THEN 0 ELSE 1 END')
      .addOrderBy('image."sortOrder"')
      .getRawMany();
    return new Map(rows.map((r) => [r.albumId, fastify.storage.getViewUrl(r.s3Key)]));
  }

  public static async updateAlbum(
    album: Album,
    changes: { title?: string; coverImageId?: string | null },
    fastify: FastifyInstance
  ): Promise<Album> {
    if (changes.coverImageId) {
      const cover = await fastify.db
        .getRepository(Image)
        .findOne({ where: { id: changes.coverImageId, albumId: album.id, status: "uploaded" }, select: { id: true } });
      if (!cover) throw AppError.badRequest("Cover image must be an uploaded image in this album");
    }
    if (changes.title !== undefined) album.title = changes.title;
    if (changes.coverImageId !== undefined) album.coverImageId = changes.coverImageId;
    return fastify.db.getRepository(Album).save(album);
  }

  /** Deletes the album, its images in S3, members and share links. */
  public static async deleteAlbum(album: Album, fastify: FastifyInstance): Promise<void> {
    const images = await fastify.db
      .getRepository(Image)
      .find({ where: { albumId: album.id }, select: { s3Key: true } });
    if (images.length) await fastify.storage.deleteObjects(images.map((i) => i.s3Key));
    await fastify.db.getRepository(Album).delete({ id: album.id });
  }

  public static async listMembers(album: Album, fastify: FastifyInstance): Promise<AlbumMemberDto[]> {
    const owner = await fastify.db.getRepository(User).findOne({ where: { id: album.ownerId } });
    const members = await fastify.db.getRepository(AlbumMember).find({
      where: { albumId: album.id },
      relations: { user: true },
      order: { createdAt: "ASC" },
    });
    return [
      ...(owner ? [{ userId: owner.id, username: owner.username, name: owner.name, role: "owner" as const }] : []),
      ...members.map((m) => ({
        userId: m.userId,
        username: m.user?.username ?? "",
        name: m.user?.name ?? "",
        role: m.role,
      })),
    ];
  }

  /** Adds a friend to the album by username. */
  public static async addMember(
    album: Album,
    username: string,
    role: AlbumRole,
    addedById: string,
    fastify: FastifyInstance
  ): Promise<AlbumMemberDto> {
    const user = await fastify.db
      .getRepository(User)
      .findOne({ where: { username: username.trim().toLowerCase(), isActive: true } });
    if (!user) throw AppError.notFound(`No user found with username '${username}'`);
    if (user.id === album.ownerId) throw AppError.badRequest("The owner is already part of this album");

    const repo = fastify.db.getRepository(AlbumMember);
    const existing = await repo.findOne({ where: { albumId: album.id, userId: user.id }, select: { id: true } });
    if (existing) throw AppError.conflict(`'${user.username}' is already a member of this album`);

    await repo.save(repo.create({ albumId: album.id, userId: user.id, role, addedById }));
    return { userId: user.id, username: user.username, name: user.name, role };
  }

  public static async updateMemberRole(
    albumId: string,
    userId: string,
    role: AlbumRole,
    fastify: FastifyInstance
  ): Promise<void> {
    const result = await fastify.db.getRepository(AlbumMember).update({ albumId, userId }, { role });
    if (!result.affected) throw AppError.notFound("Member not found");
  }

  public static async removeMember(albumId: string, userId: string, fastify: FastifyInstance): Promise<void> {
    const result = await fastify.db.getRepository(AlbumMember).delete({ albumId, userId });
    if (!result.affected) throw AppError.notFound("Member not found");
  }
}
