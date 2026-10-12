import { Router, type IRouter } from "express";
import { db, appSettingsTable, feedbackResponsesTable } from "@workspace/db";
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

// Формулировки вариантов зафиксированы требованиями к опросу.
export const FEEDBACK_PAIN_POINTS = [
  "Не нашел нужную функцию",
  "Неудобно читать в браузере (ридере)",
  "Сайт работает медленно или с ошибками",
  "Не хватает поддержки других форматов (PDF, MOBI и т.д.)",
] as const;
const MISSING_FEATURE_PAIN_POINT = "Не нашел нужную функцию";
const MAX_PAIN_POINTS = 2;

const contactFormat = /^[^\s@]+@[^\s@]+\.[^\s@]+$|^@[A-Za-z0-9_]{4,32}$|^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/[A-Za-z0-9_]{4,32}$/i;

function createSurveySchema(isAuthenticated: boolean) {
  return z
    .object({
      rating: z.number().int().min(1).max(5),
      painPoints: z.array(z.enum(FEEDBACK_PAIN_POINTS)).max(MAX_PAIN_POINTS).optional().default([]),
      missingFeature: z.string().trim().max(500).optional(),
      wantsContact: z.boolean().optional().default(false),
      contactInfo: z.string().trim().max(200).optional(),
      pageUrl: z.string().trim().max(500).optional(),
    })
    .superRefine((data, ctx) => {
      if (data.rating <= 4) {
        if (data.painPoints.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["painPoints"],
            message: "Выберите хотя бы одну причину",
          });
        }
      } else if (data.painPoints.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["painPoints"],
          message: "Для оценки 5 звезд причины не указываются",
        });
      }

      if (data.painPoints.includes(MISSING_FEATURE_PAIN_POINT) && !data.missingFeature) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["missingFeature"],
          message: "Опишите, какой функции не хватает",
        });
      }

      if (data.wantsContact && !isAuthenticated) {
        if (!data.contactInfo) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["contactInfo"],
            message: "Укажите email или Telegram для связи",
          });
        } else if (!contactFormat.test(data.contactInfo)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["contactInfo"],
            message: "Некорректный email или Telegram",
          });
        }
      }
    });
}

// POST /api/feedback - публичный endpoint для отправки обратной связи
router.post("/feedback", async (req, res): Promise<void> => {
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

// GET /api/feedback/survey - публичные варианты ответов (единый источник для клиента)
router.get("/feedback/survey", (_req, res): void => {
  res.json({
    painPoints: [...FEEDBACK_PAIN_POINTS],
    missingFeatureTrigger: MISSING_FEATURE_PAIN_POINT,
    maxPainPoints: MAX_PAIN_POINTS,
  });
});

// POST /api/feedback/survey - публичный endpoint exit-intent опроса оценки сайта
router.post("/feedback/survey", async (req, res): Promise<void> => {
  const userId = req.session.userId ?? null;

  try {
    const validated = createSurveySchema(userId !== null).parse(req.body);

    const painPoints = validated.rating <= 4 ? validated.painPoints : [];
    const missingFeature = painPoints.includes(MISSING_FEATURE_PAIN_POINT)
      ? (validated.missingFeature ?? null)
      : null;

    await db.insert(feedbackResponsesTable).values({
      userId,
      sessionId: userId === null && req.sessionID ? req.sessionID.slice(0, 64) : null,
      rating: validated.rating,
      painPoints,
      missingFeature,
      wantsContact: validated.wantsContact,
      contactInfo: validated.wantsContact ? (validated.contactInfo ?? null) : null,
      pageUrl: validated.pageUrl ?? null,
    });

    res.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: "Ошибка валидации данных",
        details: error.errors,
      });
      return;
    }

    console.error("Ошибка при сохранении отзыва:", error);
    res.status(500).json({ error: "Не удалось сохранить отзыв. Попробуйте позже." });
  }
});

export default router;
