import db from "./database.js";

const OWNER_ID = Number(process.env.OWNER_ID || 0);
const OBSERVER_GROUP_ID = process.env.OBSERVER_GROUP_ID
  ? Number(process.env.OBSERVER_GROUP_ID)
  : null;

const RESTRICTION_MINUTES = Math.max(1, Number(process.env.RESTRICTION_MINUTES || 30));

const WARNING_LIMIT = Math.max(
  1,
  Number(process.env.WARNING_LIMIT || 3)
);

const ALLOWED_TAGS = [
  "#ورود", "#خروج", "#خوردن", "#خون", "#خوابیدن", "#خواب",
  "#پزشکی", "#خرید", "#فروش", "#انتقال",
  "#خرید_ملک", "#فروش_ملک", "#خرید_خودرو",
  "#فروش_خودرو", "#انتقال_مالکیت", "#شروع_کار",
  "#پایان_کار", "#ماموریت", "#تمرین", "#مبارزه",
  "#زخمی", "#بیهوش", "#مرگ", "#ازدواج", "#طلاق",
  "#فرزندخواندگی", "#استخدام", "#اخراج", "#ارتقا",
  "#تعطیلی", "#بازگشایی"
];

const WARNINGS = [
  "این دیالوگه یا نامه‌ای که از دستگاه چاپ بیرون اومده؟ قالب رول رو رعایت کن.",
  "ستاره و خط تیره باهات قهرن؟ اکشن و دیالوگ رو درست بنویس.",
  "ناظر بیداره؛ این پیام هنوز از دروازهٔ قالب‌بندی رد نشده.",
  "قوانین رول تزئینی نیستن. پیام رو اصلاح کن.",
  "این یکی از نظر قالب‌بندی به تأیید دربار نرسید."
];

db.exec(`
  CREATE TABLE IF NOT EXISTS rp_groups (
    chat_id INTEGER PRIMARY KEY,
    title TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    added_by INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS free_chat_groups (
    chat_id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    added_by INTEGER,
    created_at INTEGER
  );


  CREATE TABLE IF NOT EXISTS observer_warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL,
    chat_id INTEGER NOT NULL,
    message_id INTEGER,
    reason TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    cleared_at TEXT
  );

  CREATE TABLE IF NOT EXISTS observer_username_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL,
    old_username TEXT,
    new_username TEXT,
    changed_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS observer_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    details TEXT,
    created_at TEXT NOT NULL
  );
`);


db.exec(`
  CREATE TABLE IF NOT EXISTS observer_restrictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL,
    username TEXT,
    restricted_until TEXT NOT NULL,
    restored_at TEXT,
    created_at TEXT NOT NULL,
    affected_groups TEXT NOT NULL DEFAULT '[]'
  );
`);

const now = () => Math.floor(Date.now() / 1000);

function isOwner(ctx) {
  return Boolean(OWNER_ID && ctx.from?.id === OWNER_ID);
}

function isGroup(chat) {
  return chat && (chat.type === "group" || chat.type === "supergroup");
}

function isRegistered(chatId) {
  return Boolean(
    db.prepare(
      "SELECT 1 FROM rp_groups WHERE chat_id = ? AND active = 1"
    ).get(chatId)
  );
}

function audit(actorId, action, details = "") {
  db.prepare(`
    INSERT INTO observer_audit
      (actor_id, action, details, created_at)
    VALUES (?, ?, ?, ?)
  `).run(actorId, action, details, now());
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

async function report(botOrApi, text) {
  if (!OBSERVER_GROUP_ID) {
    console.warn("[OBSERVER REPORT]", text);
    return;
  }

  const api = botOrApi?.api ?? botOrApi;

  if (!api || typeof api.sendMessage !== "function") {
    console.error("Observer report failed: Telegram API unavailable.");
    return;
  }

  try {
    const reportText = String(text ?? "").trimEnd();

    const hashtagRules = [
      { pattern: /انتقال.{0,30}(وجه|پول|بانک|کارت)|(?:وجه|پول).{0,30}انتقال/i, tag: "#انتقال_وجه" },
      { pattern: /مالیات|مالیاتی/i, tag: "#مالیات" },
      { pattern: /کارت\s*بانکی|شماره\s*کارت/i, tag: "#کارت_بانکی" },
      { pattern: /بانک|موجودی|کیف\s*پول|واریز|برداشت|پول|وجه/i, tag: "#امور_مالی" },
      { pattern: /ملک|املاک|خانه|زمین|اجاره/i, tag: "#املاک" },
      { pattern: /خودرو|ماشین|وسیله\s*نقلیه|پلاک/i, tag: "#خودرو" },
      { pattern: /کسب.?وکار|سود\s*روزانه|درآمد\s*روزانه/i, tag: "#کسب_وکار" },
      { pattern: /فروشگاه|بازار|محصول|کالا/i, tag: "#فروشگاه" },
      { pattern: /خرید|خریدار|خریداری/i, tag: "#خرید" },
      { pattern: /فروش|فروشنده|فروخته/i, tag: "#فروش" },
      { pattern: /اخطار|هشدار|محدودیت|مسدود|سکوت|رفع\s*محدودیت/i, tag: "#مدیریت" },
      { pattern: /خواب|خوردن|غذا|گرسنگی|تشنگی|خون.?آشام/i, tag: "#نیازهای_کاربر" },
      { pattern: /هویت|نژاد|گرگینه|دگرپیکر/i, tag: "#هویت" },
      { pattern: /ثبت\s*گروه|گروه\s*نقش.?آفرینی/i, tag: "#گروه_نقش_آفرینی" },
      { pattern: /کاربر|پروفایل|ثبت.?نام|نام\s*کاربری/i, tag: "#کاربر" },
      { pattern: /ربات|خطا|سیستم|گزارش/i, tag: "#گزارش_سیستم" }
    ];

    const matchedTags = hashtagRules
      .filter(rule => rule.pattern.test(reportText))
      .map(rule => rule.tag);

    const tagsToAppend = [...new Set(matchedTags)]
      .filter(tag => !reportText.includes(tag))
      .slice(0, 3);

    if (tagsToAppend.length === 0 && matchedTags.length === 0) {
      tagsToAppend.push("#گزارش_سایر");
    }

    const taggedReportText = tagsToAppend.length
      ? `${reportText}\n\n${tagsToAppend.join(" ")}`
      : reportText;

    await api.sendMessage(OBSERVER_GROUP_ID, taggedReportText, {
      parse_mode: "HTML"
    });
  } catch (error) {
    console.error("Observer report failed:", error.message);
  }
}

async function restrictAcrossGroups(api, telegramId, username = "") {
  const groups = db.prepare(`
    SELECT chat_id, title
    FROM rp_groups
    WHERE active = 1
  `).all();

  if (!groups.length) {
    await report(api, "⚠️ محدودیت اعمال نشد؛ گروه نقش‌آفرینی فعالی ثبت نشده است.");
    return;
  }

  const untilUnix =
    Math.floor(Date.now() / 1000) + RESTRICTION_MINUTES * 60;
  const restrictedUntil = new Date(untilUnix * 1000).toISOString();
  const successful = [];
  const failed = [];

  for (const group of groups) {
    try {
      await api.restrictChatMember(
        group.chat_id,
        telegramId,
        {
          can_send_messages: false,
          can_send_audios: false,
          can_send_documents: false,
          can_send_photos: false,
          can_send_videos: false,
          can_send_video_notes: false,
          can_send_voice_notes: false,
          can_send_polls: false,
          can_send_other_messages: false,
          can_add_web_page_previews: false
        },
        { until_date: untilUnix }
      );

      successful.push({
        chat_id: group.chat_id,
        title: group.title || ""
      });
    } catch (error) {
      failed.push({
        chat_id: group.chat_id,
        title: group.title || "",
        error: error.message || String(error)
      });
      console.error(
        "Restriction failed:",
        group.chat_id,
        telegramId,
        error.message || error
      );
    }
  }

  if (!successful.length) {
    await report(
      api,
      `⚠️ محدودیت کاربر ${telegramId} در هیچ گروهی اعمال نشد. ` +
      `بررسی کن ربات در گروه‌ها مجوز محدودکردن اعضا را داشته باشد.`
    );
    return;
  }

  db.prepare(`
    INSERT INTO observer_restrictions
      (telegram_id, username, restricted_until, restored_at,
       created_at, affected_groups)
    VALUES (?, ?, ?, NULL, ?, ?)
  `).run(
    telegramId,
    username || null,
    restrictedUntil,
    now(),
    JSON.stringify(successful)
  );

  await report(
    api,
    `🔇 <b>محدودیت نقش‌آفرینی اعمال شد</b>\n` +
    `شناسه کاربر: <code>${telegramId}</code>\n` +
    `مدت: ${RESTRICTION_MINUTES} دقیقه\n` +
    `گروه‌های موفق: ${successful.length}/${groups.length}\n` +
    (failed.length
      ? `گروه‌های ناموفق: ${failed.map(g =>
          escapeHtml(g.title || String(g.chat_id))
        ).join("، ")}`
      : "محدودیت در تمام گروه‌های فعال اعمال شد.")
  );
}

async function restoreExpiredRestrictions(bot) {
  const currentTime = now();

  const expired = db.prepare(`
    SELECT id, telegram_id
    FROM observer_restrictions
    WHERE restored_at IS NULL
      AND restricted_until <= ?
  `).all(currentTime);

  if (!expired.length) return;

  const markRestored = db.prepare(`
    UPDATE observer_restrictions
    SET restored_at = ?
    WHERE id = ? AND restored_at IS NULL
  `);

  let restoredCount = 0;

  for (const item of expired) {
    const result = markRestored.run(currentTime, item.id);
    restoredCount += result.changes;
  }

  if (restoredCount) {
    await report(
      bot.api,
      `✅ مدت محدودیت ${restoredCount} مورد به پایان رسید. ` +
      `تلگرام محدودیت زمان‌دار را به‌صورت خودکار منقضی می‌کند.`
    );
  }
}

function getActiveWarnings(telegramId) {
  return db.prepare(`
    SELECT COUNT(*) AS total
    FROM observer_warnings
    WHERE telegram_id = ? AND active = 1
  `).get(telegramId).total;
}

async function warn(ctx, reason) {
  const user = ctx.from;
  const chat = ctx.chat;

  const result = db.prepare(`
    INSERT INTO observer_warnings
      (telegram_id, chat_id, message_id, reason, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(user.id, chat.id, ctx.msg.message_id, reason, now());

  const total = getActiveWarnings(user.id);
  const username = user.username ? `@${escapeHtml(user.username)}` : "بدون یوزرنیم";
  const randomWarning = WARNINGS[Math.floor(Math.random() * WARNINGS.length)];

  try {
    await ctx.reply(
      `⚠️ ${escapeHtml(randomWarning)}\nاخطار فعال: ${total}/${WARNING_LIMIT}`
    );
  } catch {}

  await report(
    ctx.api,
    `⚠️ <b>اخطار نقش‌آفرینی</b>\n` +
    `کاربر: ${escapeHtml(user.first_name || "نامشخص")}\n` +
    `یوزرنیم: ${username}\n` +
    `شناسه: <code>${user.id}</code>\n` +
    `گروه: ${escapeHtml(chat.title || String(chat.id))}\n` +
    `علت: ${escapeHtml(reason)}\n` +
    `اخطار فعال: ${total}/${WARNING_LIMIT}\n` +
    `شناسهٔ ثبت: <code>${result.lastInsertRowid}</code>`
  );


  if (total >= WARNING_LIMIT) {
    const existingRestriction = db.prepare(`
      SELECT 1 FROM observer_restrictions
      WHERE telegram_id = ? AND restored_at IS NULL
        AND restricted_until > ?
      LIMIT 1
    `).get(user.id, now());

    if (!existingRestriction) {
      await restrictAcrossGroups(
        ctx.api,
        user.id,
        user.username || ""
      );
    }

  }
}

function validateRoleplay(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  if (!lines.length) return { ok: true };

  for (const line of lines) {
    // هشتگ مجاز می‌تواند همراه توضیح در همان خط باشد.
    const tag = line.match(/^(#\S+)(?:\s+.*)?$/);
    if (tag && ALLOWED_TAGS.includes(tag[1])) continue;

    // دیالوگ باید با خط تیره در دو طرف بسته شود.
    if (/^-[^-].*-$/.test(line)) continue;

    // اکشن باید با ستاره در دو طرف بسته شود.
    if (/^\*[^*].*\*$/.test(line)) continue;

    return {
      ok: false,
      reason: `قالب نامعتبر در این خط: ${line.slice(0, 120)}`
    };
  }

  return { ok: true };
}


db.exec(`
  CREATE TABLE IF NOT EXISTS observer_identity (
    telegram_id INTEGER PRIMARY KEY,
    character_code TEXT UNIQUE,
    character_name TEXT,
    celebrity_name TEXT,
    photo_file_id TEXT,
    approved INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
`);


db.exec(`
  CREATE TABLE IF NOT EXISTS observer_needs (
    telegram_id INTEGER PRIMARY KEY,
    last_food_at INTEGER,
    last_sleep_at INTEGER,
    sleep_until INTEGER,
    last_blood_at INTEGER,
    updated_at INTEGER
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS observer_active_map (
    telegram_id INTEGER PRIMARY KEY,
    chat_id INTEGER NOT NULL,
    entered_at INTEGER NOT NULL,
    username TEXT
  );
`);



  // ثبت هویت: /rpidentity شناسه کدشخصیت نامشخصیت


  // ذخیره عکس کارت: مالک باید به پیام عکس پاسخ دهد.

  // تأیید هویت: /rpidentityapprove شناسه

// مدیریت پایدار نیازهای شخصیت
function ensureNeeds(telegramId) {
  db.prepare(`
    INSERT OR IGNORE INTO observer_needs (telegram_id, updated_at)
    VALUES (?, ?)
  `).run(telegramId, now());

  return db.prepare(`
    SELECT * FROM observer_needs WHERE telegram_id = ?
  `).get(telegramId);
}

function updateNeed(telegramId, field) {
  const allowedFields = {
    food: "last_food_at",
    sleep: "last_sleep_at",
    blood: "last_blood_at"
  };

  const column = allowedFields[field];
  if (!column) throw new Error("Unknown need field");

  ensureNeeds(telegramId);
  db.prepare(`
    UPDATE observer_needs
    SET ${column} = ?, updated_at = ?
    WHERE telegram_id = ?
  `).run(now(), now(), telegramId);
}

export function registerObserver(bot) {

  bot.command("rpidentity", async ctx => {
    if (!isOwner(ctx)) {
      return ctx.reply("⛔ این دستور فقط برای مالک ربات است.");
    }

    const parts = (ctx.match || "").trim().split(/\s+/);
    const telegramId = Number(parts.shift());
    const characterCode = parts.shift();
    const characterName = parts.join(" ");

    if (!Number.isSafeInteger(telegramId) || telegramId <= 0 ||
        !characterCode || !characterName) {
      return ctx.reply(
        "روش استفاده:\n/rpidentity شناسه_تلگرام کد_شخصیت نام_شخصیت"
      );
    }

    db.prepare(`
      INSERT INTO observer_identity
        (telegram_id, character_code, character_name, approved, updated_at)
      VALUES (?, ?, ?, 0, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        character_code = excluded.character_code,
        character_name = excluded.character_name,
        approved = 0,
        updated_at = excluded.updated_at
    `).run(telegramId, characterCode, characterName, now());

    audit(ctx.from.id, "identity_created", `telegram_id=${telegramId}`);

    return ctx.reply(
      `✅ اطلاعات هویت ثبت شد.\nشناسه: ${telegramId}\nکد شخصیت: ${escapeHtml(characterCode)}\nنام شخصیت: ${escapeHtml(characterName)}\n\nوضعیت فعلی: در انتظار تأیید`
    );
  });

  bot.command("rpidentityphoto", async ctx => {
    if (!isOwner(ctx)) {
      return ctx.reply("⛔ این دستور فقط برای مالک ربات است.");
    }

    const targetId = Number((ctx.match || "").trim());
    const replied = ctx.msg.reply_to_message;
    const photos = replied?.photo;
    const document = replied?.document;

    let fileId = null;

    if (photos?.length) {
      fileId = photos[photos.length - 1].file_id;
    } else if (
      document?.mime_type &&
      document.mime_type.startsWith("image/")
    ) {
      fileId = document.file_id;
    }

    if (!Number.isSafeInteger(targetId) || targetId <= 0 || !fileId) {
      return ctx.reply(
        "روش استفاده:\nابتدا به پیام عکس کارت پاسخ بده و بنویس:\n/rpidentityphoto شناسه_تلگرام"
      );
    }

    const result = db.prepare(`
      UPDATE observer_identity
      SET photo_file_id = ?, updated_at = ?
      WHERE telegram_id = ?
    `).run(fileId, now(), targetId);

    if (!result.changes) {
      return ctx.reply(
        "❌ ابتدا اطلاعات شخصیت را با /rpidentity ثبت کن."
      );
    }

    audit(ctx.from.id, "identity_photo_updated",
      `telegram_id=${targetId}`);

    return ctx.reply(
      `✅ عکس کارت به پروندهٔ کاربر ${targetId} متصل شد.`
    );
  });

  bot.command("rpidentityapprove", async ctx => {
    if (!isOwner(ctx)) {
      return ctx.reply("⛔ این دستور فقط برای مالک ربات است.");
    }

    const telegramId = Number((ctx.match || "").trim());

    if (!Number.isSafeInteger(telegramId) || telegramId <= 0) {
      return ctx.reply("روش استفاده: /rpidentityapprove شناسه_تلگرام");
    }

    const result = db.prepare(`
      UPDATE observer_identity
      SET approved = 1, updated_at = ?
      WHERE telegram_id = ?
    `).run(now(), telegramId);

    if (!result.changes) {
      return ctx.reply("❌ برای این شناسه اطلاعات هویتی ثبت نشده است.");
    }

    audit(ctx.from.id, "identity_approved", `telegram_id=${telegramId}`);

    return ctx.reply(`✅ هویت کاربر ${telegramId} تأیید شد.`);
  });


  // MONTADORIA_RACE_SYSTEM_V1
  db.exec(`
    CREATE TABLE IF NOT EXISTS observer_races (
      telegram_id INTEGER PRIMARY KEY,
      race TEXT NOT NULL,
      assigned_by INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_blood_reminder_at INTEGER NOT NULL DEFAULT 0
    )
  `);

  // تبدیل زمان‌های متنی قدیمی به زمان عددی یونیکس
  const normalizeUnixSeconds = value => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.floor(value);
    }
    if (typeof value !== "string" || !value.trim()) return null;

    const numeric = Number(value);
    if (Number.isFinite(numeric)) return Math.floor(numeric);

    const milliseconds = Date.parse(value);
    return Number.isFinite(milliseconds)
      ? Math.floor(milliseconds / 1000)
      : null;
  };

  const normalizeTimestampColumn = (table, column) => {
    const rows = db.prepare(
      `SELECT telegram_id, ${column} AS value
       FROM ${table}
       WHERE typeof(${column}) = 'text'`
    ).all();

    const update = db.prepare(
      `UPDATE ${table} SET ${column} = ? WHERE telegram_id = ?`
    );

    for (const row of rows) {
      const timestamp = normalizeUnixSeconds(row.value);
      if (timestamp !== null) {
        update.run(timestamp, row.telegram_id);
      }
    }
  };

  normalizeTimestampColumn("observer_races", "updated_at");
  normalizeTimestampColumn("observer_races", "last_blood_reminder_at");
  normalizeTimestampColumn("observer_needs", "last_blood_at");

  const raceAliases = {
    "انسان": "انسان",
    "human": "انسان",
    "خون‌آشام": "خون‌آشام",
    "خون آشام": "خون‌آشام",
    "vampire": "خون‌آشام",
    "گرگینه": "گرگینه",
    "werewolf": "گرگینه",
    "تغییرشکل‌دهنده": "تغییرشکل‌دهنده",
    "تغییر شکل دهنده": "تغییرشکل‌دهنده",
    "shapeshifter": "تغییرشکل‌دهنده"
  };

  const canViewRaces = (ctx) => {
    if (isOwner(ctx)) return true;
    const row = db.prepare(
      "SELECT role FROM users WHERE telegram_id = ?"
    ).get(ctx.from.id);
    return !!row && [
      "moderator", "owner", "مدیر / ناظر", "مالک", "ناظر"
    ].includes(String(row.role || "").trim().toLowerCase());
  };

  // مشاهده نژادها فقط از پی‌وی و برای مالک/ناظران
  bot.command("rpraces", async ctx => {
    if (ctx.chat.type !== "private") {
      await ctx.reply("🔒 برای حفظ محرمانگی، این دستور را در پی‌وی ربات اجرا کن.");
      return;
    }

    if (!canViewRaces(ctx)) {
      await ctx.reply("⛔ اجازهٔ مشاهدهٔ اطلاعات محرمانهٔ نژادها را نداری.");
      return;
    }

    const arg = String(ctx.match || "").trim();

    if (arg && /^\d+$/.test(arg)) {
      const targetId = Number(arg);
      const row = db.prepare(`
        SELECT r.telegram_id, r.race, r.updated_at,
               u.username, u.display_name
        FROM observer_races r
        LEFT JOIN users u ON u.telegram_id = r.telegram_id
        WHERE r.telegram_id = ?
      `).get(targetId);

      if (!row) {
        await ctx.reply("برای این شناسه هنوز نژادی ثبت نشده است.");
        return;
      }

      await ctx.reply(
        `🔒 اطلاعات محرمانهٔ نژاد\n` +
        `شناسه: ${row.telegram_id}\n` +
        `نام: ${row.display_name || "ثبت نشده"}\n` +
        `نام کاربری: ${row.username ? "@" + row.username : "ندارد"}\n` +
        `نژاد: ${row.race}\n` +
        `آخرین ثبت: ${row.updated_at}`
      );
      return;
    }

    const rows = db.prepare(`
      SELECT r.telegram_id, r.race, u.username, u.display_name
      FROM observer_races r
      LEFT JOIN users u ON u.telegram_id = r.telegram_id
      ORDER BY r.updated_at DESC
      LIMIT 50
    `).all();

    if (!rows.length) {
      await ctx.reply("هنوز نژادی ثبت نشده است.\nبرای مشاهدهٔ یک نفر: /rpraces شناسه");
      return;
    }

    const output = rows.map(row =>
      `• ${row.display_name || "بدون نام"} | شناسه: ${row.telegram_id}` +
      ` | ${row.username ? "@" + row.username + " | " : ""}${row.race}`
    );

    await ctx.reply(
      "🔒 فهرست محرمانهٔ نژادها (حداکثر ۵۰ مورد):\n\n" +
      output.join("\n") +
      "\n\nمشاهدهٔ یک نفر: /rpraces شناسه"
    );
  });

  // تعیین یا تغییر نژاد فقط برای مالک و فقط از پی‌وی
  bot.command("rpraceset", async ctx => {
    if (ctx.chat.type !== "private") {
      await ctx.reply("🔒 این دستور را در پی‌وی ربات اجرا کن.");
      return;
    }

    if (!isOwner(ctx)) {
      await ctx.reply("⛔ فقط مالک می‌تواند نژاد را تعیین یا تغییر دهد.");
      return;
    }

    const args = String(ctx.match || "").trim().split(/\s+/);
    const targetId = Number(args.shift());
    const rawRace = args.join(" ").trim();
    const race = raceAliases[rawRace.toLowerCase()] || raceAliases[rawRace];

    if (!Number.isSafeInteger(targetId) || targetId <= 0 || !race) {
      await ctx.reply(
        "روش استفاده:\n/rpraceset شناسه نژاد\n\n" +
        "نژادهای مجاز:\n" +
        "انسان، خون‌آشام، گرگینه، تغییرشکل‌دهنده\n\n" +
        "نمونه:\n/rpraceset 123456789 خون‌آشام"
      );
      return;
    }

    const target = db.prepare(
      "SELECT telegram_id FROM users WHERE telegram_id = ?"
    ).get(targetId);

    if (!target) {
      await ctx.reply("این شناسه در دیتابیس کاربران پیدا نشد.");
      return;
    }

    const currentTime = Math.floor(Date.now() / 1000);

    db.prepare(`
      INSERT INTO observer_races
        (telegram_id, race, assigned_by, updated_at, last_blood_reminder_at)
      VALUES (?, ?, ?, ?, 0)
      ON CONFLICT(telegram_id) DO UPDATE SET
        race = excluded.race,
        assigned_by = excluded.assigned_by,
        updated_at = excluded.updated_at,
        last_blood_reminder_at = 0
    `).run(targetId, race, ctx.from.id, currentTime);

    if (race === "خون‌آشام") {
      db.prepare(`
        INSERT OR IGNORE INTO observer_needs
          (telegram_id, last_blood_at, updated_at)
        VALUES (?, ?, ?)
      `).run(targetId, currentTime, currentTime);

      db.prepare(`
        UPDATE observer_needs
        SET last_blood_at = ?, updated_at = ?
        WHERE telegram_id = ?
      `).run(currentTime, currentTime, targetId);
    }

    await report(
      ctx.api,
      `🔐 تغییر نژاد | شناسه: ${targetId} | نژاد: ${race} | مالک: ${ctx.from.id}`
    );

    await ctx.reply(
      `✅ نژاد کاربر ${targetId} ثبت شد: ${race}\n` +
      (race === "خون‌آشام"
        ? "🩸 شمارش یادآوری خصوصی خون از همین لحظه آغاز شد."
        : "اطلاعات نژاد برای کاربران عادی نمایش داده نمی‌شود.")
    );
  });

  // یادآوری خون‌آشام‌ها هر ۱۲ ساعت؛ پیام فقط در پی‌وی خود شخص
  const checkVampireBloodReminders = async () => {
    const currentTime = Math.floor(Date.now() / 1000);
    const twelveHoursAgo = currentTime - 12 * 60 * 60;

    const dueUsers = db.prepare(`
      SELECT r.telegram_id,
             COALESCE(n.last_blood_at, r.updated_at) AS last_blood_at
      FROM observer_races r
      LEFT JOIN observer_needs n ON n.telegram_id = r.telegram_id
      WHERE r.race = 'خون‌آشام'
        AND COALESCE(n.last_blood_at, r.updated_at) <= ?
        AND COALESCE(r.last_blood_reminder_at, 0) <= ?
    `).all(twelveHoursAgo, twelveHoursAgo);

    for (const person of dueUsers) {
      let sent = false;
      try {
        await bot.api.sendMessage(
          person.telegram_id,
          "🩸 یادآوری مونتادوریا\n\n" +
          "زمان نوشیدن خون رسیده است. پس از انجام آن، در گروه نقش‌آفرینی هشتگ #خون را ثبت کن.\n" +
          "این پیام خصوصی است؛ برای ثبت وضعیت، هشتگ را در پی‌وی ربات نفرست."
        );
        sent = true;
      } catch (error) {
        console.error("ارسال یادآوری خون ناموفق بود:", person.telegram_id, error);
        await report(
          bot.api,
          `⚠️ ارسال پی‌وی یادآوری خون ناموفق بود | شناسه: ${person.telegram_id} | ممکن است کاربر هنوز ربات را /start نکرده باشد.`
        );
      }

      db.prepare(`
        UPDATE observer_races
        SET last_blood_reminder_at = ?
        WHERE telegram_id = ? AND race = 'خون‌آشام'
      `).run(currentTime, person.telegram_id);

      if (sent) {
        await report(
          bot.api,
          `🩸 یادآوری خصوصی خون ارسال شد | شناسه: ${person.telegram_id}`
        );
      }
    }
  };


  // MONTADORIA_FOOD_REMINDER_V1
  try {
    db.exec("ALTER TABLE observer_needs ADD COLUMN last_food_warning_at INTEGER");
  } catch (e) {
    if (!String(e.message).includes("duplicate column")) throw e;
  }

  const foodTimestampToUnix = value => {
    if (value === null || value === undefined || value === "") return 0;

    const raw = String(value).trim();

    if (/^[+-]?\d+(?:\.\d+)?$/.test(raw)) {
      const numeric = Number(raw);
      if (!Number.isFinite(numeric) || numeric <= 0) return 0;
      return Math.floor(numeric > 1e12 ? numeric / 1000 : numeric);
    }

    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
  };

  let foodReminderCheckRunning = false;

  const checkFoodReminders = async () => {
    if (foodReminderCheckRunning) return;
    foodReminderCheckRunning = true;

    try {
      const currentTime = Math.floor(Date.now() / 1000);

      const people = db.prepare(`
        SELECT
          n.telegram_id,
          n.last_food_at,
          n.last_food_warning_at,
          m.chat_id
        FROM observer_needs n
        INNER JOIN observer_active_map m
          ON m.telegram_id = n.telegram_id
        WHERE n.last_food_at IS NOT NULL
      `).all();

      for (const person of people) {
        const telegramId = Number(person.telegram_id);
        const chatId = Number(person.chat_id);
        const lastFoodAt = foodTimestampToUnix(person.last_food_at);
        const lastWarningAt = foodTimestampToUnix(
          person.last_food_warning_at
        );

        // هشدار اول: ۸ ساعت پس از آخرین غذای ثبت‌شده
        if (!lastFoodAt || currentTime - lastFoodAt < 8 * 3600) {
          continue;
        }

        // هشدارهای بعدی: هر ۴ ساعت
        if (
          lastWarningAt > 0 &&
          currentTime - lastWarningAt < 4 * 3600
        ) {
          continue;
        }

        try {
          await bot.api.sendMessage(
            chatId,
            "🍽️ <b>یادآوری غذا</b>\n\n" +
            `شناسه کاربر: <code>${telegramId}</code>\n` +
            "مدت زیادی از آخرین غذای این شخصیت گذشته است.\n" +
            "برای ثبت غذا، در همین گروه از <code>#خوردن</code> استفاده کن.",
            { parse_mode: "HTML" }
          );

          db.prepare(`
            UPDATE observer_needs
            SET last_food_warning_at = ?, updated_at = ?
            WHERE telegram_id = ?
          `).run(currentTime, currentTime, telegramId);

          await report(
            bot.api,
            `🍽️ هشدار غذا ارسال شد | شناسه: ${telegramId} | گروه: ${chatId}`
          );
        } catch (error) {
          console.error(
            "ارسال یادآوری غذا ناموفق بود:",
            telegramId,
            chatId,
            error.message || error
          );
        }
      }
    } finally {
      foodReminderCheckRunning = false;
    }
  };

  // بررسی هر ۱۰ دقیقه؛ خود هشدارها با فاصله چندساعته ارسال می‌شوند.
  const foodReminderTimer = setInterval(() => {
    checkFoodReminders().catch(console.error);
  }, 10 * 60 * 1000);

  foodReminderTimer.unref?.();
  checkFoodReminders().catch(console.error);
  // END MONTADORIA_FOOD_REMINDER_V1

  const vampireReminderTimer = setInterval(() => {
    checkVampireBloodReminders().catch(error =>
      console.error("خطا در یادآوری خون‌آشام‌ها:", error)
    );
  }, 60_000);
  vampireReminderTimer.unref?.();
  checkVampireBloodReminders().catch(console.error);

  const restoreTimer = setInterval(() => {
    restoreExpiredRestrictions(bot).catch(error =>
      console.error("Restriction restore error:", error)
    );
  }, 60_000);
  restoreTimer.unref?.();
  restoreExpiredRestrictions(bot).catch(console.error);

  // گروه‌ها فقط با دستور مالک ثبت می‌شوند.
  bot.command("rpadd", async ctx => {
    if (!isOwner(ctx)) {
      return ctx.reply("⛔ این دستور فقط برای مالک ربات است.");
    }

    if (!isGroup(ctx.chat)) {
      return ctx.reply("این دستور را داخل گروه موردنظر اجرا کن.");
    }

    db.prepare(`
      INSERT INTO rp_groups (chat_id, title, active, added_by, created_at)
      VALUES (?, ?, 1, ?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET
        title = excluded.title,
        active = 1,
        added_by = excluded.added_by
    `).run(
      ctx.chat.id,
      ctx.chat.title || "",
      ctx.from.id,
      now()
    );

    audit(ctx.from.id, "rp_group_add", `${ctx.chat.id}`);

    await ctx.reply("✅ این گروه به فهرست گروه‌های مجاز نقش‌آفرینی اضافه شد.");
    await report(
      ctx.api,
      `➕ گروه نقش‌آفرینی ثبت شد:\n${escapeHtml(ctx.chat.title || "")}\n` +
      `شناسه: <code>${ctx.chat.id}</code>`
    );
  });

  bot.command("rpremove", async ctx => {
    if (!isOwner(ctx)) {
      return ctx.reply("⛔ این دستور فقط برای مالک ربات است.");
    }

    if (!isGroup(ctx.chat)) {
      return ctx.reply("این دستور را داخل گروه موردنظر اجرا کن.");
    }

    db.prepare(`
      UPDATE rp_groups SET active = 0 WHERE chat_id = ?
    `).run(ctx.chat.id);

    audit(ctx.from.id, "rp_group_remove", `${ctx.chat.id}`);

    await ctx.reply("گروه از فهرست نظارت خارج شد.");
    await report(
      ctx.api,
      `➖ گروه از نظارت خارج شد: <code>${ctx.chat.id}</code>`
    );
  });

  bot.command("rpgroups", async ctx => {
    if (!isOwner(ctx)) {
      return ctx.reply("⛔ این دستور فقط برای مالک ربات است.");
    }

    const groups = db.prepare(`
      SELECT chat_id, title FROM rp_groups WHERE active = 1 ORDER BY title
    `).all();

    if (!groups.length) {
      return ctx.reply("هنوز هیچ گروهی برای نظارت ثبت نشده است.");
    }

    const output = groups.map((group, index) =>
      `${index + 1}. ${escapeHtml(group.title || "بدون عنوان")}\n` +
      `<code>${group.chat_id}</code>`
    ).join("\n\n");

    await ctx.reply(`📋 <b>گروه‌های تحت نظارت</b>\n\n${output}`, {
      parse_mode: "HTML"
    });
  });


  // مدیریت گروه‌های چت آزاد ـ فقط مالک

  bot.command("freechatadd", async ctx => {
    if (!isOwner(ctx.from?.id)) {
      await ctx.reply("⛔ این دستور فقط برای مالک است.");
      return;
    }

    if (!["group", "supergroup"].includes(ctx.chat?.type)) {
      await ctx.reply("این دستور را داخل گروه موردنظر اجرا کن.");
      return;
    }

    const chatId = ctx.chat.id;
    const title = String(ctx.chat.title || chatId).replace(/\s+/g, " ").trim();

    db.prepare(`
      INSERT INTO free_chat_groups
        (chat_id, title, active, added_by, created_at)
      VALUES (?, ?, 1, ?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET
        title = excluded.title,
        active = 1,
        added_by = excluded.added_by,
        created_at = excluded.created_at
    `).run(chatId, title, ctx.from.id, now());

    db.prepare(
      "UPDATE rp_groups SET active = 0 WHERE chat_id = ?"
    ).run(chatId);

    await ctx.reply("✅ این گروه به فهرست چت‌های آزاد اضافه شد.");
  });

  bot.command("freechatremove", async ctx => {
    if (!isOwner(ctx.from?.id)) {
      await ctx.reply("⛔ این دستور فقط برای مالک است.");
      return;
    }

    if (!["group", "supergroup"].includes(ctx.chat?.type)) {
      await ctx.reply("این دستور را داخل همان گروه اجرا کن.");
      return;
    }

    const result = db.prepare(`
      UPDATE free_chat_groups
      SET active = 0
      WHERE chat_id = ? AND active = 1
    `).run(ctx.chat.id);

    await ctx.reply(
      result.changes
        ? "✅ گروه از فهرست چت‌های آزاد حذف شد."
        : "این گروه در فهرست فعال چت آزاد نیست."
    );
  });

  bot.command("freechatgroups", async ctx => {
    if (!isOwner(ctx.from?.id)) {
      await ctx.reply("⛔ این دستور فقط برای مالک است.");
      return;
    }

    const rows = db.prepare(`
      SELECT chat_id, title
      FROM free_chat_groups
      WHERE active = 1
      ORDER BY title COLLATE NOCASE
    `).all();

    if (!rows.length) {
      await ctx.reply("هنوز گروه چت آزادی ثبت نشده است.");
      return;
    }

    const lines = rows.map(
      (row, i) => `${i + 1}. ${escapeHtml(row.title)} — ${row.chat_id}`
    );

    await ctx.reply("📋 فهرست گروه‌های چت آزاد:\n\n" + lines.join("\n"));
  });

  // رفع دستی سکوت یک کاربر در گروه‌های نقش‌آفرینی
  bot.command("rpunmute", async ctx => {
    if (!isOwner(ctx)) {
      return ctx.reply("⛔ این دستور فقط برای مالک ربات است.");
    }

    const targetId = Number((ctx.match || "").trim());

    if (!Number.isSafeInteger(targetId) || targetId <= 0) {
      return ctx.reply("روش استفاده: /rpunmute شناسه_تلگرام");
    }

    const groups = db.prepare(`
      SELECT chat_id, title
      FROM rp_groups
      WHERE active = 1
    `).all();

    if (!groups.length) {
      return ctx.reply("⚠️ هیچ گروه نقش‌آفرینی فعالی ثبت نشده است.");
    }

    const successful = [];
    const failed = [];

    const allowAllPermissions = {
      can_send_messages: true,
      can_send_audios: true,
      can_send_documents: true,
      can_send_photos: true,
      can_send_videos: true,
      can_send_video_notes: true,
      can_send_voice_notes: true,
      can_send_polls: true,
      can_send_other_messages: true,
      can_add_web_page_previews: true
    };

    for (const group of groups) {
      try {
        const chat = await ctx.api.getChat(group.chat_id);
        const defaults = chat.permissions;

        // در صورت وجود مجوزهای پیش‌فرض گروه، همان‌ها بازگردانده می‌شوند.
        const permissions = defaults
          ? Object.fromEntries(
              Object.keys(allowAllPermissions).map(key => [
                key,
                defaults[key] === true
              ])
            )
          : { ...allowAllPermissions };

        await ctx.api.restrictChatMember(
          group.chat_id,
          targetId,
          permissions
        );

        successful.push(group);
      } catch (error) {
        failed.push({
          chat_id: group.chat_id,
          title: group.title || String(group.chat_id),
          message: error.message
        });
      }
    }

    // فقط وقتی رفع محدودیت در تمام گروه‌ها موفق بود،
    // رکوردهای محدودیت فعال در پایگاه داده بسته می‌شوند.
    if (failed.length === 0) {
      db.prepare(`
        UPDATE observer_restrictions
        SET restored_at = ?
        WHERE telegram_id = ? AND restored_at IS NULL
      `).run(now(), targetId);
    }

    audit(
      ctx.from.id,
      "manual_unmute",
      `telegram_id=${targetId};success=${successful.length};failed=${failed.length}`
    );

    const failureDetails = failed.length
      ? "\\n\\n<b>گروه‌های ناموفق:</b>\\n" +
        failed.map(group =>
          `${escapeHtml(group.title)}: ${escapeHtml(group.message)}`
        ).join("\\n")
      : "";

    await report(
      ctx.api,
      `🔊 <b>گزارش رفع سکوت دستی</b>\\n` +
      `کاربر: <code>${targetId}</code>\\n` +
      `موفق: ${successful.length} از ${groups.length} گروه\\n` +
      `ناموفق: ${failed.length}` +
      failureDetails
    );

    return ctx.reply(
      `🔊 نتیجه رفع سکوت کاربر ${targetId}\\n` +
      `✅ موفق: ${successful.length} گروه\\n` +
      `❌ ناموفق: ${failed.length} گروه` +
      (failed.length
        ? "\\nبرای گروه‌های ناموفق، گزارش و خطا بررسی شود."
        : "\\nمحدودیت‌های ثبت‌شده با موفقیت برداشته شدند.")
    );
  });


  // پاک‌کردن اخطارهای فعال یک کاربر: /rpclear ID
  bot.command("rpclear", async ctx => {
    if (!isOwner(ctx)) {
      return ctx.reply("⛔ این دستور فقط برای مالک ربات است.");
    }

    const targetId = Number((ctx.match || "").trim());

    if (!Number.isSafeInteger(targetId) || targetId <= 0) {
      return ctx.reply("روش استفاده: /rpclear شناسه_تلگرام");
    }

    const result = db.prepare(`
      UPDATE observer_warnings
      SET active = 0, cleared_at = ?
      WHERE telegram_id = ? AND active = 1
    `).run(now(), targetId);

    audit(ctx.from.id, "warnings_cleared",
      `telegram_id=${targetId};count=${result.changes}`);

    await report(
      ctx.api,
      `🧾 <b>پاک‌سازی اخطارها</b>\n` +
      `کاربر: <code>${targetId}</code>\n` +
      `اخطارهای پاک‌شده: ${result.changes}\n` +
      `مدیر: <code>${ctx.from.id}</code>`
    );

    return ctx.reply(
      `✅ اخطارهای فعال کاربر ${targetId} پاک شد. تعداد: ${result.changes}`
    );
  });


  // نمایش اخطارهای فعال یک کاربر: /rpwarnings ID
  bot.command("rpwarnings", async ctx => {
    if (!isOwner(ctx)) {
      return ctx.reply("⛔ این دستور فقط برای مالک ربات است.");
    }

    const targetId = Number((ctx.match || "").trim());

    if (!Number.isSafeInteger(targetId) || targetId <= 0) {
      return ctx.reply("روش استفاده: /rpwarnings شناسه_تلگرام");
    }

    const rows = db.prepare(`
      SELECT id, chat_id, reason, created_at
      FROM observer_warnings
      WHERE telegram_id = ? AND active = 1
      ORDER BY id DESC
      LIMIT 20
    `).all(targetId);

    if (!rows.length) {
      return ctx.reply(`✅ کاربر ${targetId} اخطار فعالی ندارد.`);
    }

    const output = rows.map((row, index) =>
      `${index + 1}. اخطار #${row.id}\n` +
      `گروه: ${row.chat_id}\n` +
      `علت: ${escapeHtml(row.reason)}\n` +
      `زمان: ${row.created_at}`
    ).join("\n\n");

    return ctx.reply(
      `📋 اخطارهای فعال کاربر ${targetId}\n` +
      `تعداد فعال: ${getActiveWarnings(targetId)}\n\n${output}`
    );
  });


  // پنل اولیه تنظیمات ناظر
  bot.command("rpsettings", async ctx => {
    if (!isOwner(ctx)) {
      return ctx.reply("⛔ دسترسی فقط برای مالک ربات مجاز است.");
    }

    const groups = db.prepare(`
      SELECT chat_id, title
      FROM rp_groups
      WHERE active = 1
      ORDER BY title
    `).all();

    const groupList = groups.length
      ? groups.map((g, i) =>
          `${i + 1}. ${escapeHtml(g.title || "بدون نام")} — <code>${g.chat_id}</code>`
        ).join("\n")
      : "هیچ گروهی ثبت نشده است.";

    const activeWarnings = db.prepare(`
      SELECT COUNT(*) AS total
      FROM observer_warnings
      WHERE active = 1
    `).get().total;

    return ctx.reply(
      `⚙️ <b>تنظیمات ناظر مونتادوریا</b>\n\n` +
      `حد اخطار: ${WARNING_LIMIT}\n` +
      `مدت محدودیت: ${RESTRICTION_MINUTES} دقیقه\n` +
      `گروه گزارش: ${OBSERVER_GROUP_ID ?? "تنظیم نشده"}\n` +
      `گروه‌های فعال: ${groups.length}\n` +
      `اخطارهای فعال: ${activeWarnings}\n\n` +
      `<b>گروه‌های ثبت‌شده:</b>\n${groupList}\n\n` +
      `دستورات مدیریت:\n` +
      `/rpadd — ثبت گروه فعلی\n` +
      `/rpremove — غیرفعال‌کردن گروه فعلی\n` +
      `/rpgroups — فهرست گروه‌ها\n` +
      `/freechatadd — ثبت گروه چت آزاد\n` +
      `/freechatremove — حذف گروه چت آزاد\n` +
      `/freechatgroups — فهرست چت‌های آزاد\n` +
      `/rpwarnings شناسه — مشاهده اخطارها\n` +
      `/rpclear شناسه — پاک‌کردن اخطارها\n` +
      `/rpstatus — وضعیت کلی`,
      { parse_mode: "HTML" }
    );
  });

  bot.command("rpstatus", async ctx => {
    if (!isOwner(ctx)) {
      return ctx.reply("⛔ این دستور فقط برای مالک ربات است.");
    }

    const groups = db.prepare(`
      SELECT COUNT(*) AS total FROM rp_groups WHERE active = 1
    `).get().total;

    const warnings = db.prepare(`
      SELECT COUNT(*) AS total
      FROM observer_warnings WHERE active = 1
    `).get().total;

    await ctx.reply(
      `📊 وضعیت ناظر مونتادوریا\n` +
      `گروه‌های فعال: ${groups}\n` +
      `اخطارهای فعال: ${warnings}\n` +
      `حد اخطار: ${WARNING_LIMIT}\n` +
      `گروه گزارش: ${OBSERVER_GROUP_ID ?? "تنظیم نشده"}`
    );
  });

  // بررسی تغییر یوزرنیم اعضا
  bot.on("message", async ctx => {
    if (!isGroup(ctx.chat) || !ctx.from || ctx.from.is_bot) return;
    if (!isRegistered(ctx.chat.id)) return;

    const user = ctx.from;
    const existing = db.prepare(`
      SELECT username FROM users WHERE telegram_id = ?
    `).get(user.id);

    const newUsername = user.username || null;

    if (existing && (existing.username || null) !== newUsername) {
      db.prepare(`
        INSERT INTO observer_username_history
          (telegram_id, old_username, new_username, changed_at)
        VALUES (?, ?, ?, ?)
      `).run(
        user.id,
        existing.username || null,
        newUsername,
        now()
      );

      await report(
        ctx.api,
        `🔄 <b>تغییر یوزرنیم</b>\n` +
        `کاربر: <code>${user.id}</code>\n` +
        `قبلی: ${escapeHtml(existing.username || "نداشت")}\n` +
        `جدید: ${escapeHtml(newUsername || "ندارد")}\n` +
        `گروه: ${escapeHtml(ctx.chat.title || String(ctx.chat.id))}`
      );

      db.prepare(`
        UPDATE users
        SET username = ?, updated_at = ?
        WHERE telegram_id = ?
      `).run(newUsername, now(), user.id);
    }

    // درخواست پنل با پیام ساده role
    if ((ctx.msg.text || "").trim().toLowerCase() === "role") {
      const dbUser = db.prepare(`
        SELECT display_name, job, money, bank, xp, level, role
        FROM users WHERE telegram_id = ?
      `).get(user.id);

      if (!dbUser) {
        return ctx.reply("ابتدا در سیستم مونتادوریا ثبت‌نام کن.");
      }

      const identity = db.prepare(`
        SELECT character_code, character_name, approved, photo_file_id
        FROM observer_identity
        WHERE telegram_id = ?
      `).get(user.id);

      const identityText =
        `🪪 <b>پروندهٔ نقش‌آفرینی</b>\n\n` +
        (identity?.approved
          ? `کد شخصیت: ${escapeHtml(identity.character_code || "ثبت نشده")}\nنام شخصیت: ${escapeHtml(identity.character_name || "ثبت نشده")}\n\n`
          : "هویت شخصیت هنوز تأیید نشده است.\n\n") +
        `نام: ${escapeHtml(dbUser.display_name)}\n` +
        `شناسه تلگرام: <code>${user.id}</code>\n` +
        `شغل: ${escapeHtml(dbUser.job || "بدون شغل")}\n` +
        `پول: ${dbUser.money}\n` +
        `بانک: ${dbUser.bank}\n` +
        `تجربه: ${dbUser.xp}\n` +
        `سطح: ${dbUser.level}\n` +
        `نقش سامانه: ${escapeHtml(dbUser.role)}\n\n` +
        `اطلاعات نژاد در این پنل نمایش داده نمی‌شود.`;

      if (identity?.approved && identity.photo_file_id) {
        try {
          return await ctx.replyWithPhoto(identity.photo_file_id, {
            caption: identityText,
            parse_mode: "HTML"
          });
        } catch (error) {
          console.error("Identity card photo failed:", error.message);
        }
      }

      return ctx.reply(identityText, { parse_mode: "HTML" });
    }

    const text = ctx.msg.text;
    if (!text || text.startsWith("/")) return;

    // محدودیت پیام هنگام خواب: فقط ورود و خروج مجاز است
const currentSleep = db.prepare(`
  SELECT sleep_until
  FROM observer_needs
  WHERE telegram_id = ?
`).get(user.id);

const currentUnixTime = Math.floor(Date.now() / 1000);
const sleepCommand = text.trim().split(/\s+/)[0];

if (
  Number(currentSleep?.sleep_until || 0) > currentUnixTime &&
  !["#ورود", "#خروج"].includes(sleepCommand)
) {
  try {
    await ctx.api.deleteMessage(ctx.chat.id, ctx.msg.message_id);
    await report(
      ctx.api,
      `🌙 پیام هنگام خواب حذف شد | کاربر: ${user.id} | گروه: ${ctx.chat.id}`
    );
  } catch (error) {
    console.error("Sleep message deletion failed:", error.message);
    await report(
      ctx.api,
      `⚠️ حذف پیام هنگام خواب ناموفق بود | کاربر: ${user.id} | گروه: ${ctx.chat.id} | ${error.message}`
    );
  }
  return;
}

// فرمان‌های هشتگی مجاز باید مستقل یا در خطوط جداگانه باشند.
    // مدیریت ورود و خروج مپ

    // MONTADORIA_BLOOD_TAG_V1
    const hasBloodTag = text.split(/\r?\n/).some(
      line => line.trim().split(/\s+/)[0] === "#خون"
    );
    if (hasBloodTag) {
      const bloodTime = Math.floor(Date.now() / 1000);
      db.prepare(`
        INSERT OR IGNORE INTO observer_needs
          (telegram_id, last_blood_at, updated_at)
        VALUES (?, ?, ?)
      `).run(user.id, bloodTime, bloodTime);
      db.prepare(`
        UPDATE observer_needs
        SET last_blood_at = ?, updated_at = ?
        WHERE telegram_id = ?
      `).run(bloodTime, bloodTime, user.id);

      db.prepare(`
        UPDATE observer_races
        SET last_blood_reminder_at = 0
        WHERE telegram_id = ? AND race = 'خون‌آشام'
      `).run(user.id);

      await report(
        ctx.api,
        `🩸 ثبت نوشیدن خون | کاربر: ${user.id} | گروه: ${ctx.chat.id}`
      );
    }

    const hasMapTag = tag => text.split(/\r?\n/).some(
      line => line.trim().split(/\s+/)[0] === tag
    );

    if (hasMapTag("#ورود")) {
      const activeMap = db.prepare(`
        SELECT chat_id FROM observer_active_map
        WHERE telegram_id = ?
      `).get(user.id);

      if (activeMap && Number(activeMap.chat_id) !== Number(ctx.chat.id)) {
        await ctx.reply(
          "⛔ هنوز از مپ قبلی خارج نشده‌ای. ابتدا در همان مپ #خروج بزن."
        );
        return;
      }

      if (!activeMap) {
        db.prepare(`
          INSERT INTO observer_active_map
            (telegram_id, chat_id, entered_at, username)
          VALUES (?, ?, ?, ?)
        `).run(user.id, ctx.chat.id, now(), user.username || null);

        await report(
          ctx.api,
          `🚪 ورود به مپ | کاربر: ${user.id} | گروه: ${ctx.chat.id}`
        );
      }
    }

    if (hasMapTag("#خروج")) {
      const activeMap = db.prepare(`
        SELECT chat_id FROM observer_active_map
        WHERE telegram_id = ?
      `).get(user.id);

      if (!activeMap || Number(activeMap.chat_id) !== Number(ctx.chat.id)) {
        await ctx.reply(
          "⛔ در این مپ حضور فعالی برای تو ثبت نشده است."
        );
        return;
      }

      db.prepare(`
        DELETE FROM observer_active_map
        WHERE telegram_id = ? AND chat_id = ?
      `).run(user.id, ctx.chat.id);

      await report(
        ctx.api,
        `🚪 خروج از مپ | کاربر: ${user.id} | گروه: ${ctx.chat.id}`
      );
    }

    // کنترل مپ فعال برای ثبت نیازها
    const needActionRequested = text.split(/\r?\n/).some(line => {
      const tag = line.trim().split(/\s+/)[0];
      return ["#خوردن", "#خوابیدن", "#خواب"].includes(tag);
    });

    if (needActionRequested) {
      const activeNeedMap = db.prepare(`
        SELECT chat_id
        FROM observer_active_map
        WHERE telegram_id = ?
      `).get(user.id);

      if (
        !activeNeedMap ||
        Number(activeNeedMap.chat_id) !== Number(ctx.chat.id)
      ) {
        await ctx.reply(
          "⛔ ثبت غذا و خواب فقط در مپی مجاز است که با #ورود در آن حضور داری."
        );
        return;
      }
    }

    // ثبت خودکار رویدادهای غذا و خواب
    const hasNeedTag = tag => text.split(/\\r?\\n/).some(
      line => line.trim().split(/\\s+/)[0] === tag
    );

    // تاریخچه غذا برای محدودیت هر ۸ ساعت یک‌بار
    db.exec(`
      CREATE TABLE IF NOT EXISTS observer_food_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id INTEGER NOT NULL,
        eaten_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_observer_food_log_user_time
      ON observer_food_log (telegram_id, eaten_at);
    `);

    const currentTime = now();

    if (hasNeedTag("#خوردن")) {
      const lastFood = db.prepare(`
        SELECT MAX(eaten_at) AS last_at
        FROM observer_food_log
        WHERE telegram_id = ?
      `).get(user.id).last_at;
      if (lastFood && currentTime - Number(lastFood) < 28800) {
        const remaining = Math.ceil((28800 - (currentTime - Number(lastFood))) / 3600);
        await ctx.reply(`⛔ برای ثبت غذای بعدی باید ۸ ساعت فاصله باشد. زمان باقی‌مانده: حدود ${remaining} ساعت.`);
      } else {
        db.prepare(`
          INSERT INTO observer_food_log (telegram_id, eaten_at)
          VALUES (?, ?)
        `).run(user.id, currentTime);

        updateNeed(user.id, "food");

        await report(
          ctx.api,
          `🍽️ ثبت غذا | کاربر: ${user.id} | فاصله مجاز: ۸ ساعت | گروه: ${ctx.chat.id}`
        );
      }
    }

    if (hasNeedTag("#خوابیدن") || hasNeedTag("#خواب")) {
      ensureNeeds(user.id);

      const personNeeds = db.prepare(`
        SELECT last_sleep_at
        FROM observer_needs
        WHERE telegram_id = ?
      `).get(user.id);

      const lastSleepAt = Number(personNeeds?.last_sleep_at || 0);

      if (lastSleepAt > 0 && currentTime - lastSleepAt < 86400) {
        const remainingHours = Math.ceil(
          (86400 - (currentTime - lastSleepAt)) / 3600
        );

        await ctx.reply(
          `⛔ در هر ۲۴ ساعت فقط یک بار می‌توانی خواب را ثبت کنی. حدود ${remainingHours} ساعت تا امکان ثبت خواب بعدی باقی مانده است.`
        );
      } else {
        const sleepHours = Math.max(
          1,
          Number(process.env.SLEEP_DURATION_HOURS || 6)
        );

        db.prepare(`
          UPDATE observer_needs
          SET last_sleep_at = ?, sleep_until = ?, updated_at = ?
          WHERE telegram_id = ?
        `).run(
          currentTime,
          currentTime + sleepHours * 3600,
          currentTime,
          user.id
        );

        await report(
          ctx.api,
          `🌙 ثبت خواب | کاربر: ${user.id} | مدت: ${sleepHours} ساعت | گروه: ${ctx.chat.id}`
        );
      }
    }



    const validation = validateRoleplay(text);

    if (!validation.ok) {
      await warn(ctx, validation.reason);
    }
  });
}
