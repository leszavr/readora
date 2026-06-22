import { Router, type IRouter } from "express";
import { db, appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { emailService } from "../lib/email-service";
import { z } from "zod";

const router: IRouter = Router();

const feedbackSchema = z.object({
  name: z.string().optional(),
  email: z.string().email("Некорректный email адрес"),
  subject: z.string().optional(),
  message: z.string().min(1, "Сообщение не может быть пустым"),
});

// POST /api/feedback - публичный endpoint для отправки обратной связи
router.post("/api/feedback", async (req, res): Promise<void> => {
  try {
    const validated = feedbackSchema.parse(req.body);

    // Получаем email для обратной связи из настроек
    const [feedbackEmailSetting] = await db
      .select()
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, "feedback_email"));

    const feedbackEmail = feedbackEmailSetting?.value;

    if (!feedbackEmail) {
      res.status(500).json({
        error: "Email для обратной связи не настроен. Обратитесь к администратору.",
      });
      return;
    }

    // Формируем текст письма
    const emailSubject = validated.subject
      ? `[Обратная связь] ${validated.subject}`
      : "[Обратная связь] Новое сообщение с сайта";

    const emailBody = `
Получено новое сообщение через форму обратной связи:

${validated.name ? `От: ${validated.name}` : ""}
Email: ${validated.email}
${validated.subject ? `Тема: ${validated.subject}` : ""}

Сообщение:
${validated.message}

---
Отправлено: ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}
    `.trim();

    // Отправляем email
    await emailService.sendEmail({
      to: feedbackEmail,
      subject: emailSubject,
      text: emailBody,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Новое сообщение через форму обратной связи</h2>
          ${validated.name ? `<p><strong>От:</strong> ${validated.name}</p>` : ""}
          <p><strong>Email:</strong> ${validated.email}</p>
          ${validated.subject ? `<p><strong>Тема:</strong> ${validated.subject}</p>` : ""}
          <div style="margin-top: 20px; padding: 15px; background-color: #f5f5f5; border-left: 4px solid #007bff;">
            <p style="margin: 0; white-space: pre-wrap;">${validated.message}</p>
          </div>
          <p style="margin-top: 20px; color: #666; font-size: 12px;">
            Отправлено: ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}
          </p>
        </div>
      `,
    });

    res.json({ success: true, message: "Сообщение успешно отправлено" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: "Ошибка валидации данных",
        details: error.errors,
      });
      return;
    }

    console.error("Ошибка при отправке обратной связи:", error);
    res.status(500).json({
      error: "Не удалось отправить сообщение. Попробуйте позже.",
    });
  }
});

export default router;
