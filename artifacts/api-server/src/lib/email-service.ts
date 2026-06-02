import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { db, appSettingsTable } from "@workspace/db";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

interface SMTPSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
  appBaseUrl: string | null;
  enabled: boolean;
}

interface EmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

interface SmtpTestResult {
  success: boolean;
  messageId?: string;
  error?: string;
  code?: string;
}

function extractErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = (error as { code?: unknown }).code;
  return typeof candidate === "string" ? candidate : undefined;
}

function extractErrorResponse(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = (error as { response?: unknown }).response;
  if (typeof candidate !== "string") return undefined;
  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function extractErrorCommand(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = (error as { command?: unknown }).command;
  return typeof candidate === "string" ? candidate : undefined;
}

function formatSmtpError(error: unknown): { message: string; code?: string } {
  const fallback = error instanceof Error ? error.message : String(error);
  const code = extractErrorCode(error);
  const response = extractErrorResponse(error);
  const command = extractErrorCommand(error);

  let message = fallback;
  if (response) message = response;
  if (command) message = `${message} (command: ${command})`;
  if (code) message = `${message} [${code}]`;

  return { message, code };
}

class EmailService {
  private transporter: Transporter | null = null;
  private settings: SMTPSettings | null = null;

  private normalizeBaseUrl(value: string | null | undefined): string | null {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed.replace(/\/+$/, "");
  }

  private async resolvePublicBaseUrl(fallbackBaseUrl?: string): Promise<string> {
    if (!this.settings) {
      await this.initialize();
    }

    const fromSettings = this.normalizeBaseUrl(this.settings?.appBaseUrl);
    if (fromSettings) return fromSettings;

    const fromFallback = this.normalizeBaseUrl(fallbackBaseUrl);
    if (fromFallback) return fromFallback;

    const fromEnv = this.normalizeBaseUrl(process.env.APP_BASE_URL)
      ?? this.normalizeBaseUrl(process.env.APP_ORIGIN)
      ?? "http://localhost:3000";
    return fromEnv;
  }

  resetTransporter(): void {
    this.transporter = null;
    this.settings = null;
  }

  async initialize(): Promise<void> {
    try {
      // Всегда сбрасываем текущее состояние, чтобы не держать устаревший транспорт
      this.resetTransporter();

      const settingsFromDb = await db.select().from(appSettingsTable);
      const settingsMap = new Map(settingsFromDb.map((s) => [s.key, s.value]));

      const enabled = settingsMap.get("smtp_enabled") === "true";
      if (!enabled) {
        console.log("[EmailService] SMTP disabled in settings");
        return;
      }

      const host = settingsMap.get("smtp_host");
      const port = settingsMap.get("smtp_port");
      const user = settingsMap.get("smtp_user");
      const password = settingsMap.get("smtp_password");
      const from = settingsMap.get("smtp_from");
      const appBaseUrl = settingsMap.get("app_base_url") ?? null;

      if (!host || !port || !from) {
        console.warn("[EmailService] SMTP settings incomplete, email disabled");
        return;
      }

      const portNumber = Number.parseInt(port, 10);
      if (!Number.isFinite(portNumber) || portNumber <= 0 || portNumber > 65535) {
        console.warn("[EmailService] SMTP port is invalid, email disabled");
        return;
      }

      const secure = settingsMap.get("smtp_secure") === "true";
      const hasAuth = Boolean(user && password);

      this.settings = {
        host,
        port: portNumber,
        secure,
        user: user ?? "",
        password: password ?? "",
        from,
        appBaseUrl,
        enabled: true,
      };

      this.transporter = nodemailer.createTransport({
        host: this.settings.host,
        port: this.settings.port,
        // secure=true: TLS-обёртка сразу (порт 465); false: STARTTLS после EHLO (587/25)
        secure: this.settings.secure,
        auth: hasAuth
          ? {
              user: this.settings.user,
              pass: this.settings.password,
            }
          : undefined,
      });

      console.log(`[EmailService] Initialized with SMTP ${this.settings.host}:${this.settings.port}`);
    } catch (error) {
      console.error("[EmailService] Failed to initialize:", error);
    }
  }

  async sendEmail(options: EmailOptions): Promise<boolean> {
    if (!this.transporter || !this.settings) {
      await this.initialize();
    }

    if (!this.transporter || !this.settings) {
      console.warn("[EmailService] Email not configured, skipping send");
      return false;
    }

    try {
      const info = await this.transporter.sendMail({
        from: this.settings.from,
        to: Array.isArray(options.to) ? options.to.join(", ") : options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });

      console.log(`[EmailService] Email sent: ${info.messageId}`);
      return true;
    } catch (error) {
      console.error("[EmailService] Failed to send email:", error);
      return false;
    }
  }

  async sendEmailVerification(email: string, username: string, token: string, baseUrl: string): Promise<boolean> {
    const normalizedBaseUrl = await this.resolvePublicBaseUrl(baseUrl);
    const verifyUrl = `${normalizedBaseUrl}/verify/${token}`;
    const html = await this.loadTemplate("email-verification", {
      username,
      verifyUrl,
      logoUrl: `${normalizedBaseUrl}/readora-wordmark.webp`,
    });

    return this.sendEmail({
      to: email,
      subject: "Подтверждение email — Readora",
      html,
      text: `Здравствуйте, ${username}!\n\nПодтвердите ваш email, перейдя по ссылке: ${verifyUrl}\n\nСсылка действительна 24 часа.`,
    });
  }

  async sendPasswordReset(email: string, username: string, token: string, baseUrl: string): Promise<boolean> {
    const normalizedBaseUrl = await this.resolvePublicBaseUrl(baseUrl);
    const resetUrl = `${normalizedBaseUrl}/reset-password/${token}`;
    const html = await this.loadTemplate("password-reset", {
      username,
      resetUrl,
      logoUrl: `${normalizedBaseUrl}/readora-wordmark.webp`,
    });

    return this.sendEmail({
      to: email,
      subject: "Восстановление пароля — Readora",
      html,
      text: `Здравствуйте, ${username}!\n\nДля сброса пароля перейдите по ссылке: ${resetUrl}\n\nСсылка действительна 1 час.\n\nЕсли вы не запрашивали сброс пароля, проигнорируйте это письмо.`,
    });
  }

  async sendPasswordChangeConfirmation(email: string, username: string, token: string, baseUrl: string): Promise<boolean> {
    const normalizedBaseUrl = await this.resolvePublicBaseUrl(baseUrl);
    const confirmUrl = `${normalizedBaseUrl}/confirm-password-change/${token}`;
    const html = await this.loadTemplate("password-change-confirmation", {
      username,
      confirmUrl,
      logoUrl: `${normalizedBaseUrl}/readora-wordmark.webp`,
    });

    return this.sendEmail({
      to: email,
      subject: "Подтверждение смены пароля — Readora",
      html,
      text: `Здравствуйте, ${username}!\n\nПодтвердите смену пароля по ссылке: ${confirmUrl}\n\nСсылка действительна 1 час.\n\nЕсли вы не запрашивали смену пароля, проигнорируйте это письмо.`,
    });
  }

  private async loadTemplate(templateName: string, vars: Record<string, string>): Promise<string> {
    try {
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const templatePath = join(__dirname, "..", "..", "email-templates", `${templateName}.html`);
      let html = await readFile(templatePath, "utf-8");

      // Simple variable replacement
      for (const [key, value] of Object.entries(vars)) {
        html = html.replaceAll(`{{${key}}}`, value);
      }

      return html;
    } catch (error) {
      console.error(`[EmailService] Failed to load template ${templateName}:`, error);
      // Fallback to plain text
      return `<html><body><pre>${JSON.stringify(vars, null, 2)}</pre></body></html>`;
    }
  }

  isEnabled(): boolean {
    return this.transporter !== null && this.settings !== null;
  }

  async sendTestEmail(to: string): Promise<SmtpTestResult> {
    try {
      if (!this.transporter || !this.settings) {
        await this.initialize();
      }

      if (!this.transporter || !this.settings) {
        return { success: false, error: "SMTP не настроен или отключен" };
      }

      const publicBaseUrl = await this.resolvePublicBaseUrl();
      const logoHtml = publicBaseUrl
        ? `<p><img src="${publicBaseUrl}/readora-wordmark.webp" alt="Readora" style="height:28px;width:auto"></p>`
        : "";

      const info = await this.transporter.sendMail({
        from: this.settings.from,
        to,
        subject: "Тестовое письмо — Readora",
        text: "Это тестовое письмо от Readora. Если вы его получили — SMTP настроен корректно.",
        html: `${logoHtml}<p>Это тестовое письмо от <strong>Readora</strong>.</p><p>Если вы его получили — SMTP настроен корректно.</p>`,
      });

      return { success: true, messageId: info.messageId };
    } catch (error) {
      const formatted = formatSmtpError(error);
      console.error("[EmailService] Failed to send test email:", error);
      return { success: false, error: formatted.message, code: formatted.code };
    }
  }
}

export const emailService = new EmailService();
