/**
 * An error whose message is safe to show and whose status is known: a missing
 * product is a 404, bad input a 400. errorMiddleware passes both through;
 * anything thrown without a status is treated as a 500.
 */
export class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
  }
}
