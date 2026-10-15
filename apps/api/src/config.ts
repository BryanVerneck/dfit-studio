export interface Config {
  jwtSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  cookieSecure: boolean;
  authRateLimitPerMinute: number;
  trustProxy: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const jwtSecret = env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must be set to at least 32 characters");
  }
  return {
    jwtSecret,
    accessTokenTtlSeconds: 15 * 60,
    refreshTokenTtlDays: 30,
    cookieSecure: env.NODE_ENV === "production",
    authRateLimitPerMinute: Number(env.AUTH_RATE_LIMIT_PER_MINUTE ?? 10),
    // Set TRUST_PROXY=true behind a hosting proxy so rate limits see each client's real IP.
    trustProxy: env.TRUST_PROXY === "true",
  };
}
