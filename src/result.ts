export interface Failure {
  ok: false;
  error: { code: string; message: string; details?: Record<string,unknown> };
}

export interface Success<T> {
  ok: true;
  result: T;
}

export type Result<T> = Success<T> | Failure;

export function ok<T>(result: T): Success<T> {
  return { ok: true, result };
}

export function fail(code: string, message: string, details?:Record<string,unknown>): Failure {
  return { ok: false, error: { code, message, ...(details ? {details} : {}) } };
}

export function exitCodeFor(code: string): number {
  if (
    code === "NOT_IMPLEMENTED" ||
    code === "ENGINE_FAILED" ||
    code === "ICHINGSHIFA_UNAVAILABLE" ||
    code === "ICHINGSHIFA_CALL_FAILED" ||
    code === "ICHINGSHIFA_EMPTY"
  ) {
    return 2;
  }
  return 1;
}
