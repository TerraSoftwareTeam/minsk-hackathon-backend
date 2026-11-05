/**
 * Builds the PostgreSQL connection URL from DATABASE_* variables.
 * Shared by prisma.config.ts (Prisma CLI) and PrismaService (runtime),
 * so both always connect to the same database.
 *
 * Returns undefined if any variable is missing, so commands that do not
 * need a connection (e.g. `prisma generate` in CI/Docker build) still work.
 * PrismaService turns a missing URL into an error at runtime.
 */
export function buildDatabaseUrl(
  get: (key: string) => string | undefined,
): string | undefined {
  const user = get('DATABASE_USER');
  const password = get('DATABASE_PASS');
  const host = get('DATABASE_HOST');
  const port = get('DATABASE_PORT');
  const name = get('DATABASE_NAME');

  if (!user || !password || !host || !port || !name) {
    return undefined;
  }

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${name}?schema=public`;
}
