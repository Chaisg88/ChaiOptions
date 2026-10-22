const messages = {
  DATABASE_NOT_CONFIGURED:
    "The database is not configured. Add DATABASE_URL to the Vercel Production environment variables, then redeploy.",
  DATABASE_URL_INVALID:
    "The database connection setting is invalid. Check DATABASE_URL in the Vercel Production environment variables, then redeploy.",
  DATABASE_AUTH_FAILED:
    "The database rejected its connection credentials. Update DATABASE_URL in Vercel, then redeploy. Your app password has not been checked.",
  DATABASE_NOT_FOUND:
    "The configured database could not be found. Check DATABASE_URL in Vercel, then redeploy.",
  DATABASE_UNREACHABLE:
    "The database could not be reached. Check that the Neon database is available and DATABASE_URL is correct.",
  ROOT_ACCOUNT_NOT_CONFIGURED:
    "The database is connected, but its first account needs ROOT_EMAIL and a ROOT_PASSWORD of 12–128 characters. Configure them in Vercel, then redeploy.",
  STARTUP_FAILED:
    "The service could not start. Check this deployment's Vercel runtime logs for its startup error code.",
};

export function startupError(code) {
  return Object.assign(new Error(messages[code] || messages.STARTUP_FAILED), {
    code: Object.hasOwn(messages, code) ? code : "STARTUP_FAILED",
  });
}

export function publicStartupError(error) {
  const databaseCodes = {
    "28P01": "DATABASE_AUTH_FAILED",
    "28000": "DATABASE_AUTH_FAILED",
    "3D000": "DATABASE_NOT_FOUND",
    ENOTFOUND: "DATABASE_UNREACHABLE",
    EAI_AGAIN: "DATABASE_UNREACHABLE",
    ECONNREFUSED: "DATABASE_UNREACHABLE",
    ECONNRESET: "DATABASE_UNREACHABLE",
    ETIMEDOUT: "DATABASE_UNREACHABLE",
  };
  // Never send arbitrary driver messages, connection strings or credentials.
  const code = Object.hasOwn(messages, error?.code)
    ? error.code
    : Object.hasOwn(databaseCodes, error?.code)
      ? databaseCodes[error.code]
      : "STARTUP_FAILED";
  return { error: messages[code], code };
}
