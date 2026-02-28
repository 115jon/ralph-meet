/**
 * Custom error class for service-layer failures.
 *
 * Route handlers catch these and convert them to HTTP responses
 * via `apiError(err.message, err.status, err.code)`.
 */
export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
    public readonly code?: string
  ) {
    super(message);
    this.name = "ServiceError";
  }

  /** 400 Bad Request */
  static badRequest(message: string, code?: string): ServiceError {
    return new ServiceError(message, 400, code);
  }

  /** 403 Forbidden */
  static forbidden(message: string, code?: string): ServiceError {
    return new ServiceError(message, 403, code);
  }

  /** 404 Not Found */
  static notFound(message: string, code?: string): ServiceError {
    return new ServiceError(message, 404, code);
  }

  /** 409 Conflict */
  static conflict(message: string, code?: string): ServiceError {
    return new ServiceError(message, 409, code);
  }
}
