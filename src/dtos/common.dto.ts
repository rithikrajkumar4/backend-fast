// Common Response and Query DTOs

export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T = any> {
  success: boolean;
  count: number;
  total?: number;
  data: T[];
}

export interface PaginationQueryDto {
  page?: string;
  limit?: string;
  sort?: string;
  order?: "ASC" | "DESC";
}

export interface IdParamDto {
  id: string;
}
