import { SignJWT, jwtVerify } from "jose";
import { env } from "../config/env.js";
import type { MemberRole } from "../generated/prisma/client.js";

const secret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
export const ACCESS_TTL_SEC = 15 * 60;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const REFRESH_GRACE_MS = 20_000;

export interface AccessClaims {
  sub: string;
  org: string;
  role: MemberRole;
  sid: string;
}

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ org: claims.org, role: claims.role, sid: claims.sid })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuer("leadhunter")
    .setAudience("leadhunter-web")
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SEC}s`)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, secret, {
    issuer: "leadhunter",
    audience: "leadhunter-web",
    algorithms: ["HS256"],
  });
  if (typeof payload.sub !== "string" || typeof payload.org !== "string" || typeof payload.sid !== "string") {
    throw new Error("claims inválidas");
  }
  return { sub: payload.sub, org: payload.org, sid: payload.sid, role: payload.role as MemberRole };
}
