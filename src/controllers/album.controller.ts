import type { FastifyRequest, FastifyReply } from "fastify";
import { AlbumService } from "../services/album.service.js";
import { MediaService } from "../services/media.service.js";
import { ShareService } from "../services/share.service.js";
import { Image } from "../database/entities/image.entity.js";
import { AppError } from "../utils/errors.js";
import type {
  AlbumParamsDto,
  ImageParamsDto,
  MemberParamsDto,
  ShareLinkParamsDto,
  ShareTokenParamsDto,
  CreateAlbumDto,
  UpdateAlbumDto,
  RequestUploadsDto,
  CompleteUploadsDto,
  ReorderImagesDto,
  AddMemberDto,
  UpdateMemberDto,
  CreateShareLinkDto,
} from "../dtos/index.js";

/** The authenticated user's id; rejects tokens that are not session access tokens. */
function requireUserId(request: FastifyRequest): string {
  const userId = request.user?.id;
  if (!userId || !request.user?.sessionId) throw AppError.unauthorized("Invalid or expired token");
  return userId;
}

export class AlbumController {
  // ======================= Albums =======================

  public static async createAlbum(request: FastifyRequest<{ Body: CreateAlbumDto }>, reply: FastifyReply) {
    const album = await AlbumService.createAlbum(requireUserId(request), request.body.title, request.server);
    return reply.status(201).send({ success: true, data: { album: { ...album, role: "owner" } } });
  }

  public static async listAlbums(request: FastifyRequest, _reply: FastifyReply) {
    const albums = await AlbumService.listAlbums(requireUserId(request), request.server);
    return { success: true, count: albums.length, data: { albums } };
  }

  public static async getAlbum(request: FastifyRequest<{ Params: AlbumParamsDto }>, _reply: FastifyReply) {
    const { album, role } = await AlbumService.getAccess(request.params.albumId, requireUserId(request), request.server);
    const [images, members] = await Promise.all([
      MediaService.listImages(album.id, request.server),
      AlbumService.listMembers(album, request.server),
    ]);
    return { success: true, data: { album: { ...album, role }, images, members } };
  }

  public static async updateAlbum(
    request: FastifyRequest<{ Params: AlbumParamsDto; Body: UpdateAlbumDto }>,
    _reply: FastifyReply
  ) {
    const { album, role } = await AlbumService.getAccess(
      request.params.albumId,
      requireUserId(request),
      request.server,
      "editor"
    );
    const updated = await AlbumService.updateAlbum(album, request.body, request.server);
    return { success: true, data: { album: { ...updated, role } } };
  }

  public static async deleteAlbum(request: FastifyRequest<{ Params: AlbumParamsDto }>, _reply: FastifyReply) {
    const { album } = await AlbumService.getAccess(
      request.params.albumId,
      requireUserId(request),
      request.server,
      "owner"
    );
    await AlbumService.deleteAlbum(album, request.server);
    return { success: true, message: "Album and its images were deleted" };
  }

  // ======================= Images =======================

  public static async requestUploads(
    request: FastifyRequest<{ Params: AlbumParamsDto; Body: RequestUploadsDto }>,
    reply: FastifyReply
  ) {
    const userId = requireUserId(request);
    const { album } = await AlbumService.getAccess(request.params.albumId, userId, request.server, "editor");
    const uploads = await MediaService.requestUploads(album.id, userId, request.body.files, request.server);
    return reply.status(201).send({
      success: true,
      message: "Upload each file to its URL, then call /uploads/complete with the image ids",
      data: { uploads },
    });
  }

  public static async completeUploads(
    request: FastifyRequest<{ Params: AlbumParamsDto; Body: CompleteUploadsDto }>,
    _reply: FastifyReply
  ) {
    const userId = requireUserId(request);
    const { album } = await AlbumService.getAccess(request.params.albumId, userId, request.server, "editor");
    const result = await MediaService.completeUploads(album.id, userId, request.body.imageIds, request.server);
    return { success: result.failed.length === 0, data: result };
  }

  public static async reorderImages(
    request: FastifyRequest<{ Params: AlbumParamsDto; Body: ReorderImagesDto }>,
    _reply: FastifyReply
  ) {
    const { album } = await AlbumService.getAccess(
      request.params.albumId,
      requireUserId(request),
      request.server,
      "editor"
    );
    await MediaService.reorderImages(album.id, request.body.imageIds, request.server);
    const images = await MediaService.listImages(album.id, request.server);
    return { success: true, data: { images } };
  }

  public static async deleteImage(request: FastifyRequest<{ Params: ImageParamsDto }>, _reply: FastifyReply) {
    const { album } = await AlbumService.getAccess(
      request.params.albumId,
      requireUserId(request),
      request.server,
      "editor"
    );
    const image = await request.server.db
      .getRepository(Image)
      .findOne({ where: { id: request.params.imageId, albumId: album.id } });
    if (!image) throw AppError.notFound("Image not found");
    await MediaService.deleteImage(album, image, request.server);
    return { success: true, message: "Image deleted" };
  }

  // ======================= Members (friends) =======================

  public static async listMembers(request: FastifyRequest<{ Params: AlbumParamsDto }>, _reply: FastifyReply) {
    const { album } = await AlbumService.getAccess(request.params.albumId, requireUserId(request), request.server);
    const members = await AlbumService.listMembers(album, request.server);
    return { success: true, data: { members } };
  }

  public static async addMember(
    request: FastifyRequest<{ Params: AlbumParamsDto; Body: AddMemberDto }>,
    reply: FastifyReply
  ) {
    const userId = requireUserId(request);
    const { album } = await AlbumService.getAccess(request.params.albumId, userId, request.server, "owner");
    const member = await AlbumService.addMember(album, request.body.username, request.body.role, userId, request.server);
    return reply.status(201).send({ success: true, data: { member } });
  }

  public static async updateMember(
    request: FastifyRequest<{ Params: MemberParamsDto; Body: UpdateMemberDto }>,
    _reply: FastifyReply
  ) {
    const { album } = await AlbumService.getAccess(
      request.params.albumId,
      requireUserId(request),
      request.server,
      "owner"
    );
    await AlbumService.updateMemberRole(album.id, request.params.userId, request.body.role, request.server);
    return { success: true, message: "Member role updated" };
  }

  /** The owner can remove anyone; a member can remove themselves (leave the album). */
  public static async removeMember(request: FastifyRequest<{ Params: MemberParamsDto }>, _reply: FastifyReply) {
    const userId = requireUserId(request);
    const isLeaving = request.params.userId === userId;
    const { album, role } = await AlbumService.getAccess(
      request.params.albumId,
      userId,
      request.server,
      isLeaving ? "viewer" : "owner"
    );
    if (isLeaving && role === "owner") {
      throw AppError.badRequest("The owner cannot leave the album; delete it instead");
    }
    await AlbumService.removeMember(album.id, request.params.userId, request.server);
    return { success: true, message: isLeaving ? "You left the album" : "Member removed" };
  }

  // ======================= Share links =======================

  public static async createShareLink(
    request: FastifyRequest<{ Params: AlbumParamsDto; Body: CreateShareLinkDto }>,
    reply: FastifyReply
  ) {
    const userId = requireUserId(request);
    const { album } = await AlbumService.getAccess(request.params.albumId, userId, request.server, "editor");
    const link = await ShareService.createLink(album.id, userId, request.body?.expiresInHours, request.server);
    return reply.status(201).send({ success: true, data: { link } });
  }

  public static async listShareLinks(request: FastifyRequest<{ Params: AlbumParamsDto }>, _reply: FastifyReply) {
    const { album } = await AlbumService.getAccess(
      request.params.albumId,
      requireUserId(request),
      request.server,
      "editor"
    );
    const links = await ShareService.listLinks(album.id, request.server);
    return { success: true, data: { links } };
  }

  public static async revokeShareLink(
    request: FastifyRequest<{ Params: ShareLinkParamsDto }>,
    _reply: FastifyReply
  ) {
    const { album } = await AlbumService.getAccess(
      request.params.albumId,
      requireUserId(request),
      request.server,
      "editor"
    );
    await ShareService.revokeLink(album.id, request.params.linkId, request.server);
    return { success: true, message: "Share link revoked" };
  }

  /** Public: anyone with the link can view the album. */
  public static async viewShared(request: FastifyRequest<{ Params: ShareTokenParamsDto }>, _reply: FastifyReply) {
    const view = await ShareService.viewSharedAlbum(request.params.token, request.server);
    return { success: true, data: view };
  }
}
