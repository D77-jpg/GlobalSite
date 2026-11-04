export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export function ensure(
  condition: unknown,
  status = 400,
  code = "VALIDATION_ERROR",
): asserts condition {
  if (!condition) throw new AppError(status, code);
}
