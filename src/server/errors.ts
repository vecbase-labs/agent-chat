export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}
export function fail(status: number, code: string, message: string): never {
  throw new HttpError(status, code, message)
}
