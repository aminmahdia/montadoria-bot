import fs from 'node:fs';

const file = 'src/training.js';
if (!fs.existsSync(file)) {
  console.error('خطا: src/training.js پیدا نشد. ابتدا وارد پوشه montadoria-bot شو.');
  process.exit(1);
}

let s = fs.readFileSync(file, 'utf8');
const original = s;

function replaceOnce(oldText, newText, label) {
  const count = s.split(oldText).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: بخش موردنظر دقیقاً یک‌بار پیدا نشد (تعداد: ${count}). فایل تغییر نکرد.`);
  }
  s = s.replace(oldText, newText);
}

// 1) Tables for saved user videos and pending requests.
replaceOnce(
`CREATE TABLE IF NOT EXISTS training_reject_wait (
  manager_id TEXT PRIMARY KEY,
  review_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
\`);`,
`CREATE TABLE IF NOT EXISTS training_reject_wait (
  manager_id TEXT PRIMARY KEY,
  review_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS training_profile_media (
  telegram_id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  file_unique_id TEXT,
  source_chat_id TEXT,
  source_message_id INTEGER,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  file_size INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS training_profile_media_requests (
  telegram_id TEXT PRIMARY KEY,
  requested_at INTEGER NOT NULL
);
\`);`,
'media tables'
);

// 2) Migrations for old profile posts.
replaceOnce(
`ensureColumn("training_sessions", "xp_per_minute", "INTEGER");`,
`ensureColumn("training_sessions", "xp_per_minute", "INTEGER");
ensureColumn("training_profile_posts", "protect_content", "INTEGER NOT NULL DEFAULT 0");`,
'protected profile migration'
);

// 3) Video registration helpers.
replaceOnce(
`const setSetting = (key, value) =>
  db.prepare(\`
    INSERT INTO training_settings(key,value)
    VALUES(?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  \`).run(key, String(value));`,
`const setSetting = (key, value) =>
  db.prepare(\`
    INSERT INTO training_settings(key,value)
    VALUES(?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  \`).run(key, String(value));

const TRAINING_PROFILE_VIDEO_MAX_SECONDS = 8;
const TRAINING_PROFILE_VIDEO_MAX_BYTES = 8 * 1024 * 1024;

function hasTrainingProfileVideo(telegramId) {
  return !!db.prepare(\`
    SELECT 1 FROM training_profile_media
    WHERE telegram_id=?
    LIMIT 1
  \`).get(String(telegramId));
}

function createTrainingProfileVideoRequest(telegramId) {
  return db.prepare(\`
    INSERT OR IGNORE INTO training_profile_media_requests(
      telegram_id, requested_at
    ) VALUES(?,?)
  \`).run(
    String(telegramId),
    Math.floor(Date.now() / 1000)
  );
}

function trainingProfileVideoPrompt() {
  return [
    "🎞 برای ساخت کارت مهارت مونتادوریا، یک ویدئوی کوتاه از شخصیتت بفرست.",
    "",
    "شرایط ویدئو:",
    "• مدت: حداکثر ۸ ثانیه",
    "• حجم: حداکثر ۸ مگابایت",
    "• ویدئو بدون متن و ترجیحاً با چهره یا ظاهر واضح شخصیت باشد.",
    "• ویدئو را همین‌جا در گفت‌وگوی خصوصی ربات به‌صورت Video ارسال کن؛ نه به‌شکل فایل یا استیکر.",
    "",
    "پس از ثبت، می‌توانی از گروه RP دستور #تمرین‌ها را اجرا کنی."
  ].join("\\n");`,
'video helpers'
);

// 4) Run every profile render in a single queue.
replaceOnce(
`async function updatePersistentSkillProfile(bot, telegramId) {`,
`async function renderPersistentSkillProfile(bot, telegramId) {`,
'rename renderer'
);

replaceOnce(
`  const oldPost = db.prepare(\`
    SELECT chat_id, message_id
    FROM training_profile_posts
    WHERE telegram_id=?
  \`).get(String(telegramId));`,
`  const oldPost = db.prepare(\`
    SELECT chat_id, message_id, protect_content
    FROM training_profile_posts
    WHERE telegram_id=?
  \`).get(String(telegramId));`,
'old post select'
);

replaceOnce(
`  if (oldPost && String(oldPost.chat_id) === String(chatId)) {`,
`  if (
    oldPost &&
    String(oldPost.chat_id) === String(chatId) &&
    Number(oldPost.protect_content || 0) === 1
  ) {`,
'edit only protected post'
);

replaceOnce(
`        UPDATE training_profile_posts
        SET updated_at=?
        WHERE telegram_id=?`,
`        UPDATE training_profile_posts
        SET updated_at=?, protect_content=1
        WHERE telegram_id=?`,
'update protected flag'
);

replaceOnce(
`    { caption }
  );`,
`    {
      caption,
      protect_content: true
    }
  );`,
'protect new photo card'
);

replaceOnce(
`    INSERT INTO training_profile_posts(
      telegram_id, chat_id, message_id, updated_at
    )
    VALUES(?,?,?,?)`,
`    INSERT INTO training_profile_posts(
      telegram_id, chat_id, message_id, updated_at, protect_content
    )
    VALUES(?,?,?,?,1)`,
'insert protected post'
);

replaceOnce(
`}

// NOTIFY PLAYER

async function notifyPlayer(bot, review, approved) {`,
`}

// تمام به‌روزرسانی کارت‌ها از یک صف عبور می‌کنند تا sharp هم‌زمان
// چند تصویر سنگین را روی هاست تولید نکند.
let profileGenerationQueue = Promise.resolve();

function updatePersistentSkillProfile(bot, telegramId) {
  const task = profileGenerationQueue
    .catch(() => {})
    .then(() => renderPersistentSkillProfile(bot, telegramId));

  profileGenerationQueue = task.catch(error => {
    console.error(
      "TRAINING_PROFILE_QUEUE_ERROR:",
      error?.description || error?.message || error
    );
  });

  return task;
}

// NOTIFY PLAYER

async function notifyPlayer(bot, review, approved) {`,
'queue wrapper'
);

// 5) Admin command: clear stored video, try to delete the submitted message, and ask again.
replaceOnce(
`  // PREDEFINED EXERCISES

  bot.hears(/^افزودن تمرین\\s*\\|/i, async ctx => {`,
`  // حذف و درخواست دوباره ویدئوی کارت مهارت توسط مدیر
  bot.hears(/^حذف ویدئوی کارت\\s*\\|\\s*(\\d{5,20})$/i, async ctx => {
    if (!ctx.from || !isManager(ctx)) return;

    const targetId = String(ctx.match[1]).trim();

    const oldMedia = db.prepare(\`
      SELECT source_chat_id, source_message_id
      FROM training_profile_media
      WHERE telegram_id=?
    \`).get(targetId);

    db.prepare(\`
      DELETE FROM training_profile_media
      WHERE telegram_id=?
    \`).run(targetId);

    db.prepare(\`
      INSERT INTO training_profile_media_requests(telegram_id, requested_at)
      VALUES(?,?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        requested_at=excluded.requested_at
    \`).run(targetId, Math.floor(Date.now() / 1000));

    let oldMessageDeleted = false;
    if (oldMedia?.source_chat_id && oldMedia?.source_message_id) {
      try {
        await bot.api.deleteMessage(
          oldMedia.source_chat_id,
          oldMedia.source_message_id
        );
        oldMessageDeleted = true;
      } catch {}
    }

    let privateRequestSent = false;
    try {
      await bot.api.sendMessage(
        targetId,
        "♻️ ویدئوی کارت مهارتت توسط مدیریت حذف شد. لطفاً ویدئوی جدیدت را ارسال کن.\\n\\n" +
        trainingProfileVideoPrompt()
      );
      privateRequestSent = true;
    } catch {}

    return ctx.reply(
      "✅ درخواست حذف ویدئوی کارت انجام شد.\\n" +
      (oldMedia ? "ویدئوی ذخیره‌شده از پرونده پاک شد.\\n" : "ویدئوی ذخیره‌شده‌ای وجود نداشت.\\n") +
      (oldMessageDeleted ? "پیام ویدئوی قبلی نیز از گفت‌وگوی خصوصی حذف شد.\\n" : "") +
      (privateRequestSent
        ? "✅ درخواست ویدئوی جدید به خصوصی کاربر ارسال شد."
        : "⚠️ پیام خصوصی ارسال نشد؛ کاربر باید ربات را باز کند و /trainingvideo را بزند.")
    );
  });

  // PREDEFINED EXERCISES

  bot.hears(/^افزودن تمرین\\s*\\|/i, async ctx => {`,
'admin video reset command'
);

// 6) Private user command for requesting the video.
replaceOnce(
`  bot.hears(/^#تمرین‌ها$/i, async ctx => {`,
`  bot.command("trainingvideo", async ctx => {
    if (!ctx.from) return;

    if (ctx.chat.type !== "private") {
      return ctx.reply(
        "برای ثبت ویدئوی کارت، به گفت‌وگوی خصوصی ربات برو و دستور /trainingvideo را بزن."
      );
    }

    if (hasTrainingProfileVideo(ctx.from.id)) {
      return ctx.reply(
        "✅ ویدئوی کارت مهارتت قبلاً ثبت شده است. برای جایگزینی، باید مدیر دستور حذف ویدئوی کارت را اجرا کند."
      );
    }

    createTrainingProfileVideoRequest(ctx.from.id);
    return ctx.reply(trainingProfileVideoPrompt());
  });

  bot.hears(/^#تمرین‌ها$/i, async ctx => {`,
'private trainingvideo command'
);

// 7) First-time training gate.
replaceOnce(
`    const rows = db.prepare(\`
      SELECT id,name,skill
      FROM training_exercises ORDER BY id
    \`).all();`,
`    if (!hasTrainingProfileVideo(ctx.from.id)) {
      const request = createTrainingProfileVideoRequest(ctx.from.id);

      if (request.changes) {
        try {
          await bot.api.sendMessage(
            String(ctx.from.id),
            "برای فعال‌سازی کارت مهارت، ابتدا ویدئوی کوتاه شخصیتت را ارسال کن.\\n\\n" +
            trainingProfileVideoPrompt()
          );
        } catch {}
      }

      return ctx.reply(
        "🎞 پیش از شروع اولین تمرین، باید ویدئوی کارت مهارتت را در گفت‌وگوی خصوصی ربات ثبت کنی.\\n" +
        "ربات را باز کن و /trainingvideo را بزن. پس از ارسال ویدئو دوباره #تمرین‌ها را اجرا کن."
      );
    }

    const rows = db.prepare(\`
      SELECT id,name,skill
      FROM training_exercises ORDER BY id
    \`).all();`,
'first-time video gate'
);

// 8) Receive videos only when a user has an active request.
replaceOnce(
`  // MANAGER PRIVATE REJECTION REASON + SESSION ACTIVITY

  bot.on("message:text", async (ctx, next) => {`,
`  // دریافت و ذخیره ویدئوی اختصاصی کارت در گفت‌وگوی خصوصی
  bot.on("message:video", async (ctx, next) => {
    if (!ctx.from || ctx.chat.type !== "private") return next();

    const id = String(ctx.from.id);
    const request = db.prepare(\`
      SELECT requested_at
      FROM training_profile_media_requests
      WHERE telegram_id=?
    \`).get(id);

    if (!request) return next();

    const video = ctx.message.video;
    const duration = Number(video.duration || 0);
    const fileSize = Number(video.file_size || 0);

    if (duration < 1 || duration > TRAINING_PROFILE_VIDEO_MAX_SECONDS) {
      return ctx.reply(
        \`⛔ مدت ویدئو باید بین ۱ تا \${TRAINING_PROFILE_VIDEO_MAX_SECONDS} ثانیه باشد. ویدئوی دیگری بفرست.\`
      );
    }

    if (fileSize > TRAINING_PROFILE_VIDEO_MAX_BYTES) {
      return ctx.reply("⛔ حجم ویدئو نباید بیشتر از ۸ مگابایت باشد. نسخه کم‌حجم‌تری بفرست.");
    }

    db.prepare(\`
      INSERT INTO training_profile_media(
        telegram_id,file_id,file_unique_id,source_chat_id,
        source_message_id,duration_seconds,file_size,updated_at
      )
      VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        file_id=excluded.file_id,
        file_unique_id=excluded.file_unique_id,
        source_chat_id=excluded.source_chat_id,
        source_message_id=excluded.source_message_id,
        duration_seconds=excluded.duration_seconds,
        file_size=excluded.file_size,
        updated_at=excluded.updated_at
    \`).run(
      id,
      video.file_id,
      video.file_unique_id || null,
      String(ctx.chat.id),
      Number(ctx.message.message_id),
      duration,
      fileSize,
      Math.floor(Date.now() / 1000)
    );

    db.prepare(\`
      DELETE FROM training_profile_media_requests
      WHERE telegram_id=?
    \`).run(id);

    return ctx.reply(
      "✅ ویدئوی کارت مهارتت دریافت و ثبت شد. حالا به گروه RP برگرد و #تمرین‌ها را اجرا کن."
    );
  });

  // MANAGER PRIVATE REJECTION REASON + SESSION ACTIVITY

  bot.on("message:text", async (ctx, next) => {`,
'private video handler'
);

if (s === original) throw new Error('هیچ تغییری اعمال نشد.');
fs.writeFileSync(file, s, 'utf8');
console.log('✅ تغییرات در src/training.js اعمال شد.');
console.log('مرحله بعد: node --check src/training.js');
