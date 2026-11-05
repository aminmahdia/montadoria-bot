import db from "./database.js";

// MONTADORIA TRAINING SYSTEM

const TRAINING_IDLE_SECONDS = 180;
const XP_PER_MINUTE = 2;
const POINTS_PER_MINUTE = 1;

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
`);

const getSetting = key =>
  db.prepare("SELECT value FROM training_settings WHERE key=?").get(key)?.value;

const setSetting = (key, value) =>
  db.prepare(`
    INSERT INTO training_settings(key,value)
    VALUES(?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).run(key, String(value));

function userName(ctx) {
  return ctx.from?.first_name ||
    ctx.from?.username ||
    String(ctx.from?.id);
}

function isManager(ctx) {
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

function userXp(id) {
  return Number(
    db.prepare("SELECT xp FROM users WHERE telegram_id=?")
      .get(String(id))?.xp || 0
  );
}

function addXp(id, xp) {
  db.prepare(`
    UPDATE users
    SET xp=COALESCE(xp,0)+?, updated_at=?
    WHERE telegram_id=?
  `).run(
    xp,
    Math.floor(Date.now() / 1000),
    String(id)
  );
}

function safeSkill(s) {
  return String(s || "").trim().slice(0, 80);
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

export function registerTraining(bot) {

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
      SELECT id FROM training_sessions
      WHERE telegram_id=? AND status='active'
    `).get(id);

    if (active) {
      return ctx.reply("شما از قبل یک تمرین فعال دارید.");
    }

    db.prepare(`
      INSERT INTO training_sessions(
        telegram_id,chat_id,started_at,last_activity_at,status
      )
      VALUES(?,?,?,?, 'active')
    `).run(id, chat, now, now);

    await ctx.reply(
      `تمرین شما شروع شد.
برای پایان:
#پایان_تمرین | نام مهارت | گروهی/انفرادی

اگر بیش از ۳ دقیقه فعالیت نداشته باشید تمرین لغو می‌شود.`
    );
  });

  bot.hears(/^#پایان_تمرین\s*\|/i, async ctx => {
    if (!ctx.from || !ctx.message?.text) return;

    const parsed = splitEnd(ctx.message.text);

    if (!parsed) {
      return ctx.reply(
        "قالب درست:\n#پایان_تمرین | نام مهارت | گروهی/انفرادی"
      );
    }

    const id = String(ctx.from.id);
    const now = Math.floor(Date.now() / 1000);

    const session = db.prepare(`
      SELECT * FROM training_sessions
      WHERE telegram_id=? AND status='active'
      ORDER BY id DESC LIMIT 1
    `).get(id);

    if (!session) {
      return ctx.reply("تمرین فعالی برای شما ثبت نشده است.");
    }

    if (now - Number(session.last_activity_at) >
        TRAINING_IDLE_SECONDS) {

      db.prepare(`
        UPDATE training_sessions
        SET status='cancelled'
        WHERE id=?
      `).run(session.id);

      return ctx.reply(
        "تمرین به دلیل بیش از ۳ دقیقه عدم فعالیت لغو شد؛ امتیازی ثبت نشد."
      );
    }

    const minutes = Math.max(
      1,
      Math.floor((now - Number(session.started_at)) / 60)
    );

    const points = minutes * POINTS_PER_MINUTE;
    const xp = minutes * XP_PER_MINUTE;

    db.prepare(`
      UPDATE training_sessions
      SET status='submitted'
      WHERE id=?
    `).run(session.id);

    const review = db.prepare(`
      INSERT INTO training_reviews(
        session_id,telegram_id,skill,mode,
        duration_minutes,points,xp,status,created_at
      )
      VALUES(?,?,?,?,?,?,?,'pending',?)
    `).run(
      session.id,
      id,
      parsed.skill,
      parsed.mode,
      minutes,
      points,
      xp,
      now
    );

    const channel = getSetting("skill_channel_id");

    if (!channel) {
      return ctx.reply(
        "تمرین ثبت شد اما کانال مهارت تنظیم نشده است."
      );
    }

    const msg = await ctx.telegram.sendMessage(
      channel,
      `⟡ درخواست تأیید تمرین
👤 ${userName(ctx)} (@${ctx.from.username || "بدون‌یوزرنیم"})
🆔 ${id}
🥋 مهارت: ${parsed.skill}
👥 نوع: ${parsed.mode}
⏱ مدت: ${minutes} دقیقه
⭐ امتیاز: ${points}
✨ XP: ${xp}`,
      {
        reply_markup: {
          inline_keyboard: [[
            {
              text: "✅ تأیید",
              callback_data: `training:approve:${review.lastInsertRowid}`
            },
            {
              text: "❌ رد",
              callback_data: `training:reject:${review.lastInsertRowid}`
            }
          ]]
        }
      }
    );

    db.prepare(`
      UPDATE training_reviews
      SET channel_message_id=?
      WHERE id=?
    `).run(msg.message_id, review.lastInsertRowid);

    await ctx.reply(
      "تمرین برای بررسی مدیران ارسال شد. پس از تأیید، امتیاز و XP ثبت می‌شود."
    );
  });
  bot.command("skillchannel", async ctx => {
    if (!isManager(ctx)) return;

    const id = ctx.message.text.split(/\s+/)[1];

    if (!id) {
      return ctx.reply("دستور: /skillchannel شناسه_کانال");
    }

    setSetting("skill_channel_id", id);

    return ctx.reply("کانال مهارت تنظیم شد.");
  });

  bot.command("trainingprofile", async ctx => {
    const id = String(ctx.from.id);

    const rows = db.prepare(`
      SELECT skill,points,sessions
      FROM training_skills
      WHERE telegram_id=?
      ORDER BY points DESC
    `).all(id);

    const xp = userXp(id);

    const body = rows.length
      ? rows.map(r =>
          `• ${r.skill}: ${r.points} امتیاز (${r.sessions} تمرین)`
        ).join("\n")
      : "هنوز مهارتی ثبت نشده است.";

    return ctx.reply(
      `⟡ پروفایل مهارت
👤 ${userName(ctx)}
✨ XP: ${xp}
${body}`
    );
  });

  bot.action(/^training:approve:(\d+)$/, async ctx => {
    if (!isManager(ctx)) {
      return ctx.answerCbQuery(
        "دسترسی مدیر لازم است.",
        { show_alert: true }
      );
    }

    const rid = Number(ctx.match[1]);

    const review = db.prepare(`
      SELECT * FROM training_reviews
      WHERE id=? AND status='pending'
    `).get(rid);

    if (!review) {
      return ctx.answerCbQuery(
        "این درخواست قبلاً بررسی شده است.",
        { show_alert: true }
      );
    }

    db.prepare(`
      UPDATE training_reviews
      SET status='approved',reviewer_id=?
      WHERE id=?
    `).run(String(ctx.from.id), rid);

    db.prepare(`
      INSERT INTO training_skills(
        telegram_id,skill,points,sessions
      )
      VALUES(?,?,?,1)
      ON CONFLICT(telegram_id,skill)
      DO UPDATE SET
        points=points+excluded.points,
        sessions=sessions+1
    `).run(
      review.telegram_id,
      review.skill,
      review.points
    );

    addXp(review.telegram_id, review.xp);

    await ctx.editMessageText(
      `${ctx.callbackQuery.message.text}

✅ تأیید شد توسط ${userName(ctx)}.`
    );

    await ctx.answerCbQuery(
      "تمرین تأیید و امتیاز ثبت شد."
    );

    try {
      await ctx.telegram.sendMessage(
        review.telegram_id,
        `تمرین «${review.skill}» تأیید شد.
+${review.points} امتیاز
+${review.xp} XP`
      );
    } catch {}
  });

  bot.action(/^training:reject:(\d+)$/, async ctx => {
    if (!isManager(ctx)) {
      return ctx.answerCbQuery(
        "دسترسی مدیر لازم است.",
        { show_alert: true }
      );
    }

    const rid = Number(ctx.match[1]);

    const review = db.prepare(`
      SELECT * FROM training_reviews
      WHERE id=? AND status='pending'
    `).get(rid);

    if (!review) {
      return ctx.answerCbQuery(
        "این درخواست قبلاً بررسی شده است.",
        { show_alert: true }
      );
    }

    setSetting(
      `training_reject_wait_${ctx.from.id}`,
      String(rid)
    );

    await ctx.answerCbQuery();

    await ctx.reply(
      "دلیل رد این تمرین را در پیام بعدی ارسال کنید."
    );
  });

  bot.on("message:text", async (ctx, next) => {
    if (!ctx.from || !ctx.message?.text) {
      return next();
    }

    const key = `training_reject_wait_${ctx.from.id}`;
    const rid = getSetting(key);

    if (
      rid &&
      isManager(ctx) &&
      !ctx.message.text.startsWith("/")
    ) {
      const review = db.prepare(`
        SELECT * FROM training_reviews
        WHERE id=? AND status='pending'
      `).get(Number(rid));

      if (review) {
        db.prepare(`
          UPDATE training_reviews
          SET status='rejected',
              reviewer_id=?,
              reject_reason=?
          WHERE id=?
        `).run(
          String(ctx.from.id),
          ctx.message.text.slice(0, 500),
          Number(rid)
        );

        setSetting(key, "");

        try {
          await ctx.telegram.editMessageText(
            getSetting("skill_channel_id"),
            review.channel_message_id,
            undefined,
            `❌ درخواست تمرین رد شد
👤 شناسه: ${review.telegram_id}
🥋 مهارت: ${review.skill}
علت: ${ctx.message.text.slice(0, 500)}`
          );

          await ctx.telegram.sendMessage(
            review.telegram_id,
            `تمرین «${review.skill}» رد شد.
علت: ${ctx.message.text.slice(0, 500)}`
          );
        } catch {}

        return ctx.reply("دلیل رد ثبت شد.");
      }
    }

    const id = String(ctx.from.id);
    const now = Math.floor(Date.now() / 1000);

    db.prepare(`
      UPDATE training_sessions
      SET last_activity_at=?
      WHERE telegram_id=? AND status='active'
    `).run(now, id);

    return next();
  });

  setInterval(() => {
    const now = Math.floor(Date.now() / 1000);

    const stale = db.prepare(`
      SELECT id FROM training_sessions
      WHERE status='active'
      AND last_activity_at<?
    `).all(now - TRAINING_IDLE_SECONDS);

    for (const row of stale) {
      db.prepare(`
        UPDATE training_sessions
        SET status='cancelled'
        WHERE id=?
      `).run(row.id);
    }
  }, 10000);
}
