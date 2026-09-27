import type { FastifyPluginAsync } from "fastify";
import { AlbumController } from "../../../controllers/album.controller.js";
import { asyncHandler } from "../../../utils/async-handler.js";
import { validateBody, validateParams } from "../../../middlewares/validate.js";
import {
  albumIdParamsSchema,
  imageParamsSchema,
  memberParamsSchema,
  shareLinkParamsSchema,
  shareTokenParamsSchema,
  createAlbumSchema,
  updateAlbumSchema,
  requestUploadsSchema,
  completeUploadsSchema,
  reorderImagesSchema,
  addMemberSchema,
  updateMemberSchema,
  createShareLinkSchema,
} from "../../../schemas/album.schema.js";

const albumParams = validateParams(albumIdParamsSchema);

export const albumRoutes: FastifyPluginAsync = async (fastify) => {
  // onRequest so authentication is checked before params/body validation.
  fastify.addHook("onRequest", fastify.authenticate);

  /**
   * Albums (image collections)
   */
  fastify.post("/", { preValidation: [validateBody(createAlbumSchema)] }, asyncHandler(AlbumController.createAlbum));
  fastify.get("/", asyncHandler(AlbumController.listAlbums));
  fastify.get("/:albumId", { preValidation: [albumParams] }, asyncHandler(AlbumController.getAlbum));
  fastify.patch(
    "/:albumId",
    { preValidation: [albumParams, validateBody(updateAlbumSchema)] },
    asyncHandler(AlbumController.updateAlbum)
  );
  fastify.delete("/:albumId", { preValidation: [albumParams] }, asyncHandler(AlbumController.deleteAlbum));

  /**
   * Images: request presigned S3 uploads for the swiped-right images, confirm, reorder, delete
   */
  fastify.post(
    "/:albumId/uploads",
    { preValidation: [albumParams, validateBody(requestUploadsSchema)] },
    asyncHandler(AlbumController.requestUploads)
  );
  fastify.post(
    "/:albumId/uploads/complete",
    { preValidation: [albumParams, validateBody(completeUploadsSchema)] },
    asyncHandler(AlbumController.completeUploads)
  );
  fastify.put(
    "/:albumId/images/order",
    { preValidation: [albumParams, validateBody(reorderImagesSchema)] },
    asyncHandler(AlbumController.reorderImages)
  );
  fastify.delete(
    "/:albumId/images/:imageId",
    { preValidation: [validateParams(imageParamsSchema)] },
    asyncHandler(AlbumController.deleteImage)
  );

  /**
   * Members: add friends to the collection by username
   */
  fastify.get("/:albumId/members", { preValidation: [albumParams] }, asyncHandler(AlbumController.listMembers));
  fastify.post(
    "/:albumId/members",
    { preValidation: [albumParams, validateBody(addMemberSchema)] },
    asyncHandler(AlbumController.addMember)
  );
  fastify.patch(
    "/:albumId/members/:userId",
    { preValidation: [validateParams(memberParamsSchema), validateBody(updateMemberSchema)] },
    asyncHandler(AlbumController.updateMember)
  );
  fastify.delete(
    "/:albumId/members/:userId",
    { preValidation: [validateParams(memberParamsSchema)] },
    asyncHandler(AlbumController.removeMember)
  );

  /**
   * Public share links
   */
  fastify.post(
    "/:albumId/share-links",
    { preValidation: [albumParams, validateBody(createShareLinkSchema)] },
    asyncHandler(AlbumController.createShareLink)
  );
  fastify.get("/:albumId/share-links", { preValidation: [albumParams] }, asyncHandler(AlbumController.listShareLinks));
  fastify.delete(
    "/:albumId/share-links/:linkId",
    { preValidation: [validateParams(shareLinkParamsSchema)] },
    asyncHandler(AlbumController.revokeShareLink)
  );
};

/**
 * Public (no login) view of an album shared via link
 */
export const sharedRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/:token",
    { preValidation: [validateParams(shareTokenParamsSchema)] },
    asyncHandler(AlbumController.viewShared)
  );
};
