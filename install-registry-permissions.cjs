const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const file = path.join(process.cwd(), "src/commands.js");
const source = fs.readFileSync(file, "utf8");

if (source.includes("MONTADORIA_REGISTRY_AGENTS_V1")) {
  console.log("سیستم مأموران ثبت قبلاً نصب شده است.");
  process.exit(0);
}

const backup =
  file + ".before-registry-agents-" +
  new Date().toISOString().replace(/[:.]/g, "-") + ".bak";

fs.copyFileSync(file, backup);

let s = source;

function replaceOnce(oldText, newText, label) {
  const first = s.indexOf(oldText);
  if (first < 0 || s.indexOf(oldText, first + oldText.length) >= 0) {
    throw new Error("محل تغییر دقیقاً پیدا نشد: " + label);
  }
  s = s.slice(0, first) + newText + s.slice(first + oldText.length);
}

try {
  // 1. جدول مأموران ثبت
  replaceOnce(
    '  const rtNow = () => Math.floor(Date.now() / 1000);',
    `  // MONTADORIA_REGISTRY_AGENTS_V1
  db.exec(\`
    CREATE TABLE IF NOT EXISTS montadoria_registry_agents (
      telegram_id TEXT PRIMARY KEY,
      added_by TEXT NOT NULL,
      added_at INTEGER NOT NULL
    )
  \`);

  const rtNow = () => Math.floor(Date.now() / 1000);`,
    "جدول مأموران"
  );

  // 2. مجوزها و دستورات مدیریتی دفتر ثبت
  replaceOnce(
    '  const rtDigits = value => {',
    `  const rtIsRegistrar = ctx => {
    const id = String(ctx.from?.id ?? "");
    if (!id) return false;

    // صاحب دفتر ثبت نیز مجوز ثبت دارد.
    if (id === rtOwnerId()) return true;

    return Boolean(db.prepare(
      "SELECT 1 FROM montadoria_registry_agents WHERE telegram_id = ?"
    ).get(id));
  };

  const rtCanManageRegistrars = ctx =>
    rtIsBotOwner(ctx) || String(ctx.from?.id ?? "") === rtOwnerId();

  bot.hears(/^افزودن\\s+م[اأ]مور\\s+ثبت\\s+([0-9۰-۹٠-٩]{5,20})$/u, async ctx => {
    if (!rtCanManageRegistrars(ctx)) {
      return ctx.reply("⛔ فقط مالک ربات یا صاحب دفتر ثبت می‌تواند مأمور تعیین کند.");
    }

    const targetId = String(ctx.match[1]).replace(/[۰-۹٠-٩]/g, c => ({
      "۰":"0","۱":"1","۲":"2","۳":"3","۴":"4",
      "۵":"5","۶":"6","۷":"7","۸":"8","۹":"9",
      "٠":"0","١":"1","٢":"2","٣":"3","٤":"4",
      "٥":"5","٦":"6","٧":"7","٨":"8","٩":"9"
    })[c]);

    const target = getUser(Number(targetId));
    if (!target) {
      return ctx.reply("❌ کاربر پیدا نشد؛ ابتدا باید ربات را با /start فعال کند.");
    }

    db.prepare(\`
      INSERT INTO montadoria_registry_agents (telegram_id, added_by, added_at)
      VALUES (?, ?, ?)
      ON CONFLICT(telegram_id) DO NOTHING
    \`).run(targetId, String(ctx.from.id), rtNow());

    return ctx.reply(
      "✅ مأمور ثبت تعیین شد.\\n" +
      "شناسه: " + targetId + "\\n" +
      "از این پس می‌تواند دارایی‌های مجاز را ثبت کند."
    );
  });

  bot.hears(/^حذف\\s+م[اأ]مور\\s+ثبت\\s+([0-9۰-۹٠-٩]{5,20})$/u, async ctx => {
    if (!rtCanManageRegistrars(ctx)) {
      return ctx.reply("⛔ فقط مالک ربات یا صاحب دفتر ثبت می‌تواند مأمور حذف کند.");
    }

    const targetId = String(ctx.match[1]).replace(/[۰-۹٠-٩]/g, c => ({
      "۰":"0","۱":"1","۲":"2","۳":"3","۴":"4",
      "۵":"5","۶":"6","۷":"7","۸":"8","۹":"9",
      "٠":"0","١":"1","٢":"2","٣":"3","٤":"4",
      "٥":"5","٦":"6","٧":"7","٨":"8","٩":"9"
    })[c]);

    const result = db.prepare(
      "DELETE FROM montadoria_registry_agents WHERE telegram_id = ?"
    ).run(targetId);

    return ctx.reply(
      result.changes
        ? "✅ دسترسی مأمور ثبت لغو شد."
        : "❌ این شناسه در فهرست مأموران ثبت نبود."
    );
  });

  bot.hears(/^(?:ماموران ثبت|مأموران ثبت)$/u, async ctx => {
    if (!rtCanManageRegistrars(ctx)) {
      return ctx.reply("⛔ فقط مالک ربات یا صاحب دفتر ثبت می‌تواند فهرست را ببیند.");
    }

    const head = rtOwnerId();
    const rows = db.prepare(
      "SELECT telegram_id, added_at FROM montadoria_registry_agents ORDER BY added_at"
    ).all();

    let text = "🏛️ فهرست دفتر ثبت\\n\\n";
    text += "مسئول دفتر: " + (head || "تعیین نشده") + "\\n\\n";
    text += rows.length
      ? rows.map((r, i) => (i + 1) + ". " + r.telegram_id).join("\\n")
      : "هنوز مأمور دیگری تعیین نشده است.";

    return ctx.reply(text);
  });

  const rtDigits = value => {`,
    "مجوزها و مدیریت مأموران"
  );

  // 3. سد مشترک برای دستورات ثبت دارایی
  replaceOnce(
    '  bot.use(async (ctx, next) => {\\n    const text = ctx.message?.text;\\n    if (!text || !ctx.from?.id) return next();\\n\\n    let trade;',
    `  // MONTADORIA_REGISTRY_REGISTRATION_GUARD_V1
  bot.use(async (ctx, next) => {
    const text = String(ctx.message?.text ?? ctx.message?.caption ?? "").trim();
    if (!text || !ctx.from?.id) return next();

    const registrationCommand =
      /^(?:ثبت|افزودن|ایجاد|تعریف|ساخت)\\s+(?:خودرو|ملک|کسب[‌ ]?وکار|کالا|آیتم|محصول|شمشیر|سلاح|غذا|نوشیدنی|دارو|لباس|ابزار|دارایی|رسانه|عکس|تصویر|ویدیو|ویدئو|فروشگاه|مغازه|وسیله)(?:\\s|\\||$)/u;

    if (!registrationCommand.test(text)) return next();

    if (!rtIsRegistrar(ctx)) {
      return ctx.reply(
        "⛔ اجازهٔ ثبت ندارید.\\n" +
        "ثبت دارایی‌ها فقط توسط مأموران دفتر ثبت مونتادوریا مجاز است."
      );
    }

    return next();
  });

  bot.use(async (ctx, next) => {
    const text = ctx.message?.text;
    if (!text || !ctx.from?.id) return next();

    let trade;`,
    "محافظ ثبت دارایی‌ها"
  );

  // 4. اجازه به مأموران برای عبور از کنترل‌های قدیمی ثبت خودرو
  replaceOnce(
    'if (!carIsManager(u)) return ctx.reply("⛔ فقط مدیر یا مالک می‌تواند خودرو ثبت کند.");',
    'if (!carIsManager(u) && !rtIsRegistrar(ctx)) return ctx.reply("⛔ فقط مأمور ثبت مجاز است.");',
    "ثبت خودرو"
  );

  // 5. اجازه به مأموران برای ثبت کسب‌وکار
  replaceOnce(
    'if (!businessManager(getUser(ctx.from.id))) {',
    'if (!businessManager(getUser(ctx.from.id)) && !rtIsRegistrar(ctx)) {',
    "ثبت کسب‌وکار"
  );

  // 6. اجازه به مأموران برای ثبت ملک
  replaceOnce(
    'const propertyIsManager = ctx =>\\n  String(process.env.OWNER_ID || "") === String(ctx.from?.id) ||',
    'const propertyIsManager = ctx =>\\n  rtIsRegistrar(ctx) ||\\n  String(process.env.OWNER_ID || "") === String(ctx.from?.id) ||',
    "ثبت ملک"
  );

  // 7. اجازه به مأموران برای استفاده از بخش مدیریت کالاها
  replaceOnce(
    '      role === "moderator"\\n    );',
    '      role === "moderator" ||\\n      rtIsRegistrar(ctx)\\n    );',
    "مدیریت کالاها"
  );

  // 8. اجازه به مأموران در مدیریت فروشگاه‌های چندبازاری
  replaceOnce(
    '      ) || String(process.env.OWNER_ID || "") === String(ctx.from.id);',
    '      ) || String(process.env.OWNER_ID || "") === String(ctx.from.id) || rtIsRegistrar(ctx);',
    "مدیریت بازارها"
  );

  fs.writeFileSync(file, s, "utf8");

  try {
    execFileSync("node", ["--check", file], { stdio: "inherit" });
  } catch (error) {
    fs.copyFileSync(backup, file);
    throw new Error("بررسی نحوی ناموفق بود؛ فایل اصلی از پشتیبان بازیابی شد.");
  }

  console.log("\\n✅ سیستم مجوز مأموران ثبت نصب شد.");
  console.log("✅ بررسی نحوی فایل موفق بود.");
  console.log("✅ نسخه پشتیبان: " + backup);
  console.log("\\nدستورات جدید:");
  console.log("افزودن مامور ثبت 123456789");
  console.log("حذف مامور ثبت 123456789");
  console.log("ماموران ثبت");
  console.log("\\nتغییرات هنوز commit یا push نشده‌اند.");

} catch (error) {
  fs.copyFileSync(backup, file);
  console.error("\\n❌ نصب انجام نشد:", error.message);
  console.error("فایل اصلی از نسخه پشتیبان بازیابی شد.");
  process.exit(1);
}
