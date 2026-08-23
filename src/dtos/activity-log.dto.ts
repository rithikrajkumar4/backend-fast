// ActivityLog Entity DTOs

export interface ActivityLogResponseDto {
  requestId: string;
  sessionId?: string | null;
  method: string;
  route: string;
  url: string;
  statusCode: number;
  durationMs: number;
  timestamp: Date;
}

export interface GetActivityQueryDto {
  limit?: string;
  sessionOnly?: string;
}

export interface ActivityListResponseDto {
  success: boolean;
  currentSessionId?: string | null;
  count: number;
  activities: ActivityLogResponseDto[];
}
