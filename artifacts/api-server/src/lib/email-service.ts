import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { db, appSettingsTable } from "@workspace/db";
import { readFile, writeFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

interface SMTPSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
  appBaseUrl: string | null;
  enabled: boolean;
  saveToFiles: boolean;
}

interface SavedEmail {
  id: string;
  to: string;
  subject: string;
  date: string;
  timestamp: number;
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
      const saveToFiles = settingsMap.get("email_save_to_files") === "true";

      this.settings = {
        host,
        port: portNumber,
        secure,
        user: user ?? "",
        password: password ?? "",
        from,
        appBaseUrl,
        enabled: true,
        saveToFiles,
      };

      // Создаём папку для сохранения писем если включена опция
      if (saveToFiles) {
        await this.ensureEmailsDirectory();
      }

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

  private async ensureEmailsDirectory(): Promise<void> {
    const emailsDir = join(process.cwd(), "logs", "emails");
    if (!existsSync(emailsDir)) {
      await mkdir(emailsDir, { recursive: true });
    }
  }

  private async saveEmailToFile(options: EmailOptions): Promise<string> {
    await this.ensureEmailsDirectory();
    const emailsDir = join(process.cwd(), "logs", "emails");
    const timestamp = Date.now();
    const id = `${timestamp}-${Math.random().toString(36).substring(2, 9)}`;
    const filename = `${id}.json`;
    const filepath = join(emailsDir, filename);

    const emailData = {
      id,
      to: Array.isArray(options.to) ? options.to : [options.to],
      subject: options.subject,
      html: options.html,
      text: options.text || "",
      from: this.settings?.from || "noreply@readora.local",
      date: new Date(timestamp).toISOString(),
      timestamp,
    };

    await writeFile(filepath, JSON.stringify(emailData, null, 2), "utf-8");
    console.log(`[EmailService] Email saved to file: ${filename}`);
    return id;
  }

  async sendEmail(options: EmailOptions): Promise<boolean> {
    if (!this.transporter || !this.settings) {
      await this.initialize();
    }

    if (!this.transporter || !this.settings) {
      console.warn("[EmailService] Email not configured, skipping send");
      return false;
    }

    // Если включено сохранение в файлы - сохраняем и возвращаем успех
    if (this.settings.saveToFiles) {
      try {
        await this.saveEmailToFile(options);
        return true;
      } catch (error) {
        console.error("[EmailService] Failed to save email to file:", error);
        return false;
      }
    }

    // Обычная отправка через SMTP
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
      const fileName = `${templateName}.html`;
      const cwd = process.cwd();
      const candidatePaths = [
        join(cwd, "email-templates", fileName),
        join(cwd, "dist", "email-templates", fileName),
        join(cwd, "..", "email-templates", fileName),
        join(__dirname, "..", "..", "email-templates", fileName),
        join(__dirname, "..", "..", "..", "email-templates", fileName),
      ];

      let html: string | null = null;
      for (const candidate of candidatePaths) {
        try {
          html = await readFile(candidate, "utf-8");
          break;
        } catch {
          // try next candidate path
        }
      }

      if (!html) {
        throw new Error(`Template not found: ${fileName}`);
      }

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

  isSavingToFiles(): boolean {
    return this.settings?.saveToFiles === true;
  }

  async getSavedEmails(): Promise<SavedEmail[]> {
    try {
      await this.ensureEmailsDirectory();
      const emailsDir = join(process.cwd(), "logs", "emails");
      const files = await readdir(emailsDir);
      const emails: SavedEmail[] = [];

      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        try {
          const filepath = join(emailsDir, file);
          const stats = await stat(filepath);
          const content = await readFile(filepath, "utf-8");
          const data = JSON.parse(content);
          emails.push({
            id: data.id,
            to: Array.isArray(data.to) ? data.to.join(", ") : data.to,
            subject: data.subject,
            date: data.date,
            timestamp: data.timestamp || stats.mtimeMs,
          });
        } catch (error) {
          console.error(`[EmailService] Failed to read email file ${file}:`, error);
        }
      }

      // Сортируем по времени (новые первые)
      return emails.sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
      console.error("[EmailService] Failed to get saved emails:", error);
      return [];
    }
  }

  async getSavedEmail(id: string): Promise<any | null> {
    try {
      const emailsDir = join(process.cwd(), "logs", "emails");
      const files = await readdir(emailsDir);
      const file = files.find(f => f.startsWith(id));
      if (!file) return null;

      const filepath = join(emailsDir, file);
      const content = await readFile(filepath, "utf-8");
      return JSON.parse(content);
    } catch (error) {
      console.error(`[EmailService] Failed to get saved email ${id}:`, error);
      return null;
    }
  }

  async deleteSavedEmail(id: string): Promise<boolean> {
    try {
      const emailsDir = join(process.cwd(), "logs", "emails");
      const files = await readdir(emailsDir);
      const file = files.find(f => f.startsWith(id));
      if (!file) return false;

      const filepath = join(emailsDir, file);
      await unlink(filepath);
      console.log(`[EmailService] Deleted saved email: ${id}`);
      return true;
    } catch (error) {
      console.error(`[EmailService] Failed to delete saved email ${id}:`, error);
      return false;
    }
  }

  async clearSavedEmails(): Promise<number> {
    try {
      const emailsDir = join(process.cwd(), "logs", "emails");
      const files = await readdir(emailsDir);
      let count = 0;

      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        try {
          await unlink(join(emailsDir, file));
          count++;
        } catch (error) {
          console.error(`[EmailService] Failed to delete file ${file}:`, error);
        }
      }

      console.log(`[EmailService] Cleared ${count} saved emails`);
      return count;
    } catch (error) {
      console.error("[EmailService] Failed to clear saved emails:", error);
      return 0;
    }
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

      // Используем sendEmail чтобы учитывался флаг saveToFiles
      const sent = await this.sendEmail({
        to,
        subject: "Тестовое письмо — Readora",
        text: "Это тестовое письмо от Readora. Если вы его получили — SMTP настроен корректно.",
        html: `${logoHtml}<p>Это тестовое письмо от <strong>Readora</strong>.</p><p>Если вы его получили — SMTP настроен корректно.</p>`,
      });

      if (sent) {
        return { success: true, messageId: this.settings.saveToFiles ? "saved-to-file" : undefined };
      } else {
        return { success: false, error: "Не удалось отправить письмо" };
      }
    } catch (error) {
      const formatted = formatSmtpError(error);
      console.error("[EmailService] Failed to send test email:", error);
      return { success: false, error: formatted.message, code: formatted.code };
    }
  }
}

export const emailService = new EmailService();
