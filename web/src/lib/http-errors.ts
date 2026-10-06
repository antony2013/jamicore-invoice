import { NextResponse } from "next/server";

/**
 * Typed HTTP errors for route handlers. Throw these inside transactions and
 * let the outer catch map them via handleRouteError — user-facing messages
 * keep their status instead of collapsing to 500.
 */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
  }
}

export class BadRequestError extends HttpError {
  constructor(message: string) {
    super(400, message);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message: string) {
    super(403, message);
  }
}

export class NotFoundError extends HttpError {
  constructor(message: string) {
    super(404, message);
  }
}

export class ConflictError extends HttpError {
  constructor(message: string) {
    super(409, message);
  }
}

/** Map a caught error to a JSON response (unknowns → 500 + console.error). */
export function handleRouteError(error: unknown, context: string): NextResponse {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(`Error in ${context}:`, error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
