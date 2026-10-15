import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { createOtpSender, type OtpSender } from "../services/delivery.service.js";
import { IdentityVerifier } from "../services/identity-verifier.service.js";

declare module "fastify" {
  interface FastifyInstance {
    otpSender: OtpSender;
    identityVerifier: IdentityVerifier;
    /** fetch used by the admin status check to contact providers (replaced in tests) */
    probeFetch: typeof fetch;
  }
}

export interface AuthProvidersOptions {
  otpSender?: OtpSender;
  identityVerifier?: IdentityVerifier;
  probeFetch?: typeof fetch;
}

async function authProvidersPluginAsync(fastify: FastifyInstance, opts: AuthProvidersOptions) {
  fastify.decorate("otpSender", opts.otpSender ?? createOtpSender(fastify.log));
  fastify.decorate("identityVerifier", opts.identityVerifier ?? new IdentityVerifier());
  fastify.decorate("probeFetch", opts.probeFetch ?? fetch);
}

export const authProvidersPlugin = fp(authProvidersPluginAsync, {
  name: "auth-providers-plugin",
});
