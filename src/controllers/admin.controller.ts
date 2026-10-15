import type { FastifyRequest, FastifyReply } from "fastify";
import { AdminService } from "../services/admin.service.js";
import { SettingsService } from "../services/settings.service.js";
import { AuthStatusService } from "../services/auth-status.service.js";
import type {
  AdminLoginInput,
  AdminChangePasswordInput,
  AdminTestDeliveryInput,
} from "../schemas/admin.schema.js";

export class AdminController {
  public static async login(request: FastifyRequest<{ Body: AdminLoginInput }>, _reply: FastifyReply) {
    const { username, password } = request.body;
    const result = await AdminService.login(username, password, request.server);
    return { success: true, data: result };
  }

  public static async me(request: FastifyRequest, _reply: FastifyReply) {
    return { success: true, data: { admin: request.admin } };
  }

  public static async changePassword(
    request: FastifyRequest<{ Body: AdminChangePasswordInput }>,
    _reply: FastifyReply
  ) {
    const { currentPassword, newPassword } = request.body;
    await AdminService.changePassword(request.admin!.id, currentPassword, newPassword, request.server);
    return { success: true, message: "Password updated" };
  }

  public static async getOverview(request: FastifyRequest, _reply: FastifyReply) {
    return { success: true, data: await AdminService.getOverview(request.server) };
  }

  public static async getAuthSettings(request: FastifyRequest, _reply: FastifyReply) {
    return { success: true, data: await SettingsService.getAdminView(request.server) };
  }

  public static async updateAuthSettings(
    request: FastifyRequest<{ Body: Record<string, unknown> }>,
    _reply: FastifyReply
  ) {
    const data = await SettingsService.updateAuthSettings(request.body, request.admin!.id, request.server);
    request.log.info({ adminId: request.admin!.id }, "Auth settings updated");
    return { success: true, message: "Settings saved", data };
  }

  /** Whether each login method works; `?live=true` also contacts the providers. */
  public static async getAuthStatus(
    request: FastifyRequest<{ Querystring: { live?: string } }>,
    _reply: FastifyReply
  ) {
    const live = request.query.live === "true" || request.query.live === "1";
    if (live) SettingsService.invalidateCache(); // pick up env changes right away
    const loaded = await SettingsService.load(request.server);
    const methods = await AuthStatusService.check(loaded, { live, fetch: request.server.probeFetch });
    return {
      success: true,
      data: { methods, warnings: SettingsService.getWarnings(loaded), checkedAt: new Date(), live },
    };
  }

  public static async testDelivery(
    request: FastifyRequest<{ Body: AdminTestDeliveryInput }>,
    _reply: FastifyReply
  ) {
    const { channel, to } = request.body;
    const result = await AdminService.sendTestMessage(channel, to, request.server);
    return { success: true, message: `Test ${channel} sent to ${result.to}`, data: result };
  }
}
