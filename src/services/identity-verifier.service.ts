import crypto from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import type { SsoProvider } from "../database/entities/auth-identity.entity.js";
import type { AuthSettings } from "../schemas/settings.schema.js";
import { AppError } from "../utils/errors.js";
import { sha256Hex } from "../utils/crypto.js";

/** A user identity proven by an SSO provider. */
export interface VerifiedIdentity {
  provider: SsoProvider;
  providerUserId: string;
  email: string | null;
  /** True only when the provider guarantees the user controls the email */
  emailVerified: boolean;
  name: string | null;
}

export interface SsoCredentials {
  /** OpenID Connect ID token (Google, Apple, Facebook Limited Login) */
  idToken?: string;
  /** Facebook classic login access token */
  accessToken?: string;
  /** Raw nonce the client generated, checked against the token's nonce claim when given */
  nonce?: string;
}

export interface IdentityVerifierOptions {
  googleJwks?: JWTVerifyGetKey;
  appleJwks?: JWTVerifyGetKey;
  facebookJwks?: JWTVerifyGetKey;
  fetch?: typeof fetch;
}

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const APPLE_ISSUER = "https://appleid.apple.com";
const FACEBOOK_ISSUER = "https://www.facebook.com";
const HTTP_TIMEOUT_MS = 10_000;

const invalidToken = () => AppError.unauthorized("Invalid or expired sign-in token");

function claimIsTrue(value: unknown): boolean {
  return value === true || value === "true";
}

/** Accepts either the raw nonce or its SHA-256 (Apple and Firebase-style clients hash it). */
function checkNonce(payload: JWTPayload, rawNonce?: string): void {
  if (!rawNonce) return;
  const claim = payload.nonce;
  if (claim !== rawNonce && claim !== sha256Hex(rawNonce)) {
    throw AppError.unauthorized("Sign-in nonce mismatch");
  }
}

export class IdentityVerifier {
  private readonly googleJwks: JWTVerifyGetKey;
  private readonly appleJwks: JWTVerifyGetKey;
  private readonly facebookJwks: JWTVerifyGetKey;
  private readonly fetchImpl: typeof fetch;

  constructor(options: IdentityVerifierOptions = {}) {
    this.googleJwks =
      options.googleJwks ?? createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
    this.appleJwks = options.appleJwks ?? createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));
    this.facebookJwks =
      options.facebookJwks ??
      createRemoteJWKSet(new URL("https://limited.facebook.com/.well-known/oauth/openid/jwks/"));
    this.fetchImpl = options.fetch ?? fetch;
  }

  public async verify(
    provider: SsoProvider,
    credentials: SsoCredentials,
    settings: AuthSettings
  ): Promise<VerifiedIdentity> {
    if (!settings.sso[provider].enabled) {
      throw AppError.forbidden(`${provider[0].toUpperCase()}${provider.slice(1)} sign-in is disabled`);
    }
    switch (provider) {
      case "google":
        return this.verifyGoogle(credentials, settings);
      case "apple":
        return this.verifyApple(credentials, settings);
      case "facebook":
        return this.verifyFacebook(credentials, settings);
    }
  }

  private async verifyJwt(
    token: string | undefined,
    jwks: JWTVerifyGetKey,
    issuer: string | string[],
    audience: string[]
  ): Promise<JWTPayload> {
    if (!token) throw AppError.badRequest("idToken is required");
    try {
      const { payload } = await jwtVerify(token, jwks, { issuer, audience, clockTolerance: 30 });
      if (!payload.sub) throw invalidToken();
      return payload;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw invalidToken();
    }
  }

  private async verifyGoogle(c: SsoCredentials, s: AuthSettings): Promise<VerifiedIdentity> {
    const payload = await this.verifyJwt(c.idToken, this.googleJwks, GOOGLE_ISSUERS, s.sso.google.clientIds);
    checkNonce(payload, c.nonce);
    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : null;
    return {
      provider: "google",
      providerUserId: payload.sub!,
      email,
      emailVerified: !!email && claimIsTrue(payload.email_verified),
      name: typeof payload.name === "string" ? payload.name : null,
    };
  }

  private async verifyApple(c: SsoCredentials, s: AuthSettings): Promise<VerifiedIdentity> {
    const payload = await this.verifyJwt(c.idToken, this.appleJwks, APPLE_ISSUER, s.sso.apple.clientIds);
    checkNonce(payload, c.nonce);
    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : null;
    return {
      provider: "apple",
      providerUserId: payload.sub!,
      email,
      // Apple only issues verified emails (including private relay addresses)
      emailVerified: !!email && (payload.email_verified === undefined || claimIsTrue(payload.email_verified)),
      name: null, // Apple sends the name to the client only, on first sign-in
    };
  }

  private async verifyFacebook(c: SsoCredentials, s: AuthSettings): Promise<VerifiedIdentity> {
    const { appId, appSecret } = s.sso.facebook;

    // iOS Limited Login returns an OIDC token instead of an access token
    if (c.idToken) {
      const payload = await this.verifyJwt(c.idToken, this.facebookJwks, FACEBOOK_ISSUER, [appId]);
      checkNonce(payload, c.nonce);
      return {
        provider: "facebook",
        providerUserId: payload.sub!,
        email: typeof payload.email === "string" ? payload.email.toLowerCase() : null,
        emailVerified: false, // Facebook doesn't guarantee email ownership; never auto-link on it
        name: typeof payload.name === "string" ? payload.name : null,
      };
    }

    if (!c.accessToken) throw AppError.badRequest("accessToken or idToken is required");

    // Confirm the token was issued to *this* app, otherwise any app's token would be accepted
    const debugUrl = new URL("https://graph.facebook.com/debug_token");
    debugUrl.searchParams.set("input_token", c.accessToken);
    debugUrl.searchParams.set("access_token", `${appId}|${appSecret}`);
    const debug = await this.getJson(debugUrl);
    const data = debug?.data;
    if (!data?.is_valid || String(data.app_id) !== appId || !data.user_id) {
      throw invalidToken();
    }

    const meUrl = new URL("https://graph.facebook.com/me");
    meUrl.searchParams.set("fields", "id,name,email");
    meUrl.searchParams.set("access_token", c.accessToken);
    meUrl.searchParams.set(
      "appsecret_proof",
      crypto.createHmac("sha256", appSecret).update(c.accessToken).digest("hex")
    );
    const me = await this.getJson(meUrl);
    if (!me?.id || String(me.id) !== String(data.user_id)) {
      throw invalidToken();
    }

    return {
      provider: "facebook",
      providerUserId: String(me.id),
      email: typeof me.email === "string" ? me.email.toLowerCase() : null,
      emailVerified: false,
      name: typeof me.name === "string" ? me.name : null,
    };
  }

  private async getJson(url: URL): Promise<any> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    } catch {
      throw AppError.badGateway("Couldn't reach Facebook to verify the sign-in");
    }
    if (res.status >= 500) throw AppError.badGateway("Facebook is unavailable. Please try again.");
    if (!res.ok) throw invalidToken();
    return res.json();
  }
}
