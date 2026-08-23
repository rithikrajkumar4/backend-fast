export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly details?: any;

  constructor(statusCode: number, message: string, details?: any) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = true;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  public static badRequest(message = "Bad Request", details?: any): AppError {
    return new AppError(400, message, details);
  }

  public static unauthorized(message = "Unauthorized", details?: any): AppError {
    return new AppError(401, message, details);
  }

  public static forbidden(message = "Forbidden", details?: any): AppError {
    return new AppError(403, message, details);
  }

  public static notFound(message = "Not Found", details?: any): AppError {
    return new AppError(404, message, details);
  }

  public static conflict(message = "Conflict", details?: any): AppError {
    return new AppError(409, message, details);
  }

  public static internal(message = "Internal Server Error", details?: any): AppError {
    return new AppError(500, message, details);
  }
}
