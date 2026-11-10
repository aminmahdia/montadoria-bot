import db from "./database.js";
import { InputFile } from "grammy";
import sharp from "sharp";
import ffmpegPath from "ffmpeg-static";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const runFFmpeg = promisify(execFile);

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

CREATE TABLE IF NOT EXISTS training_profile_videos (
  telegram_id TEXT PRIMARY KEY,
  video_file_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS training_profile_photo_requests (
  telegram_id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  prompt_message_id INTEGER NOT NULL DEFAULT 0,
  requested_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS training_reject_wait (
  manager_id TEXT PRIMARY KEY,
  review_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS training_profile_video_request_once (
  telegram_id TEXT PRIMARY KEY,
  requested_at INTEGER NOT NULL
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

ensureColumn("training_sessions", "exercise_id", "INTEGER");
ensureColumn("training_sessions", "exercise_name", "TEXT");
ensureColumn("training_sessions", "skill", "TEXT");
ensureColumn("training_sessions", "points_per_minute", "INTEGER");
ensureColumn("training_sessions", "xp_per_minute", "INTEGER");

db.exec(`
CREATE TABLE IF NOT EXISTS training_exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  skill TEXT NOT NULL,
  points_per_minute INTEGER NOT NULL,
  xp_per_minute INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at INTEGER NOT NULL
);
`);

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

  if (parts.length !== 2) return null;

  const mode = parts[1].toLowerCase();

  if (!["گروهی", "انفرادی"].includes(mode)) {
    return null;
  }

  return { mode };
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

function reviewLinksKeyboard(sourceUrl) {
  const rows = [];

  if (sourceUrl) {
    rows.push([
      {
        text: "🔎 مشاهده پیام اصلی تمرین",
        url: sourceUrl
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

  const reply_markup = reviewLinksKeyboard(sourceUrl);

  const finalText = sourceUrl ||
    !review.source_chat_id ||
    !review.source_message_id
    ? text
    : `${text}\n\nپیام اصلی: گروه ${review.source_chat_id} | پیام ${review.source_message_id}`;

  const reviewChatId =
    review.review_chat_id || fallbackMessage?.chat?.id;

  const reviewMessageId =
    review.review_message_id || fallbackMessage?.message_id;

  // گزارش نهایی فقط در همان پیام گروه ناظران ثبت می‌شود.
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

  // حذف پیام موقت قدیمی از کانال مهارت.
  const channelId =
    review.channel_id || getSetting("skill_channel_id");

  if (channelId && review.channel_message_id) {
    try {
      await bot.api.deleteMessage(
        channelId,
        review.channel_message_id
      );
    } catch (error) {
      console.error(
        "TRAINING_SKILL_REQUEST_DELETE_ERROR:",
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

  const rows = Array.isArray(skills)
    ? skills.slice(0, PROFILE_SKILLS_LIMIT)
    : [];

  const photo = photoBuffer
    ? `<image href="data:image/jpeg;base64,${photoBuffer.toString("base64")}" x="470" y="220" width="260" height="260" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)"/>`
    : `<circle cx="600" cy="350" r="126" fill="#170d20"/>
       <text x="600" y="370" text-anchor="middle" font-size="76" fill="#d8b36a">${escapeSvg((user.display_name || "M").trim().slice(0, 1).toUpperCase())}</text>`;

  const placements = [
    { x: 280, y: 265, side: "left" },
    { x: 920, y: 265, side: "right" },
    { x: 280, y: 465, side: "left" },
    { x: 920, y: 465, side: "right" }
  ];

  const glowFilters = rows.map((skill, index) => {
    const percent = Math.min(
      100,
      Math.max(0, Math.round(
        Number(skill.points || 0) / SKILL_MASTERY_POINTS * 100
      ))
    );

    const glowColor =
      percent >= 100 ? "#ff8ed8" :
      percent >= 75 ? "#c27aff" :
      percent >= 50 ? "#58cfff" :
      percent >= 25 ? "#ffd16d" : "#ff7547";

    const blur = (2.5 + percent * 0.12).toFixed(1);
    const opacity = (0.20 + percent * 0.007).toFixed(2);

    return `<filter id="weaponGlow${index}" x="-100%" y="-100%" width="300%" height="300%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="${blur}" result="blur"/>
      <feFlood flood-color="${glowColor}" flood-opacity="${opacity}" result="flood"/>
      <feComposite in="flood" in2="blur" operator="in" result="glow"/>
      <feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>`;
  }).join("");

  const skillMarkup = rows.length
    ? rows.map((skill, index) => {
        const pos = placements[index];

        const percent = Math.min(
          100,
          Math.max(0, Math.round(
            Number(skill.points || 0) / SKILL_MASTERY_POINTS * 100
          ))
        );

        const color = fireColor(percent);

        const glowColor =
          percent >= 100 ? "#ff8ed8" :
          percent >= 75 ? "#c27aff" :
          percent >= 50 ? "#58cfff" :
          percent >= 25 ? "#ffd16d" : "#ff7547";

        const blur = (2.5 + percent * 0.12).toFixed(1);
        const flameOpacity = (0.12 + percent * 0.0065).toFixed(2);
        const weaponScale = "1.35";
        const strokeWidth = (3 + percent * 0.035).toFixed(1);


        const skillName = String(skill.skill || "مهارت").toLowerCase();
        let weapon;

        if (/شمشیر|sword/.test(skillName)) {
          weapon = `
            <path d="M0,-72 L13,-13 L9,7 L-9,7 L-13,-13 Z"
                  fill="${color}" stroke="#fff0c7"
                  stroke-width="${strokeWidth}" stroke-linejoin="round"/>
            <path d="M0,-65 V2" stroke="#fff8df"
                  stroke-width="2.2" opacity=".9"/>
            <path d="M-32,5 Q0,17 32,5"
                  fill="none" stroke="#f0cf8b"
                  stroke-width="${Number(strokeWidth) + 2}"
                  stroke-linecap="round"/>
            <path d="M0,13 V57"
                  stroke="#b77b43" stroke-width="13"
                  stroke-linecap="round"/>
            <path d="M-6,23 L6,30 M-6,35 L6,42 M-6,47 L6,54"
                  stroke="#f1d5a0" stroke-width="2.5"/>
            <path d="M-13,59 Q0,76 13,59 L9,54 H-9 Z"
                  fill="#d9b36c" stroke="#fff0c7" stroke-width="2"/>
          `;
        } else if (/خنجر|چاقو|dagger|knife/.test(skillName)) {
          weapon = `
            <path d="M0,-39 L10,5 L0,15 L-10,5 Z"
                  fill="${color}" stroke="#fff0c7" stroke-width="2"/>
            <path d="M-17,15 H17 M0,15 V36 M-8,36 H8"
                  fill="none" stroke="#d9b36c"
                  stroke-width="${strokeWidth}" stroke-linecap="round"/>
          `;
        } else if (/تفنگ|اسلحه|تیراندازی|gun|rifle|shoot/.test(skillName)) {
          weapon = `
            <path d="M-43,-10 H34 L47,-3 H16 L11,8 H-4 L-11,0 H-43 Z"
                  fill="${color}" stroke="#ffe6ba" stroke-width="2"
                  stroke-linejoin="round"/>
            <path d="M-7,7 L-2,29 L11,29 L14,7 M-29,-10 V-19 H-8 V-10"
                  fill="none" stroke="#d9b36c"
                  stroke-width="${strokeWidth}" stroke-linejoin="round"/>
          `;
        } else if (/کمان|archery|bow/.test(skillName)) {
          weapon = `
            <path d="M-13,-43 C39,-26 39,26 -13,43"
                  fill="none" stroke="${color}"
                  stroke-width="${Number(strokeWidth) + 1}"
                  stroke-linecap="round"/>
            <path d="M-13,-43 L-13,43 M-13,0 H43 M30,-8 L43,0 L30,8"
                  fill="none" stroke="#ffe6ba" stroke-width="2"
                  stroke-linecap="round" stroke-linejoin="round"/>
          `;
        } else if (/تبر|axe/.test(skillName)) {
          weapon = `
            <path d="M-3,-42 L3,42" stroke="#d9b36c"
                  stroke-width="${Number(strokeWidth) + 2}" stroke-linecap="round"/>
            <path d="M0,-38 C28,-49 47,-29 39,-8 C29,2 14,1 2,-3 Z"
                  fill="${color}" stroke="#ffe6ba" stroke-width="2"/>
          `;
        } else if (/نیزه|spear/.test(skillName)) {
          weapon = `
            <path d="M0,-46 L0,43" stroke="#d9b36c"
                  stroke-width="${Number(strokeWidth) + 2}" stroke-linecap="round"/>
            <path d="M0,-49 L13,-18 L0,-24 L-13,-18 Z"
                  fill="${color}" stroke="#ffe6ba" stroke-width="2"/>
          `;
        } else if (/مشت|بوکس|boxing|拳/.test(skillName)) {
          weapon = `
            <path d="M-34,-8 C-38,-23 -22,-30 -12,-20 L-6,-12 L-4,-28
                     C-2,-40 13,-39 15,-26 L17,-13 L22,-27
                     C27,-38 41,-31 37,-18 L31,15
                     C27,30 14,37 -3,34 L-22,27
                     C-33,22 -38,5 -34,-8 Z"
                  fill="${color}" stroke="#ffe6ba" stroke-width="2"/>
            <path d="M-24,13 L24,13" stroke="#8d2132" stroke-width="5"/>
          `;
        } else {
          weapon = `
            <path d="M0,-45 L10,-7 L5,7 L-5,7 L-10,-7 Z"
                  fill="${color}" stroke="#fff0c7" stroke-width="2"/>
            <path d="M-21,8 H21 M0,7 V36 M-9,36 H9"
                  fill="none" stroke="#d9b36c"
                  stroke-width="${strokeWidth}" stroke-linecap="round"/>
          `;
        }

        return `
          <g>
            <g data-flame-x="${pos.x}" data-flame-y="${pos.y}" data-flame-level="${percent}" transform="translate(${pos.x} ${pos.y})">
              <ellipse cx="0" cy="0"
                       rx="${46 + percent * 0.10}"
                       ry="${38 + percent * 0.08}"
                       fill="url(#fireAura)" opacity="${flameOpacity}"/>

              <g transform="scale(${weaponScale})"
                 filter="url(#weaponGlow${index})">
                ${weapon}
              </g>
            </g>

          </g>`;
      }).join("")
    : `<text x="600" y="545" text-anchor="middle"
             font-size="22" fill="#d9c8a7">هنوز مهارتی ثبت نشده است.</text>`;

  return `
  <svg xmlns="http://www.w3.org/2000/svg"
       width="${width}" height="${height}"
       viewBox="0 0 ${width} ${height}"
       font-family="DejaVu Sans,Arial,sans-serif">

    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#030305"/>
        <stop offset=".38" stop-color="#100817"/>
        <stop offset=".72" stop-color="#260b20"/>
        <stop offset="1" stop-color="#050407"/>
      </linearGradient>

      <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#765324"/>
        <stop offset=".5" stop-color="#f4d58b"/>
        <stop offset="1" stop-color="#765324"/>
      </linearGradient>

      <linearGradient id="rainbowFire" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ff315d"/>
        <stop offset=".2" stop-color="#ff9b32"/>
        <stop offset=".4" stop-color="#ffe34e"/>
        <stop offset=".6" stop-color="#45e08b"/>
        <stop offset=".8" stop-color="#42b9ff"/>
        <stop offset="1" stop-color="#c15cff"/>
      </linearGradient>

      <radialGradient id="fireAura">
        <stop offset="0" stop-color="#fff0c4" stop-opacity=".85"/>
        <stop offset=".35" stop-color="#ff8d44" stop-opacity=".55"/>
        <stop offset="1" stop-color="#a51d50" stop-opacity="0"/>
      </radialGradient>

      <clipPath id="avatarClip">
        <circle cx="600" cy="350" r="126"/>
      </clipPath>

      <pattern id="grain" width="48" height="48"
               patternUnits="userSpaceOnUse">
        <path d="M0 24H48 M24 0V48"
              stroke="#ffffff" stroke-opacity=".025" stroke-width="1"/>
      </pattern>

      ${glowFilters}
    </defs>

    <rect width="1200" height="720" fill="url(#bg)"/>
    <rect width="1200" height="720" fill="url(#grain)"/>

    <rect x="18" y="18" width="1164" height="684" rx="24"
          fill="none" stroke="url(#gold)" stroke-width="3"/>

    <rect x="29" y="29" width="1142" height="662" rx="18"
          fill="none" stroke="#743e69" stroke-width="1" opacity=".65"/>

    <path d="M60 145 H1140" stroke="url(#gold)"
          stroke-width="1.5" opacity=".65"/>

    <path d="M60 650 H1140" stroke="#8c633c"
          stroke-width="1" opacity=".55"/>

    <g transform="translate(112 91)" fill="none"
       stroke="#c49c58" stroke-width="3" stroke-linejoin="round">
      <path d="M-35,-29 L-17,-13 L0,-24 L17,-13 L35,-29
               L29,5 L17,27 L0,39 L-17,27 L-29,5 Z"/>
      <path d="M-19,1 L-5,7 L-18,13 M19,1 L5,7 L18,13
               M-8,24 L0,29 L8,24"/>
      <path d="M-35,-29 L-30,-5 M35,-29 L30,-5"/>
    </g>

    <g transform="translate(1088 91)" fill="none"
       stroke="#d9b36c" stroke-width="3" stroke-linejoin="round">
      <path d="M0,-39 C-19,-25 -19,-7 0,5
               C19,-7 19,-25 0,-39 Z"/>
      <path d="M0,5 C-22,-1 -31,12 -22,27
               C-10,30 -3,22 0,5 Z"/>
      <path d="M0,5 C22,-1 31,12 22,27
               C10,30 3,22 0,5 Z"/>
      <path d="M0,5 V40 M-15,40 H15"/>
    </g>

    <text x="600" y="78" text-anchor="middle" font-size="36"
          font-weight="bold" letter-spacing="8"
          fill="url(#gold)">MONTADORIA</text>

    <text x="600" y="113" text-anchor="middle" font-size="15"
          letter-spacing="5" fill="#bba4c4">
      WOLF · FLEUR-DE-LIS · MASTERY
    </text>

    <text x="600" y="183" text-anchor="middle" font-size="19"
          letter-spacing="4" fill="#d6b873">
      PLAYER SKILL ARCHIVE
    </text>

    <circle cx="600" cy="350" r="139" fill="#100817"
            stroke="#795333" stroke-width="2"/>

    <circle cx="600" cy="350" r="133" fill="none"
            stroke="url(#gold)" stroke-width="5"/>

    ${photo}

    <circle cx="600" cy="350" r="129" fill="none"
            stroke="#a45d91" stroke-width="2" opacity=".75"/>

    ${skillMarkup}

    <text x="600" y="535" text-anchor="middle"
          font-size="25" fill="#f1dcae">
      ${escapeSvg(String(displayName).slice(0, 32))}
    </text>

    <text x="600" y="574" text-anchor="middle"
          font-size="18" fill="#d6b873">
      XP ${Number(xp || 0)}  ·  LEVEL ${Number(level || 1)}
    </text>

    <text x="600" y="610" text-anchor="middle"
          font-size="15" fill="#a995b2">
      TELEGRAM ID · ${escapeSvg(user.telegram_id)}
    </text>

    <text x="600" y="675" text-anchor="middle"
          font-size="13" letter-spacing="4" fill="#80658e">
      THE FIRST CIRCLE · MONTADORIA
    </text>
  </svg>`;
}

const profileGenerationQueues = new Map();


// DOWNLOAD PLAYER PROFILE VIDEO
async function getTrainingProfileVideoBuffer(bot, telegramId) {
  const saved = db.prepare(`
    SELECT video_file_id FROM training_profile_videos
    WHERE telegram_id=?
  `).get(String(telegramId));

  if (!saved?.video_file_id) return null;

  const file = await bot.api.getFile(saved.video_file_id);
  if (!file?.file_path) throw new Error("Video file path unavailable.");

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured.");

  const response = await fetch(
    `https://api.telegram.org/file/bot${token}/${file.file_path}`
  );

  if (!response.ok) throw new Error(`Video download failed: ${response.status}`);

  const data = Buffer.from(await response.arrayBuffer());

  if (!data.length || data.length > 20 * 1024 * 1024) {
    throw new Error("Profile video exceeds 20 MB.");
  }

  return data;
}

// REQUEST PLAYER PROFILE VIDEO
async function requestTrainingProfileVideo(
  bot,
  telegramId,
  fallbackChatId = null,
  force = false
) {
  const id = String(telegramId);

  const saved = db.prepare(`
    SELECT video_file_id FROM training_profile_videos
    WHERE telegram_id=?
  `).get(id);

  if (saved?.video_file_id && !force) return false;

  const pending = db.prepare(`
    SELECT telegram_id FROM training_profile_photo_requests
    WHERE telegram_id=?
  `).get(id);

  if (pending && !force) return true;

  if (!force) {
    const requestedBefore = db.prepare(`
      SELECT telegram_id FROM training_profile_video_request_once
      WHERE telegram_id=?
    `).get(id);

    if (requestedBefore) return false;

    db.prepare(`
      INSERT OR IGNORE INTO training_profile_video_request_once(
        telegram_id, requested_at
      ) VALUES(?,?)
    `).run(id, Math.floor(Date.now() / 1000));
  } else {
    db.prepare(`
      INSERT INTO training_profile_video_request_once(telegram_id, requested_at)
      VALUES(?,?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        requested_at=excluded.requested_at
    `).run(id, Math.floor(Date.now() / 1000));
  }

  if (force) {
    db.prepare(`
      DELETE FROM training_profile_photo_requests
      WHERE telegram_id=?
    `).run(id);
  }

  const prompt =
    "🎬 برای کارت مهارت مونتادوریا، یک ویدیوی کوتاه دلخواه ارسال کن.\n\n" +
    "ویدیو باید به‌صورت Video ارسال شود، نه فایل.\n" +
    "حداکثر حجم: ۲۰ مگابایت.\n" +
    "ویدیوی تو در قاب کارت مهارت نمایش داده می‌شود.";

  let sent = null;
  let privateError = null;

  try {
    sent = await bot.api.sendMessage(id, prompt);
  } catch (error) {
    privateError = error;
  }

  const promptMessageId = Number(sent?.message_id || 0);

  if (!sent) {
    const latestReview = db.prepare(`
      SELECT source_chat_id FROM training_reviews
      WHERE telegram_id=? AND source_chat_id IS NOT NULL
      ORDER BY id DESC LIMIT 1
    `).get(id);

    const fallback = String(
      fallbackChatId || latestReview?.source_chat_id || ""
    );

    if (!fallback || fallback === id) {
      throw privateError || new Error("Unable to open private video request.");
    }

    try {
      await bot.api.sendMessage(
        fallback,
        `🎬 بازیکن ${id}: وارد خصوصی ربات شو، /start را بزن و ویدیوی کوتاهت را ارسال کن.`
      );
    } catch (error) {
      db.prepare(`
        DELETE FROM training_profile_video_request_once
        WHERE telegram_id=?
      `).run(id);
      throw error;
    }
  }

  db.prepare(`
    INSERT INTO training_profile_photo_requests(
      telegram_id,chat_id,prompt_message_id,requested_at
    )
    VALUES(?,?,?,?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      chat_id=excluded.chat_id,
      prompt_message_id=excluded.prompt_message_id,
      requested_at=excluded.requested_at
  `).run(id, id, promptMessageId, Math.floor(Date.now() / 1000));

  return true;
}
// RENDER A SHORT, STREAMABLE MP4 VIDEO
async function buildSkillProfileVideo(svg, playerVideoBuffer) {
  if (!ffmpegPath) throw new Error("FFmpeg binary was not installed on the host.");
  if (!playerVideoBuffer?.length) throw new Error("Player profile video is missing.");

  const dir = await mkdtemp(join(tmpdir(), "montadoria-skill-profile-"));
  const pngPath = join(dir, "profile.png");
  const playerPath = join(dir, "player.mp4");
  const mp4Path = join(dir, "profile.mp4");

  try {
    await writeFile(pngPath, await sharp(Buffer.from(svg)).png().toBuffer());
    await writeFile(playerPath, playerVideoBuffer);

    const flames = Array.from(
      svg.matchAll(/data-flame-x="(\d+)" data-flame-y="(\d+)" data-flame-level="(\d+)"/g),
      m => ({
        x: Number(m[1]),
        y: Number(m[2]),
        level: Math.max(0, Math.min(100, Number(m[3]))) / 100
      })
    );

    const frameCount = 24;

    for (let frame = 0; frame < frameCount; frame++) {
      const markup = flames.map((item, index) => {
        const intensity = 0.30 + item.level * 0.68;

        const tongues = Array.from({ length: 5 }, (_, j) => {
          const phase = frame * 0.72 + index * 1.91 + j * 1.37;
          const flicker = 0.76 + 0.24 * Math.sin(phase);
          const height = (42 + item.level * 65) * flicker;
          const width = 7 + item.level * 8;
          const x = [-30, -15, 0, 15, 30][j];
          const drift = Math.sin(phase * 1.4) * (4 + item.level * 6);
          const base = 48;
          const tip = base - height;

          return `
            <path d="M${x-6},${base}
              C${x-width+drift},${base-18}
               ${x-width},${tip+height*.42}
               ${x+drift},${tip}
              C${x+width},${tip+height*.38}
               ${x+width},${base-15}
               ${x+6},${base} Z"
              fill="#ff5728" opacity="${intensity}" filter="url(#fireGlow)"/>
            <path d="M${x-3},${base-2}
              C${x-5},${base-24}
               ${x+drift*.5},${tip+height*.35}
               ${x+drift*.4},${tip+9}
              C${x+8},${tip+height*.55}
               ${x+5},${base-16}
               ${x+3},${base-2} Z"
              fill="#ffd36d" opacity="${intensity*.78}"/>
          `;
        }).join("");

        return `<g transform="translate(${item.x} ${item.y})">${tongues}</g>`;
      }).join("");

      const flameSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720">
          <defs>
            <filter id="fireGlow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="4"/>
            </filter>
          </defs>
          ${markup}
        </svg>`;

      const framePath = join(dir, `flame-${String(frame).padStart(3, "0")}.png`);
      await writeFile(framePath, await sharp(Buffer.from(flameSvg)).png().toBuffer());
    }

    const flamePattern = join(dir, "flame-%03d.png");

    const makeArgs = crf => [
      "-hide_banner", "-loglevel", "error", "-y",
      "-loop", "1", "-framerate", "30", "-i", pngPath,
      "-stream_loop", "-1", "-framerate", "12", "-i", flamePattern,
      "-threads", "1", "-i", playerPath,
      "-filter_complex_threads", "1",
      "-filter_complex",
      "[2:v]scale=260:260:force_original_aspect_ratio=increase,crop=260:260,fps=30,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte((X-W/2)*(X-W/2)+(Y-H/2)*(Y-H/2),126*126),255,0)'[avatar];[0:v][1:v]overlay=0:0:shortest=1[flamed];[flamed][avatar]overlay=470:220:shortest=1:eof_action=endall,fps=30,format=yuv420p[out]",
      "-map", "[out]", "-t", "3", "-shortest",
      "-c:v", "libx264", "-preset", "ultrafast",
      "-crf", String(crf), "-pix_fmt", "yuv420p",
      "-movflags", "+faststart", "-an", "-threads", "1", mp4Path
    ];

    await runFFmpeg(ffmpegPath, makeArgs(30), {
      timeout: 300000, maxBuffer: 8 * 1024 * 1024
    });

    let info = await stat(mp4Path);

    if (info.size > 45 * 1024 * 1024) {
      await runFFmpeg(ffmpegPath, makeArgs(34), {
        timeout: 300000, maxBuffer: 8 * 1024 * 1024
      });
      info = await stat(mp4Path);
    }

    if (!info.size || info.size > 45 * 1024 * 1024) {
      throw new Error("Generated profile video is empty or exceeds the safe 45 MB limit.");
    }

    return await readFile(mp4Path);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// UPDATE THE EXISTING PROFILE POST, WITHOUT DUPLICATING IT

async function updatePersistentSkillProfile(bot, telegramId) {
  const id = String(telegramId);
  const previous = profileGenerationQueues.get(id) || Promise.resolve();

  const task = previous.catch(() => {}).then(async () => {
    const chatId = getSetting("skill_channel_id");

    if (!chatId) {
      throw new Error("کانال مهارت تنظیم نشده است؛ دستور /skillchannel را بررسی کن.");
    }

    const user = userRecord(id) || {
      telegram_id: id,
      display_name: userNameById(id),
      xp: 0,
      level: 1
    };

    const skills = db.prepare(`
      SELECT skill, points, sessions
      FROM training_skills
      WHERE telegram_id=?
      ORDER BY points DESC, skill ASC
    `).all(id);

    const oldPost = db.prepare(`
      SELECT chat_id, message_id
      FROM training_profile_posts
      WHERE telegram_id=?
    `).get(id);

    if (!skills.length && !oldPost) return "waiting_for_approval";

    const videoRow = db.prepare(`
      SELECT video_file_id
      FROM training_profile_videos
      WHERE telegram_id=?
    `).get(id);

    if (!videoRow?.video_file_id) {
      if (skills.length) await requestTrainingProfileVideo(bot, id);
      return "video_request_sent";
    }

    let playerVideoBuffer;

    try {
      playerVideoBuffer = await getTrainingProfileVideoBuffer(bot, id);
    } catch (error) {
      const downloadError = String(
        error?.description || error?.message || error
      );
      console.error("TRAINING_PROFILE_VIDEO_DOWNLOAD_ERROR:", downloadError);

      throw new Error(
        `دانلود ویدئوی ذخیره‌شده از تلگرام ناموفق بود: ${downloadError}`
      );
    }

    if (!playerVideoBuffer?.length) {
      throw new Error("ویدئوی کارت خالی دانلود شد؛ ویدئو را دوباره ارسال کن.");
    }

    const svg = profileSvg(
      user,
      skills,
      user.xp,
      user.level,
      null
    );

    const videoBuffer = await buildSkillProfileVideo(
      svg,
      playerVideoBuffer
    );

    const captionRows = skills.slice(0, 8).map(item => {
      const percent = Math.min(
        100,
        Math.max(
          0,
          Math.round(
            Number(item.points || 0) /
            SKILL_MASTERY_POINTS * 100
          )
        )
      );

      return `${weaponIcon(item.skill)} ${item.skill}: ${percent}% (${item.points} امتیاز)`;
    });

    const caption = [
      "⟡ پرونده ویدیویی دائمی مهارت مونتادوریا ⟡",
      `👤 ${decoratedUserName(id, user.display_name || "بازیکن")}`,
      `🆔 شناسه تلگرام: ${id}`,
      `✨ XP: ${Number(user.xp || 0)} | 🎖 Level: ${Number(user.level || 1)}`,
      ...captionRows,
      "",
      "🔥 در ۱۰۰ امتیاز، نماد هر مهارت به درخشش رنگی کامل می‌رسد."
    ].join("\n").slice(0, 1000);

    if (oldPost && String(oldPost.chat_id) === String(chatId)) {
      try {
        await bot.api.editMessageMedia(
          oldPost.chat_id,
          oldPost.message_id,
          {
            type: "video",
            media: new InputFile(
              videoBuffer,
              "montadoria-skill-profile.mp4"
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
          id
        );

        return "updated";

      } catch (error) {
        const message = String(
          error?.description || error?.message || error
        );

        if (/message is not modified/i.test(message)) {
          console.warn(
            "TRAINING_PROFILE_VIDEO_EDIT_UNCHANGED: publishing a replacement post."
          );
        } else {
          console.error("TRAINING_PROFILE_VIDEO_EDIT_ERROR:", message);
        }
      }
    }

    const sent = await bot.api.sendVideo(
      chatId,
      new InputFile(
        videoBuffer,
        "montadoria-skill-profile.mp4"
      ),
      {
        caption,
        duration: 3,
        width: 1200,
        height: 720,
        supports_streaming: true
      }
    );

    db.prepare(`
      INSERT INTO training_profile_posts(
        telegram_id,chat_id,message_id,updated_at
      )
      VALUES(?,?,?,?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        chat_id=excluded.chat_id,
        message_id=excluded.message_id,
        updated_at=excluded.updated_at
    `).run(
      id,
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

    return "published";
  });

  profileGenerationQueues.set(id, task);

  try {
    return await task;
  } finally {
    if (profileGenerationQueues.get(id) === task) {
      profileGenerationQueues.delete(id);
    }
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

  // READ-ONLY LIVE STATUS OF THE RUNNING DATABASE.
  bot.hears(/^#وضعیت_کارت_مهارت$/i, async ctx => {
    if (!ctx.from || ctx.chat?.type !== "private" || !isManager(ctx)) return;

    const id = String(ctx.from.id);

    const video = db.prepare(`
      SELECT video_file_id FROM training_profile_videos
      WHERE telegram_id=?
    `).get(id);

    const pending = db.prepare(`
      SELECT telegram_id FROM training_profile_photo_requests
      WHERE telegram_id=?
    `).get(id);

    const skills = db.prepare(`
      SELECT COUNT(*) AS total FROM training_skills
      WHERE telegram_id=?
    `).get(id);

    const post = db.prepare(`
      SELECT chat_id, message_id FROM training_profile_posts
      WHERE telegram_id=?
    `).get(id);

    const channel = getSetting("skill_channel_id");

    return ctx.reply([
      "🧾 وضعیت زنده کارت مهارت",
      "نسخه بررسی: CARD_DIAG_20261110_A",
      `ویدئو در دیتابیس: ${video?.video_file_id ? "ثبت شده" : "ثبت نشده"}`,
      `درخواست ویدئو در انتظار: ${pending ? "بله" : "خیر"}`,
      `تعداد مهارت‌های تأییدشده: ${Number(skills?.total || 0)}`,
      `پست کارت در دیتابیس: ${post ? "ثبت شده" : "ثبت نشده"}`,
      `کانال تنظیم‌شده: ${channel || "تنظیم نشده"}`,
      `کانال پست قبلی: ${post?.chat_id || "ندارد"}`,
      `شناسه پیام کارت: ${post?.message_id || "ندارد"}`
    ].join("\n"));
  });

  // ONLY ACCEPT THE REQUESTED PHOTO IN THE PLAYER'S PRIVATE CHAT.
  bot.on("message:video", async (ctx, next) => {
    if (!ctx.from || !ctx.chat || ctx.chat.type !== "private") return next();

    const id = String(ctx.from.id);

    const pending = db.prepare(`
      SELECT chat_id FROM training_profile_photo_requests
      WHERE telegram_id=?
    `).get(id);

    if (!pending || String(ctx.chat.id) !== id || String(pending.chat_id) !== id) {
      return next();
    }

    const video = ctx.message.video;
    if (!video?.file_id) return next();

    if (Number(video.file_size || 0) > 20 * 1024 * 1024) {
      return ctx.reply("❌ حجم ویدیو بیشتر از ۲۰ مگابایت است.");
    }

    db.prepare(`
      INSERT INTO training_profile_videos(
        telegram_id,video_file_id,updated_at
      )
      VALUES(?,?,?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        video_file_id=excluded.video_file_id,
        updated_at=excluded.updated_at
    `).run(id, video.file_id, Math.floor(Date.now() / 1000));

    db.prepare(`
      DELETE FROM training_profile_photo_requests
      WHERE telegram_id=?
    `).run(id);

    db.prepare(`
      DELETE FROM training_profile_video_request_once
      WHERE telegram_id=?
    `).run(id);

    await ctx.reply("✅ ویدیو دریافت شد. کارت مهارت در حال به‌روزرسانی است.");

    try {
      const result = await updatePersistentSkillProfile(bot, id);

      if (result === "updated" || result === "published") {
        await ctx.reply("✅ کارت مهارت در کانال به‌روزرسانی شد.");
      } else if (result === "waiting_for_approval") {
        await ctx.reply("✅ ویدئو ذخیره شد؛ پس از تأیید اولین تمرین، کارت مهارت منتشر می‌شود.");
      } else if (result === "video_request_sent") {
        await ctx.reply("⚠️ هنوز ویدئوی ذخیره‌شده برای کارت در دسترس نیست؛ درخواست ارسال ویدئو ثبت شد.");
      } else {
        await ctx.reply(`⚠️ به‌روزرسانی کارت با وضعیت غیرمنتظره متوقف شد: ${String(result)}`);
      }
    } catch (error) {
      const detail = String(
        error?.description || error?.message || error || "خطای نامشخص"
      );
      const token = String(process.env.TELEGRAM_BOT_TOKEN || "");
      const safeDetail = token ? detail.split(token).join("[TOKEN]") : detail;

      console.error("TRAINING_PROFILE_VIDEO_CREATE_ERROR:", error?.stack || detail);

      await ctx.reply(
        "❌ ویدئو ذخیره شد، اما کارت ساخته نشد.\n" +
        `علت: ${safeDetail.slice(0, 220)}`
      );
    }
  });

  bot.hears(/^#تغییر_ویدئو_کارت$/i, async ctx => {
    if (!ctx.from || !ctx.chat) return;

    try {
      await requestTrainingProfileVideo(
        bot,
        String(ctx.from.id),
        String(ctx.chat.id),
        true
      );

      return ctx.reply("🎬 ویدیوی جدید کارت مهارت را در خصوصی ربات ارسال کن.");
    } catch (error) {
      console.error("TRAINING_PROFILE_VIDEO_REPLACE_ERROR:", error?.description || error?.message || error);
      return ctx.reply("❌ ابتدا در خصوصی ربات /start را بزن.");
    }
  });

  // DELETE PLAYER SKILLS COMMANDS

  bot.hears(
    /^حذف مهارت\s*\|\s*(\d{5,20})\s*\|\s*(.+)$/i,
    async ctx => {
      if (!ctx.from || !isManager(ctx)) return;

      const targetId = String(ctx.match[1]).trim();
      const skill = safeSkill(ctx.match[2]);

      if (!skill) {
        return ctx.reply("❌ نام مهارت معتبر نیست.");
      }

      const result = db.prepare(`
        DELETE FROM training_skills
        WHERE telegram_id=? AND skill=?
      `).run(targetId, skill);

      if (result.changes === 0) {
        return ctx.reply(
          "❌ این مهارت برای بازیکن ثبت نشده است."
        );
      }

      try {
        await updatePersistentSkillProfile(bot, targetId);
      } catch (err) {
        console.error("Skill profile update failed:", err);
      }

      return ctx.reply(
        `✅ مهارت ${skill} از بازیکن ${targetId} حذف شد.\n` +
        "XP و تاریخچه تمرین‌های تأییدشده تغییری نکردند."
      );
    }
  );

  bot.hears(
    /^حذف همه مهارت‌ها\s*\|\s*(\d{5,20})$/i,
    async ctx => {
      if (!ctx.from || !isManager(ctx)) return;

      const targetId = String(ctx.match[1]).trim();

      const result = db.prepare(`
        DELETE FROM training_skills
        WHERE telegram_id=?
      `).run(targetId);

      if (result.changes === 0) {
        return ctx.reply(
          "❌ این بازیکن مهارتی برای حذف ندارد."
        );
      }

      try {
        await updatePersistentSkillProfile(bot, targetId);
      } catch (err) {
        console.error("Skill profile update failed:", err);
      }

      return ctx.reply(
        `✅ تمام مهارت‌های بازیکن ${targetId} حذف شدند.\n` +
        "XP و تاریخچه تمرین‌های تأییدشده تغییری نکردند."
      );
    }
  );



  // PREDEFINED EXERCISES

  bot.hears(/^افزودن تمرین\s*\|/i, async ctx => {
    if (!ctx.from || !isManager(ctx)) return;

    const a = String(ctx.message.text).split("|").map(x => x.trim());

    if (a.length !== 5) {
      return ctx.reply(
        "قالب:\nافزودن تمرین | نام تمرین | مهارت مقصد | امتیاز هر دقیقه | XP هر دقیقه"
      );
    }

    const name = safeSkill(a[1]);
    const skill = safeSkill(a[2]);
    const points = Number(a[3]);
    const xp = Number(a[4]);

    if (!name || !skill ||
        !Number.isFinite(points) || points <= 0 || points > 1000 ||
        !Number.isFinite(xp) || xp < 0 || xp > 1000) {
      return ctx.reply("❌ اطلاعات تمرین معتبر نیست.");
    }

    try {
      const result = db.prepare(`
        INSERT INTO training_exercises(
          name,skill,points_per_minute,xp_per_minute,created_by,created_at
        ) VALUES(?,?,?,?,?,?)
      `).run(
        name, skill, points, xp,
        String(ctx.from.id),
        Math.floor(Date.now() / 1000)
      );

      return ctx.reply(
        `✅ تمرین ثبت شد.\nشناسه: ${result.lastInsertRowid}\n` +
        `نام: ${name}\nمهارت: ${skill}\n` +
        `امتیاز هر دقیقه: ${points}\nXP هر دقیقه: ${xp}`
      );
    } catch (e) {
      if (/UNIQUE|constraint/i.test(String(e.message))) {
        return ctx.reply("❌ این نام تمرین قبلاً ثبت شده است.");
      }
      console.error(e);
      return ctx.reply("❌ ثبت تمرین ناموفق بود.");
    }
  });

  bot.hears(/^ویرایش تمرین\s*\|/i, async ctx => {
    if (!ctx.from || !isManager(ctx)) return;

    const a = String(ctx.message.text).split("|").map(x => x.trim());

    if (a.length !== 6) {
      return ctx.reply(
        "قالب:\nویرایش تمرین | شناسه | نام | مهارت مقصد | امتیاز هر دقیقه | XP هر دقیقه"
      );
    }

    const id = Number(a[1]);
    const name = safeSkill(a[2]);
    const skill = safeSkill(a[3]);
    const points = Number(a[4]);
    const xp = Number(a[5]);

    if (!Number.isSafeInteger(id) || id < 1 || !name || !skill ||
        !Number.isFinite(points) || points <= 0 || points > 1000 ||
        !Number.isFinite(xp) || xp < 0 || xp > 1000) {
      return ctx.reply("❌ اطلاعات ویرایش معتبر نیست.");
    }

    try {
      const r = db.prepare(`
        UPDATE training_exercises
        SET name=?,skill=?,points_per_minute=?,xp_per_minute=?
        WHERE id=?
      `).run(name, skill, points, xp, id);

      return ctx.reply(
        r.changes ? `✅ تمرین ${id} ویرایش شد.` :
        "❌ شناسه تمرین پیدا نشد."
      );
    } catch (e) {
      if (/UNIQUE|constraint/i.test(String(e.message))) {
        return ctx.reply("❌ نام تمرین تکراری است.");
      }
      console.error(e);
      return ctx.reply("❌ ویرایش ناموفق بود.");
    }
  });

  bot.hears(/^حذف تمرین\s*\|\s*(\d+)$/i, async ctx => {
    if (!ctx.from || !isManager(ctx)) return;

    const r = db.prepare(
      "DELETE FROM training_exercises WHERE id=?"
    ).run(Number(ctx.match[1]));

    return ctx.reply(
      r.changes ? "✅ تمرین حذف شد." : "❌ تمرین پیدا نشد."
    );
  });

  bot.hears(/^فهرست تمرین‌ها$/i, async ctx => {
    const rows = db.prepare(`
      SELECT id,name,skill,points_per_minute,xp_per_minute
      FROM training_exercises ORDER BY id
    `).all();

    if (!rows.length) return ctx.reply("هنوز تمرینی ثبت نشده است.");

    return ctx.reply(
      "⟡ فهرست تمرین‌ها ⟡\n\n" +
      rows.map(x =>
        `${x.id}. ${x.name}\nمهارت: ${x.skill}\n` +
        `${x.points_per_minute} امتیاز و ${x.xp_per_minute} XP در دقیقه`
      ).join("\n\n")
    );
  });

  bot.hears(/^#تمرین‌ها$/i, async ctx => {
    if (!ctx.from || !ctx.chat) return;

    if (!inActiveRP(ctx)) {
      return ctx.reply("ابتدا باید #ورود کرده باشید.");
    }

    if (isSleeping(ctx.from.id)) {
      return ctx.reply("در زمان خواب امکان تمرین وجود ندارد.");
    }

    const active = db.prepare(`
      SELECT id,exercise_id,exercise_name
      FROM training_sessions
      WHERE telegram_id=? AND status='active'
      LIMIT 1
    `).get(String(ctx.from.id));

    if (active) {
      return ctx.reply(
        `شما تمرین فعال «${active.exercise_name || "قدیمی"}» دارید.`
      );
    }

    const rows = db.prepare(`
      SELECT id,name,skill
      FROM training_exercises ORDER BY id
    `).all();

    if (!rows.length) {
      return ctx.reply("مدیر هنوز تمرینی تعریف نکرده است.");
    }

    return ctx.reply(
      "یک تمرین انتخاب کن:",
      {
        reply_markup: {
          inline_keyboard: rows.map(x => [{
            text: `${x.name} | ${x.skill}`.slice(0, 64),
            callback_data: `training:start:${x.id}`
          }])
        }
      }
    );
  });

  bot.callbackQuery(/^training:start:(\d+)$/, async ctx => {
    if (!ctx.from || !ctx.chat) return;

    if (!inActiveRP(ctx)) {
      return ctx.answerCallbackQuery({
        text: "ابتدا باید #ورود کرده باشید.",
        show_alert: true
      });
    }

    if (isSleeping(ctx.from.id)) {
      return ctx.answerCallbackQuery({
        text: "در زمان خواب امکان تمرین وجود ندارد.",
        show_alert: true
      });
    }

    const id = String(ctx.from.id);
    const chat = String(ctx.chat.id);

    const active = db.prepare(`
      SELECT id FROM training_sessions
      WHERE telegram_id=? AND status='active'
      LIMIT 1
    `).get(id);

    if (active) {
      return ctx.answerCallbackQuery({
        text: "شما تمرین فعال دارید.",
        show_alert: true
      });
    }

    const exercise = db.prepare(`
      SELECT * FROM training_exercises WHERE id=?
    `).get(Number(ctx.match[1]));

    if (!exercise) {
      return ctx.answerCallbackQuery({
        text: "تمرین پیدا نشد.",
        show_alert: true
      });
    }

    const now = Math.floor(Date.now() / 1000);

    db.prepare(`
      INSERT INTO training_sessions(
        telegram_id,chat_id,started_at,last_activity_at,status,
        exercise_id,exercise_name,skill,points_per_minute,xp_per_minute
      )
      VALUES(?,?,?,?,'active',?,?,?,?,?)
    `).run(
      id, chat, now, now,
      exercise.id, exercise.name, exercise.skill,
      exercise.points_per_minute, exercise.xp_per_minute
    );

    await ctx.answerCallbackQuery({ text: "تمرین آغاز شد." });

    return ctx.editMessageText(
      `✅ تمرین آغاز شد.\n\n` +
      `🏋️ ${exercise.name}\n🥋 مهارت مقصد: ${exercise.skill}\n\n` +
      "برای پایان:\n#پایان_تمرین | گروهی\nیا\n#پایان_تمرین | انفرادی",
      { reply_markup: { inline_keyboard: [] } }
    );
  });

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

    if (!session.exercise_id || !session.skill) {
      db.prepare(`
        UPDATE training_sessions SET status='cancelled' WHERE id=?
      `).run(session.id);

      return ctx.reply(
        "این جلسه با روش قبلی شروع شده؛ لطفاً #تمرین‌ها را انتخاب کن."
      );
    }

    const modeMultiplier = parsed.mode === "گروهی" ? 1.5 : 1;

    // امتیاز مهارت: انفرادی ۱۰ و گروهی ۱۵ در هر ساعت
    const points = (minutes / 60) * 10 * modeMultiplier;

    // XP: هر ۵ دقیقه تمرین، ۲ XP
    const xp = Math.floor(minutes / 5) * 2;
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
      session.skill,
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

    try {
      // درخواست بررسی فقط به گروه ناظران می‌رود.
      // کانال مهارت مخصوص کارت تصویری دائمی بازیکن است.
      const sourceUrl = await messageUrl(
        bot.api,
        chatId,
        sourceMessageId
      );

      const pendingText = formatPendingText(
        review,
        playerName,
        sourceUrl
      );

      const reviewMessage = await bot.api.sendMessage(
        reviewGroup,
        pendingText,
        {
          reply_markup: {
            inline_keyboard: [
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
                : [])
            ]
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

      try {
        await requestTrainingProfileVideo(bot, id, chatId);
      } catch (error) {
        console.error(
          "TRAINING_PROFILE_PHOTO_REQUEST_ERROR:",
          error?.description || error?.message || error
        );
      }

      return ctx.reply(
        "✅ تمرین برای بررسی به گروه اطلاعات ناظران ارسال شد. پس از تصمیم ناظر، امتیاز و XP ثبت می‌شود."
      );

    } catch (error) {
      console.error(
        "TRAINING_SUBMISSION_DELIVERY_ERROR:",
        error?.description || error?.message || error
      );

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
        "دسترسی ربات به گروه اطلاعات و شناسه تنظیم‌شده را بررسی کنید.\n" +
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

      try {
        await bot.api.sendMessage(
          approved.telegram_id,
          "⚠️ تمرین تأیید و امتیاز ثبت شد، اما ساخت کارت مهارت ناموفق بود. برای بررسی وضعیت، دستور #وضعیت_کارت_مهارت را در خصوصی ربات بفرست."
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
