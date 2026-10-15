import { createHash, randomBytes } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import type { Config } from "../config.js";

export type Role = "owner" | "staff" | "student";

export interface AccessClaims {
  userId: string;
  studioId: string;
  role: Role;
  mustChangePassword: boolean;
}

const key = (config: Config) => new TextEncoder().encode(config.jwtSecret);

export function signAccessToken(config: Config, claims: AccessClaims) {
  return new SignJWT({ sid: claims.studioId, role: claims.role, mcp: claims.mustChangePassword })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(`${config.accessTokenTtlSeconds}s`)
    .sign(key(config));
}

export async function verifyAccessToken(config: Config, token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(config), { algorithms: ["HS256"] });
    if (!payload.sub || typeof payload.sid !== "string" || typeof payload.role !== "string") return null;
    return {
      userId: payload.sub,
      studioId: payload.sid,
      role: payload.role as Role,
      mustChangePassword: payload.mcp === true,
    };
  } catch {
    return null;
  }
}

export const newRefreshToken = () => randomBytes(32).toString("base64url");
export const hashRefreshToken = (token: string) => createHash("sha256").update(token).digest("hex");
