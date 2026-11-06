import db from "./database.js";
import { InputFile } from "grammy";
import sharp from "sharp";

sharp.concurrency(1);

// MONTADORIA TRAINING SYSTEM — REVIEW GROUP + PERMANENT SKILL PROFILE

const TRAINING_IDLE_SECONDS = 180;
const XP_PER_MINUTE = 2;
const POINTS_PER_MINUTE = 1;
const SKILL_MASTERY_POINTS = 100;
const REJECT_REPLY_TIMEOUT = 10 * 60;
const PROFILE_SKILLS_LIMIT = 4;

// DATABASE

db.exec(`
CREATE TABLE IF NOT EXISTS training_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS training_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  telegram_id TEXT NOT NULL,
  skill TEXT NOT NULL,
  mode TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  points INTEGER NOT NULL,
  xp INTEGER NOT NULL,
  channel_message_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewer_id TEXT,
  reject_reason TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS training_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS training_skills (
  telegram_id TEXT NOT NULL,
  skill TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (telegram_id, skill)
);

CREATE TABLE IF NOT EXISTS training_profile_posts (
  telegram_id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS training_reject_wait (
  manager_id TEXT PRIMARY KEY,
  review_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
`);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();

  if (!columns.some(item => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("training_reviews", "channel_id", "TEXT");
ensureColumn("training_reviews", "review_chat_id", "TEXT");
ensureColumn("training_reviews", "review_message_id", "INTEGER");
ensureColumn("training_reviews", "source_chat_id", "TEXT");
ensureColumn("training_reviews", "source_message_id", "INTEGER");

const getSetting = key =>
  db.prepare("SELECT value FROM training_settings WHERE key=?").get(key)?.value;

const setSetting = (key, value) =>
  db.prepare(`
    INSERT INTO training_settings(key,value)
    VALUES(?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).run(key, String(value));

function userRecord(id) {
  return db.prepare(`
    SELECT telegram_id, username, display_name, xp, level, job
    FROM users
    WHERE telegram_id=?
    LIMIT 1
  `).get(String(id));
}

function userNameById(id) {
  const user = userRecord(id);

  return user?.display_name ||
    (user?.username ? `@${user.username}` : `کاربر ${id}`);
}

function decoratedUserName(id, fallback = "بازیکن") {
  try {
    const tag = db.prepare(`
      SELECT last_notified_tag, latin_name
      FROM montadoria_setnames
      WHERE telegram_id=?
    `).get(Number(id));

    if (tag?.last_notified_tag) return tag.last_notified_tag;

    if (tag?.latin_name) return `⟡𝐌 ${tag.latin_name}`;
  } catch {}

  return userRecord(id)?.display_name || fallback;
}

function isManager(ctx) {
  if (!ctx.from?.id) return false;

  const role = db.prepare(
    "SELECT role FROM users WHERE telegram_id=?"
  ).get(String(ctx.from.id))?.role;

  return ["owner", "moderator", "admin"].includes(
    String(role || "").toLowerCase()
  );
}

function inActiveRP(ctx) {
  try {
    return !!db.prepare(`
      SELECT 1 FROM observer_active_map
      WHERE telegram_id=? AND chat_id=?
    `).get(String(ctx.from.id), String(ctx.chat.id));
  } catch {
    return true;
  }
}

function isSleeping(id) {
  try {
    const row = db.prepare(
      "SELECT sleep_until FROM observer_needs WHERE telegram_id=?"
    ).get(String(id));

    return Number(row?.sleep_until || 0) >
      Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function safeSkill(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function splitEnd(text) {
  const parts = String(text || "")
    .split("|")
    .map(x => x.trim());

  if (parts.length < 3) return null;

  const skill = safeSkill(parts[1]);
  const mode = parts[2].toLowerCase();

  if (!skill || !["گروهی", "انفرادی"].includes(mode)) {
    return null;
  }

  return { skill, mode };
}

function escapeSvg(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function calculateLevelFromXP(xp) {
  let level = 1;

  while (
    Number(xp) >= Math.floor(100 * Math.pow(level, 1.5)) &&
    level < 1000
  ) {
    level++;
  }

  return level;
}

// MESSAGE LINKS

async function messageUrl(api, chatId, messageId) {
  if (!chatId || !messageId) return null;

  try {
    const chat = await api.getChat(chatId);

    if (chat?.username) {
      return `https://t.me/${chat.username}/${messageId}`;
    }
  } catch {}

  const id = String(chatId);

  if (/^-100\d+$/.test(id)) {
    return `https://t.me/c/${id.slice(4)}/${messageId}`;
  }

  return null;
}

function reviewLinksKeyboard(sourceUrl, skillUrl) {
  const rows = [];

  if (sourceUrl) {
    rows.push([
      {
        text: "🔎 مشاهده پیام اصلی تمرین",
        url: sourceUrl
      }
    ]);
  }

  if (skillUrl) {
    rows.push([
      {
        text: "📌 مشاهده گزارش کانال مهارت",
        url: skillUrl
      }
    ]);
  }

  return { inline_keyboard: rows };
}

// REPORT TEXT

function formatPendingText(review, playerName, sourceUrl) {
  return [
    "⟡ درخواست بررسی تمرین مونتادوریا ⟡",
    "",
    `شماره درخواست: ${review.id}`,
    `👤 بازیکن: ${playerName}`,
    `🆔 شناسه: ${review.telegram_id}`,
    `🥋 مهارت: ${review.skill}`,
    `👥 نوع تمرین: ${review.mode}`,
    `⏱ مدت: ${review.duration_minutes} دقیقه`,
    `⭐ امتیاز در انتظار: ${review.points}`,
    `✨ XP در انتظار: ${review.xp}`,
    "",
    sourceUrl
      ? "🔗 پیام اصلی پایان تمرین از دکمهٔ زیر قابل مشاهده است."
      : `شناسه گروه: ${review.source_chat_id || "نامشخص"} | شناسه پیام: ${review.source_message_id || "نامشخص"}`,
    "پس از بررسی، یکی از دکمه‌های زیر را انتخاب کنید."
  ].join("\n");
}

function formatFinalText(
  review,
  status,
  reviewerName,
  currentXP,
  currentLevel
) {
  const approved = status === "approved";

  const lines = [
    "⟡ گزارش نهایی بررسی تمرین ⟡",
    "",
    `وضعیت: ${approved ? "✅ تأیید شد" : "❌ رد شد"}`,
    `شماره درخواست: ${review.id}`,
    `👤 بازیکن: ${userNameById(review.telegram_id)}`,
    `🆔 شناسه: ${review.telegram_id}`,
    `🥋 مهارت: ${review.skill}`,
    `👥 نوع تمرین: ${review.mode}`,
    `⏱ مدت ثبت‌شده: ${review.duration_minutes} دقیقه`,
    `⭐ امتیاز تمرین: ${approved ? "+" : "بدون ثبت: "}${review.points}`,
    `✨ XP تمرین: ${approved ? (review.xp_result ? "+" : "ثبت‌نشد: ") : "بدون ثبت: "}${review.xp}`,
    `🛡 بررسی‌کننده: ${reviewerName}`
  ];

  if (approved) {
    lines.push(`✨ XP فعلی بازیکن: ${currentXP ?? "ثبت نشده"}`);
    lines.push(`🎖 Level فعلی بازیکن: ${currentLevel ?? "ثبت نشده"}`);
  } else {
    lines.push(`📝 دلیل رد: ${review.reject_reason || "ثبت نشده"}`);
  }

  lines.push("", "این گزارش جایگزین پیام درخواست اولیه شد.");

  return lines.join("\n");
}

async function editFinalReports(bot, review, text, fallbackMessage) {
  const sourceUrl = await messageUrl(
    bot.api,
    review.source_chat_id,
    review.source_message_id
  );

  const skillUrl = await messageUrl(
    bot.api,
    review.channel_id || getSetting("skill_channel_id"),
    review.channel_message_id
  );

  const reply_markup = reviewLinksKeyboard(sourceUrl, skillUrl);

  const finalText = sourceUrl ||
    !review.source_chat_id ||
    !review.source_message_id
    ? text
    : `${text}\n\nپیام اصلی: گروه ${review.source_chat_id} | پیام ${review.source_message_id}`;

  const reviewChatId =
    review.review_chat_id || fallbackMessage?.chat?.id;

  const reviewMessageId =
    review.review_message_id || fallbackMessage?.message_id;

  if (reviewChatId && reviewMessageId) {
    try {
      await bot.api.editMessageText(
        reviewChatId,
        reviewMessageId,
        finalText,
        { reply_markup }
      );
    } catch (error) {
      console.error(
        "TRAINING_REVIEW_REPORT_EDIT_ERROR:",
        error?.description || error?.message || error
      );
    }
  }

  const channelId =
    review.channel_id || getSetting("skill_channel_id");

  if (channelId && review.channel_message_id) {
    try {
      await bot.api.editMessageText(
        channelId,
        review.channel_message_id,
        finalText
      );
    } catch (error) {
      console.error(
        "TRAINING_SKILL_REPORT_EDIT_ERROR:",
        error?.description || error?.message || error
      );
    }
  }
}

// XP + LEVEL

function awardTrainingXP(telegramId, amount) {
  const id = String(telegramId);

  const user = db.prepare(
    "SELECT xp, level FROM users WHERE telegram_id=?"
  ).get(id);

  if (!user) return null;

  const oldXP = Math.max(0, Number(user.xp || 0));
  const oldLevel = Math.max(1, Number(user.level || 1));
  const newXP = oldXP + Number(amount);

  if (!Number.isSafeInteger(newXP) || newXP < 0) {
    return null;
  }

  const newLevel = calculateLevelFromXP(newXP);

  db.prepare(`
    UPDATE users
    SET xp=?, level=?, updated_at=?
    WHERE telegram_id=?
  `).run(
    newXP,
    newLevel,
    new Date().toISOString(),
    id
  );

  return {
    oldXP,
    newXP,
    oldLevel,
    newLevel
  };
}

// WEAPON ICONS

function weaponIcon(skill) {
  const s = String(skill || "").toLowerCase();

  if (/شمشیر|sword/.test(s)) return "⚔️";
  if (/خنجر|چاقو|dagger|knife/.test(s)) return "🗡️";
  if (/تفنگ|اسلحه|تیراندازی|gun|rifle|shoot/.test(s)) return "🔫";
  if (/کمان|تیر و کمان|archery|bow/.test(s)) return "🏹";
  if (/تبر|axe/.test(s)) return "🪓";
  if (/نیزه|spear/.test(s)) return "🔱";
  if (/مشت|بوکس|boxing|拳/.test(s)) return "🥊";

  return "⚔️";
}

function fireColor(percent) {
  if (percent >= 100) return "url(#rainbowFire)";
  if (percent >= 75) return "#bd68ff";
  if (percent >= 50) return "#46c9ff";
  if (percent >= 25) return "#ffd34e";

  return "#ff713b";
}

// SVG SKILL CARD

function profileSvg(user, skills, xp, level, photoBuffer) {
  const width = 1200;
  const height = 720;

  const displayName = decoratedUserName(
    user.telegram_id,
    user.display_name || "MONTADORIA PLAYER"
  );

  const photo = photoBuffer
    ? `<image href="data:image/jpeg;base64,${photoBuffer.toString("base64")}" x="78" y="215" width="300" height="300" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)"/>`
    : `<circle cx="228" cy="365" r="145" fill="#241b31"/><text x="228" y="390" text-anchor="middle" font-size="88" fill="#d8b36a">${escapeSvg((user.display_name || "M").trim().slice(0, 1).toUpperCase())}</text>`;

  const rows = skills.slice(0, PROFILE_SKILLS_LIMIT);

  const skillMarkup = rows.length
    ? rows.map((skill, index) => {
        const y = 245 + index * 104;

        const percent = Math.min(
          100,
          Math.max(
            0,
            Math.round(
              Number(skill.points || 0) /
              SKILL_MASTERY_POINTS * 100
            )
          )
        );

        const barWidth = Math.round(310 * percent / 100);
        const color = fireColor(percent);

        return `
          <g>
            <text x="520" y="${y}" font-size="31" fill="#f4e9d2">${escapeSvg(weaponIcon(skill.skill))}</text>

            <text x="575" y="${y}" font-size="25" fill="#f4e9d2" direction="rtl" unicode-bidi="plaintext">${escapeSvg(String(skill.skill).slice(0, 24))}</text>

            <text x="1045" y="${y}" font-size="22" fill="#d9c8a7" text-anchor="end">${percent}%</text>

            <rect x="575" y="${y + 18}" width="470" height="16" rx="8" fill="#332b3e"/>

            <rect x="575" y="${y + 18}" width="${barWidth}" height="16" rx="8" fill="${color}"/>

            <text x="575" y="${y + 64}" font-size="16" fill="#a99cb3">${Number(skill.points || 0)} امتیاز · ${Number(skill.sessions || 0)} تمرین</text>

            <path d="M0,-36 C-26,-5 -30,12 -14,28 C-3,39 18,34 24,18 C32,0 15,-20 0,-36 Z" transform="translate(1090 ${y + 5})" fill="${color}" stroke="#ffe2a2" stroke-width="2"/>

            <path d="M0,-15 C-11,-2 -12,8 -4,15 C3,20 12,12 9,4 C7,-3 3,-9 0,-15 Z" transform="translate(1090 ${y + 5})" fill="#fff0bd" opacity=".9"/>
          </g>`;
      }).join("")
    : `<text x="575" y="280" font-size="26" fill="#d9c8a7">هنوز مهارتی ثبت نشده است.</text>`;

  return `
  <svg xmlns="http://www.w3.org/2000/svg"
       width="${width}" height="${height}"
       viewBox="0 0 ${width} ${height}"
       font-family="DejaVu Sans,Arial,sans-serif">

    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0b0a10"/>
        <stop offset=".55" stop-color="#21152d"/>
        <stop offset="1" stop-color="#09090d"/>
      </linearGradient>

      <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#8f6c35"/>
        <stop offset=".5" stop-color="#f4d58b"/>
        <stop offset="1" stop-color="#8f6c35"/>
      </linearGradient>

      <linearGradient id="rainbowFire" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ff315d"/>
        <stop offset=".2" stop-color="#ff9b32"/>
        <stop offset=".4" stop-color="#ffe34e"/>
        <stop offset=".6" stop-color="#45e08b"/>
        <stop offset=".8" stop-color="#42b9ff"/>
        <stop offset="1" stop-color="#c15cff"/>
      </linearGradient>

      <clipPath id="avatarClip">
        <circle cx="228" cy="365" r="145"/>
      </clipPath>

      <pattern id="grain" width="48" height="48" patternUnits="userSpaceOnUse">
        <path d="M0 24H48 M24 0V48" stroke="#ffffff" stroke-opacity=".025" stroke-width="1"/>
      </pattern>
    </defs>

    <rect width="1200" height="720" rx="34" fill="url(#bg)"/>
    <rect width="1200" height="720" rx="34" fill="url(#grain)"/>

    <rect x="18" y="18" width="1164" height="684" rx="28" fill="none" stroke="url(#gold)" stroke-width="3"/>

    <path d="M55 150H1145" stroke="#b99659" stroke-opacity=".55" stroke-width="2"/>

    <text x="600" y="75" text-anchor="middle" font-size="35" font-weight="700" letter-spacing="8" fill="#f0d89d">MONTADORIA</text>

    <text x="600" y="116" text-anchor="middle" font-size="17" letter-spacing="5" fill="#bda77b">PERMANENT SKILL ARCHIVE</text>

    ${photo}

    <circle cx="228" cy="365" r="155" fill="none" stroke="url(#gold)" stroke-width="8"/>

    <text x="228" y="565" text-anchor="middle" font-size="27" fill="#f4e3bb">${escapeSvg(displayName.slice(0, 36))}</text>

    <text x="228" y="600" text-anchor="middle" font-size="17" fill="#b7a5c2">PLAYER ID · ${escapeSvg(user.telegram_id)}</text>

    <text x="520" y="190" font-size="24" fill="#d8b36a" letter-spacing="3">WEAPON MASTERY</text>

    ${skillMarkup}

    <path d="M520 670H1145" stroke="#8b6a3d" stroke-opacity=".6"/>

    <text x="575" y="656" font-size="20" fill="#ddc99d">XP ${Number(xp || 0)}</text>

    <text x="900" y="656" font-size="20" fill="#ddc99d">LEVEL ${Number(level || 1)}</text>

    <text x="1140" y="656" text-anchor="end" font-size="15" fill="#9c8ba6">100% = CHROMATIC FLAME</text>
  </svg>`;
}

// USER PHOTO

async function getRegisteredPhotoFileId(id) {
  try {
    const user = userRecord(id);

    if (!user?.username) return null;

    const row = db.prepare(`
      SELECT photo_file_id
      FROM character_registrations
      WHERE telegram_username=? COLLATE NOCASE
      LIMIT 1
    `).get(String(user.username).replace(/^@/, ""));

    return row?.photo_file_id || null;
  } catch {
    return null;
  }
}

async function getUserPhotoBuffer(bot, id) {
  try {
    let fileId = await getRegisteredPhotoFileId(id);

    if (!fileId) {
      const photos = await bot.api.getUserProfilePhotos(
        Number(id),
        { limit: 1 }
      );

      const sizes = photos?.photos?.[0] || [];

      const largest = sizes.reduce((best, item) => {
        if (!best) return item;

        return Number(item.width || 0) * Number(item.height || 0) >
          Number(best.width || 0) * Number(best.height || 0)
          ? item
          : best;
      }, null);

      fileId = largest?.file_id || null;
    }

    if (!fileId) return null;

    const file = await bot.api.getFile(fileId);

    if (!file?.file_path) return null;

    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!token) return null;

    const response = await fetch(
      `https://api.telegram.org/file/bot${token}/${file.file_path}`
    );

    if (!response.ok) {
      throw new Error(`Telegram photo download failed: ${response.status}`);
    }

    const data = Buffer.from(await response.arrayBuffer());

    if (!data.length || data.length > 8 * 1024 * 1024) return null;

    return await sharp(data)
      .rotate()
      .resize({ width: 480, height: 480, fit: "cover" })
      .jpeg({ quality: 86 })
      .toBuffer();

  } catch (error) {
    console.error(
      "TRAINING_PROFILE_PHOTO_ERROR:",
      error?.description || error?.message || error
    );

    return null;
  }
}

// PERMANENT SKILL PROFILE

async function updatePersistentSkillProfile(bot, telegramId) {
  const chatId = getSetting("skill_channel_id");

  if (!chatId) return;

  const user = userRecord(telegramId) || {
    telegram_id: String(telegramId),
    display_name: userNameById(telegramId),
    xp: 0,
    level: 1
  };

  const skills = db.prepare(`
    SELECT skill, points, sessions
    FROM training_skills
    WHERE telegram_id=?
    ORDER BY points DESC, skill ASC
  `).all(String(telegramId));

  const photoBuffer = await getUserPhotoBuffer(bot, telegramId);

  const svg = profileSvg(
    user,
    skills,
    user.xp,
    user.level,
    photoBuffer
  );

  const imageBuffer = await sharp(Buffer.from(svg))
    .png()
    .toBuffer();

  const captionRows = skills.slice(0, 8).map(item => {
    const percent = Math.min(
      100,
      Math.max(
        0,
        Math.round(Number(item.points || 0) / SKILL_MASTERY_POINTS * 100)
      )
    );

    return `${weaponIcon(item.skill)} ${item.skill}: ${percent}% (${item.points} امتیاز)`;
  });

  const caption = [
    "⟡ پرونده دائمی مهارت مونتادوریا ⟡",
    `👤 ${decoratedUserName(telegramId, user.display_name || "بازیکن")}`,
    `🆔 ${telegramId}`,
    `✨ XP: ${Number(user.xp || 0)} | 🎖 Level: ${Number(user.level || 1)}`,
    ...captionRows,
    "",
    "🔥 در ۱۰۰ امتیاز هر مهارت، آتش آن به حالت رنگی کامل می‌رسد."
  ].join("\n").slice(0, 1000);

  const oldPost = db.prepare(`
    SELECT chat_id, message_id
    FROM training_profile_posts
    WHERE telegram_id=?
  `).get(String(telegramId));

  if (oldPost && String(oldPost.chat_id) === String(chatId)) {
    try {
      await bot.api.editMessageMedia(
        oldPost.chat_id,
        oldPost.message_id,
        {
          type: "photo",
          media: new InputFile(
            imageBuffer,
            "montadoria-skill-profile.png"
          ),
          caption
        }
      );

      db.prepare(`
        UPDATE training_profile_posts
        SET updated_at=?
        WHERE telegram_id=?
      `).run(
        Math.floor(Date.now() / 1000),
        String(telegramId)
      );

      return;

    } catch (error) {
      const message = String(
        error?.description || error?.message || error
      );

      if (/message is not modified/i.test(message)) return;

      console.error("TRAINING_PROFILE_EDIT_ERROR:", message);
    }
  }

  const sent = await bot.api.sendPhoto(
    chatId,
    new InputFile(imageBuffer, "montadoria-skill-profile.png"),
    { caption }
  );

  db.prepare(`
    INSERT INTO training_profile_posts(
      telegram_id, chat_id, message_id, updated_at
    )
    VALUES(?,?,?,?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      chat_id=excluded.chat_id,
      message_id=excluded.message_id,
      updated_at=excluded.updated_at
  `).run(
    String(telegramId),
    String(chatId),
    sent.message_id,
    Math.floor(Date.now() / 1000)
  );

  if (oldPost) {
    try {
      await bot.api.deleteMessage(
        oldPost.chat_id,
        oldPost.message_id
      );
    } catch {}
  }
}

// NOTIFY PLAYER

async function notifyPlayer(bot, review, approved) {
  try {
    if (approved) {
      const user = userRecord(review.telegram_id);

      const skill = db.prepare(`
        SELECT points FROM training_skills
        WHERE telegram_id=? AND skill=?
      `).get(
        String(review.telegram_id),
        review.skill
      );

      const percent = Math.min(100, Number(skill?.points || 0));

      await bot.api.sendMessage(
        review.telegram_id,
        `✅ تمرین «${review.skill}» تأیید شد.\n` +
        `⭐ امتیاز ثبت‌شده: +${review.points}\n` +
        `✨ XP ثبت‌شده: ${review.xp_result ? "+" + review.xp : "ثبت نشد؛ حساب یا مقدار XP معتبر نیست"}\n` +
        `🎖 Level فعلی: ${Number(user?.level || 1)}\n` +
        `🔥 پیشرفت مهارت: ${percent}%`
      );

    } else {
      await bot.api.sendMessage(
        review.telegram_id,
        `❌ تمرین «${review.skill}» رد شد.\n` +
        `علت: ${review.reject_reason || "ثبت نشده"}`
      );
    }

  } catch (error) {
    console.error(
      "TRAINING_PLAYER_NOTIFY_ERROR:",
      error?.description || error?.message || error
    );
  }
}

// DATABASE REVIEW OPERATIONS

function approveReview(reviewId, reviewerId) {
  return db.transaction(() => {
    const review = db.prepare(`
      SELECT *
      FROM training_reviews
      WHERE id=? AND status='pending'
    `).get(Number(reviewId));

    if (!review) return null;

    const changed = db.prepare(`
      UPDATE training_reviews
      SET status='approved', reviewer_id=?
      WHERE id=? AND status='pending'
    `).run(
      String(reviewerId),
      Number(reviewId)
    );

    if (changed.changes !== 1) return null;

    db.prepare(`
      INSERT INTO training_skills(
        telegram_id,skill,points,sessions
      )
      VALUES(?,?,?,1)
      ON CONFLICT(telegram_id,skill)
      DO UPDATE SET
        points=training_skills.points+excluded.points,
        sessions=training_skills.sessions+1
    `).run(
      String(review.telegram_id),
      review.skill,
      Number(review.points)
    );

    const xpResult = awardTrainingXP(
      review.telegram_id,
      Number(review.xp)
    );

    return {
      ...review,
      status: "approved",
      reviewer_id: String(reviewerId),
      xp_result: xpResult
    };
  })();
}

function rejectReview(reviewId, reviewerId, reason) {
  return db.transaction(() => {
    const review = db.prepare(`
      SELECT *
      FROM training_reviews
      WHERE id=? AND status='pending'
    `).get(Number(reviewId));

    if (!review) return null;

    const changed = db.prepare(`
      UPDATE training_reviews
      SET status='rejected',
          reviewer_id=?,
          reject_reason=?
      WHERE id=? AND status='pending'
    `).run(
      String(reviewerId),
      String(reason).slice(0, 500),
      Number(reviewId)
    );

    if (changed.changes !== 1) return null;

    return {
      ...review,
      status: "rejected",
      reviewer_id: String(reviewerId),
      reject_reason: String(reason).slice(0, 500)
    };
  })();
}

// MAIN SYSTEM

export function registerTraining(bot) {

  // START TRAINING

  bot.hears(/^#شروع_تمرین$/i, async ctx => {
    if (!ctx.from || !ctx.chat) return;

    if (!inActiveRP(ctx)) {
      return ctx.reply(
        "برای شروع تمرین ابتدا باید #ورود کرده باشید."
      );
    }

    if (isSleeping(ctx.from.id)) {
      return ctx.reply(
        "در زمان خواب امکان شروع تمرین وجود ندارد."
      );
    }

    const id = String(ctx.from.id);
    const chat = String(ctx.chat.id);
    const now = Math.floor(Date.now() / 1000);

    const active = db.prepare(`
      SELECT id
      FROM training_sessions
      WHERE telegram_id=? AND status='active'
      LIMIT 1
    `).get(id);

    if (active) {
      return ctx.reply(
        "شما از قبل یک تمرین فعال دارید."
      );
    }

    db.prepare(`
      INSERT INTO training_sessions(
        telegram_id,chat_id,started_at,last_activity_at,status
      )
      VALUES(?,?,?,?, 'active')
    `).run(id, chat, now, now);

    return ctx.reply(
      "تمرین شما شروع شد.\n" +
      "برای پایان:\n" +
      "#پایان_تمرین | نام مهارت | گروهی/انفرادی\n\n" +
      "اگر بیش از ۳ دقیقه در همین گروه فعالیت نداشته باشید، تمرین لغو می‌شود."
    );
  });

  // END TRAINING

  bot.hears(/^#پایان_تمرین/i, async ctx => {
    if (!ctx.from || !ctx.chat || !ctx.message?.text) return;

    const parsed = splitEnd(ctx.message.text);

    if (!parsed) {
      return ctx.reply(
        "قالب درست:\n#پایان_تمرین | نام مهارت | گروهی/انفرادی"
      );
    }

    const id = String(ctx.from.id);
    const chatId = String(ctx.chat.id);
    const now = Math.floor(Date.now() / 1000);

    const session = db.prepare(`
      SELECT *
      FROM training_sessions
      WHERE telegram_id=?
        AND chat_id=?
        AND status='active'
      ORDER BY id DESC
      LIMIT 1
    `).get(id, chatId);

    if (!session) {
      return ctx.reply(
        "تمرین فعالی برای شما در این گروه ثبت نشده است."
      );
    }

    if (now - Number(session.last_activity_at) > TRAINING_IDLE_SECONDS) {
      db.prepare(`
        UPDATE training_sessions
        SET status='cancelled'
        WHERE id=?
      `).run(session.id);

      return ctx.reply(
        "تمرین به دلیل بیش از ۳ دقیقه عدم فعالیت لغو شد؛ امتیازی ثبت نشد."
      );
    }

    const skillChannel = getSetting("skill_channel_id");
    const reviewGroup = getSetting("training_review_group_id");

    if (!skillChannel || !reviewGroup) {
      return ctx.reply(
        "⚙️ تنظیم کانال‌ها کامل نیست.\n" +
        (!skillChannel
          ? "کانال مهارت: /skillchannel شناسه_کانال\n"
          : "") +
        (!reviewGroup
          ? "گروه اطلاعات: دستور /trainingreviewgroup را داخل همان گروه اجرا کنید."
          : "")
      );
    }

    const minutes = Math.max(
      1,
      Math.floor(
        (now - Number(session.started_at)) / 60
      )
    );

    const points = minutes * POINTS_PER_MINUTE;
    const xp = minutes * XP_PER_MINUTE;
    const sourceMessageId = Number(ctx.message.message_id);

    const inserted = db.prepare(`
      INSERT INTO training_reviews(
        session_id,telegram_id,skill,mode,
        duration_minutes,points,xp,status,created_at,
        channel_id,source_chat_id,source_message_id
      )
      VALUES(?,?,?,?,?,?,?,'pending',?,?,?,?)
    `).run(
      session.id,
      id,
      parsed.skill,
      parsed.mode,
      minutes,
      points,
      xp,
      now,
      String(skillChannel),
      chatId,
      sourceMessageId
    );

    const reviewId = Number(inserted.lastInsertRowid);

    const review = db.prepare(`
      SELECT * FROM training_reviews WHERE id=?
    `).get(reviewId);

    const player = userRecord(id);

    const playerName = decoratedUserName(
      id,
      player?.display_name || userNameById(id)
    );

    let skillMessage = null;

    try {
      // گزارش اولیه در کانال مهارت، بدون دکمه تصمیم‌گیری.
      skillMessage = await bot.api.sendMessage(
        skillChannel,
        [
          "⟡ درخواست ثبت تمرین ⟡",
          `👤 ${playerName}`,
          `🆔 ${id}`,
          `🥋 مهارت: ${parsed.skill}`,
          `👥 نوع: ${parsed.mode}`,
          `⏱ مدت: ${minutes} دقیقه`,
          `⭐ امتیاز در انتظار: ${points}`,
          `✨ XP در انتظار: ${xp}`,
          `شماره درخواست: ${reviewId}`
        ].join("\n")
      );

      db.prepare(`
        UPDATE training_reviews
        SET channel_message_id=?
        WHERE id=?
      `).run(
        skillMessage.message_id,
        reviewId
      );

      // لینک پیام پایان تمرین در گروه اصلی.
      const sourceUrl = await messageUrl(
        bot.api,
        chatId,
        sourceMessageId
      );

      const skillUrl = await messageUrl(
        bot.api,
        skillChannel,
        skillMessage.message_id
      );

      const pendingText = formatPendingText(
        review,
        playerName,
        sourceUrl
      );

      // دکمه‌های تصمیم فقط در گروه اطلاعات قرار می‌گیرند.
      const keyboard = [
        [
          {
            text: "✅ تأیید",
            callback_data: `training:approve:${reviewId}`
          },
          {
            text: "❌ رد",
            callback_data: `training:reject:${reviewId}`
          }
        ],
        ...(sourceUrl
          ? [[{
              text: "🔎 مشاهده پیام اصلی تمرین",
              url: sourceUrl
            }]]
          : []),
        ...(skillUrl
          ? [[{
              text: "📌 مشاهده گزارش کانال مهارت",
              url: skillUrl
            }]]
          : [])
      ];

      const reviewMessage = await bot.api.sendMessage(
        reviewGroup,
        pendingText,
        {
          reply_markup: {
            inline_keyboard: keyboard
          }
        }
      );

      db.prepare(`
        UPDATE training_reviews
        SET review_chat_id=?,
            review_message_id=?
        WHERE id=?
      `).run(
        String(reviewGroup),
        reviewMessage.message_id,
        reviewId
      );

      db.prepare(`
        UPDATE training_sessions
        SET status='submitted'
        WHERE id=? AND status='active'
      `).run(session.id);

      return ctx.reply(
        "✅ تمرین برای بررسی به گروه اطلاعات ناظران ارسال شد. پس از تصمیم ناظر، امتیاز و XP ثبت می‌شود."
      );

    } catch (error) {
      console.error(
        "TRAINING_SUBMISSION_DELIVERY_ERROR:",
        error?.description || error?.message || error
      );

      if (skillMessage?.message_id) {
        try {
          await bot.api.deleteMessage(
            skillChannel,
            skillMessage.message_id
          );
        } catch {}
      }

      db.prepare(`
        UPDATE training_reviews
        SET status='delivery_failed'
        WHERE id=? AND status='pending'
      `).run(reviewId);

      db.prepare(`
        UPDATE training_sessions
        SET status='active',
            last_activity_at=?
        WHERE id=?
      `).run(now, session.id);

      return ctx.reply(
        "❌ ارسال تمرین برای بررسی کامل نشد؛ جلسه تمرین باز نگه داشته شد.\n" +
        "دسترسی ربات به کانال مهارت و گروه اطلاعات و شناسه‌های تنظیم‌شده را بررسی کنید.\n" +
        `خطا: ${String(error?.description || error?.message || error).slice(0, 250)}`
      );
    }
  });

  // SET REVIEW GROUP

  bot.command("trainingreviewgroup", async ctx => {
    if (!isManager(ctx)) {
      return ctx.reply(
        "⛔ فقط مدیر یا مالک می‌تواند گروه بررسی تمرین را تنظیم کند."
      );
    }

    const argument = String(ctx.match || "").trim();
    let targetId = null;

    if (argument) {
      if (
        !(/^-?\d{5,20}$/.test(argument) ||
          /^@[A-Za-z0-9_]{5,32}$/.test(argument))
      ) {
        return ctx.reply(
          "شناسه گروه معتبر نیست. نمونه:\n/trainingreviewgroup -1001234567890"
        );
      }

      targetId = argument;

    } else if (["group", "supergroup"].includes(ctx.chat.type)) {
      targetId = String(ctx.chat.id);
    }

    if (!targetId) {
      return ctx.reply(
        "این دستور را داخل گروه اطلاعات اجرا کن یا شناسه گروه را بنویس:\n" +
        "/trainingreviewgroup -1001234567890"
      );
    }

    setSetting("training_review_group_id", targetId);

    return ctx.reply(
      `✅ گروه بررسی تمرین ثبت شد.\nشناسه: ${targetId}`
    );
  });

  // SET SKILL CHANNEL

  bot.command("skillchannel", async ctx => {
    if (!isManager(ctx)) return;

    const id = String(ctx.match || "").trim();

    if (
      !(/^-?\d{5,20}$/.test(id) ||
        /^@[A-Za-z0-9_]{5,32}$/.test(id))
    ) {
      return ctx.reply(
        "دستور: /skillchannel شناسه_کانال یا @ChannelUsername\n" +
        "نمونه: /skillchannel -1001234567890"
      );
    }

    setSetting("skill_channel_id", id);

    return ctx.reply(
      "✅ کانال مهارت تنظیم شد؛ پروفایل‌های دائمی نیز در همین کانال منتشر می‌شوند."
    );
  });

  // TEXT PROFILE

  bot.command("trainingprofile", async ctx => {
    if (!ctx.from) return;

    const id = String(ctx.from.id);

    const rows = db.prepare(`
      SELECT skill,points,sessions
      FROM training_skills
      WHERE telegram_id=?
      ORDER BY points DESC
    `).all(id);

    const user = userRecord(id);

    const body = rows.length
      ? rows.map(r => {
          const percent = Math.min(
            100,
            Math.max(
              0,
              Math.round(
                Number(r.points || 0) /
                SKILL_MASTERY_POINTS * 100
              )
            )
          );

          return `${weaponIcon(r.skill)} ${r.skill}: ${r.points} امتیاز | ${percent}% | ${r.sessions} تمرین`;
        }).join("\n")
      : "هنوز مهارتی ثبت نشده است.";

    return ctx.reply(
      `⟡ پروفایل مهارت مونتادوریا ⟡\n` +
      `👤 ${decoratedUserName(id, user?.display_name || userNameById(id))}\n` +
      `✨ XP: ${Number(user?.xp || 0)} | 🎖 Level: ${Number(user?.level || 1)}\n\n` +
      `${body}\n\n` +
      "🔥 هر مهارت با رسیدن به ۱۰۰ امتیاز، به آتش رنگی کامل می‌رسد."
    );
  });

  // APPROVE

  bot.callbackQuery(/^training:approve:(\d+)$/, async ctx => {
    if (!isManager(ctx)) {
      return ctx.answerCallbackQuery({
        text: "دسترسی مدیر لازم است.",
        show_alert: true
      });
    }

    const rid = Number(ctx.match[1]);

    let approved;

    try {
      approved = approveReview(rid, ctx.from.id);
    } catch (error) {
      console.error("TRAINING_APPROVE_DB_ERROR:", error);

      return ctx.answerCallbackQuery({
        text: "ثبت تأیید در پایگاه داده ناموفق بود.",
        show_alert: true
      });
    }

    if (!approved) {
      return ctx.answerCallbackQuery({
        text: "این درخواست قبلاً بررسی شده یا وجود ندارد.",
        show_alert: true
      });
    }

    const reviewerName = userNameById(ctx.from.id);
    const updatedUser = userRecord(approved.telegram_id);

    const report = formatFinalText(
      approved,
      "approved",
      reviewerName,
      updatedUser?.xp,
      updatedUser?.level
    );

    await ctx.answerCallbackQuery({
      text: "✅ تمرین تأیید و امتیاز ثبت شد."
    });

    // پیام گروه ناظران و کانال مهارت به گزارش کامل تبدیل می‌شود.
    await editFinalReports(
      bot,
      approved,
      report,
      ctx.callbackQuery.message
    );

    // به‌روزرسانی کارت دائمی بازیکن.
    try {
      await updatePersistentSkillProfile(
        bot,
        approved.telegram_id
      );
    } catch (error) {
      console.error(
        "TRAINING_PROFILE_UPDATE_ERROR:",
        error?.description || error?.message || error
      );

      try {
        await bot.api.sendMessage(
          getSetting("skill_channel_id"),
          `⚠️ به‌روزرسانی کارت مهارت کاربر ${approved.telegram_id} ناموفق بود؛ گزارش تمرین تأیید شده است.`
        );
      } catch {}
    }

    await notifyPlayer(bot, approved, true);
  });

  // REJECT

  bot.callbackQuery(/^training:reject:(\d+)$/, async ctx => {
    if (!isManager(ctx)) {
      return ctx.answerCallbackQuery({
        text: "دسترسی مدیر لازم است.",
        show_alert: true
      });
    }

    const rid = Number(ctx.match[1]);

    const review = db.prepare(`
      SELECT id
      FROM training_reviews
      WHERE id=? AND status='pending'
    `).get(rid);

    if (!review) {
      return ctx.answerCallbackQuery({
        text: "این درخواست قبلاً بررسی شده است.",
        show_alert: true
      });
    }

    try {
      await bot.api.sendMessage(
        ctx.from.id,
        `دلیل رد درخواست تمرین شماره ${rid} را در همین گفت‌وگوی خصوصی ارسال کن.\n` +
        "حداکثر ۵۰۰ نویسه؛ برای لغو این درخواست /canceltrainingreject را بفرست."
      );

      db.prepare(`
        INSERT INTO training_reject_wait(
          manager_id,review_id,created_at
        )
        VALUES(?,?,?)
        ON CONFLICT(manager_id) DO UPDATE SET
          review_id=excluded.review_id,
          created_at=excluded.created_at
      `).run(
        String(ctx.from.id),
        rid,
        Math.floor(Date.now() / 1000)
      );

      return ctx.answerCallbackQuery({
        text: "پیام خصوصی برای ثبت دلیل رد ارسال شد."
      });

    } catch (error) {
      console.error(
        "TRAINING_REJECT_PROMPT_ERROR:",
        error?.description || error?.message || error
      );

      return ctx.answerCallbackQuery({
        text: "ابتدا وارد گفت‌وگوی خصوصی ربات شو و /start را بزن؛ سپس دوباره رد را انتخاب کن.",
        show_alert: true
      });
    }
  });

  // CANCEL REJECTION REQUEST

  bot.command("canceltrainingreject", async ctx => {
    if (!ctx.from) return;

    const result = db.prepare(
      "DELETE FROM training_reject_wait WHERE manager_id=?"
    ).run(String(ctx.from.id));

    return ctx.reply(
      result.changes
        ? "درخواست ثبت دلیل رد لغو شد."
        : "درخواست فعالی برای لغو وجود ندارد."
    );
  });

  // MANAGER PRIVATE REJECTION REASON + SESSION ACTIVITY

  bot.on("message:text", async (ctx, next) => {
    if (!ctx.from || !ctx.message?.text) {
      return next();
    }

    // دلیل رد فقط در گفت‌وگوی خصوصی مدیر دریافت می‌شود.
    if (ctx.chat.type === "private") {
      const waiting = db.prepare(`
        SELECT review_id,created_at
        FROM training_reject_wait
        WHERE manager_id=?
      `).get(String(ctx.from.id));

      if (waiting && isManager(ctx)) {
        const text = String(ctx.message.text).trim();
        const now = Math.floor(Date.now() / 1000);

        if (now - Number(waiting.created_at) > REJECT_REPLY_TIMEOUT) {
          db.prepare(`
            DELETE FROM training_reject_wait
            WHERE manager_id=?
          `).run(String(ctx.from.id));

          await ctx.reply(
            "⌛ مهلت ثبت دلیل رد تمام شد؛ دوباره از دکمه رد استفاده کن."
          );

          return;
        }

        if (text.startsWith("/")) {
          return next();
        }

        if (text.length < 2) {
          await ctx.reply(
            "دلیل رد خیلی کوتاه است؛ دلیل را واضح‌تر بنویس."
          );

          return;
        }

        const rid = Number(waiting.review_id);
        let rejected;

        try {
          rejected = rejectReview(
            rid,
            ctx.from.id,
            text.slice(0, 500)
          );

        } catch (error) {
          console.error("TRAINING_REJECT_DB_ERROR:", error);

          await ctx.reply(
            "❌ ثبت دلیل رد ناموفق بود. دوباره تلاش کن."
          );

          return;
        }

        db.prepare(`
          DELETE FROM training_reject_wait
          WHERE manager_id=?
        `).run(String(ctx.from.id));

        if (!rejected) {
          await ctx.reply(
            "این درخواست قبلاً بررسی شده است؛ تغییری ثبت نشد."
          );

          return;
        }

        const report = formatFinalText(
          rejected,
          "rejected",
          userNameById(ctx.from.id),
          null,
          null
        );

        await editFinalReports(
          bot,
          rejected,
          report,
          null
        );

        await notifyPlayer(bot, rejected, false);

        await ctx.reply(
          "✅ دلیل رد ثبت شد و گزارش نهایی جایگزین پیام درخواست شد."
        );

        return;
      }
    }

    // فقط پیام‌های همان گروهی که تمرین در آن شروع شده،
    // فعالیت تمرین را به‌روز می‌کنند.
    const id = String(ctx.from.id);
    const chatId = String(ctx.chat.id);
    const now = Math.floor(Date.now() / 1000);

    db.prepare(`
      UPDATE training_sessions
      SET last_activity_at=?
      WHERE telegram_id=?
        AND chat_id=?
        AND status='active'
    `).run(now, id, chatId);

    return next();
  });

  // AUTO CANCEL IDLE SESSIONS

  setInterval(() => {
    const now = Math.floor(Date.now() / 1000);

    const stale = db.prepare(`
      SELECT id
      FROM training_sessions
      WHERE status='active'
        AND last_activity_at<?
    `).all(now - TRAINING_IDLE_SECONDS);

    for (const row of stale) {
      db.prepare(`
        UPDATE training_sessions
        SET status='cancelled'
        WHERE id=? AND status='active'
      `).run(row.id);
    }

    db.prepare(`
      DELETE FROM training_reject_wait
      WHERE created_at<?
    `).run(now - REJECT_REPLY_TIMEOUT);

  }, 10000);
}
