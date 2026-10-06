// An error that is safe to show to the user. Anything else is reported as "Something went wrong".
class AppError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

module.exports = { AppError };
