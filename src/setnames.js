import db from "./database.js";

const OWNER_ID = Number(process.env.OWNER_ID || 0);

const CATEGORIES = Object.freeze({
  member: { symbol: "⌬", badge: "👤", label: "عضو عادی" },
  government: { symbol: "⛨", badge: "🏛️", label: "شغل دولتی" },
  police: { symbol: "⌘", badge: "👮", label: "پلیس و قضایی" },
  leadership: { symbol: "⟠", badge: "⚜️", label: "مدیریت مجموعه" },
});

const FAMILIES = Object.freeze({
  none: { symbol: "", label: "بدون خاندان" },
  bonds: { symbol: "♞", label: "BONDS" },
  blackwell: { symbol: "𓅃", label: "Blackwell" },
  velmora: { symbol: "𓃲", label: "Velmora" },
});

db.exec(`
  CREATE TABLE IF NOT EXISTS montadoria_setnames (
    telegram_id INTEGER PRIMARY KEY,
    latin_name TEXT,
    category_override TEXT DEFAULT NULL,
    family_key TEXT NOT NULL DEFAULT 'none',
    last_notified_tag TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS montadoria_setname_requests (
    telegram_id INTEGER PRIMARY KEY,
    chat_id INTEGER NOT NULL,
    prompt_message_id INTEGER,
    expires_at INTEGER NOT NULL
  );
`);

function timestamp() {
  return new Date().toISOString();
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "")
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .replace(/[\s_\-]+/g, " ")
    .trim()
    .toLowerCase();
}

function ensureRecord(telegramId) {
  db.prepare(`
    INSERT OR IGNORE INTO montadoria_setnames
      (telegram_id, updated_at)
    VALUES (?, ?)
  `).run(telegramId, timestamp());

  return db.prepare(`
    SELECT *
    FROM montadoria_setnames
    WHERE telegram_id = ?
  `).get(telegramId);
}

function getUser(telegramId) {
  return db.prepare(`
    SELECT telegram_id, username, display_name, job, role
    FROM users
    WHERE telegram_id = ?
    LIMIT 1
  `).get(telegramId);
}

function isOwner(ctx) {
  return Boolean(OWNER_ID && Number(ctx.from?.id) === OWNER_ID);
}

function categoryFromJob(job) {
  const value = normalize(job);

  if (/پلیس|کارآگاه|قاضی|وکیل|police|detective|judge|lawyer/.test(value)) {
    return "police";
  }

  if (/کارمند دولت|کارمند شهرداری|ثبت احوال|شغل دولتی|government|municipal/.test(value)) {
    return "government";
  }

  return "member";
}

function boldLatin(value) {
  return [...value].map((char) => {
    const code = char.codePointAt(0);

    if (code >= 65 && code <= 90) {
      return String.fromCodePoint(0x1D400 + code - 65);
    }

    if (code >= 97 && code <= 122) {
      return String.fromCodePoint(0x1D41A + code - 97);
    }

    return char;
  }).join("");
}

function unboldLatin(value) {
  let result = "";

  for (const char of value) {
    const code = char.codePointAt(0);

    if (code >= 0x1D400 && code <= 0x1D419) {
      result += String.fromCharCode(65 + code - 0x1D400);
    } else if (code >= 0x1D41A && code <= 0x1D433) {
      result += String.fromCharCode(97 + code - 0x1D41A);
    } else if (char === " " || char === "-" || char === "'") {
      result += char;
    } else {
      return null;
    }
  }

  return validLatinName(result) ? result : null;
}

function validLatinName(value) {
  const name = String(value ?? "").trim();

  return name.length >= 2 &&
    name.length <= 30 &&
    /^[A-Za-z]+(?:[ '-][A-Za-z]+)*$/.test(name);
}

function parseLegacyTag(user) {
  const text = [user?.first_name, user?.last_name]
    .filter(Boolean)
    .join(" ");

  const match = text.match(
    /(?:👤|🏛️|👮|⚜️)?\s*⟡𝐌(⌬|⛨|⌘|⟠)(♞|𓅃|𓃲)?([\u{1D400}-\u{1D433}]+(?:[ '-][\u{1D400}-\u{1D433}]+)*)/u
  );

  if (!match) return null;

  const category = {
    "⌬": "member",
    "⛨": "government",
    "⌘": "police",
    "⟠": "leadership",
  }[match[1]];

  const family = {
    "♞": "bonds",
    "𓅃": "blackwell",
    "𓃲": "velmora",
  }[match[2] || ""] || "none";

  const latinName = unboldLatin(match[3]);

  if (!category || !latinName) return null;

  return { category, family, latinName };
}

function importLegacyTagIfPresent(user) {
  const existing = db.prepare(`
    SELECT latin_name
    FROM montadoria_setnames
    WHERE telegram_id = ?
  `).get(user.id);

  if (existing?.latin_name) return;

  const parsed = parseLegacyTag(user);

  if (!parsed) return;

  db.prepare(`
    INSERT INTO montadoria_setnames
      (telegram_id, latin_name, category_override, family_key, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      latin_name = excluded.latin_name,
      category_override = excluded.category_override,
      family_key = excluded.family_key,
      updated_at = excluded.updated_at
  `).run(
    user.id,
    parsed.latinName,
    parsed.category,
    parsed.family,
    timestamp()
  );
}

function getTagData(telegramId) {
  const record = ensureRecord(telegramId);
  const user = getUser(telegramId);

  const categoryKey =
    record.category_override || categoryFromJob(user?.job);

  return {
    record,
    user,
    categoryKey,
    category: CATEGORIES[categoryKey] || CATEGORIES.member,
    family: FAMILIES[record.family_key] || FAMILIES.none,
  };
}

function formatTag(telegramId) {
  const data = getTagData(telegramId);

  if (!data.record.latin_name) return null;

  return `${data.category.badge} ⟡𝐌${data.category.symbol}${data.family.symbol}${boldLatin(data.record.latin_name)}`;
}

async function notifyIfTagChanged(ctx, telegramId) {
  const record = db.prepare(`
    SELECT latin_name, last_notified_tag
    FROM montadoria_setnames
    WHERE telegram_id = ?
  `).get(telegramId);

  if (!record?.latin_name) return;

  const currentTag = formatTag(telegramId);

  if (!currentTag || currentTag === record.last_notified_tag) return;

  await ctx.reply(
    `⚜️ ست‌اسم تو بر اساس جایگاه یا شغل ثبت‌شده به‌روزرسانی شد:\n\n${currentTag}\n\n` +
    "نام نمایشی تلگرام را خودت با این ست‌اسم جایگزین کن."
  );

  db.prepare(`
    UPDATE montadoria_setnames
    SET last_notified_tag = ?, updated_at = ?
    WHERE telegram_id = ?
  `).run(currentTag, timestamp(), telegramId);
}

function findUserIdByUsername(username) {
  const normalized = String(username || "")
    .replace(/^@/, "")
    .toLowerCase();

  if (!normalized) return null;

  const row = db.prepare(`
    SELECT telegram_id
    FROM users
    WHERE lower(replace(username, '@', '')) = ?
    LIMIT 1
  `).get(normalized);

  return row ? Number(row.telegram_id) : null;
}

function targetToken(token) {
  return /^\d{5,20}$/.test(token || "") ||
    /^@[A-Za-z0-9_]{5,32}$/.test(token || "");
}

function resolveTargetToken(token) {
  if (/^\d{5,20}$/.test(token || "")) return Number(token);

  if (String(token || "").startsWith("@")) {
    return findUserIdByUsername(token);
  }

  return null;
}

function parseOwnerArgs(ctx, rawArgs) {
  const tokens = String(rawArgs || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  let targetId = null;
  const remaining = [...tokens];
  const replyFrom = ctx.message?.reply_to_message?.from;

  let explicitIndex = -1;

  if (tokens.length && targetToken(tokens[0])) {
    explicitIndex = 0;
  } else if (tokens.length > 1 && targetToken(tokens[tokens.length - 1])) {
    explicitIndex = tokens.length - 1;
  }

  if (explicitIndex >= 0) {
    targetId = resolveTargetToken(tokens[explicitIndex]);
    remaining.splice(explicitIndex, 1);

    if (!targetId) {
      return {
        error: "❌ کاربر پیدا نشد. شناسه یا یوزرنیم را بررسی کن؛ می‌توانی به پیام همان کاربر هم ریپلای کنی.",
      };
    }
  } else if (replyFrom?.id && !replyFrom.is_bot) {
    targetId = Number(replyFrom.id);
  }

  if (!targetId) {
    return {
      error: "❌ هدف مشخص نیست. به پیام کاربر ریپلای کن یا شناسه تلگرام / @username او را در فرمان بنویس.",
    };
  }

  if (targetId === ctx.from.id) {
    return {
      error: "⛔ برای تغییر ست‌اسم خودت از درخواست عادی ست‌اسم استفاده کن.",
    };
  }

  return {
    targetId,
    choice: normalize(remaining.join(" ")),
  };
}

function categoryChoice(value) {
  const key = normalize(value);

  if (["عضو عادی", "عضو", "عادی", "member", "⌬"].includes(key)) {
    return "member";
  }

  if (["دولتی", "شغل دولتی", "کارمند دولت", "government", "⛨"].includes(key)) {
    return "government";
  }

  if (["پلیس", "قضایی", "پلیس و قضایی", "پلیس قضایی", "police", "⌘"].includes(key)) {
    return "police";
  }

  if (["مدیریت", "مدیریت مجموعه", "حلقه مدیریت", "عضو مدیریت", "leadership", "⟠"].includes(key)) {
    return "leadership";
  }

  if (["خودکار", "اتوماتیک", "بر اساس شغل", "auto"].includes(key)) {
    return null;
  }

  return undefined;
}

function familyChoice(value) {
  const key = normalize(value);

  if (["باندز", "bonds", "♞"].includes(key)) return "bonds";

  if (["بلک ول", "بلکول", "بلک ولل", "blackwell", "𓅃"].includes(key)) {
    return "blackwell";
  }

  if (["ولمورا", "velmora", "𓃲"].includes(key)) return "velmora";

  if (["بدون خاندان", "بدون", "هیچ", "none", "ندارد"].includes(key)) {
    return "none";
  }

  return undefined;
}

async function ownerSetCategory(ctx, rawArgs) {
  if (!isOwner(ctx)) {
    await ctx.reply("⛔ فقط مالک مونتادوریا اجازهٔ تعیین جایگاه ست‌اسم را دارد.");
    return;
  }

  const parsed = parseOwnerArgs(ctx, rawArgs);

  if (parsed.error) {
    await ctx.reply(parsed.error);
    return;
  }

  if (!parsed.choice) {
    await ctx.reply(
      "روش استفاده: به پیام کاربر ریپلای کن و بنویس «ست جایگاه مدیریت»."
    );
    return;
  }

  const key = categoryChoice(parsed.choice);

  if (key === undefined) {
    await ctx.reply("❌ جایگاه نامعتبر است: عضو عادی، دولتی، پلیس، مدیریت یا خودکار.");
    return;
  }

  ensureRecord(parsed.targetId);

  db.prepare(`
    UPDATE montadoria_setnames
    SET category_override = ?, updated_at = ?
    WHERE telegram_id = ?
  `).run(key, timestamp(), parsed.targetId);

  const data = getTagData(parsed.targetId);
  const tag = formatTag(parsed.targetId);

  if (tag) {
    db.prepare(`
      UPDATE montadoria_setnames
      SET last_notified_tag = ?, updated_at = ?
      WHERE telegram_id = ?
    `).run(tag, timestamp(), parsed.targetId);
  }

  await ctx.reply(
    `✅ جایگاه ست‌اسم به‌روزرسانی شد.\n` +
    `کاربر: ${parsed.targetId}\n` +
    `جایگاه: ${key === null ? "خودکار بر اساس شغل" : data.category.label}\n` +
    `نشان جایگاه: ${data.category.symbol}\n` +
    `نشان خاندان: ${data.family.symbol || "ندارد"}\n\n` +
    (tag ? `ست‌اسم جدید:\n${tag}` : "نام لاتین ثبت نشده است؛ کاربر باید «ست اسممو بده» را اجرا کند.")
  );
}

async function ownerSetFamily(ctx, rawArgs) {
  if (!isOwner(ctx)) {
    await ctx.reply("⛔ فقط مالک مونتادوریا اجازهٔ تعیین خاندان را دارد.");
    return;
  }

  const parsed = parseOwnerArgs(ctx, rawArgs);

  if (parsed.error) {
    await ctx.reply(parsed.error);
    return;
  }

  if (!parsed.choice) {
    await ctx.reply(
      "روش استفاده: به پیام کاربر ریپلای کن و بنویس «ست خاندان باندز»."
    );
    return;
  }

  const key = familyChoice(parsed.choice);

  if (key === undefined) {
    await ctx.reply("❌ خاندان نامعتبر است: باندز، بلک‌ول، ولمورا یا بدون خاندان.");
    return;
  }

  ensureRecord(parsed.targetId);

  db.prepare(`
    UPDATE montadoria_setnames
    SET family_key = ?, updated_at = ?
    WHERE telegram_id = ?
  `).run(key, timestamp(), parsed.targetId);

  const data = getTagData(parsed.targetId);
  const tag = formatTag(parsed.targetId);

  if (tag) {
    db.prepare(`
      UPDATE montadoria_setnames
      SET last_notified_tag = ?, updated_at = ?
      WHERE telegram_id = ?
    `).run(tag, timestamp(), parsed.targetId);
  }

  await ctx.reply(
    `✅ نشان خاندان به‌روزرسانی شد.\n` +
    `کاربر: ${parsed.targetId}\n` +
    `خاندان: ${data.family.label}\n` +
    `نشان خاندان: ${data.family.symbol || "ندارد"}\n\n` +
    (tag ? `ست‌اسم جدید:\n${tag}` : "نام لاتین ثبت نشده است؛ کاربر باید «ست اسممو بده» را اجرا کند.")
  );
}

export function registerSetNames(bot) {
  bot.use(async (ctx, next) => {
    const message = ctx.message;
    const user = ctx.from;
    const text = message?.text;

    if (!message || !user || !text) return next();

    importLegacyTagIfPresent(user);

    const pending = db.prepare(`
      SELECT chat_id, prompt_message_id, expires_at
      FROM montadoria_setname_requests
      WHERE telegram_id = ?
    `).get(user.id);

    if (!pending) {
      await notifyIfTagChanged(ctx, user.id);
      return next();
    }

    if (Number(pending.expires_at) < Math.floor(Date.now() / 1000)) {
      db.prepare(`
        DELETE FROM montadoria_setname_requests
        WHERE telegram_id = ?
      `).run(user.id);

      if (String(ctx.chat.id) === String(pending.chat_id)) {
        await ctx.reply("⌛ درخواست ست‌اسم منقضی شد. دوباره «ست اسممو بده» را بفرست.");
      }

      return next();
    }

    if (Number(ctx.chat.id) !== Number(pending.chat_id)) return next();

    if (
      ctx.chat.type !== "private" &&
      Number(message.reply_to_message?.message_id) !== Number(pending.prompt_message_id)
    ) {
      return next();
    }

    if (
      text.trim().startsWith("/") ||
      /^(?:ست\s*اسممو\s*بده|ست\s*اسمم\s*(?:رو|را)\s*بده|ویرایش\s*ست\s*اسم|ویرایش\s*ست‌اسم)$/iu.test(text.trim())
    ) {
      return next();
    }

    if (!validLatinName(text)) {
      await ctx.reply(
        "نام را فقط با حروف لاتین وارد کن؛ ۲ تا ۳۰ حرف، با امکان استفاده از فاصله، خط تیره یا آپاستروف. نمونه: Ilhan Blackwell"
      );
      return;
    }

    const name = text.trim().replace(/\s+/g, " ");

    ensureRecord(user.id);

    db.prepare(`
      UPDATE montadoria_setnames
      SET latin_name = ?, updated_at = ?
      WHERE telegram_id = ?
    `).run(name, timestamp(), user.id);

    db.prepare(`
      DELETE FROM montadoria_setname_requests
      WHERE telegram_id = ?
    `).run(user.id);

    const tag = formatTag(user.id);

    db.prepare(`
      UPDATE montadoria_setnames
      SET last_notified_tag = ?, updated_at = ?
      WHERE telegram_id = ?
    `).run(tag, timestamp(), user.id);

    await ctx.reply(
      `✅ ست‌اسم مونتادوریا ساخته شد:\n\n${tag}\n\n` +
      "این متن را در نام نمایشی تلگرام خودت قرار بده؛ ربات نمی‌تواند نام تلگرام را مستقیماً تغییر بدهد."
    );
  });

  const startSetName = async (ctx) => {
    const user = ctx.from;

    ensureRecord(user.id);

    db.prepare(`
      DELETE FROM montadoria_setname_requests
      WHERE telegram_id = ?
    `).run(user.id);

    const prompt = await ctx.reply(
      "نام خود را با حروف لاتین وارد کن.\nنمونه: Ilhan یا Ali Blackwell\n\nبرای پاسخ، به همین پیام ریپلای کن.",
      { reply_to_message_id: ctx.message.message_id }
    );

    db.prepare(`
      INSERT INTO montadoria_setname_requests
        (telegram_id, chat_id, prompt_message_id, expires_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        chat_id = excluded.chat_id,
        prompt_message_id = excluded.prompt_message_id,
        expires_at = excluded.expires_at
    `).run(
      user.id,
      ctx.chat.id,
      prompt.message_id,
      Math.floor(Date.now() / 1000) + 600
    );
  };

  bot.hears(
    /^(?:ست\s*اسممو\s*بده|ست\s*اسمم\s*(?:رو|را)\s*بده|ویرایش\s*ست\s*اسم|ویرایش\s*ست‌اسم)$/iu,
    startSetName
  );

  bot.hears(
    /^(?:\/?ست[‌_\s-]*(?:جایگاه|رتبه))(?:@\w+)?(?:\s+(.+))?$/iu,
    async (ctx) => {
      await ownerSetCategory(ctx, ctx.match[1] || "");
    }
  );

  bot.hears(
    /^(?:\/?ست[‌_\s-]*(?:خاندان|خانواده))(?:@\w+)?(?:\s+(.+))?$/iu,
    async (ctx) => {
      await ownerSetFamily(ctx, ctx.match[1] || "");
    }
  );
}
