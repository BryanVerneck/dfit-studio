import type { FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import { verifyAccessToken, type AccessClaims, type Role } from "./tokens.js";

declare module "fastify" {
  interface FastifyRequest {
    auth?: AccessClaims;
  }
}

// Requires a valid access token. While a temporary password is in force, only routes
// that set allowPasswordChange (the ones needed to choose a new password) are reachable.
export function authenticate(config: Config, opts: { allowPasswordChange?: boolean } = {}) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    const claims = token ? await verifyAccessToken(config, token) : null;
    if (!claims) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    if (claims.mustChangePassword && !opts.allowPasswordChange) {
      return reply.code(403).send({ error: "password_change_required" });
    }
    request.auth = claims;
  };
}

export function requireRole(...roles: Role[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.auth || !roles.includes(request.auth.role)) {
      return reply.code(403).send({ error: "forbidden" });
    }
  };
}
