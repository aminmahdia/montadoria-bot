import db from "./database.js";



// MONTADORIA TRAINING SYSTEM — REVIEW GROUP + PERMANENT SKILL PROFILE

const TRAINING_IDLE_SECONDS = 180;
const XP_PER_MINUTE = 2;
const POINTS_PER_MINUTE = 1;
const SKILL_MASTERY_POINTS = 100;
const REJECT_REPLY_TIMEOUT = 10 * 60;

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


async function publishApprovedSkillProgress(bot, review) {
  const channelId = getSetting("training_skill_channel_id");
  if (!channelId) {
    console.error("TRAINING_SKILL_CHANNEL_NOT_SET");
    return false;
  }

  try {
    const skill = db.prepare(`
      SELECT points,sessions
      FROM training_skills
      WHERE telegram_id=? AND skill=?
    `).get(String(review.telegram_id), review.skill);

    if (!skill) throw new Error("اطلاعات مهارت پس از تأیید پیدا نشد.");

    const user = userRecord(review.telegram_id);
    const percent = Math.min(100, Math.max(0, Number(skill.points || 0)));
    const playerName = decoratedUserName(
      review.telegram_id,
      user?.display_name || userNameById(review.telegram_id)
    );

    const message = [
      "⟡ گزارش پیشرفت مهارت مونتادوریا ⟡",
      "",
      `👤 بازیکن: ${playerName}`,
      `🥋 مهارت: ${review.skill}`,
      `⭐ امتیاز مهارت: ${Number(skill.points || 0)}`,
      `📈 میزان پیشرفت: ${percent}%`,
      `🏋️ تمرین‌های تأییدشده: ${Number(skill.sessions || 0)}`,
      `✨ XP فعلی: ${Number(user?.xp || 0)}`,
      `🎖 Level فعلی: ${Number(user?.level || 1)}`
    ].join("\n");

    await bot.api.sendMessage(channelId, message);
    return true;
  } catch (error) {
    console.error(
      "TRAINING_SKILL_CHANNEL_SEND_ERROR:",
      error?.description || error?.message || error
    );
    return false;
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

    const reviewGroup = getSetting("training_review_group_id");

    if (!reviewGroup) {
      return ctx.reply(
        "⚙️ گروه بررسی تمرین تنظیم نشده است. دستور /trainingreviewgroup را داخل همان گروه اجرا کنید."
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
        source_chat_id,source_message_id
      )
      VALUES(?,?,?,?,?,?,?,'pending',?,?,?)
    `).run(
      session.id,
      id,
      session.skill,
      parsed.mode,
      minutes,
      points,
      xp,
      now,
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

  bot.command("trainingskillchannel", async ctx => {
    if (!isManager(ctx)) {
      return ctx.reply("⛔ فقط مدیر یا مالک می‌تواند کانال مهارت را تنظیم کند.");
    }

    const targetId = String(ctx.match || "").trim();
    if (!targetId || !(/^-100\d{5,20}$/.test(targetId) || /^@[A-Za-z0-9_]{5,32}$/.test(targetId))) {
      return ctx.reply(
        "قالب دستور:\n/trainingskillchannel @ChannelUsername\nیا\n/trainingskillchannel -1001234567890"
      );
    }

    try {
      const chat = await ctx.api.getChat(targetId);
      if (chat.type !== "channel") {
        return ctx.reply("❌ مقصد واردشده کانال تلگرام نیست.");
      }

      const me = await ctx.api.getMe();
      const member = await ctx.api.getChatMember(chat.id, me.id);
      if (!["administrator", "creator"].includes(member.status) || member.can_post_messages === false) {
        return ctx.reply("❌ ربات باید در کانال مدیر باشد و اجازهٔ ارسال پیام داشته باشد.");
      }

      setSetting("training_skill_channel_id", String(chat.id));
      return ctx.reply(
        "✅ کانال مهارت با موفقیت تنظیم شد.\nشناسه: " + chat.id
      );
    } catch (error) {
      console.error("TRAINING_SKILL_CHANNEL_SETUP_ERROR:", error?.description || error?.message || error);
      return ctx.reply(
        "❌ تنظیم کانال ناموفق بود. شناسه/آیدی کانال و دسترسی مدیریتی ربات را بررسی کن.\n" +
        String(error?.description || error?.message || error).slice(0, 250)
      );
    }
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
      `${body}`
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

    await publishApprovedSkillProgress(bot, approved);

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
