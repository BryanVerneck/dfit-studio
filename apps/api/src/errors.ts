// Expected failures that map directly to an HTTP response.
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
