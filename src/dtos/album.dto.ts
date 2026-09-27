// Album, Image, Member & Share Link DTOs
import type { AlbumRole } from "../database/entities/album-member.entity.js";
import type {
  CreateAlbumInput,
  UpdateAlbumInput,
  RequestUploadsInput,
  CompleteUploadsInput,
  ReorderImagesInput,
  AddMemberInput,
  UpdateMemberInput,
  CreateShareLinkInput,
} from "../schemas/album.schema.js";

export type AccessRole = "owner" | AlbumRole;

// ======================= Request DTOs =======================

export type CreateAlbumDto = CreateAlbumInput;
export type UpdateAlbumDto = UpdateAlbumInput;
export type RequestUploadsDto = RequestUploadsInput;
export type CompleteUploadsDto = CompleteUploadsInput;
export type ReorderImagesDto = ReorderImagesInput;
export type AddMemberDto = AddMemberInput;
export type UpdateMemberDto = UpdateMemberInput;
export type CreateShareLinkDto = CreateShareLinkInput;

export interface AlbumParamsDto {
  albumId: string;
}
export interface ImageParamsDto extends AlbumParamsDto {
  imageId: string;
}
export interface MemberParamsDto extends AlbumParamsDto {
  userId: string;
}
export interface ShareLinkParamsDto extends AlbumParamsDto {
  linkId: string;
}
export interface ShareTokenParamsDto {
  token: string;
}

// ======================= Response DTOs =======================

export interface ImageResponseDto {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sortOrder: number;
  uploaderId: string;
  url: string;
  createdAt: Date;
}

export interface AlbumSummaryDto {
  id: string;
  title: string;
  ownerId: string;
  role: AccessRole;
  imageCount: number;
  coverUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AlbumMemberDto {
  userId: string;
  username: string;
  name: string;
  role: AccessRole;
}

export interface UploadTargetDto {
  imageId: string;
  fileName: string;
  sortOrder: number;
  upload: {
    method: "POST";
    url: string;
    fields: Record<string, string>;
    expiresAt: Date;
  };
}

export interface ShareLinkDto {
  id: string;
  token: string;
  url: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  viewCount: number;
  createdAt: Date;
}
