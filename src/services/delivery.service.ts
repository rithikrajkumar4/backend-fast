import type { FastifyBaseLogger } from "fastify";
import nodemailer, { type Transporter } from "nodemailer";
import type { OtpChannel } from "../database/entities/verification-code.entity.js";
import type { AuthSettings } from "../schemas/settings.schema.js";
import { AppError } from "../utils/errors.js";

export interface OtpMessage {
  channel: OtpChannel;
  /** Normalized phone number or email */
  to: string;
  code: string;
  settings: AuthSettings;
}

/** Sends one verification code. Throws when the provider rejects the message. */
export type OtpSender = (message: OtpMessage) => Promise<void>;

const HTTP_TIMEOUT_MS = 10_000;

function messageText({ code, settings }: OtpMessage): string {
  const minutes = Math.max(1, Math.round(settings.otp.ttlSeconds / 60));
  return `Your ${settings.appName} verification code is ${code}. It expires in ${minutes} minute${minutes === 1 ? "" : "s"}. Don't share it with anyone.`;
}

function requireE164(to: string): void {
  if (!to.startsWith("+")) {
    throw AppError.badRequest("Phone number must include the country code, e.g. +14155550123");
  }
}

async function readProviderError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const json = JSON.parse(text);
    return json?.message || json?.error?.message || text;
  } catch {
    return text || res.statusText;
  }
}

// ======================= Email (SMTP) =======================

let smtpTransport: { key: string; transporter: Transporter } | null = null;

function getSmtpTransport(smtp: AuthSettings["delivery"]["email"]["smtp"]): Transporter {
  const key = JSON.stringify(smtp);
  if (smtpTransport?.key !== key) {
    smtpTransport?.transporter.close();
    smtpTransport = {
      key,
      transporter: nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
        connectionTimeout: HTTP_TIMEOUT_MS,
      }),
    };
  }
  return smtpTransport.transporter;
}

async function sendSmtpEmail(message: OtpMessage): Promise<void> {
  const { email } = message.settings.delivery;
  const text = messageText(message);
  await getSmtpTransport(email.smtp).sendMail({
    from: email.from,
    to: message.to,
    subject: `${message.code} is your ${message.settings.appName} verification code`,
    text,
    html: `<p>Your ${escapeHtml(message.settings.appName)} verification code is</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:4px">${message.code}</p>
<p>It expires in ${Math.max(1, Math.round(message.settings.otp.ttlSeconds / 60))} minutes. If you didn't request it, you can ignore this email.</p>`,
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// ======================= Twilio (SMS + WhatsApp) =======================

async function sendTwilio(message: OtpMessage, kind: "sms" | "whatsapp"): Promise<void> {
  requireE164(message.to);
  const t = message.settings.delivery.twilio;
  const body = new URLSearchParams();

  if (kind === "sms") {
    body.set("To", message.to);
    body.set(t.smsFrom.startsWith("MG") ? "MessagingServiceSid" : "From", t.smsFrom);
    body.set("Body", messageText(message));
  } else {
    body.set("To", `whatsapp:${message.to}`);
    body.set("From", `whatsapp:${t.whatsappFrom.replace(/^whatsapp:/, "")}`);
    if (t.whatsappContentSid) {
      body.set("ContentSid", t.whatsappContentSid);
      body.set("ContentVariables", JSON.stringify({ "1": message.code }));
    } else {
      body.set("Body", messageText(message));
    }
  }

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(t.accountSid)}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${t.accountSid}:${t.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    }
  );
  if (!res.ok) {
    throw new Error(`Twilio ${kind} failed (${res.status}): ${await readProviderError(res)}`);
  }
}

// ======================= Meta WhatsApp Cloud API =======================

async function sendMetaWhatsapp(message: OtpMessage): Promise<void> {
  requireE164(message.to);
  const m = message.settings.delivery.meta;
  const components: unknown[] = [
    { type: "body", parameters: [{ type: "text", text: message.code }] },
  ];
  if (m.copyCodeButton) {
    // Authentication templates carry a copy-code / one-tap button that also takes the code
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: message.code }],
    });
  }

  const res = await fetch(
    `https://graph.facebook.com/${m.graphApiVersion}/${encodeURIComponent(m.phoneNumberId)}/messages`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${m.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: message.to.replace(/^\+/, ""),
        type: "template",
        template: { name: m.templateName, language: { code: m.templateLanguage }, components },
      }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    }
  );
  if (!res.ok) {
    throw new Error(`WhatsApp Cloud API failed (${res.status}): ${await readProviderError(res)}`);
  }
}

// ======================= Dispatcher =======================

/** Routes a code to the provider the admin configured for its channel. */
export function createOtpSender(log: FastifyBaseLogger): OtpSender {
  return async (message) => {
    const { delivery } = message.settings;
    const logToConsole = () =>
      log.info({ channel: message.channel, to: message.to, code: message.code }, "OTP (console provider)");

    switch (message.channel) {
      case "email":
        return delivery.email.provider === "smtp" ? sendSmtpEmail(message) : logToConsole();
      case "sms":
        return delivery.sms.provider === "twilio" ? sendTwilio(message, "sms") : logToConsole();
      case "whatsapp":
        if (delivery.whatsapp.provider === "twilio") return sendTwilio(message, "whatsapp");
        if (delivery.whatsapp.provider === "meta") return sendMetaWhatsapp(message);
        return logToConsole();
    }
  };
}
