/**
 * Service-layer errors. These are thrown by the deterministic services
 * (`lib/services/*`) and caught by Server Actions, which translate them
 * into form errors or HTTP responses.
 */

export class ServiceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    this.status = status;
  }
}

export class NotFoundError extends ServiceError {
  constructor(entity: string, id: string) {
    super("not_found", `${entity} ${id} not found`, 404);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends ServiceError {
  constructor(message: string) {
    super("conflict", message, 409);
    this.name = "ConflictError";
  }
}

export class ValidationFailure extends ServiceError {
  constructor(message: string) {
    super("validation_failed", message, 400);
    this.name = "ValidationFailure";
  }
}
