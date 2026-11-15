import db from "./database.js"
import { randomBytes } from "node:crypto"

const OWNER_ID = Number(process.env.OWNER_ID)

const ROLES = {
  user: "کاربر عادی",
  moderator: "مدیر / ناظر",
  owner: "مالک",
}

const USERS_PER_PAGE = 8


function generateUniqueCardNumber() {
  const exists = db.prepare(
    "SELECT 1 FROM users WHERE card_number = ? LIMIT 1"
  );

  for (let attempt = 0; attempt < 1000; attempt++) {
    const randomValue = BigInt(
      "0x" + randomBytes(8).toString("hex")
    );
    const cardNumber = (
      1000000000000000n + randomValue % 9000000000000000n
    ).toString();

    if (!exists.get(cardNumber)) return cardNumber;
  }

  throw new Error("Could not generate a unique Montadoria card number");
}

function getUser(telegramId) {
  return db
    .prepare(`
      SELECT telegram_id, username, display_name,
             money, infinite_money, bank, xp, level, role, job, card_number
      FROM users
      WHERE telegram_id = ?
    `)
    .get(telegramId)
}

function getAllUsers() {
  return db
    .prepare(`
      SELECT telegram_id, username, display_name,
             money, infinite_money, bank, xp, level, role, job, card_number
      FROM users
      ORDER BY id ASC
    `)
    .all()
}

function getCurrentOwner() {
  return db
    .prepare(`
      SELECT telegram_id, username, display_name, role
      FROM users
      WHERE role = 'owner'
      LIMIT 1
    `)
    .get()
}

function isModeratorOrOwner(user) {
  return user && (
    user.role === "moderator" ||
    user.role === "owner"
  )
}

function isOwner(user) {
  return user && user.role === "owner"
}

function syncOwner(telegramId) {
  if (!OWNER_ID || telegramId !== OWNER_ID) return

  const currentOwner = getCurrentOwner()

  if (currentOwner) return

  const user = getUser(telegramId)

  if (!user) return

  db.prepare(`
    UPDATE users
    SET role = 'owner',
        updated_at = ?
    WHERE telegram_id = ?
  `).run(
    new Date().toISOString(),
    telegramId
  )
}

function safeNumber(value) {
  const number = Number(value)

  if (!Number.isFinite(number)) {
    return null
  }

  return number
}
// =========================
// XP / LEVEL SYSTEM
// =========================

function xpRequiredForLevel(level) {
  if (level <= 1) {
    return 0
  }

  return Math.floor(
    100 * Math.pow(level - 1, 1.5)
  )
}

function calculateLevelFromXP(xp) {
  let level = 1

  while (
    xp >= xpRequiredForLevel(level + 1)
  ) {
    level++

    if (level > 1000) {
      break
    }
  }

  return level
}

function addXP(telegramId, amount) {
  const user = getUser(telegramId)

  if (!user) return null

  const xpAmount = Number(amount)

  if (
    !Number.isSafeInteger(xpAmount) ||
    xpAmount <= 0
  ) {
    return null
  }

  const newXP = user.xp + xpAmount

  if (!Number.isSafeInteger(newXP)) {
    return null
  }

  const newLevel = calculateLevelFromXP(newXP)

  db.prepare(`
    UPDATE users
    SET xp = ?,
        level = ?,
        updated_at = ?
    WHERE telegram_id = ?
  `).run(
    newXP,
    newLevel,
    new Date().toISOString(),
    telegramId
  )

  return {
    oldXP: user.xp,
    newXP,
    oldLevel: user.level,
    newLevel,
    gainedXP: xpAmount,
    levelUp: newLevel > user.level
  }
}


function userButtonName(user) {
  const name = user.display_name || "Unknown"

  if (name.length <= 30) {
    return name
  }

  return name.slice(0, 27) + "..."
}

async function showUserList(ctx, page = 0) {
  const requester = getUser(ctx.from.id)

  if (!isModeratorOrOwner(requester)) {
    await ctx.answerCallbackQuery({
      text: "⛔ فقط مدیر یا مالک دسترسی دارد.",
      show_alert: true,
    })
    return
  }

  const users = getAllUsers()

  const totalPages = Math.max(
    1,
    Math.ceil(users.length / USERS_PER_PAGE)
  )

  if (page < 0) page = 0
  if (page >= totalPages) page = totalPages - 1

  const start = page * USERS_PER_PAGE

  const pageUsers = users.slice(
    start,
    start + USERS_PER_PAGE
  )

  const keyboard = []

  for (const user of pageUsers) {
    keyboard.push([
      {
        text:
          `${user.role === "owner" ? "👑" :
            user.role === "moderator" ? "🛡️" : "👤"} ` +
          userButtonName(user),

        callback_data:
          `user_view:${user.telegram_id}:${page}`,
      },
    ])
  }

  const navigation = []

  if (page > 0) {
    navigation.push({
      text: "◀️ قبلی",
      callback_data: `user_page:${page - 1}`,
    })
  }

  navigation.push({
    text: `📄 ${page + 1}/${totalPages}`,
    callback_data: "user_page_current",
  })

  if (page < totalPages - 1) {
    navigation.push({
      text: "بعدی ▶️",
      callback_data: `user_page:${page + 1}`,
    })
  }

  keyboard.push(navigation)

  keyboard.push([
    {
      text: "🔄 بروزرسانی",
      callback_data: `user_page:${page}`,
    },
    {
      text: "↩️ بازگشت",
      callback_data: "owner_panel",
    },
  ])

  const text = [
    "👥 مدیریت کاربران",
    "",
    `تعداد کاربران: ${users.length}`,
    "",
    "برای مشاهده اطلاعات یک کاربر، روی نام او بزنید.",
  ].join("\n")

  await ctx.editMessageText(text, {
    reply_markup: {
      inline_keyboard: keyboard,
    },
  })

  await ctx.answerCallbackQuery()
}

async function showUserDetails(ctx, targetId, page) {
  const requester = getUser(ctx.from.id)

  if (!isModeratorOrOwner(requester)) {
    await ctx.answerCallbackQuery({
      text: "⛔ فقط مدیر یا مالک دسترسی دارد.",
      show_alert: true,
    })
    return
  }

  const target = getUser(targetId)

  if (!target) {
    await ctx.answerCallbackQuery({
      text: "❌ کاربر پیدا نشد.",
      show_alert: true,
    })
    return
  }

  const text = [
    "👤 USER INFORMATION",
    "",
    `Name: ${target.display_name}`,
    `Username: ${target.username ? "@" + target.username : "ندارد"}`,
    `🆔 ID: ${target.telegram_id}`,
    "",
    `💰 Money: ${target.infinite_money ? "♾️" : "$" + target.money}`,
    `🏦 Bank: $${target.bank}`,
    `💳 Card: ${target.card_number}`,
    `⭐ Level: ${target.level}`,
    `✨ XP: ${target.xp}`,
    `💼 Job: ${target.job ?? "Unemployed"}`,
    `🎭 Role: ${ROLES[target.role] ?? target.role}`,
  ].join("\n")

  const keyboard = [
    [
      {
        text: "🎭 تغییر نقش",
        callback_data:
          `user_role:${target.telegram_id}:${page}`,
      },
    ],
    [
      {
        text: "💼 تغییر شغل",
        callback_data:
          `user_job:${target.telegram_id}:${page}`,
      },
    ],
    [
      {
        text: "💰 مدیریت پول",
        callback_data:
          `user_money:${target.telegram_id}:${page}`,
      },
    ],
    [
      {
        text: "🏦 مدیریت بانک",
        callback_data:
          `user_bank:${target.telegram_id}:${page}`,
      },
    ],
    [
      {
        text: "⭐ مدیریت XP / Level",
        callback_data:
          `user_xp:${target.telegram_id}:${page}`,
      },
    ],
    [
      {
        text: "↩️ بازگشت به کاربران",
        callback_data:
          `user_page:${page}`,
      },
    ],
    [
      {
        text: "👑 پنل مالک",
        callback_data: "owner_panel",
      },
    ],
  ]

  if (!isModeratorOrOwner(requester)) {
    const viewOnlyCallbacks = /^(?:user_page:\d+|user_page_current|owner_panel)$/;

    for (let i = keyboard.length - 1; i >= 0; i--) {
      keyboard[i] = keyboard[i].filter(
        button => viewOnlyCallbacks.test(button.callback_data || "")
      );

      if (keyboard[i].length === 0) {
        keyboard.splice(i, 1);
      }
    }
  }

  await ctx.editMessageText(text, {
    reply_markup: {
      inline_keyboard: keyboard,
    },
  })

  await ctx.answerCallbackQuery()
}

async function showOwnerPanel(ctx) {
  const user = getUser(ctx.from.id)

  if (!isOwner(user)) {
    await ctx.answerCallbackQuery({
      text: "⛔ فقط مالک دسترسی دارد.",
      show_alert: true,
    })
    return
  }

  await ctx.editMessageText(
    [
      "👑 MONTADORIA OWNER PANEL",
      "",
      "مدیریت کاربران:",
      "از پنل شیشه‌ای کاربران برای مدیریت سریع استفاده کن.",
      "",
      "دستورات مستقیم:",
      "/user ID",
      "/setrole ID ROLE",
      "/setjob ID JOB",
      "/setmoney ID AMOUNT",
      "/setinfmoney ID",
      "/removeinfmoney ID",
      "/setbank ID AMOUNT",
      "/setxp ID AMOUNT",
      "/setlevel ID LEVEL",
      "",
      "مدیریت مالکیت:",
      "/transferowner ID",
      "/confirmtransfer",
      "",
      "سیستم:",
      "/reset",
      "/confirmreset",
    ].join("\n"),
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "👥 مدیریت کاربران",
              callback_data: "user_page:0",
            },
          ],
          [
            {
              text: "🛡️ وضعیت مدیریت",
              callback_data: "admin_status",
            },
          ],
        ],
      },
    }
  )

  await ctx.answerCallbackQuery()
}

export function registerCommands(bot) {

  // MONTADORIA_MAP_LOCATOR_V1
  db.exec(`
    CREATE TABLE IF NOT EXISTS montadoria_map_invite_links (
      chat_id TEXT PRIMARY KEY,
      invite_link TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  bot.hears(/^(?:مپ من کجاست|من تو کدوم مپم|من در کدام مپ هستم|لینک مپ فعلی)\s*[؟?]?$/u, async (ctx) => {
    if (!ctx.chat || !["group", "supergroup"].includes(ctx.chat.type)) {
      await ctx.reply("این دستور را داخل گروه مپ بفرست.");
      return;
    }

    try {
      const info = await ctx.api.getChat(ctx.chat.id);
      const title = info.title || ctx.chat.title || "مپ فعلی";
      let link = "";

      if (info.username) {
        link = `https://t.me/${info.username}`;
      } else {
        const cached = db.prepare(
          "SELECT invite_link FROM montadoria_map_invite_links WHERE chat_id = ?"
        ).get(String(info.id));

        link = cached?.invite_link || info.invite_link || "";

        if (!link) {
          try {
            const invite = await ctx.api.createChatInviteLink(info.id, {
              name: "لینک مپ مونتادوریا"
            });

            link = invite.invite_link;

            db.prepare(`
              INSERT OR REPLACE INTO montadoria_map_invite_links
                (chat_id, invite_link, updated_at)
              VALUES (?, ?, ?)
            `).run(String(info.id), link, Date.now());
          } catch (_) {
            link = "";
          }
        }
      }

      const linkText = link
        ? `🔗 لینک مپ: ${link}`
        : "🔗 ساخت لینک ممکن نشد؛ ربات برای گروه خصوصی به دسترسی دعوت کاربران نیاز دارد.";

      await ctx.reply(
        `⟡ موقعیت مپ شما ⟡\n\n` +
        `🗺️ نام مپ: ${title}\n` +
        `🆔 شناسه مپ: ${info.id}\n` +
        `${linkText}`
      );
    } catch (_) {
      await ctx.reply("❌ دریافت اطلاعات مپ با خطا روبه‌رو شد.");
    }
  });

  // MONTADORIA_PLACE_MAP_CATALOG_V1
  db.exec(`
    CREATE TABLE IF NOT EXISTS montadoria_place_maps (
      map_id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_chat_id TEXT NOT NULL,
      map_name TEXT NOT NULL COLLATE NOCASE,
      target_chat_id TEXT NOT NULL UNIQUE,
      target_title TEXT NOT NULL DEFAULT '',
      photo_file_id TEXT NOT NULL,
      invite_link TEXT NOT NULL,
      required_job TEXT NOT NULL DEFAULT '',
      required_license TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(location_chat_id, map_name)
    )
  `);

  const mpText = value => String(value ?? "").trim();
  const mpNow = () => Math.floor(Date.now() / 1000);
  const mpManage = ctx => isModeratorOrOwner(getUser(ctx.from?.id));

  const mpDeleteLater = (ctx, message) => {
    if (!message?.chat?.id || !message?.message_id) return;
    const api = ctx.api;
    const timer = setTimeout(() => {
      api.deleteMessage(message.chat.id, message.message_id).catch(() => {});
    }, 60_000);
    timer.unref?.();
  };

  const mpReply = async (ctx, text, extra = {}) => {
    const sent = await ctx.reply(text, extra);
    mpDeleteLater(ctx, sent);
    return sent;
  };

  const mpLicenseExists = code => {
    if (!code) return true;
    try {
      return Boolean(db.prepare(`
        SELECT 1 FROM black_market_license_types
        WHERE code=? AND active=1
      `).get(code));
    } catch {
      return false;
    }
  };

  const mpCanEnterUser = (telegramId, map) => {
    const requiredJob = mpText(map.required_job);
    const requiredLicense = mpText(map.required_license);
    if (!requiredJob && !requiredLicense) return true;

    const user = getUser(Number(telegramId));
    if (!user) return false;
    if (isModeratorOrOwner(user)) return true;
    if (requiredJob && mpText(user.job) !== requiredJob) return false;

    if (requiredLicense) {
      try {
        const ownsLicense = db.prepare(`
          SELECT 1 FROM black_market_user_licenses
          WHERE telegram_id=? AND license_code=? AND active=1
        `).get(String(telegramId), requiredLicense);
        const activeLicense = db.prepare(`
          SELECT 1 FROM black_market_license_types
          WHERE code=? AND active=1
        `).get(requiredLicense);
        if (!ownsLicense || !activeLicense) return false;
      } catch {
        return false;
      }
    }
    return true;
  };

  // ثبت مپ: عکس باید همراه این کپشن، داخل گروه اصلی همان مکان ارسال شود.
  bot.on("message:photo", async ctx => {
    const caption = mpText(ctx.message.caption);
    if (!/^ثبت مپ(?:\s*\||$)/u.test(caption)) return;
    if (!mpManage(ctx)) {
      await mpReply(ctx, "⛔ فقط مالک یا مدیر می‌تواند مپ ثبت کند.");
      return;
    }
    if (!ctx.chat || !["group", "supergroup"].includes(ctx.chat.type)) {
      await mpReply(ctx, "این عکس را همراه دستور ثبت مپ، داخل گروه اصلی همان مکان بفرست.");
      return;
    }

    const match = caption.match(/^ثبت مپ\s*\|\s*([^|]+)\s*\|\s*(-?\d+)\s*\|\s*([^|]+)\s*\|\s*(.+)$/u);
    if (!match) {
      await mpReply(ctx,
        "قالب ثبت مپ درست نیست.\n\n" +
        "عکس را با این کپشن ارسال کن:\n" +
        "ثبت مپ | نام مپ | شناسه گروه مقصد | شغل یا - | کد مجوز یا -\n\n" +
        "برای مپ آزاد، دو شرط آخر را - بگذار.");
      return;
    }

    const mapName = mpText(match[1]);
    const targetChatId = mpText(match[2]);
    const rawJob = mpText(match[3]);
    const rawLicense = mpText(match[4]);
    const requiredJob = rawJob === "-" ? "" : rawJob;
    const requiredLicense = rawLicense === "-" ? "" : rawLicense;
    const photoFileId = ctx.message.photo.at(-1)?.file_id;

    if (!mapName || mapName.length > 80 || !photoFileId) {
      await mpReply(ctx, "نام مپ یا عکس معتبر نیست.");
      return;
    }
    if (requiredLicense && !mpLicenseExists(requiredLicense)) {
      await mpReply(ctx, "⛔ کد مجوز فعال پیدا نشد. ابتدا مجوز را تعریف کن یا - بگذار.");
      return;
    }

    let targetInfo;
    let invite;
    try {
      targetInfo = await ctx.api.getChat(targetChatId);
      if (!["group", "supergroup"].includes(targetInfo.type)) {
        await mpReply(ctx, "شناسه مقصد باید متعلق به یک گروه یا سوپرگروه تلگرام باشد.");
        return;
      }
      if ((requiredJob || requiredLicense) && targetInfo.username) {
        await mpReply(ctx,
          "⛔ این مپ شرط دسترسی دارد؛ گروه مقصد باید خصوصی باشد تا ورود با لینک عمومی دور زده نشود.");
        return;
      }
      const duplicateName = db.prepare(`
        SELECT 1 FROM montadoria_place_maps
        WHERE location_chat_id=? AND map_name=? COLLATE NOCASE
      `).get(String(ctx.chat.id), mapName);
      if (duplicateName) {
        await mpReply(ctx, "مپ دیگری با همین نام در این مکان ثبت شده است.");
        return;
      }
      const duplicateTarget = db.prepare(`
        SELECT 1 FROM montadoria_place_maps WHERE target_chat_id=?
      `).get(targetChatId);
      if (duplicateTarget) {
        await mpReply(ctx, "این گروه مقصد قبلاً به‌عنوان یک مپ ثبت شده است.");
        return;
      }
      invite = await ctx.api.createChatInviteLink(targetChatId, {
        name: "Montadoria Map",
        ...(requiredJob || requiredLicense ? { creates_join_request: true } : {})
      });
    } catch (error) {
      console.error("MONTADORIA map invite creation failed:", error);
      const detail = String(error?.description || error?.message || error).slice(0, 220);
      await mpReply(ctx,
        `❌ ساخت لینک مپ انجام نشد.\\nجزئیات خطا: ${detail}`);
      return;
    }

    try {
      db.prepare(`
        INSERT INTO montadoria_place_maps (
          location_chat_id, map_name, target_chat_id, target_title,
          photo_file_id, invite_link, required_job, required_license,
          created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        String(ctx.chat.id), mapName, targetChatId,
        targetInfo.title || mapName, photoFileId, invite.invite_link,
        requiredJob, requiredLicense, String(ctx.from.id), mpNow(), mpNow()
      );
    } catch {
      try { await ctx.api.revokeChatInviteLink(targetChatId, invite.invite_link); } catch {}
      await mpReply(ctx, "❌ ثبت مپ انجام نشد؛ احتمالاً نام یا گروه مقصد تکراری است.");
      return;
    }

    await mpReply(ctx,
      `✅ مپ «${mapName}» ثبت شد.\n` +
      `📍 مکان: ${ctx.chat.title || "گروه فعلی"}\n` +
      `🔐 شغل لازم: ${requiredJob || "ندارد"}\n` +
      `🔑 مجوز لازم: ${requiredLicense || "ندارد"}\n\n` +
      "برای نمایش فهرست، دستور «مپ‌های این مکان» را بفرست.");
  });

  // هر عکس مپ و دکمه ورود در پیام جدا نمایش داده می‌شود؛ پیام‌های ربات پس از ۶۰ ثانیه پاک می‌شوند.
  bot.hears(/^(?:مپ‌های این مکان|مپ های این مکان|مپ‌های اینجا|مپ های اینجا|لیست مپ‌ها|فهرست مپ‌ها)\s*[؟?]?$/u, async ctx => {
    if (!ctx.chat || !["group", "supergroup"].includes(ctx.chat.type)) {
      await mpReply(ctx, "این دستور را داخل گروه اصلی همان مکان بفرست.");
      return;
    }
    mpDeleteLater(ctx, ctx.message);
    const maps = db.prepare(`
      SELECT * FROM montadoria_place_maps
      WHERE location_chat_id=?
      ORDER BY map_id ASC
    `).all(String(ctx.chat.id)).filter(map => mpCanEnterUser(ctx.from.id, map));

    if (!maps.length) {
      await mpReply(ctx, "در این مکان مپی برای نمایش یا مپی که دسترسی ورودش را داشته باشی ثبت نشده است.");
      return;
    }

    for (const map of maps) {
      try {
        const sent = await ctx.replyWithPhoto(map.photo_file_id, {
          caption: `༺⟡ 𝐌𝐎𝐍𝐓𝐀𝐃𝐎𝐑𝐈𝐀 ⟡༻\n\n🗺️ ${map.map_name}\n📍 ${map.target_title || map.map_name}`,
          reply_markup: {
            inline_keyboard: [[{ text: `ورود به ${map.map_name}`.slice(0, 60), url: map.invite_link }]]
          }
        });
        mpDeleteLater(ctx, sent);
      } catch {
        await mpReply(ctx, `❌ نمایش عکس مپ «${map.map_name}» ناموفق بود.`);
      }
    }
  });

  // تغییر یا برداشتن شروط دسترسی یک مپ.
  bot.hears(/^تنظیم دسترسی مپ\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*(.+)$/u, async ctx => {
    if (!mpManage(ctx)) return mpReply(ctx, "⛔ فقط مالک یا مدیر اجازه تغییر دسترسی مپ را دارد.");
    if (!ctx.chat || !["group", "supergroup"].includes(ctx.chat.type)) {
      return mpReply(ctx, "این دستور را در گروه اصلی همان مکان بفرست.");
    }
    const mapName = mpText(ctx.match[1]);
    const rawJob = mpText(ctx.match[2]);
    const rawLicense = mpText(ctx.match[3]);
    const requiredJob = rawJob === "-" ? "" : rawJob;
    const requiredLicense = rawLicense === "-" ? "" : rawLicense;
    const map = db.prepare(`
      SELECT * FROM montadoria_place_maps
      WHERE location_chat_id=? AND map_name=? COLLATE NOCASE
    `).get(String(ctx.chat.id), mapName);
    if (!map) return mpReply(ctx, "مپ فعالی با این نام در همین مکان پیدا نشد.");
    if (requiredLicense && !mpLicenseExists(requiredLicense)) {
      return mpReply(ctx, "کد مجوز فعال پیدا نشد؛ ابتدا مجوز را تعریف کن یا - بگذار.");
    }
    if (requiredJob || requiredLicense) {
      try {
        const targetInfo = await ctx.api.getChat(map.target_chat_id);
        if (targetInfo.username) {
          return mpReply(ctx, "⛔ برای اعمال محدودیت، گروه مقصد باید خصوصی باشد؛ گروه عمومی امکان دور زدن شرط را دارد.");
        }
      } catch {
        return mpReply(ctx, "❌ بررسی گروه مقصد ممکن نشد؛ دسترسی ربات به گروه را بررسی کن.");
      }
    }
    db.prepare(`
      UPDATE montadoria_place_maps
      SET required_job=?, required_license=?, updated_at=? WHERE map_id=?
    `).run(requiredJob, requiredLicense, mpNow(), map.map_id);
    return mpReply(ctx,
      `✅ دسترسی مپ «${map.map_name}» تغییر کرد.\n` +
      `شغل لازم: ${requiredJob || "ندارد"}\n` +
      `مجوز لازم: ${requiredLicense || "ندارد"}`);
  });

  // حذف از فهرست و لغو لینک قبلی.
  bot.hears(/^حذف مپ\s*\|\s*(.+)$/u, async ctx => {
    if (!mpManage(ctx)) return mpReply(ctx, "⛔ فقط مالک یا مدیر اجازه حذف مپ را دارد.");
    if (!ctx.chat || !["group", "supergroup"].includes(ctx.chat.type)) {
      return mpReply(ctx, "این دستور را در گروه اصلی همان مکان بفرست.");
    }
    const mapName = mpText(ctx.match[1]);
    const map = db.prepare(`
      SELECT * FROM montadoria_place_maps
      WHERE location_chat_id=? AND map_name=? COLLATE NOCASE
    `).get(String(ctx.chat.id), mapName);
    if (!map) return mpReply(ctx, "مپ با این نام در همین مکان پیدا نشد.");
    try { await ctx.api.revokeChatInviteLink(map.target_chat_id, map.invite_link); } catch {}
    db.prepare("DELETE FROM montadoria_place_maps WHERE map_id=?").run(map.map_id);
    return mpReply(ctx, `✅ مپ «${map.map_name}» از فهرست حذف شد و لینک قبلی آن لغو شد.`);
  });

  // تأیید ورود بر اساس شغل و مجوز؛ گروه مقصدِ محدودشده باید خصوصی باشد.
  bot.on("chat_join_request", async ctx => {
    const request = ctx.chatJoinRequest;
    if (!request?.chat?.id || !request?.from?.id) return;
    const map = db.prepare(`
      SELECT * FROM montadoria_place_maps
      WHERE target_chat_id=?
      LIMIT 1
    `).get(String(request.chat.id));
    if (!map) return;

    const allowed = mpCanEnterUser(request.from.id, map);
    try {
      if (allowed) {
        await ctx.api.approveChatJoinRequest(request.chat.id, request.from.id);
      } else {
        await ctx.api.declineChatJoinRequest(request.chat.id, request.from.id);
        const required = [
          map.required_job ? `شغل: ${map.required_job}` : "",
          map.required_license ? `مجوز: ${map.required_license}` : ""
        ].filter(Boolean).join(" | ");
        try {
          await ctx.api.sendMessage(
            request.user_chat_id || request.from.id,
            `درخواست ورود شما به مپ «${map.map_name}» پذیرفته نشد.\nشرط دسترسی: ${required || "نامشخص"}`
          );
        } catch {}
      }
    } catch (error) {
      console.error("MONTADORIA map join request error:", error);
    }
  });
  // END MONTADORIA_PLACE_MAP_CATALOG_V1


  bot.command("start", async (ctx) => {
    const telegramId = ctx.from.id
    const username = ctx.from.username ?? null

    const displayName =
      [ctx.from.first_name, ctx.from.last_name]
        .filter(Boolean)
        .join(" ") || "Unknown"

    const now = new Date().toISOString()

    syncOwner(telegramId)

    let existingUser = getUser(telegramId)

    if (!existingUser) {
      const currentOwner = getCurrentOwner()

      const role =
        !currentOwner && telegramId === OWNER_ID
          ? "owner"
          : "user"

      const cardNumber = generateUniqueCardNumber();
      db.prepare(`
        INSERT INTO users (
          telegram_id,
          username,
          display_name,
          card_number,
          money,
          infinite_money,
          bank,
          xp,
          level,
          role,
          job,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, 0, 0, 0, 0, 1, ?, NULL, ?, ?)
      `).run(
        telegramId,
        username,
        displayName,
        cardNumber,
        role,
        now,
        now
      )

      await ctx.reply(
        `سلام ${displayName}! 👋\n\n` +
        `به MONTADORIA خوش آمدی.\n\n` +
        `حساب تو با موفقیت ساخته شد.\n\n` +
        `💳 شماره کارت بانکی تو:\n${cardNumber}`
      )

      return
    }

    db.prepare(`
      UPDATE users
      SET username = ?,
          display_name = ?,
          updated_at = ?
      WHERE telegram_id = ?
    `).run(
      username,
      displayName,
      now,
      telegramId
    )

    existingUser = getUser(telegramId)

    await ctx.reply(
      `سلام ${displayName}! 👋\n\n` +
      `به MONTADORIA خوش آمدی.\n\n` +
      `Role: ${ROLES[existingUser.role] ?? existingUser.role}`
    )
  })

  const showOwnProfile = async (ctx) => {
    syncOwner(ctx.from.id)

    const user = getUser(ctx.from.id)

    if (!user) {
      await ctx.reply("ابتدا /start را بزنید.")
      return
    }

    // MONTADORIA_ROYAL_PROFILE_V2
    const profileText = [
      "𝐑𝐎𝐘𝐀𝐋 𝐀𝐑𝐂𝐇𝐈𝐕𝐄𝐒",
      "❖ بایگانی رسمی شهروند ❖",
      "──── ⟡ ────",
      "",
      "Ⅰ · مشخصات هویتی حساب",
      "",
      `♟ نام شهروند: ${user.display_name || "ثبت نشده"}`,
      `♙ نام کاربری: ${user.username ? "@" + user.username : "ثبت نشده"}`,
      `🆔 شناسهٔ شهروندی: ${user.telegram_id}`,
      "",
      "Ⅱ · دارایی و جایگاه اجتماعی",
      "",
      `💰 دارایی نقدی: ${user.infinite_money ? "♾️ نامحدود" : user.money}`,
      `🏦 موجودی خزانه: ${user.bank}`,
      `💳 شماره کارت بانکی: ${user.card_number}`,
      `⭐ سطح شخصیت: ${user.level}`,
      `✨ امتیاز تجربه: ${user.xp}`,
      `⚒ حرفه: ${user.job ?? "بدون شغل"}`,
      `♜ جایگاه اجتماعی: ${ROLES[user.role] ?? user.role}`,
      "",
      "\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0╭───────⟡───────╮",
      "\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0𝐌𝐎𝐍𝐓𝐀𝐃𝐎𝐑𝐈𝐀",
      "\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0╰───────⟡───────╯",
    ].join("\n")

  const registration = db.prepare(`
    SELECT character_name, registration_code, celebrity_name,
           telegram_username, photo_file_id,
           family_name, mother_username, father_username
    FROM character_registrations
    WHERE telegram_username = ? COLLATE NOCASE
  `).get((ctx.from.username || user.username || "").replace(/^@/, ""))

  const registrationText = registration
    ? [
        "⟡ پروندهٔ نقش‌آفرینی ⟡",
        "",
        `🎭 نام شخصیت: ${registration.character_name || "ثبت نشده"}`,
        `🔐 کد اختصاصی: ${registration.registration_code || "ثبت نشده"}`,
        `♟ نام واقعی ثبت‌شده: ${registration.celebrity_name || "ثبت نشده"}`,
        `♙ حساب ثبت‌شده: ${registration.telegram_username ? "@" + registration.telegram_username : "ثبت نشده"}`,
        "",
        `♜ خاندان: ${registration.family_name || "در بایگانی ثبت نشده"}`,
        `♜ مادر: ${registration.mother_username ? "@" + registration.mother_username : "در بایگانی ثبت نشده"}`,
        `♜ پدر: ${registration.father_username ? "@" + registration.father_username : "در بایگانی ثبت نشده"}`,
        "",
        "╰──────⟡──────╯"
      ].join("\n")
    : [
        "⟡ پروندهٔ نقش‌آفرینی ⟡",
        "",
        "برای این حساب، شناسنامهٔ نقش‌آفرینی در بایگانی پیدا نشد.",
        "",
        "╰──────⟡──────╯"
      ].join("\n");

  const fullProfileText =
    `${profileText}\n\n${registrationText}`;

  if (registration?.photo_file_id) {
    await ctx.replyWithPhoto(registration.photo_file_id, {
      caption: fullProfileText
    })
  } else {
    await ctx.reply(fullProfileText)
  }
  };

  bot.command("profile", showOwnProfile);
  bot.hears(/^(?:\/)?(?:رول|پروفایل)(?:@\w+)?$/u, showOwnProfile);



  // =========================

  // ===== مدیریت والدین و خاندان شناسنامه =====

  const pendingRegistrationParents = new Map();

  const registrationActor = (ctx) => {
    if (ctx.from?.id) syncOwner(ctx.from.id);
    return ctx.from?.id ? getUser(ctx.from.id) : null;
  };

  const registrationCanManage = (user) =>
    Boolean(user && ["owner", "moderator"].includes(user.role));

  const registrationUsername = (value) => {
    const match = String(value ?? "").trim()
      .match(/^@?([A-Za-z][A-Za-z0-9_]{4,31})$/);
    return match ? match[1] : null;
  };

  const registrationClans = {
    velmora: "ولمورا",
    blackwell: "بلک ول",
    bonds: "باندز"
  };

  async function openRegistrationParents(ctx, rawTarget) {
    const actor = registrationActor(ctx);

    if (!registrationCanManage(actor)) {
      await ctx.reply("⛔ این دستور فقط برای مالک و ناظران است.");
      return;
    }

    const target = registrationUsername(rawTarget);

    if (!target) {
      await ctx.reply("استفاده صحیح:\n/parents @username");
      return;
    }

    const record = db.prepare(`
      SELECT telegram_username, mother_username, father_username
      FROM character_registrations
      WHERE telegram_username = ? COLLATE NOCASE
    `).get(target);

    if (!record) {
      await ctx.reply("❌ برای این نام کاربری شناسنامه‌ای پیدا نشد.");
      return;
    }

    await ctx.reply(
      `👪 مدیریت والدین شناسنامه @${record.telegram_username}\n\n` +
      `مادر فعلی: ${record.mother_username ? "@" + record.mother_username : "ثبت نشده"}\n` +
      `پدر فعلی: ${record.father_username ? "@" + record.father_username : "ثبت نشده"}\n\n` +
      "برای ثبت یا تغییر، یکی از گزینه‌ها را انتخاب کن:",
      {
        reply_markup: {
          inline_keyboard: [[
            {
              text: "👩 مادر",
              callback_data: `regparent:mother:${record.telegram_username}`
            },
            {
              text: "👨 پدر",
              callback_data: `regparent:father:${record.telegram_username}`
            }
          ]]
        }
      }
    );
  }

  bot.command("parents", async ctx => {
    await openRegistrationParents(ctx, ctx.match);
  });

  bot.hears(
    /^(?:\/)?والدین\s+@?([A-Za-z][A-Za-z0-9_]{4,31})$/u,
    async ctx => openRegistrationParents(ctx, ctx.match[1])
  );

  bot.callbackQuery(
    /^regparent:(mother|father):([A-Za-z][A-Za-z0-9_]{4,31})$/,
    async ctx => {
      const actor = registrationActor(ctx);

      if (!registrationCanManage(actor)) {
        await ctx.answerCallbackQuery({
          text: "فقط مالک و ناظران دسترسی دارند.",
          show_alert: true
        });
        return;
      }

      const [, relation, target] = ctx.match;

      const record = db.prepare(`
        SELECT telegram_username
        FROM character_registrations
        WHERE telegram_username = ? COLLATE NOCASE
      `).get(target);

      if (!record) {
        await ctx.answerCallbackQuery({
          text: "شناسنامه پیدا نشد.",
          show_alert: true
        });
        return;
      }

      pendingRegistrationParents.set(ctx.from.id, {
        target: record.telegram_username,
        relation,
        expiresAt: Date.now() + 5 * 60 * 1000
      });

      await ctx.answerCallbackQuery();

      await ctx.reply(
        `یوزرنیم ${relation === "mother" ? "مادر" : "پدر"} ` +
        `شخصیت @${record.telegram_username} را بفرست.\n\n` +
        "فقط نام کاربری تلگرام را بفرست؛ برای مثال: @ExampleUser\n" +
        "آیدی عددی پذیرفته نمی‌شود.\n" +
        "برای حذف والد ثبت‌شده، «حذف» را بفرست.\n" +
        "برای لغو عملیات: /cancel"
      );
    }
  );

  bot.command("cancel", async ctx => {
    if (pendingRegistrationParents.delete(ctx.from.id)) {
      await ctx.reply("عملیات ثبت والد لغو شد.");
    }
  });

  bot.on("message:text", async (ctx, next) => {
    const pending = pendingRegistrationParents.get(ctx.from.id);

    if (!pending) {
      return next();
    }

    if (Date.now() > pending.expiresAt) {
      pendingRegistrationParents.delete(ctx.from.id);
      await ctx.reply("زمان عملیات تمام شده است؛ دوباره دستور /parents را اجرا کن.");
      return;
    }

    const text = String(ctx.message.text || "").trim();

    if (text === "/cancel") {
      pendingRegistrationParents.delete(ctx.from.id);
      await ctx.reply("عملیات ثبت والد لغو شد.");
      return;
    }

    // فرمان‌های دیگر باید به handlerهای خودشان برسند.
    if (text.startsWith("/")) {
      return next();
    }

    const actor = registrationActor(ctx);

    if (!registrationCanManage(actor)) {
      pendingRegistrationParents.delete(ctx.from.id);
      await ctx.reply("⛔ دسترسی ثبت والد برای حساب شما وجود ندارد.");
      return;
    }

    let username = null;

    if (!/^(?:حذف|پاک)$/u.test(text)) {
      username = registrationUsername(text);

      if (!username) {
        await ctx.reply(
          "❌ نام کاربری معتبر نیست.\n" +
          "فقط یوزرنیم تلگرام را بفرست، نه آیدی عددی."
        );
        return;
      }
    }

    const column = pending.relation === "mother"
      ? "mother_username"
      : "father_username";

    const result = db.prepare(`
      UPDATE character_registrations
      SET ${column} = ?
      WHERE telegram_username = ? COLLATE NOCASE
    `).run(username, pending.target);

    pendingRegistrationParents.delete(ctx.from.id);

    if (!result.changes) {
      await ctx.reply("❌ شناسنامه پیدا نشد؛ والد ثبت نشد.");
      return;
    }

    await ctx.reply(
      username
        ? `✅ ${pending.relation === "mother" ? "مادر" : "پدر"} @${username} ` +
          `برای شناسنامه @${pending.target} ثبت شد.`
        : `✅ اطلاعات ${pending.relation === "mother" ? "مادر" : "پدر"} ` +
          `شناسنامه @${pending.target} حذف شد.`
    );
  });

  async function showRegistrationFamilyMenu(ctx, rawTarget, editMode = false) {
    const actor = registrationActor(ctx);

    if (!registrationCanManage(actor)) {
      await ctx.reply("⛔ این دستور فقط برای مالک و ناظران است.");
      return;
    }

    const target = registrationUsername(rawTarget);

    if (!target) {
      await ctx.reply("استفاده صحیح:\n/family @username");
      return;
    }

    const record = db.prepare(`
      SELECT telegram_username, family_name
      FROM character_registrations
      WHERE telegram_username = ? COLLATE NOCASE
    `).get(target);

    if (!record) {
      await ctx.reply("❌ برای این نام کاربری شناسنامه‌ای پیدا نشد.");
      return;
    }

    if (editMode && actor.role !== "owner") {
      await ctx.reply("⛔ ویرایش خاندان فقط در اختیار مالک است.");
      return;
    }

    if (record.family_name && !editMode) {
      if (actor.role !== "owner") {
        await ctx.reply(
          `خاندان این شخصیت قبلاً «${record.family_name}» ثبت شده است.\n` +
          "تغییر خاندان فقط در اختیار مالک است."
        );
        return;
      }

      await ctx.reply(
        `🏰 خاندان فعلی @${record.telegram_username}: ${record.family_name}`,
        {
          reply_markup: {
            inline_keyboard: [[{
              text: "✏️ ویرایش خاندان",
              callback_data: `regfam_edit:${record.telegram_username}`
            }]]
          }
        }
      );
      return;
    }

    const buttons = Object.entries(registrationClans).map(([key, name]) => ({
      text: name,
      callback_data: `regfam:${key}:${record.telegram_username}`
    }));

    await ctx.reply(
      `${editMode ? "✏️ ویرایش خاندان" : "🏰 انتخاب خاندان"} برای ` +
      `@${record.telegram_username}:\n\n` +
      (record.family_name ? `خاندان فعلی: ${record.family_name}\n` : "") +
      "یکی از سه خاندان را انتخاب کن:",
      {
        reply_markup: {
          inline_keyboard: [buttons]
        }
      }
    );
  }

  bot.command("family", async ctx => {
    await showRegistrationFamilyMenu(ctx, ctx.match);
  });

  bot.hears(
    /^(?:\/)?خاندان\s+@?([A-Za-z][A-Za-z0-9_]{4,31})$/u,
    async ctx => showRegistrationFamilyMenu(ctx, ctx.match[1])
  );

  bot.command("editfamily", async ctx => {
    const actor = registrationActor(ctx);

    if (actor?.role !== "owner") {
      await ctx.reply("⛔ ویرایش خاندان فقط برای مالک فعال است.");
      return;
    }

    await showRegistrationFamilyMenu(ctx, ctx.match, true);
  });

  bot.callbackQuery(
    /^regfam_edit:([A-Za-z][A-Za-z0-9_]{4,31})$/,
    async ctx => {
      const actor = registrationActor(ctx);

      if (actor?.role !== "owner") {
        await ctx.answerCallbackQuery({
          text: "ویرایش خاندان فقط برای مالک فعال است.",
          show_alert: true
        });
        return;
      }

      const target = ctx.match[1];
      await ctx.answerCallbackQuery();
      await showRegistrationFamilyMenu(ctx, target, true);
    }
  );

  bot.callbackQuery(
    /^regfam:(velmora|blackwell|bonds):([A-Za-z][A-Za-z0-9_]{4,31})$/,
    async ctx => {
      const actor = registrationActor(ctx);

      if (!registrationCanManage(actor)) {
        await ctx.answerCallbackQuery({
          text: "دسترسی ثبت خاندان ندارید.",
          show_alert: true
        });
        return;
      }

      const [, clanKey, target] = ctx.match;

      const record = db.prepare(`
        SELECT telegram_username, family_name
        FROM character_registrations
        WHERE telegram_username = ? COLLATE NOCASE
      `).get(target);

      if (!record) {
        await ctx.answerCallbackQuery({
          text: "شناسنامه پیدا نشد.",
          show_alert: true
        });
        return;
      }

      // ناظر فقط می‌تواند خاندان ثبت‌نشده را انتخاب کند.
      if (record.family_name && actor.role !== "owner") {
        await ctx.answerCallbackQuery({
          text: "تغییر خاندان فقط در اختیار مالک است.",
          show_alert: true
        });
        return;
      }

      const clanName = registrationClans[clanKey];

      db.prepare(`
        UPDATE character_registrations
        SET family_name = ?
        WHERE telegram_username = ? COLLATE NOCASE
      `).run(clanName, record.telegram_username);

      await ctx.answerCallbackQuery({ text: "خاندان ثبت شد." });

      await ctx.reply(
        `✅ خاندان @${record.telegram_username} به «${clanName}» ثبت شد.`
      );
    }
  );



  // ===== MONTADORIA ECONOMY =====

  db.exec(`
    CREATE TABLE IF NOT EXISTS economy_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_telegram_id INTEGER NOT NULL,
      recipient_telegram_id INTEGER,
      kind TEXT NOT NULL,
      amount INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  const economyRecord = db.prepare(`
    INSERT INTO economy_ledger
      (sender_telegram_id, recipient_telegram_id, kind, amount, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const economyAmount = value => {
    const n = Number(String(value ?? "").trim().replace(/,/g, ""));
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  };

  const economyUsername = value =>
    String(value ?? "").trim().replace(/^@/, "");

  async function economyBalance(ctx) {
    syncOwner(ctx.from.id);
    const user = getUser(ctx.from.id);
    if (!user) {
      await ctx.reply("ابتدا /start را بزنید.");
      return;
    }
    await ctx.reply(
      "💰 موجودی شما\n\n" +
      `💵 پول نقد: ${user.infinite_money ? "♾️ نامحدود" : user.money}\n` +
      `🏦 موجودی بانک: ${user.bank ?? 0}`
    );
  }

  bot.command("balance", economyBalance);
  bot.hears(/^موجودی$/u, economyBalance);

  async function economyDeposit(ctx, rawAmount) {
    syncOwner(ctx.from.id);
    const user = getUser(ctx.from.id);
    const amount = economyAmount(rawAmount);

    if (!user) {
      await ctx.reply("ابتدا /start را بزنید.");
      return;
    }
    if (!amount) {
      await ctx.reply("مبلغ معتبر وارد کن.\nاستفاده: /deposit 1000");
      return;
    }
    if (!user.infinite_money && Number(user.money) < amount) {
      await ctx.reply("❌ پول نقد کافی نداری.");
      return;
    }

    const transaction = db.transaction(() => {
      if (user.infinite_money) {
        db.prepare(
          "UPDATE users SET bank = COALESCE(bank, 0) + ? WHERE telegram_id = ?"
        ).run(amount, ctx.from.id);
      } else {
        const result = db.prepare(`
          UPDATE users
          SET money = money - ?, bank = COALESCE(bank, 0) + ?
          WHERE telegram_id = ? AND money >= ?
        `).run(amount, amount, ctx.from.id, amount);
        if (!result.changes) return false;
      }

      economyRecord.run(
        ctx.from.id, null,
        user.infinite_money ? "deposit_infinite_cash" : "deposit",
        amount, new Date().toISOString()
      );
      return true;
    });

    if (!transaction()) {
      await ctx.reply("❌ موجودی نقدی تغییر کرده یا کافی نیست.");
      return;
    }
    await ctx.reply(`✅ مبلغ ${amount} به بانک واریز شد.`);
  }

  bot.command("deposit", async ctx =>
    economyDeposit(ctx, ctx.match)
  );
  bot.hears(/^واریز\s+([\d,]+)$/u, async ctx =>
    economyDeposit(ctx, ctx.match[1])
  );

  async function economyWithdraw(ctx, rawAmount) {
    syncOwner(ctx.from.id);
    const user = getUser(ctx.from.id);
    const amount = economyAmount(rawAmount);

    if (!user) {
      await ctx.reply("ابتدا /start را بزنید.");
      return;
    }
    if (!amount) {
      await ctx.reply("مبلغ معتبر وارد کن.\nاستفاده: /withdraw 1000");
      return;
    }

    const transaction = db.transaction(() => {
      const result = db.prepare(`
        UPDATE users
        SET bank = bank - ?, money = COALESCE(money, 0) + ?
        WHERE telegram_id = ? AND COALESCE(bank, 0) >= ?
      `).run(amount, amount, ctx.from.id, amount);

      if (!result.changes) return false;

      economyRecord.run(
        ctx.from.id, null, "withdraw",
        amount, new Date().toISOString()
      );
      return true;
    });

    if (!transaction()) {
      await ctx.reply("❌ موجودی بانک کافی نیست.");
      return;
    }
    await ctx.reply(`✅ مبلغ ${amount} از بانک برداشت شد.`);
  }

  bot.command("withdraw", async ctx =>
    economyWithdraw(ctx, ctx.match)
  );
  bot.hears(/^برداشت\s+([\d,]+)$/u, async ctx =>
    economyWithdraw(ctx, ctx.match[1])
  );

  async function economyTransfer(ctx, rawUsername, rawAmount) {
    syncOwner(ctx.from.id);
    const sender = getUser(ctx.from.id);
    const username = economyUsername(rawUsername);
    const amount = economyAmount(rawAmount);

    if (!sender) {
      await ctx.reply("ابتدا /start را بزنید.");
      return;
    }
    if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username) || !amount) {
      await ctx.reply(
        "❌ اطلاعات معتبر نیست.\nاستفاده:\n/transfer @username 1000"
      );
      return;
    }

    const transaction = db.transaction(() => {
      const currentSender = db.prepare(
        "SELECT telegram_id, money, infinite_money FROM users WHERE telegram_id = ?"
      ).get(ctx.from.id);

      const recipient = db.prepare(`
        SELECT telegram_id, username
        FROM users
        WHERE username = ? COLLATE NOCASE
      `).get(username);

      if (!currentSender) return "sender";
      if (!recipient) return "recipient";
      if (Number(recipient.telegram_id) === Number(ctx.from.id)) return "self";

      if (!currentSender.infinite_money) {
        const debit = db.prepare(`
          UPDATE users SET money = money - ?
          WHERE telegram_id = ? AND money >= ?
        `).run(amount, ctx.from.id, amount);
        if (!debit.changes) return "cash";
      }

      db.prepare(`
        UPDATE users
        SET bank = COALESCE(bank, 0) + ?
        WHERE telegram_id = ?
      `).run(amount, recipient.telegram_id);

      economyRecord.run(
        ctx.from.id, recipient.telegram_id,
        currentSender.infinite_money ? "transfer_infinite_cash_to_bank" : "transfer_to_bank",
        amount, new Date().toISOString()
      );

      return recipient.username || username;
    });

    const result = transaction();

    const errors = {
      sender: "❌ حساب فرستنده پیدا نشد.",
      recipient: "❌ کاربر گیرنده پیدا نشد یا در ربات ثبت‌نام نکرده است.",
      self: "❌ نمی‌توانی به خودت پول انتقال بدهی.",
      cash: "❌ پول نقد کافی نداری."
    };

    if (errors[result]) {
      await ctx.reply(errors[result]);
      return;
    }

    await ctx.reply(
      `✅ انتقال با موفقیت انجام شد.\n\n` +
      `👤 گیرنده: @${result}\n` +
      `💰 مبلغ: ${amount}\n` +
      "🏦 مبلغ مستقیماً به بانک گیرنده اضافه شد."
    );
  }

  bot.command("transfer", async ctx => {
    const args = String(ctx.match ?? "").trim().split(/\s+/);
    if (args.length !== 2) {
      await ctx.reply("استفاده:\n/transfer @username 1000");
      return;
    }
    await economyTransfer(ctx, args[0], args[1]);
  });

  bot.hears(/^#انتقال\s+@?([A-Za-z][A-Za-z0-9_]{4,31})\s+([\d,]+)$/u,
    async ctx => economyTransfer(ctx, ctx.match[1], ctx.match[2])
  );

  bot.hears(/^انتقال\s+@?([A-Za-z][A-Za-z0-9_]{4,31})\s+([\d,]+)$/u,
    async ctx => economyTransfer(ctx, ctx.match[1], ctx.match[2])
  );


  
// MONTADORIA_PERSIAN_ECONOMY_V1
{
  const faNumber = value => {
    const digits = {
      "۰":"0","۱":"1","۲":"2","۳":"3","۴":"4",
      "۵":"5","۶":"6","۷":"7","۸":"8","۹":"9",
      "٠":"0","١":"1","٢":"2","٣":"3","٤":"4",
      "٥":"5","٦":"6","٧":"7","٨":"8","٩":"9"
    };
    return String(value).replace(/[۰-۹٠-٩]/g, c => digits[c] ?? c);
  };

  const parseAmount = value => {
    const n = Number(faNumber(value).replace(/,/g, ""));
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  };

  const getEconomyUser = id => getUser(id);

  // MONTADORIA_CARD_TRANSFER_V1

  bot.hears(/^(?:شماره کارت|کارت من|کارت بانکی)$/u, async ctx => {
    const user = getEconomyUser(ctx.from.id);

    if (!user) {
      return ctx.reply("❌ حساب شما پیدا نشد. ابتدا /start را بزن.");
    }

    return ctx.reply(
      "💳 شماره کارت بانکی مونتادوریا\n\n" +
      `👤 صاحب حساب: ${user.display_name}\n` +
      `🔢 شماره کارت: ${user.card_number}\n\n` +
      "برای انتقال از موجودی بانک استفاده کن:\n" +
      "#انتقال | شماره کارت گیرنده | مبلغ\n\n" +
      "مثال:\n" +
      "#انتقال | 1234567890123456 | 500"
    );
  });

  bot.hears(
    /^\s*\{?\s*#انتقال\s*\|\s*([0-9۰-۹٠-٩]{16})\s*\|\s*([0-9۰-۹٠-٩,٬]+)\s*\}?\s*$/u,
    async ctx => {
      const senderId = ctx.from.id;
      const cardNumber = faNumber(ctx.match[1]);
      const amount = parseAmount(ctx.match[2].replace(/٬/g, ","));

      if (!amount) {
        return ctx.reply(
          "❌ مبلغ معتبر نیست.\n" +
          "فرمت صحیح:\n#انتقال | شماره کارت | مبلغ"
        );
      }

      const sender = getEconomyUser(senderId);
      if (!sender) {
        return ctx.reply("ابتدا /start را برای ربات بفرست.");
      }

      if (Number(sender.bank || 0) < amount) {
        return ctx.reply("❌ موجودی بانک شما برای این انتقال کافی نیست.");
      }

      const now = new Date().toISOString();

      try {
        const result = db.transaction(() => {
          const currentSender = db.prepare(`
            SELECT telegram_id, bank
            FROM users
            WHERE telegram_id = ?
          `).get(senderId);

          const recipient = db.prepare(`
            SELECT telegram_id, username, display_name
            FROM users
            WHERE card_number = ?
            LIMIT 1
          `).get(cardNumber);

          if (!currentSender) return { error: "sender" };
          if (!recipient) return { error: "recipient" };

          if (Number(recipient.telegram_id) === Number(senderId)) {
            return { error: "self" };
          }

          const debit = db.prepare(`
            UPDATE users
            SET bank = COALESCE(bank, 0) - ?, updated_at = ?
            WHERE telegram_id = ? AND COALESCE(bank, 0) >= ?
          `).run(amount, now, senderId, amount);

          if (debit.changes !== 1) return { error: "funds" };

          const credit = db.prepare(`
            UPDATE users
            SET bank = COALESCE(bank, 0) + ?, updated_at = ?
            WHERE telegram_id = ?
          `).run(amount, now, recipient.telegram_id);

          if (credit.changes !== 1) {
            throw new Error("CARD_TRANSFER_CREDIT_FAILED");
          }

          economyRecord.run(
            senderId,
            recipient.telegram_id,
            "card_transfer",
            amount,
            now
          );

          return {
            recipientId: recipient.telegram_id,
            recipientName: recipient.display_name || recipient.username || "کاربر",
          };
        })();

        if (result.error === "sender") {
          return ctx.reply("❌ حساب فرستنده پیدا نشد.");
        }
        if (result.error === "recipient") {
          return ctx.reply("❌ این شماره کارت در مونتادوریا ثبت نشده است.");
        }
        if (result.error === "self") {
          return ctx.reply("❌ نمی‌توانی به حساب خودت انتقال بدهی.");
        }
        if (result.error === "funds") {
          return ctx.reply("❌ موجودی بانک شما برای این انتقال کافی نیست.");
        }

        await ctx.reply(
          "✅ انتقال بانکی با موفقیت انجام شد.\n\n" +
          `👤 گیرنده: ${result.recipientName}\n` +
          `💰 مبلغ: ${amount.toLocaleString("en-US")}\n` +
          "🏦 مبلغ از بانک شما کسر و به بانک گیرنده اضافه شد."
        );

        try {
          await ctx.api.sendMessage(
            result.recipientId,
            "💳 واریز بانکی جدید در مونتادوریا\n\n" +
            `💰 مبلغ دریافتی: ${amount.toLocaleString("en-US")}\n` +
            "🏦 مبلغ به موجودی بانک شما اضافه شد."
          );
        } catch (notifyError) {
          console.error("Card transfer notification failed:", notifyError.message);
        }
      } catch (error) {
        console.error("Card transfer failed:", error);
        return ctx.reply(
          "❌ انتقال انجام نشد. موجودی‌ها تغییر نکردند؛ دوباره امتحان کن."
        );
      }
    }
  );

  // END MONTADORIA_CARD_TRANSFER_V1



  bot.hears(/^(?:موجودی|موجودی من|بالانس)$/u, async ctx => {
    try {
      const u = getEconomyUser(ctx.from.id);
      if (!u) return ctx.reply("❌ حساب شما پیدا نشد.");
      return ctx.reply(
        `💳 موجودی حساب\n\n💵 پول نقد: ${u.infinite_money ? "♾️ بی‌نهایت" : Number(u.money || 0).toLocaleString("en-US")}\n🏦 موجودی بانک: ${Number(u.bank || 0).toLocaleString("en-US")}`
      );
    } catch (e) {
      console.error("Balance error:", e);
      return ctx.reply("❌ خطا در دریافت موجودی.");
    }
  });

  bot.hears(/^(?:واریز|واریز به بانک)\s+([\d۰-۹٠-٩,٬]+)$/u, async ctx => {
    const amount = parseAmount(ctx.match[1].replace(/٬/g, ","));
    if (!amount) return ctx.reply("❌ مثال صحیح: واریز ۱۰۰");
    try {
      const u = getEconomyUser(ctx.from.id);
      if (!u) return ctx.reply("❌ حساب شما پیدا نشد.");
      if (!u.infinite_money && Number(u.money || 0) < amount)
        return ctx.reply("❌ پول نقد کافی نداری.");

      db.transaction(() => {
        if (!u.infinite_money)
          db.prepare("UPDATE users SET money = money - ? WHERE telegram_id = ?").run(amount, ctx.from.id);
        db.prepare("UPDATE users SET bank = COALESCE(bank, 0) + ? WHERE telegram_id = ?").run(amount, ctx.from.id);
      })();

      return ctx.reply(`✅ مبلغ ${amount.toLocaleString("en-US")} به بانک واریز شد.`);
    } catch (e) {
      console.error("Deposit error:", e);
      return ctx.reply("❌ واریز انجام نشد.");
    }
  });

  bot.hears(/^(?:برداشت|برداشت از بانک)\s+([\d۰-۹٠-٩,٬]+)$/u, async ctx => {
    const amount = parseAmount(ctx.match[1].replace(/٬/g, ","));
    if (!amount) return ctx.reply("❌ مثال صحیح: برداشت ۵۰");
    try {
      const u = getEconomyUser(ctx.from.id);
      if (!u) return ctx.reply("❌ حساب شما پیدا نشد.");
      if (Number(u.bank || 0) < amount) return ctx.reply("❌ موجودی بانک کافی نیست.");

      db.transaction(() => {
        db.prepare("UPDATE users SET bank = bank - ? WHERE telegram_id = ?").run(amount, ctx.from.id);
        db.prepare("UPDATE users SET money = COALESCE(money, 0) + ? WHERE telegram_id = ?").run(amount, ctx.from.id);
      })();

      return ctx.reply(`✅ مبلغ ${amount.toLocaleString("en-US")} از بانک برداشت شد.`);
    } catch (e) {
      console.error("Withdraw error:", e);
      return ctx.reply("❌ برداشت انجام نشد.");
    }
  });

  bot.hears(/^(?:#انتقال|انتقال|انتقال پول)\s+@?([A-Za-z0-9_]{1,32})\s+([\d۰-۹٠-٩,٬]+)$/u, async ctx => {
    const username = ctx.match[1].replace(/^@/, "").toLowerCase();
    const amount = parseAmount(ctx.match[2].replace(/٬/g, ","));
    if (!amount) return ctx.reply("❌ مثال صحیح: انتقال @username ۲۵");

    try {
      const sender = getEconomyUser(ctx.from.id);
      if (!sender) return ctx.reply("❌ حساب فرستنده پیدا نشد.");

      const recipient = db.prepare(
        "SELECT telegram_id, username FROM users WHERE LOWER(REPLACE(username, '@', '')) = ? LIMIT 1"
      ).get(username);

      if (!recipient) return ctx.reply("❌ گیرنده در سیستم کاربران ربات پیدا نشد.");
      if (String(recipient.telegram_id) === String(ctx.from.id))
        return ctx.reply("❌ نمی‌توانی به خودت پول انتقال بدهی.");
      if (!sender.infinite_money && Number(sender.money || 0) < amount)
        return ctx.reply("❌ پول نقد کافی برای انتقال نداری.");

      db.transaction(() => {
        if (!sender.infinite_money) {
          const result = db.prepare(
            "UPDATE users SET money = money - ? WHERE telegram_id = ? AND money >= ?"
          ).run(amount, ctx.from.id, amount);
          if (result.changes !== 1) throw new Error("INSUFFICIENT_FUNDS");
        }

        db.prepare(
          "UPDATE users SET bank = COALESCE(bank, 0) + ? WHERE telegram_id = ?"
        ).run(amount, recipient.telegram_id);

        try {
          db.prepare(
            "INSERT INTO economy_ledger (sender_telegram_id, recipient_telegram_id, kind, amount, created_at) VALUES (?, ?, ?, ?, ?)"
          ).run(ctx.from.id, recipient.telegram_id, "transfer", amount, Date.now());
        } catch (e) {
          if (!String(e.message).includes("no such table")) throw e;
        }
      })();

      const senderName = ctx.from.username ? "@" + ctx.from.username : (ctx.from.first_name || "کاربر مونتادوریا");
      const receiverName = recipient.username ? "@" + recipient.username : username;

      await ctx.reply(
        `✅ انتقال با موفقیت انجام شد.\n\n👤 گیرنده: ${receiverName}\n💰 مبلغ: ${amount.toLocaleString("en-US")}\n🏦 مبلغ به موجودی بانک گیرنده اضافه شد.`
      );

      try {
        await ctx.api.sendMessage(
          recipient.telegram_id,
          `💰 واریز جدید به حساب شما!\n\n👤 فرستنده: ${senderName}\n💵 مبلغ دریافتی: ${amount.toLocaleString("en-US")}\n🏦 این مبلغ به موجودی بانک شما اضافه شد.`
        );
      } catch (notifyError) {
        console.error("Transfer notification failed:", notifyError);
        await ctx.reply("⚠️ انتقال انجام شد، اما پیام خصوصی به گیرنده نرسید. گیرنده باید ابتدا ربات را در خصوصی /start کند.");
      }
    } catch (e) {
      console.error("Transfer error:", e);
      if (String(e.message).includes("INSUFFICIENT_FUNDS"))
        return ctx.reply("❌ پول نقد کافی برای انتقال نداری.");
      return ctx.reply("❌ انتقال انجام نشد. ممکن است نام کاربری گیرنده در ربات ثبت نشده باشد.");
    }
  });
}
// END MONTADORIA_PERSIAN_ECONOMY_V1




// MONTADORIA_SHOP_V2
{
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_inventory (
      telegram_id TEXT NOT NULL,
      item_code TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (telegram_id, item_code)
    );

    CREATE TABLE IF NOT EXISTS shop_catalog (
      item_code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      buy_price INTEGER NOT NULL,
      sell_price INTEGER NOT NULL,
      description TEXT DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
  `);

  const shopDefaults = [
    ["water", "آب آشامیدنی", 10, 5, "آب آشامیدنی"],
    ["food_basic", "غذای ساده", 30, 15, "یک وعده غذای ساده"],
    ["food_full", "غذای کامل", 70, 35, "یک وعده غذای کامل"],
    ["medicine", "دارو", 120, 60, "داروی عمومی"],
    ["clothes", "لباس معمولی", 200, 100, "لباس معمولی"],
    ["flashlight", "چراغ‌قوه", 90, 45, "چراغ‌قوه"],
    ["bag", "کیف دستی", 160, 80, "کیف دستی"],
    ["tools", "ابزار ساده", 250, 125, "ابزار عمومی"]
  ];

  const shopDigits = value => String(value)
    .replace(/[۰-۹٠-٩]/g, c => ({
      "۰":"0","۱":"1","۲":"2","۳":"3","۴":"4",
      "۵":"5","۶":"6","۷":"7","۸":"8","۹":"9",
      "٠":"0","١":"1","٢":"2","٣":"3","٤":"4",
      "٥":"5","٦":"6","٧":"7","٨":"8","٩":"9"
    })[c])
    .replace(/[٬,]/g, "");

  const shopNormalize = value => String(value)
    .trim()
    .toLocaleLowerCase("fa-IR")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک");

  const shopAmount = value => {
    const n = Number(shopDigits(value));
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
  };

  const shopFind = (name, includeInactive = false) => {
    const rows = db.prepare(
      `SELECT * FROM shop_catalog ${includeInactive ? "" : "WHERE active = 1"}`
    ).all();

    return rows.find(row => shopNormalize(row.name) === shopNormalize(name));
  };

  // ثبت کالاهای پیش‌فرض، بدون حذف اطلاعات قبلی
  const seedShop = db.prepare(`
    INSERT OR IGNORE INTO shop_catalog
      (item_code, name, buy_price, sell_price, description, active, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `);

  for (const item of shopDefaults) {
    seedShop.run(...item, Date.now());
  }

  const shopCanManage = ctx => {
    const staff = getUser(ctx.from.id);
    const role = String(staff?.role || "").toLowerCase();

    return (
      String(process.env.OWNER_ID || "") === String(ctx.from.id) ||
      role === "owner" ||
      role === "moderator"
    );
  };

  // نمایش فهرست فروشگاه





// MONTADORIA BUSINESS SYSTEM V1

db.exec(`
  CREATE TABLE IF NOT EXISTS business_catalog (
    business_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    description TEXT NOT NULL DEFAULT '',
    price INTEGER NOT NULL CHECK(price >= 0),
    daily_income INTEGER NOT NULL DEFAULT 0 CHECK(daily_income >= 0),
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS player_businesses (
    business_id INTEGER PRIMARY KEY,
    owner_id TEXT,
    last_income_at INTEGER NOT NULL DEFAULT 0,
    purchased_at INTEGER,
    FOREIGN KEY(business_id) REFERENCES business_catalog(business_id)
  );
`);

const businessNow = () => Math.floor(Date.now() / 1000);
const businessDay = 24 * 60 * 60;
const businessParts = (ctx) =>
  String(ctx.message?.text || "").trim().split(/\s*\|\s*/);
const businessManager = (u) =>
  ["owner", "moderator"].includes(String(u?.role || "").toLowerCase());

bot.hears(/^ثبت کسب[‌ ]وکار\s*\|/i, async (ctx) => {
  const a = businessParts(ctx);

  if (!businessManager(getUser(ctx.from.id))) {
    return ctx.reply("⛔ فقط مدیر یا مالک می‌تواند کسب‌وکار ثبت کند.");
  }

  if (
    a.length < 5 ||
    !a[1] ||
    !/^\d+$/.test(a[2]) ||
    !/^\d+$/.test(a[3])
  ) {
    return ctx.reply(
      "فرمت صحیح:\nثبت کسب‌وکار | نام | قیمت | درآمد روزانه | توضیحات"
    );
  }

  const price = Number(a[2]);
  const income = Number(a[3]);

  if (
    !Number.isSafeInteger(price) ||
    !Number.isSafeInteger(income) ||
    price < 0 ||
    income < 0
  ) {
    return ctx.reply("❌ قیمت و درآمد باید عدد معتبر و غیرمنفی باشند.");
  }

  try {
    const result = db.prepare(`
      INSERT INTO business_catalog
        (name, description, price, daily_income, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(a[1], a.slice(4).join(" | "), price, income, businessNow());

    db.prepare(`
      INSERT INTO player_businesses (business_id)
      VALUES (?)
    `).run(Number(result.lastInsertRowid));

    return ctx.reply(
      `✅ کسب‌وکار «${a[1]}» ثبت شد.\n` +
      `💰 قیمت: ${price}\n📈 درآمد روزانه: ${income}`
    );
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) {
      return ctx.reply("❌ کسب‌وکاری با این نام قبلاً ثبت شده است.");
    }
    console.error("ثبت کسب‌وکار:", e);
    return ctx.reply("❌ ثبت کسب‌وکار انجام نشد.");
  }
});

bot.hears(/^کسب[‌ ]وکارها$/i, async (ctx) => {
  const rows = db.prepare(`
    SELECT c.name, c.description, c.price, c.daily_income
    FROM business_catalog c
    JOIN player_businesses p ON p.business_id = c.business_id
    WHERE c.active = 1 AND p.owner_id IS NULL
    ORDER BY c.business_id DESC
    LIMIT 50
  `).all();

  if (!rows.length) {
    return ctx.reply("🏪 در حال حاضر کسب‌وکار آزادی برای خرید وجود ندارد.");
  }

  return ctx.reply(
    "🏪 کسب‌وکارهای قابل خرید:\n\n" +
    rows.map((r, i) =>
      `${i + 1}. ${r.name}\n` +
      `💰 قیمت: ${r.price}\n` +
      `📈 درآمد روزانه: ${r.daily_income}\n` +
      `${r.description || ""}`
    ).join("\n\n")
  );
});

bot.hears(/^خرید کسب[‌ ]وکار\s*\|/i, async (ctx) => {
  const a = businessParts(ctx);

  if (a.length < 2 || !a[1]) {
    return ctx.reply("فرمت صحیح:\nخرید کسب‌وکار | نام کسب‌وکار");
  }

  const userId = String(ctx.from.id);

  const transaction = db.transaction(() => {
    const u = getUser(ctx.from.id);
    if (!u) return { error: "ابتدا ربات را با /start فعال کن." };

    const b = db.prepare(`
      SELECT c.*, p.owner_id
      FROM business_catalog c
      JOIN player_businesses p ON p.business_id = c.business_id
      WHERE c.name = ? COLLATE NOCASE AND c.active = 1
    `).get(a[1]);

    if (!b) return { error: "کسب‌وکار پیدا نشد یا فعال نیست." };

    if (b.owner_id !== null && b.owner_id !== undefined) {
      return { error: "این کسب‌وکار قبلاً فروخته شده است." };
    }

    if (!u.infinite_money && Number(u.money || 0) < b.price) {
      return { error: "موجودی کیف پولت کافی نیست." };
    }

    if (!u.infinite_money) {
      const debit = db.prepare(`
        UPDATE users
        SET money = money - ?, updated_at = ?
        WHERE telegram_id = ? AND money >= ?
      `).run(
        b.price,
        new Date().toISOString(),
        userId,
        b.price
      );

      if (!debit.changes) {
        return { error: "موجودی کیف پولت کافی نیست." };
      }
    }

    const now = businessNow();

    const assigned = db.prepare(`
      UPDATE player_businesses
      SET owner_id = ?, last_income_at = ?, purchased_at = ?
      WHERE business_id = ? AND owner_id IS NULL
    `).run(userId, now, now, b.business_id);

    if (!assigned.changes) {
      throw new Error("BUSINESS_ALREADY_SOLD");
    }

    return {
      name: b.name,
      price: b.price,
      income: b.daily_income
    };
  });

  try {
    const r = transaction();

    if (r.error) return ctx.reply("❌ " + r.error);

    return ctx.reply(
      `✅ کسب‌وکار «${r.name}» خریداری شد.\n` +
      `💰 هزینه: ${r.price}\n` +
      `📈 درآمد روزانه: ${r.income}\n\n` +
      `⏳ اولین درآمد، پس از گذشت ۲۴ ساعت قابل دریافت است.`
    );
  } catch (e) {
    if (String(e.message).includes("BUSINESS_ALREADY_SOLD")) {
      return ctx.reply("این کسب‌وکار قبلاً فروخته شده است.");
    }
    console.error("خرید کسب‌وکار:", e);
    return ctx.reply("❌ خرید کسب‌وکار انجام نشد.");
  }
});

bot.hears(/^کسب[‌ ]وکارهای من$/i, async (ctx) => {
  const rows = db.prepare(`
    SELECT c.name, c.price, c.daily_income, p.last_income_at
    FROM business_catalog c
    JOIN player_businesses p ON p.business_id = c.business_id
    WHERE p.owner_id = ?
    ORDER BY c.name
  `).all(String(ctx.from.id));

  if (!rows.length) {
    return ctx.reply("🏪 هنوز مالک هیچ کسب‌وکاری نیستی.");
  }

  const now = businessNow();

  return ctx.reply(
    "🏪 کسب‌وکارهای تو:\n\n" +
    rows.map((r, i) => {
      const elapsed = Math.max(0, now - Number(r.last_income_at || 0));
      const remaining = Math.max(0, businessDay - elapsed);
      const timeText = remaining === 0
        ? "✅ درآمد آماده دریافت است."
        : `⏳ زمان تا درآمد بعدی: ${Math.floor(remaining / 3600)} ساعت و ${Math.floor((remaining % 3600) / 60)} دقیقه`;

      return (
        `${i + 1}. ${r.name}\n` +
        `💰 قیمت ثبت‌شده: ${r.price}\n` +
        `📈 درآمد روزانه: ${r.daily_income}\n` +
        `${timeText}`
      );
    }).join("\n\n")
  );
});

bot.hears(/^دریافت درآمد کسب[‌ ]وکارها$/i, async (ctx) => {
  const userId = String(ctx.from.id);

  const transaction = db.transaction(() => {
    const user = getUser(ctx.from.id);
    if (!user) return { error: "ابتدا ربات را با /start فعال کن." };

    const now = businessNow();

    const owned = db.prepare(`
      SELECT c.business_id, c.name, c.daily_income, p.last_income_at
      FROM business_catalog c
      JOIN player_businesses p ON p.business_id = c.business_id
      WHERE p.owner_id = ? AND c.active = 1
    `).all(userId);

    if (!owned.length) {
      return { error: "هیچ کسب‌وکار فعالی نداری." };
    }

    let total = 0;
    const paid = [];
    const updateIncome = db.prepare(`
      UPDATE player_businesses
      SET last_income_at = ?
      WHERE business_id = ? AND owner_id = ?
    `);

    for (const b of owned) {
      const last = Number(b.last_income_at || 0);
      const elapsed = now - last;
      const periods = Math.floor(elapsed / businessDay);

      if (periods < 1 || b.daily_income <= 0) continue;

      const amount = periods * Number(b.daily_income);

      if (!Number.isSafeInteger(amount) || amount < 0) {
        throw new Error("BUSINESS_INCOME_OUT_OF_RANGE");
      }

      total += amount;
      if (!Number.isSafeInteger(total)) {
        throw new Error("BUSINESS_TOTAL_OUT_OF_RANGE");
      }

      updateIncome.run(
        last + periods * businessDay,
        b.business_id,
        userId
      );

      paid.push({ name: b.name, amount });
    }

    if (!paid.length) {
      return {
        error: "هنوز درآمدی آماده نیست. درآمد هر کسب‌وکار پس از هر ۲۴ ساعت قابل دریافت است."
      };
    }

    db.prepare(`
      UPDATE users SET money = money + ?, updated_at = ?
      WHERE telegram_id = ?
    `).run(total, new Date().toISOString(), userId);

    return { total, paid };
  });

  try {
    const result = transaction();

    if (result.error) return ctx.reply("ℹ️ " + result.error);

    return ctx.reply(
      "✅ درآمد کسب‌وکارها دریافت شد.\n\n" +
      result.paid.map(b => `🏪 ${b.name}: ${b.amount}`).join("\n") +
      `\n\n💰 مجموع دریافتی: ${result.total}`
    );
  } catch (e) {
    console.error("دریافت درآمد کسب‌وکار:", e);
    return ctx.reply("❌ هنگام ثبت درآمد خطایی رخ داد.");
  }
});

bot.hears(/^فروش کسب[‌ ]وکار\s*\|/i, async (ctx) => {
  const a = businessParts(ctx);

  if (a.length < 2 || !a[1]) {
    return ctx.reply("فرمت صحیح:\nفروش کسب‌وکار | نام کسب‌وکار");
  }

  const userId = String(ctx.from.id);

  const transaction = db.transaction(() => {
    const b = db.prepare(`
      SELECT c.business_id, c.name, c.price
      FROM business_catalog c
      JOIN player_businesses p ON p.business_id = c.business_id
      WHERE c.name = ? COLLATE NOCASE AND p.owner_id = ?
    `).get(a[1], userId);

    if (!b) return { error: "این کسب‌وکار متعلق به تو نیست." };

    const payout = Math.floor(Number(b.price) * 0.7);

    const sold = db.prepare(`
      UPDATE player_businesses
      SET owner_id = NULL, last_income_at = 0, purchased_at = NULL
      WHERE business_id = ? AND owner_id = ?
    `).run(b.business_id, userId);

    if (!sold.changes) return { error: "فروش کسب‌وکار انجام نشد." };

    db.prepare(`
      UPDATE users SET money = money + ?, updated_at = ?
      WHERE telegram_id = ?
    `).run(payout, new Date().toISOString(), userId);

    return { name: b.name, payout };
  });

  try {
    const result = transaction();

    if (result.error) return ctx.reply("❌ " + result.error);

    return ctx.reply(
      `✅ کسب‌وکار «${result.name}» فروخته شد.\n` +
      `💰 مبلغ دریافتی (۷۰٪ قیمت ثبت‌شده): ${result.payout}`
    );
  } catch (e) {
    console.error("فروش کسب‌وکار:", e);
    return ctx.reply("❌ فروش کسب‌وکار انجام نشد.");
  }
});

bot.hears(/^انتقال کسب[‌ ]وکار\s*\|/i, async (ctx) => {
  const a = businessParts(ctx);

  if (a.length < 3 || !a[1] || !/^\d+$/.test(a[2])) {
    return ctx.reply(
      "فرمت صحیح:\nانتقال کسب‌وکار | نام کسب‌وکار | آیدی عددی گیرنده"
    );
  }

  const senderId = String(ctx.from.id);
  const recipientId = String(a[2]);

  if (senderId === recipientId) {
    return ctx.reply("نمی‌توانی کسب‌وکار را به خودت منتقل کنی.");
  }

  if (!getUser(Number(recipientId))) {
    return ctx.reply("گیرنده باید ابتدا ربات را با /start فعال کرده باشد.");
  }

  const result = db.prepare(`
    UPDATE player_businesses
    SET owner_id = ?, last_income_at = ?
    WHERE business_id = (
      SELECT c.business_id
      FROM business_catalog c
      JOIN player_businesses p ON p.business_id = c.business_id
      WHERE c.name = ? COLLATE NOCASE AND p.owner_id = ?
    )
    AND owner_id = ?
  `).run(recipientId, businessNow(), a[1], senderId, senderId);

  if (!result.changes) {
    return ctx.reply("کسب‌وکار پیدا نشد یا مالک آن نیستی.");
  }

  await ctx.reply(`✅ مالکیت کسب‌وکار «${a[1]}» منتقل شد.`);

  try {
    await bot.api.sendMessage(
      Number(recipientId),
      `🏪 کسب‌وکار «${a[1]}» به تو منتقل شد.`
    );
  } catch {}
});

// END MONTADORIA BUSINESS SYSTEM V1


// MONTADORIA DAILY SALARY V1
db.exec(`
  CREATE TABLE IF NOT EXISTS salary_jobs (
    job_name TEXT PRIMARY KEY COLLATE NOCASE,
    daily_salary INTEGER NOT NULL DEFAULT 0 CHECK(daily_salary >= 0),
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS user_salary_claims (
    telegram_id TEXT PRIMARY KEY,
    last_claim_at INTEGER NOT NULL DEFAULT 0
  );

  INSERT OR IGNORE INTO salary_jobs (job_name, daily_salary, active)
  SELECT name, 1000, 1 FROM jobs WHERE active = 1;
`);

const salaryNow = () => Math.floor(Date.now() / 1000);
const salaryDay = 24 * 60 * 60;

bot.hears(/^حقوق من$/i, async (ctx) => {
  const user = getUser(ctx.from.id);
  if (!user) return ctx.reply("ابتدا ربات را با دستور /start فعال کن.");

  const jobName = String(user.job || "").trim();
  if (!jobName) return ctx.reply("💼 در حال حاضر شغلی نداری.");

  const salaryJob = db.prepare(`
    SELECT daily_salary, active FROM salary_jobs
    WHERE job_name = ? COLLATE NOCASE
  `).get(jobName);

  if (!salaryJob || !salaryJob.active) {
    return ctx.reply(`💼 شغل تو: ${jobName}\nبرای این شغل هنوز حقوق روزانه تعیین نشده است.`);
  }

  const claim = db.prepare(`
    SELECT last_claim_at FROM user_salary_claims WHERE telegram_id = ?
  `).get(String(ctx.from.id));

  const remaining = claim ? salaryDay - (salaryNow() - claim.last_claim_at) : 0;
  const nextText = remaining > 0
    ? `\n⏳ تا دریافت بعدی: ${Math.floor(remaining / 3600)} ساعت و ${Math.floor((remaining % 3600) / 60)} دقیقه`
    : "\n✅ حقوق آماده دریافت است.";

  return ctx.reply(
    `💼 شغل: ${jobName}\n💰 حقوق روزانه: ${salaryJob.daily_salary}${nextText}`
  );
});

bot.hears(/^دریافت حقوق$/i, async (ctx) => {
  const userId = String(ctx.from.id);
  const user = getUser(ctx.from.id);
  if (!user) return ctx.reply("ابتدا ربات را با دستور /start فعال کن.");

  const jobName = String(user.job || "").trim();
  if (!jobName) return ctx.reply("❌ برای دریافت حقوق باید شغل داشته باشی.");

  const claimSalary = db.transaction(() => {
    const salaryJob = db.prepare(`
      SELECT daily_salary, active FROM salary_jobs
      WHERE job_name = ? COLLATE NOCASE
    `).get(jobName);

    if (!salaryJob || !salaryJob.active) {
      return { error: "برای شغل فعلی‌ات حقوق روزانه تعیین نشده است." };
    }

    const now = salaryNow();
    const previous = db.prepare(`
      SELECT last_claim_at FROM user_salary_claims WHERE telegram_id = ?
    `).get(userId);

    if (previous && now - previous.last_claim_at < salaryDay) {
      const remaining = salaryDay - (now - previous.last_claim_at);
      return {
        error: `هنوز زمان دریافت حقوق بعدی نرسیده است.\n⏳ زمان باقی‌مانده: ${Math.floor(remaining / 3600)} ساعت و ${Math.floor((remaining % 3600) / 60)} دقیقه`
      };
    }

    if (!user.infinite_money) {
      db.prepare(`
        UPDATE users SET money = money + ?, updated_at = ?
        WHERE telegram_id = ?
      `).run(salaryJob.daily_salary, new Date().toISOString(), userId);
    }

    db.prepare(`
      INSERT INTO user_salary_claims (telegram_id, last_claim_at)
      VALUES (?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET last_claim_at = excluded.last_claim_at
    `).run(userId, now);

    return { salary: salaryJob.daily_salary, jobName };
  });

  try {
    const result = claimSalary();
    if (result.error) return ctx.reply("⏳ " + result.error);

    return ctx.reply(
      `✅ حقوق روزانه دریافت شد.\n💼 شغل: ${result.jobName}\n💰 مبلغ: ${result.salary}`
    );
  } catch (e) {
    console.error("دریافت حقوق:", e);
    return ctx.reply("❌ هنگام ثبت حقوق خطایی رخ داد.");
  }
});

bot.hears(/^تنظیم حقوق\s*\|/i, async (ctx) => {
  const user = getUser(ctx.from.id);
  if (!["owner", "moderator"].includes(String(user?.role || "").toLowerCase())) {
    return ctx.reply("⛔ فقط مدیر یا مالک می‌تواند حقوق شغل‌ها را تنظیم کند.");
  }

  const parts = String(ctx.message?.text || "").trim().split(/\s*\|\s*/);
  if (parts.length !== 3 || !parts[1] || !/^\d+$/.test(parts[2])) {
    return ctx.reply("فرمت صحیح:\nتنظیم حقوق | نام شغل | مبلغ روزانه");
  }

  const salary = Number(parts[2]);
  if (!Number.isSafeInteger(salary) || salary < 0) {
    return ctx.reply("❌ مبلغ حقوق معتبر نیست.");
  }

  const job = db.prepare(`
    SELECT name FROM jobs WHERE name = ? COLLATE NOCASE AND active = 1
  `).get(parts[1]);

  if (!job) return ctx.reply("❌ این شغل در فهرست شغل‌های فعال وجود ندارد.");

  db.prepare(`
    INSERT INTO salary_jobs (job_name, daily_salary, active)
    VALUES (?, ?, 1)
    ON CONFLICT(job_name) DO UPDATE SET
      daily_salary = excluded.daily_salary,
      active = 1
  `).run(job.name, salary);

  return ctx.reply(`✅ حقوق روزانه شغل «${job.name}» روی ${salary} تنظیم شد.`);
});
// END MONTADORIA DAILY SALARY V1


// MONTADORIA CAR SYSTEM V1
db.exec(`
  CREATE TABLE IF NOT EXISTS car_catalog (
    car_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    description TEXT NOT NULL DEFAULT '',
    price INTEGER NOT NULL CHECK(price >= 0),
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS player_cars (
    car_id INTEGER PRIMARY KEY,
    owner_id TEXT,
    purchased_at INTEGER,
    FOREIGN KEY(car_id) REFERENCES car_catalog(car_id)
  );
`);

const carNow = () => Math.floor(Date.now() / 1000);
const carParts = (ctx) => String(ctx.message?.text || "").trim().split(/\s*\|\s*/);
const carIsManager = (u) => ["owner", "moderator"].includes(String(u?.role || "").toLowerCase());

bot.hears(/^ثبت خودرو\s*\|/i, async (ctx) => {
  const a = carParts(ctx);
  const u = getUser(ctx.from.id);
  if (!carIsManager(u)) return ctx.reply("⛔ فقط مدیر یا مالک می‌تواند خودرو ثبت کند.");
  if (a.length < 4 || !a[1] || !/^\d+$/.test(a[2])) {
    return ctx.reply("فرمت صحیح:\nثبت خودرو | نام خودرو | قیمت | توضیحات");
  }
  const price = Number(a[2]);
  if (!Number.isSafeInteger(price) || price < 0) return ctx.reply("قیمت معتبر نیست.");
  try {
    const result = db.prepare(`
      INSERT INTO car_catalog (name, description, price, created_at)
      VALUES (?, ?, ?, ?)
    `).run(a[1], a.slice(3).join(" | "), price, carNow());
    db.prepare("INSERT INTO player_cars (car_id) VALUES (?)").run(Number(result.lastInsertRowid));
    return ctx.reply("✅ خودرو به فهرست فروش اضافه شد.");
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) return ctx.reply("این خودرو قبلاً ثبت شده است.");
    console.error("ثبت خودرو:", e);
    return ctx.reply("ثبت خودرو انجام نشد.");
  }
});

bot.hears(/^خودروها$/i, async (ctx) => {
  const rows = db.prepare(`
    SELECT c.name, c.description, c.price
    FROM car_catalog c
    JOIN player_cars p ON p.car_id = c.car_id
    WHERE p.owner_id IS NULL
    ORDER BY c.car_id DESC LIMIT 50
  `).all();
  if (!rows.length) return ctx.reply("🚘 فعلاً خودرویی برای خرید موجود نیست.");
  return ctx.reply("🚘 فهرست خودروهای قابل خرید:\n\n" + rows.map((r, i) =>
    `${i + 1}. ${r.name}\n💰 قیمت: ${r.price}\n${r.description || ""}`
  ).join("\n\n"));
});

bot.hears(/^خرید خودرو\s*\|/i, async (ctx) => {
  const a = carParts(ctx);
  if (a.length < 2 || !a[1]) return ctx.reply("فرمت صحیح:\nخرید خودرو | نام خودرو");
  const userId = String(ctx.from.id);
  const transaction = db.transaction(() => {
    const u = getUser(ctx.from.id);
    if (!u) return { error: "ابتدا با ربات شروع کنید." };
    const car = db.prepare(`
      SELECT c.*, p.owner_id FROM car_catalog c
      JOIN player_cars p ON p.car_id = c.car_id
      WHERE c.name = ? COLLATE NOCASE
    `).get(a[1]);
    if (!car) return { error: "خودرو پیدا نشد." };
    if (car.owner_id !== null && car.owner_id !== undefined) return { error: "این خودرو قبلاً فروخته شده است." };
    if (!u.infinite_money && Number(u.money || 0) < car.price) return { error: "موجودی پولت کافی نیست." };
    if (!u.infinite_money) {
      const debit = db.prepare(`
        UPDATE users SET money = money - ? WHERE telegram_id = ? AND money >= ?
      `).run(car.price, userId, car.price);
      if (!debit.changes) return { error: "موجودی پولت کافی نیست." };
    }
    const assign = db.prepare(`
      UPDATE player_cars SET owner_id = ?, purchased_at = ?
      WHERE car_id = ? AND owner_id IS NULL
    `).run(userId, carNow(), car.car_id);
    if (!assign.changes) throw new Error("CAR_ALREADY_SOLD");
    return { name: car.name, price: car.price };
  });
  try {
    const result = transaction();
    if (result.error) return ctx.reply("❌ " + result.error);
    return ctx.reply(`✅ خودرو «${result.name}» با قیمت ${result.price} خریداری شد.`);
  } catch (e) {
    if (String(e.message).includes("CAR_ALREADY_SOLD")) return ctx.reply("این خودرو قبلاً فروخته شده است.");
    console.error("خرید خودرو:", e);
    return ctx.reply("خرید خودرو انجام نشد.");
  }
});

bot.hears(/^خودروهای من$/i, async (ctx) => {
  const rows = db.prepare(`
    SELECT c.name, c.description, c.price
    FROM player_cars p JOIN car_catalog c ON c.car_id = p.car_id
    WHERE p.owner_id = ? ORDER BY c.name
  `).all(String(ctx.from.id));
  if (!rows.length) return ctx.reply("🚘 خودرویی به نام تو ثبت نشده است.");
  return ctx.reply("🚘 خودروهای تو:\n\n" + rows.map((r, i) =>
    `${i + 1}. ${r.name}\n💰 قیمت ثبت‌شده: ${r.price}\n${r.description || ""}`
  ).join("\n\n"));
});

bot.hears(/^فروش خودرو\s*\|/i, async (ctx) => {
  const a = carParts(ctx);
  if (a.length < 2 || !a[1]) return ctx.reply("فرمت صحیح:\nفروش خودرو | نام خودرو");
  const userId = String(ctx.from.id);
  const transaction = db.transaction(() => {
    const car = db.prepare(`
      SELECT c.car_id, c.name, c.price FROM car_catalog c
      JOIN player_cars p ON p.car_id = c.car_id
      WHERE c.name = ? COLLATE NOCASE AND p.owner_id = ?
    `).get(a[1], userId);
    if (!car) return { error: "این خودرو متعلق به تو نیست." };
    const payout = Math.floor(car.price * 0.7);
    const sold = db.prepare(`
      UPDATE player_cars SET owner_id = NULL, purchased_at = NULL
      WHERE car_id = ? AND owner_id = ?
    `).run(car.car_id, userId);
    if (!sold.changes) return { error: "فروش خودرو انجام نشد." };
    db.prepare("UPDATE users SET money = money + ? WHERE telegram_id = ?").run(payout, userId);
    return { name: car.name, payout };
  });
  try {
    const result = transaction();
    if (result.error) return ctx.reply("❌ " + result.error);
    return ctx.reply(`✅ خودرو «${result.name}» فروخته شد.\n💰 مبلغ دریافتی: ${result.payout}`);
  } catch (e) {
    console.error("فروش خودرو:", e);
    return ctx.reply("فروش خودرو انجام نشد.");
  }
});

bot.hears(/^انتقال خودرو\s*\|/i, async (ctx) => {
  const a = carParts(ctx);
  if (a.length < 3 || !a[1] || !/^\d+$/.test(a[2])) {
    return ctx.reply("فرمت صحیح:\nانتقال خودرو | نام خودرو | آیدی عددی گیرنده");
  }
  const senderId = String(ctx.from.id);
  const recipientId = String(a[2]);
  if (senderId === recipientId) return ctx.reply("نمی‌توانی خودرو را به خودت منتقل کنی.");
  if (!getUser(Number(recipientId))) return ctx.reply("گیرنده باید ابتدا ربات را شروع کرده باشد.");
  const result = db.prepare(`
    UPDATE player_cars SET owner_id = ?, purchased_at = ?
    WHERE car_id = (
      SELECT c.car_id FROM car_catalog c
      JOIN player_cars p ON p.car_id = c.car_id
      WHERE c.name = ? COLLATE NOCASE AND p.owner_id = ?
    ) AND owner_id = ?
  `).run(recipientId, carNow(), a[1], senderId, senderId);
  if (!result.changes) return ctx.reply("خودرو پیدا نشد یا مالک آن نیستی.");
  await ctx.reply(`✅ خودرو «${a[1]}» به آیدی ${recipientId} منتقل شد.`);
  try {
    await bot.api.sendMessage(Number(recipientId), `🚘 خودروی «${a[1]}» به تو منتقل شد.`);
  } catch {}
});
// END MONTADORIA CAR SYSTEM V1


// MONTADORIA PROPERTY SYSTEM V1
db.exec(`
  CREATE TABLE IF NOT EXISTS player_properties (
    property_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    description TEXT NOT NULL DEFAULT '',
    price INTEGER NOT NULL CHECK(price >= 0),
    owner_id TEXT,
    created_at INTEGER NOT NULL
  )
`);

const propertyNow = () => Math.floor(Date.now() / 1000);
const propertyParts = text => text.split("|").map(x => x.trim());
const propertyIsManager = ctx =>
  String(ctx.from?.id) === String(process.env.OWNER_ID) ||
  ["owner", "moderator"].includes(
    String(getUser(ctx.from.id)?.role || "").toLowerCase()
  );

bot.hears(/^ثبت ملک\s*\|/i, async ctx => {
  if (!propertyIsManager(ctx))
    return ctx.reply("⛔ فقط مالک یا مدیر می‌تواند ملک ثبت کند.");

  const a = propertyParts(ctx.message.text);
  if (a.length < 4 || !a[1] || !/^\d+$/.test(a[2]))
    return ctx.reply("فرمت:\nثبت ملک | نام ملک | قیمت | توضیحات");

  try {
    db.prepare(`
      INSERT INTO player_properties (name, price, description, created_at)
      VALUES (?, ?, ?, ?)
    `).run(a[1], Number(a[2]), a.slice(3).join(" | "), propertyNow());
    return ctx.reply(`✅ ملک «${a[1]}» با قیمت ${Number(a[2]).toLocaleString("en-US")} سکه ثبت شد.`);
  } catch (e) {
    if (String(e.message).includes("UNIQUE"))
      return ctx.reply("این ملک قبلاً ثبت شده است.");
    console.error(e);
    return ctx.reply("❌ ثبت ملک انجام نشد.");
  }
});

bot.hears(/^املاک$/i, async ctx => {
  const rows = db.prepare(`
    SELECT name, description, price, owner_id
    FROM player_properties ORDER BY property_id DESC LIMIT 50
  `).all();
  if (!rows.length) return ctx.reply("🏘️ هنوز ملکی ثبت نشده است.");
  return ctx.reply("🏘️ املاک مونتادوریا\n\n" + rows.map(x =>
    `🏠 ${x.name}\n💰 ${Number(x.price).toLocaleString("en-US")} سکه\n📌 ${x.owner_id ? "فروخته‌شده" : "قابل خرید"}${x.description ? "\n📝 " + x.description : ""}`
  ).join("\n\n"));
});

bot.hears(/^املاک من$/i, async ctx => {
  const rows = db.prepare(`
    SELECT name, description, price FROM player_properties
    WHERE owner_id = ? ORDER BY property_id DESC
  `).all(String(ctx.from.id));
  if (!rows.length) return ctx.reply("🏠 ملکی به نام تو ثبت نشده است.");
  return ctx.reply("🏰 املاک تو:\n\n" + rows.map(x =>
    `🏠 ${x.name}\n💰 ${Number(x.price).toLocaleString("en-US")} سکه${x.description ? "\n📝 " + x.description : ""}`
  ).join("\n\n"));
});

bot.hears(/^خرید ملک\s*\|/i, async ctx => {
  const a = propertyParts(ctx.message.text);
  if (!a[1]) return ctx.reply("فرمت:\nخرید ملک | نام ملک");

  const user = getUser(ctx.from.id);
  if (!user) return ctx.reply("ابتدا /start را برای ربات بفرست.");

  try {
    const purchase = db.transaction(() => {
      const prop = db.prepare(
        "SELECT * FROM player_properties WHERE name = ? COLLATE NOCASE"
      ).get(a[1]);
      if (!prop) return { error: "ملک پیدا نشد." };
      if (prop.owner_id) return { error: "این ملک قبلاً فروخته شده است." };

      if (!user.infinite_money) {
        const debit = db.prepare(`
          UPDATE users SET money = money - ?
          WHERE telegram_id = ? AND money >= ?
        `).run(prop.price, String(ctx.from.id), prop.price);
        if (!debit.changes) return { error: "موجودی نقدی کافی نیست." };
      }

      const changed = db.prepare(`
        UPDATE player_properties SET owner_id = ?
        WHERE property_id = ? AND owner_id IS NULL
      `).run(String(ctx.from.id), prop.property_id);
      if (!changed.changes) throw new Error("PROPERTY_RACE");
      return { prop };
    });

    const result = purchase();
    if (result.error) return ctx.reply("❌ " + result.error);
    return ctx.reply(`✅ ملک «${result.prop.name}» به نام تو ثبت شد.\n💰 قیمت: ${Number(result.prop.price).toLocaleString("en-US")} سکه`);
  } catch (e) {
    console.error("Property purchase error:", e);
    return ctx.reply("❌ خرید انجام نشد.");
  }
});

bot.hears(/^فروش ملک\s*\|/i, async ctx => {
  const a = propertyParts(ctx.message.text);
  if (!a[1]) return ctx.reply("فرمت:\nفروش ملک | نام ملک");

  const prop = db.prepare(
    "SELECT * FROM player_properties WHERE name = ? COLLATE NOCASE"
  ).get(a[1]);
  if (!prop) return ctx.reply("❌ ملک پیدا نشد.");
  if (String(prop.owner_id) !== String(ctx.from.id))
    return ctx.reply("⛔ این ملک به نام تو نیست.");

  const sale = db.transaction(() => {
    const result = db.prepare(`
      UPDATE player_properties SET owner_id = NULL
      WHERE property_id = ? AND owner_id = ?
    `).run(prop.property_id, String(ctx.from.id));
    if (!result.changes) return false;
    db.prepare("UPDATE users SET money = money + ? WHERE telegram_id = ?")
      .run(prop.price, String(ctx.from.id));
    return true;
  });

  if (!sale()) return ctx.reply("❌ فروش انجام نشد.");
  return ctx.reply(`✅ ملک «${prop.name}» فروخته شد.\n💰 دریافتی: ${Number(prop.price).toLocaleString("en-US")} سکه`);
});

// MONTADORIA PROPERTY TRANSFER V1
bot.hears(/^انتقال ملک\s*\|/i, async ctx => {
  const a = ctx.message.text.split("|").map(x => x.trim());

  if (a.length < 3 || !a[1] || !/^\d+$/.test(a[2])) {
    return ctx.reply("فرمت دستور:\nانتقال ملک | نام ملک | آیدی عددی گیرنده");
  }

  const propertyName = a[1];
  const recipientId = a[2];
  const senderId = String(ctx.from.id);

  if (recipientId === senderId) {
    return ctx.reply("❌ نمی‌توانی ملک را به خودت منتقل کنی.");
  }

  const recipient = getUser(recipientId);
  if (!recipient) {
    return ctx.reply("❌ گیرنده در ربات ثبت‌نام نکرده است.");
  }

  const transfer = db.transaction(() => {
    const property = db.prepare(`
      SELECT property_id, name, owner_id
      FROM player_properties
      WHERE name = ? COLLATE NOCASE
    `).get(propertyName);

    if (!property) return { error: "ملک پیدا نشد." };

    if (String(property.owner_id) !== senderId) {
      return { error: "این ملک به نام تو نیست." };
    }

    const result = db.prepare(`
      UPDATE player_properties
      SET owner_id = ?
      WHERE property_id = ? AND owner_id = ?
    `).run(recipientId, property.property_id, senderId);

    if (!result.changes) return { error: "انتقال انجام نشد؛ دوباره تلاش کن." };

    return { name: property.name };
  });

  try {
    const result = transfer();
    if (result.error) return ctx.reply("❌ " + result.error);

    await ctx.reply(
      `✅ مالکیت ملک «${result.name}» به کاربر ${recipientId} منتقل شد.`
    );

    try {
      await ctx.api.sendMessage(
        Number(recipientId),
        `🏰 یک ملک به تو منتقل شد.\nنام ملک: ${result.name}`
      );
    } catch (e) {
      console.error("Property transfer notification failed:", e);
    }
  } catch (e) {
    console.error("Property transfer error:", e);
    return ctx.reply("❌ خطا هنگام انتقال ملک.");
  }
});
// END MONTADORIA PROPERTY TRANSFER V1


// END MONTADORIA PROPERTY SYSTEM V1

// MONTADORIA TAX SYSTEM V1
{
  const taxDb = db;
  taxDb.exec(`
    CREATE TABLE IF NOT EXISTS montadoria_tax_settings (
      setting TEXT PRIMARY KEY,
      value REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS montadoria_tax_cycles (
      user_id INTEGER PRIMARY KEY,
      last_at INTEGER NOT NULL DEFAULT 0,
      debt REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS montadoria_tax_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      description TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  const taxDefaults = [
    ['property_rate', 1],
    ['business_rate', 5],
    ['upkeep_rate', 1]
  ];
  const taxGetSetting = taxDb.prepare(
    'SELECT value FROM montadoria_tax_settings WHERE setting = ?'
  );
  const taxSetSetting = taxDb.prepare(`
    INSERT INTO montadoria_tax_settings(setting, value) VALUES (?, ?)
    ON CONFLICT(setting) DO UPDATE SET value = excluded.value
  `);
  for (const [key, value] of taxDefaults) {
    if (!taxGetSetting.get(key)) taxSetSetting.run(key, value);
  }

  const taxGetCycle = taxDb.prepare(
    'SELECT * FROM montadoria_tax_cycles WHERE user_id = ?'
  );
  const taxEnsureCycle = taxDb.prepare(
    'INSERT OR IGNORE INTO montadoria_tax_cycles(user_id, last_at, debt) VALUES (?, ?, 0)'
  );
  const taxAddDebt = taxDb.prepare(
    'UPDATE montadoria_tax_cycles SET debt = MIN(100000000, debt + ?), last_at = ? WHERE user_id = ?'
  );
  const taxLog = taxDb.prepare(
    'INSERT INTO montadoria_tax_logs(user_id, amount, description, created_at) VALUES (?, ?, ?, ?)'
  );

  function taxNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  function taxAssets(userId) {
    const properties = taxDb.prepare(
      'SELECT COALESCE(SUM(price), 0) AS total FROM player_properties WHERE owner_id = ?'
    ).get(userId)?.total || 0;

    const businesses = taxDb.prepare(`
      SELECT COALESCE(SUM(c.price), 0) AS total,
             COALESCE(SUM(c.daily_income), 0) AS income
      FROM player_businesses p
      JOIN business_catalog c ON c.business_id = p.business_id
      WHERE p.owner_id = ?
    `).get(userId) || { total: 0, income: 0 };

    let cars = { total: 0 };
    try {
      cars = taxDb.prepare(
        'SELECT COALESCE(SUM(price), 0) AS total FROM player_cars WHERE owner_id = ?'
      ).get(userId) || cars;
    } catch (_) {}
    return {
      properties: taxNumber(properties),
      businessValue: taxNumber(businesses.total),
      businessIncome: taxNumber(businesses.income),
      cars: taxNumber(cars.total)
    };
  }

  function taxCalculate(userId) {
    const now = Date.now();
    taxEnsureCycle.run(userId, now);
    let cycle = taxGetCycle.get(userId);
    if (!cycle.last_at || cycle.last_at > now) {
      taxDb.prepare('UPDATE montadoria_tax_cycles SET last_at = ? WHERE user_id = ?').run(now, userId);
      cycle = taxGetCycle.get(userId);
    }

    const elapsedDays = Math.min(7, Math.floor((now - cycle.last_at) / 86400000));
    if (elapsedDays > 0) {
      const a = taxAssets(userId);
      const propertyRate = Number(taxGetSetting.get('property_rate')?.value ?? 1);
      const businessRate = Number(taxGetSetting.get('business_rate')?.value ?? 5);
      const upkeepRate = Number(taxGetSetting.get('upkeep_rate')?.value ?? 1);

      const propertyTax = a.properties * propertyRate / 100 / 30 * elapsedDays;
      const businessTax = a.businessIncome * businessRate / 100 * elapsedDays;
      const upkeep = (a.properties + a.businessValue + a.cars) * upkeepRate / 100 / 30 * elapsedDays;
      const total = Math.max(0, Math.round(propertyTax + businessTax + upkeep));

      taxDb.prepare(
        'UPDATE montadoria_tax_cycles SET debt = MIN(100000000, debt + ?), last_at = ? WHERE user_id = ?'
      ).run(total, cycle.last_at + elapsedDays * 86400000, userId);

      if (total > 0) taxLog.run(userId, total, 'مالیات و نگهداری', now);
    }
    return taxGetCycle.get(userId);
  }

  function taxMoney(n) {
    return Math.round(Number(n) || 0).toLocaleString('en-US');
  }
  function taxReply(ctx, message) {
    return ctx.reply(message);
  }
  function taxIsManager(userId) {
    const u = getUser(userId);
    return u && ['owner', 'moderator'].includes(String(u.role || '').toLowerCase());
  }

  bot.hears(/^(مالیات من|بدهی من)$/u, async (ctx) => {
    const userId = ctx.from.id;
    const cycle = taxCalculate(userId);
    const a = taxAssets(userId);
    const msg =
      '⟡ وضعیت مالیاتی مونتادوریا ⟡\n' +
      'ارزش املاک: ' + taxMoney(a.properties) + '\n' +
      'درآمد روزانه کسب‌وکارها: ' + taxMoney(a.businessIncome) + '\n' +
      'ارزش کسب‌وکارها: ' + taxMoney(a.businessValue) + '\n' +
      'ارزش خودروها: ' + taxMoney(a.cars) + '\n' +
      'بدهی قابل پرداخت: ' + taxMoney(cycle.debt);
    return taxReply(ctx, msg);
  });

  bot.hears(/^پرداخت مالیات(?:\s*\|\s*(\d+))?$/u, async (ctx) => {
    const userId = ctx.from.id;
    const cycle = taxCalculate(userId);
    const debt = Math.round(Number(cycle.debt) || 0);
    if (debt <= 0) return taxReply(ctx, '✅ بدهی مالیاتی ندارید.');

    const u = getUser(userId);
    if (!u) return taxReply(ctx, 'ابتدا /start را اجرا کنید.');

    const requested = ctx.match?.[1] ? Number(ctx.match[1]) : debt;
    const amount = Math.min(debt, Math.max(0, Math.floor(requested)));
    if (amount <= 0) return taxReply(ctx, 'مبلغ پرداخت معتبر نیست.');

    const infinite = Number(u.infinite_money || 0) === 1 || u.infinite_money === true;
    if (!infinite && Number(u.money || 0) < amount) {
      return taxReply(ctx, '❌ موجودی کیف پول کافی نیست. مبلغ موردنیاز: ' + taxMoney(amount));
    }

    const pay = taxDb.transaction(() => {
      if (!infinite) {
        taxDb.prepare('UPDATE users SET money = money - ? WHERE telegram_id = ?').run(amount, userId);
      }
      taxDb.prepare(
        'UPDATE montadoria_tax_cycles SET debt = MAX(0, debt - ?) WHERE user_id = ?'
      ).run(amount, userId);
      taxLog.run(userId, -amount, 'پرداخت مالیات', Date.now());
    });
    pay();
    return taxReply(ctx, '✅ پرداخت مالیات انجام شد.\nمبلغ پرداختی: ' + taxMoney(amount));
  });

  bot.hears(/^تنظیم مالیات\s*\|\s*(ملک|کسب‌وکار|کسب و کار|نگهداری)\s*\|\s*(\d+(?:\.\d+)?)$/u, async (ctx) => {
    if (!taxIsManager(ctx.from.id)) return;
    const category = ctx.match[1].replace(/‌/g, '').replace(/\s/g, '');
    const rate = Number(ctx.match[2]);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      return taxReply(ctx, 'نرخ باید بین ۰ تا ۱۰۰ باشد.');
    }
    const key = category === 'ملک' ? 'property_rate'
      : category === 'نگهداری' ? 'upkeep_rate' : 'business_rate';
    taxSetSetting.run(key, rate);
    return taxReply(ctx, '✅ نرخ مالیات ذخیره شد: ' + category + ' = ' + rate + '%');
  });

  bot.hears(/^گزارش مالیات$/u, async (ctx) => {
    if (!taxIsManager(ctx.from.id)) return;
    const totals = taxDb.prepare(`
      SELECT COUNT(*) AS people, COALESCE(SUM(debt), 0) AS debt
      FROM montadoria_tax_cycles WHERE debt > 0
    `).get();
    const p = taxGetSetting.get('property_rate')?.value ?? 1;
    const b = taxGetSetting.get('business_rate')?.value ?? 5;
    const u = taxGetSetting.get('upkeep_rate')?.value ?? 1;
    return taxReply(ctx,
      '⟡ گزارش مالیات ⟡\n' +
      'افراد بدهکار: ' + totals.people + '\n' +
      'مجموع بدهی: ' + taxMoney(totals.debt) + '\n' +
      'نرخ ملک: ' + p + '% ماهانه\n' +
      'نرخ کسب‌وکار: ' + b + '% از درآمد روزانه\n' +
      'نرخ نگهداری: ' + u + '% ماهانه');
  });
}
// END MONTADORIA TAX SYSTEM V1



// MONTADORIA MULTI-MARKET V3
{
  const mm = db;

  // MONTADORIA BLACK MARKET LICENSES V1
  mm.exec(`
    CREATE TABLE IF NOT EXISTS black_market_license_types (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS black_market_user_licenses (
      telegram_id TEXT NOT NULL,
      license_code TEXT NOT NULL,
      granted_by TEXT NOT NULL,
      granted_at INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (telegram_id, license_code)
    );
  `);

  const bmCols = mm.prepare("PRAGMA table_info(shop_catalog)").all().map(x => x.name);
  if (!bmCols.includes("required_license")) {
    mm.exec("ALTER TABLE shop_catalog ADD COLUMN required_license TEXT NOT NULL DEFAULT ''");
  }

  bot.hears(/^تعریف مجوز\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*(.+)$/u, async ctx => {
    if (!mmManage(ctx)) return ctx.reply("⛔ فقط مالک یا مدیر اجازه این کار را دارد.");
    const [, rawCode, rawName, rawDesc] = ctx.match;
    const code = mmText(rawCode), name = mmText(rawName), desc = mmText(rawDesc);
    if (!/^[\p{L}\p{N}_-]{2,40}$/u.test(code) || !name) {
      return ctx.reply("کد مجوز معتبر نیست.");
    }
    try {
      mm.prepare(`INSERT INTO black_market_license_types
        (code,name,description,active,created_at) VALUES (?,?,?,1,?)`)
        .run(code, name, desc, mmNow());
      return ctx.reply(`✅ مجوز «${name}» ساخته شد.`);
    } catch {
      return ctx.reply("این کد مجوز قبلاً ثبت شده است.");
    }
  });

  bot.hears(/^مجوزهای بازار سیاه$/u, async ctx => {
    const rows = mm.prepare(`SELECT code,name,description
      FROM black_market_license_types WHERE active=1 ORDER BY name`).all();
    return ctx.reply(rows.length
      ? "🔐 مجوزهای بازار سیاه\n\n" +
        rows.map(x => `• ${x.name}\nکد: ${x.code}\n${x.description}`).join("\n\n")
      : "هنوز مجوزی تعریف نشده است.");
  });

  bot.hears(/^مجوزهای من$/u, async ctx => {
    const rows = mm.prepare(`SELECT t.code,t.name
      FROM black_market_user_licenses u
      JOIN black_market_license_types t ON t.code=u.license_code
      WHERE u.telegram_id=? AND u.active=1 AND t.active=1
      ORDER BY t.name`).all(String(ctx.from.id));
    return ctx.reply(rows.length
      ? "🔐 مجوزهای فعال شما:\n\n" + rows.map(x => `• ${x.name} (${x.code})`).join("\n")
      : "شما مجوز فعال بازار سیاه ندارید.");
  });

  bot.hears(/^اعطای مجوز\s*\|\s*([0-9۰-۹٠-٩]+)\s*\|\s*(.+)$/u, async ctx => {
    if (!mmManage(ctx)) return ctx.reply("⛔ فقط مالک یا مدیر اجازه این کار را دارد.");
    const userId = String(mmNum(ctx.match[1]));
    const code = mmText(ctx.match[2]);
    if (!Number.isSafeInteger(Number(userId)) || Number(userId) <= 0) {
      return ctx.reply("شناسه تلگرام معتبر نیست.");
    }
    const type = mm.prepare(`SELECT name FROM black_market_license_types
      WHERE code=? AND active=1`).get(code);
    if (!type) return ctx.reply("نوع مجوز فعال پیدا نشد.");
    mm.prepare(`INSERT INTO black_market_user_licenses
      (telegram_id,license_code,granted_by,granted_at,active)
      VALUES (?,?,?,?,1)
      ON CONFLICT(telegram_id,license_code) DO UPDATE SET
      granted_by=excluded.granted_by,granted_at=excluded.granted_at,active=1`)
      .run(userId, code, String(ctx.from.id), mmNow());
    return ctx.reply(`✅ مجوز «${type.name}» برای شناسه ${userId} فعال شد.`);
  });

  bot.hears(/^لغو مجوز\s*\|\s*([0-9۰-۹٠-٩]+)\s*\|\s*(.+)$/u, async ctx => {
    if (!mmManage(ctx)) return ctx.reply("⛔ فقط مالک یا مدیر اجازه این کار را دارد.");
    const userId = String(mmNum(ctx.match[1]));
    const code = mmText(ctx.match[2]);
    const r = mm.prepare(`UPDATE black_market_user_licenses SET active=0
      WHERE telegram_id=? AND license_code=? AND active=1`).run(userId, code);
    return ctx.reply(r.changes ? "✅ مجوز لغو شد." : "مجوز فعالی پیدا نشد.");
  });

  bot.hears(/^تعیین مجوز کالا\s*\|\s*بازار سیاه\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*(.+)$/u, async ctx => {
    if (!mmManage(ctx)) return ctx.reply("⛔ فقط مالک یا مدیر اجازه این کار را دارد.");
    const store = mmText(ctx.match[1]);
    const name = mmText(ctx.match[2]);
    const code = mmText(ctx.match[3]);
    const type = mm.prepare(`SELECT name FROM black_market_license_types
      WHERE code=? AND active=1`).get(code);
    if (!type) return ctx.reply("نوع مجوز فعال پیدا نشد.");
    const item = mmFindItem("بازار سیاه", store, name);
    if (!item || !item.active || !item.store_active) return ctx.reply("کالای فعال پیدا نشد.");
    mm.prepare("UPDATE shop_catalog SET required_license=? WHERE item_code=?")
      .run(code, item.item_code);
    return ctx.reply(`✅ خرید «${item.name}» نیازمند مجوز «${type.name}» شد.`);
  });

  bot.hears(/^حذف مجوز کالا\s*\|\s*بازار سیاه\s*\|\s*([^|]+)\s*\|\s*(.+)$/u, async ctx => {
    if (!mmManage(ctx)) return ctx.reply("⛔ فقط مالک یا مدیر اجازه این کار را دارد.");
    const item = mmFindItem("بازار سیاه", mmText(ctx.match[1]), mmText(ctx.match[2]));
    if (!item) return ctx.reply("کالا پیدا نشد.");
    mm.prepare("UPDATE shop_catalog SET required_license='' WHERE item_code=?")
      .run(item.item_code);
    return ctx.reply("✅ شرط مجوز از این کالا برداشته شد.");
  });

  // بررسی مجوز پیش از رسیدن پیام به دستور خرید اصلی
  bot.hears(/^خرید\s*\|\s*بازار سیاه\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*(.+)$/u, async (ctx, next) => {
    const item = mmFindItem("بازار سیاه", mmText(ctx.match[1]), mmText(ctx.match[2]));
    if (!item || !item.active || !item.store_active) return next();

    const code = mmText(item.required_license);
    if (!code) return next();

    const type = mm.prepare(`SELECT name FROM black_market_license_types
      WHERE code=? AND active=1`).get(code);
    if (!type) return ctx.reply("⛔ خرید این کالا غیرفعال است؛ مجوز معتبر نیست.");

    const hasLicense = mm.prepare(`SELECT 1 FROM black_market_user_licenses
      WHERE telegram_id=? AND license_code=? AND active=1`)
      .get(String(ctx.from.id), code);

    if (!hasLicense) {
      return ctx.reply(`🔒 برای خرید این کالا مجوز «${type.name}» لازم است.`);
    }
    return next();
  });
  // END MONTADORIA BLACK MARKET LICENSES V1

  const mmNow = () => Math.floor(Date.now() / 1000);
  const mmText = x => String(x ?? "").trim();

  const mmNum = x => {
    const fa = "۰۱۲۳۴۵۶۷۸۹", ar = "٠١٢٣٤٥٦٧٨٩";
    const n = [...String(x ?? "").trim()].map(c => {
      let i = fa.indexOf(c);
      if (i >= 0) return String(i);
      i = ar.indexOf(c);
      return i >= 0 ? String(i) : c;
    }).join("").replace(/[,\s٬،]/g, "");
    return Number(n);
  };

  const mmCash = x => Number(x || 0).toLocaleString("en-US");

  mm.exec(`
    CREATE TABLE IF NOT EXISTS shop_stores (
      store_id INTEGER PRIMARY KEY AUTOINCREMENT,
      market TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      UNIQUE(market, name)
    )
  `);

  // MONTADORIA_STORE_CHAT_BINDING_V1
  const storeChatCols = mm.prepare(
    "PRAGMA table_info(shop_stores)"
  ).all().map(x => x.name);

  if (!storeChatCols.includes("chat_id")) {
    mm.exec("ALTER TABLE shop_stores ADD COLUMN chat_id TEXT");
  }

  mm.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_shop_stores_chat_id_unique
    ON shop_stores(chat_id)
    WHERE chat_id IS NOT NULL AND chat_id <> ''
  `);

  const cols = mm.prepare("PRAGMA table_info(shop_catalog)").all().map(x => x.name);
  if (!cols.includes("store_id")) {
    mm.exec("ALTER TABLE shop_catalog ADD COLUMN store_id INTEGER");
  }
  const stockCols = mm.prepare("PRAGMA table_info(shop_catalog)").all().map(x => x.name);
  if (!stockCols.includes("stock")) {
    mm.exec("ALTER TABLE shop_catalog ADD COLUMN stock INTEGER NOT NULL DEFAULT -1");
  }

  const seedStores = [
    ["بازار اصلی", "خواربارفروشی", "مواد غذایی", "خوراکی‌ها و اقلام روزمره"],
    ["بازار اصلی", "پوشاک", "پوشاک", "لباس و لوازم پوشیدنی"],
    ["بازار اصلی", "داروخانه", "سلامت", "دارو و اقلام درمانی بازی"],
    ["بازار اصلی", "ابزارفروشی", "ابزار", "ابزار و لوازم کاربردی"],
    ["بازار سیاه", "تجهیزات زیرزمینی", "تجهیزات", "تجهیزات ویژه دنیای نقش‌آفرینی"],
    ["بازار سیاه", "کالاهای کمیاب", "کالاهای کمیاب", "اقلام نادر دنیای نقش‌آفرینی"]
  ];

  const mmAddStore = mm.prepare(`
    INSERT OR IGNORE INTO shop_stores
      (market, name, category, description, active, created_at)
    VALUES (?, ?, ?, ?, 1, ?)
  `);

  mm.transaction(() => {
    for (const x of seedStores) mmAddStore.run(...x, mmNow());

    const map = {
      water: "خواربارفروشی",
      food_basic: "خواربارفروشی",
      food_full: "خواربارفروشی",
      medicine: "داروخانه",
      clothes: "پوشاک",
      flashlight: "ابزارفروشی",
      tools: "ابزارفروشی",
      bag: "پوشاک"
    };

    const findStore = mm.prepare(
      "SELECT store_id FROM shop_stores WHERE market=? AND name=?"
    );
    const assign = mm.prepare(
      "UPDATE shop_catalog SET store_id=? WHERE item_code=? AND store_id IS NULL"
    );

    for (const [code, name] of Object.entries(map)) {
      const st = findStore.get("بازار اصلی", name);
      if (st) assign.run(st.store_id, code);
    }

    const fallback = findStore.get("بازار اصلی", "خواربارفروشی");
    if (fallback) {
      mm.prepare("UPDATE shop_catalog SET store_id=? WHERE store_id IS NULL")
        .run(fallback.store_id);
    }
  })();

  const mmFindStore = (market, name) => mm.prepare(`
    SELECT * FROM shop_stores
    WHERE market=? AND name=? AND active=1
  `).get(market, name);

  const mmFindItem = (market, store, name) => mm.prepare(`
    SELECT c.*, s.market, s.name AS store_name,
           s.active AS store_active, s.chat_id AS store_chat_id
    FROM shop_catalog c
    JOIN shop_stores s ON s.store_id=c.store_id
    WHERE s.market=? AND s.name=? AND c.name=?
  `).get(market, store, name);

  const mmManage = ctx => {
    try {
      const u = getUser(ctx.from.id);
      return Boolean(
        u && (u.role === "owner" || u.role === "moderator")
      ) || String(process.env.OWNER_ID || "") === String(ctx.from.id);
    } catch {
      return String(process.env.OWNER_ID || "") === String(ctx.from.id);
    }
  };


  const mmStorePurchaseError = (ctx, item) => {
    const storeName = mmText(item?.store_name || "فروشگاه");
    const chatId = String(item?.store_chat_id ?? "");

    if (!chatId) {
      return `⛔ گروه رول فروشگاه «${storeName}» هنوز تنظیم نشده است.`;
    }

    if (
      !["group", "supergroup"].includes(ctx.chat?.type) ||
      String(ctx.chat?.id) !== chatId
    ) {
      return `⛔ خرید از فروشگاه «${storeName}» فقط در گروه رول اختصاصی آن مجاز است.`;
    }

    return null;
  };

  bot.hears(
    /^تنظیم گپ فروشگاه\s*\|\s*(بازار اصلی|بازار سیاه)\s*\|\s*(.+)$/u,
    async ctx => {
      if (!mmManage(ctx)) {
        return ctx.reply("⛔ فقط مالک یا مدیر اجازه تنظیم گروه فروشگاه را دارد.");
      }

      if (!["group", "supergroup"].includes(ctx.chat?.type)) {
        return ctx.reply(
          "این دستور را داخل همان گروه رول که می‌خواهی به فروشگاه وصل شود بفرست."
        );
      }

      const market = ctx.match[1];
      const storeName = mmText(ctx.match[2]);
      const store = mmFindStore(market, storeName);

      if (!store) {
        return ctx.reply("فروشگاه فعال با این نام پیدا نشد.");
      }

      const other = mm.prepare(`
        SELECT market, name FROM shop_stores
        WHERE chat_id = ? AND store_id <> ?
        LIMIT 1
      `).get(String(ctx.chat.id), store.store_id);

      if (other) {
        return ctx.reply(
          `⛔ این گروه قبلاً به فروشگاه «${other.name}» از ${other.market} وصل شده است.`
        );
      }

      try {
        mm.prepare(
          "UPDATE shop_stores SET chat_id=? WHERE store_id=?"
        ).run(String(ctx.chat.id), store.store_id);

        return ctx.reply(
          `✅ گروه رول با موفقیت به فروشگاه «${storeName}» وصل شد.\n` +
          `شناسه گروه: ${ctx.chat.id}\n` +
          "از این پس خرید این فروشگاه فقط در همین گروه مجاز است."
        );
      } catch (e) {
        console.error("Store chat binding error:", e);
        return ctx.reply("❌ اتصال گروه به فروشگاه انجام نشد.");
      }
    }
  );

  bot.hears(
    /^حذف اتصال گپ فروشگاه\s*\|\s*(بازار اصلی|بازار سیاه)\s*\|\s*(.+)$/u,
    async ctx => {
      if (!mmManage(ctx)) {
        return ctx.reply("⛔ فقط مالک یا مدیر اجازه این کار را دارد.");
      }

      const store = mmFindStore(ctx.match[1], mmText(ctx.match[2]));
      if (!store) return ctx.reply("فروشگاه فعال پیدا نشد.");
      if (!store.chat_id) {
        return ctx.reply("برای این فروشگاه هنوز گروهی تنظیم نشده است.");
      }

      mm.prepare(
        "UPDATE shop_stores SET chat_id=NULL WHERE store_id=?"
      ).run(store.store_id);

      return ctx.reply(
        `✅ اتصال گروه از فروشگاه «${store.name}» برداشته شد.\n` +
        "تا تنظیم گروه جدید، خرید این فروشگاه غیرفعال خواهد بود."
      );
    }
  );

  bot.hears(/^وضعیت گپ فروشگاه‌ها$/u, async ctx => {
    if (!mmManage(ctx)) {
      return ctx.reply("⛔ فقط مالک یا مدیر اجازه مشاهده این فهرست را دارد.");
    }

    const rows = mm.prepare(`
      SELECT market, name, chat_id
      FROM shop_stores
      WHERE active=1
      ORDER BY market, name
    `).all();

    return ctx.reply(
      "༺ وضعیت گروه‌های فروشگاه‌ها ༻\n\n" +
      (rows.length
        ? rows.map(x =>
            `🏪 ${x.name} — ${x.market}\n` +
            `گروه: ${x.chat_id || "تنظیم نشده"}`
          ).join("\n\n")
        : "فروشگاه فعالی ثبت نشده است.")
    );
  });

  // MONTADORIA HIDDEN MARKETS V1

  const hmCols = mm.prepare("PRAGMA table_info(shop_stores)").all().map(x => x.name);
  for (const [col, definition] of [
    ["hidden", "INTEGER NOT NULL DEFAULT 0"],
    ["required_job", "TEXT NOT NULL DEFAULT ''"],
    ["required_license", "TEXT NOT NULL DEFAULT ''"]
  ]) {
    if (!hmCols.includes(col)) {
      mm.exec(`ALTER TABLE shop_stores ADD COLUMN ${col} ${definition}`);
    }
  }

  const hmText = x => String(x ?? "").trim();

  const hmCanEnter = (ctx, store) => {
    if (!store || !store.active) return false;
    if (!Number(store.hidden)) return true;
    if (mmManage(ctx)) return true;

    const job = hmText(store.required_job);
    const license = hmText(store.required_license);

    // فروشگاه مخفیِ بدون دسترسی تعریف‌شده، برای بازیکنان بسته است.
    if (!job && !license) return false;

    const user = getUser(ctx.from.id);
    if (!user) return false;

    if (job && hmText(user.job) !== job) return false;

    if (license) {
      try {
        const granted = mm.prepare(`
          SELECT 1 FROM black_market_user_licenses
          WHERE telegram_id=? AND license_code=? AND active=1
        `).get(String(ctx.from.id), license);

        const type = mm.prepare(`
          SELECT 1 FROM black_market_license_types
          WHERE code=? AND active=1
        `).get(license);

        if (!granted || !type) return false;
      } catch {
        return false;
      }
    }

    return true;
  };


  // MONTADORIA_STORE_GROUP_LINKS_V1
  {
    const storeCols = mm.prepare("PRAGMA table_info(shop_stores)")
      .all().map(x => x.name);

    if (!storeCols.includes("chat_title")) {
      mm.exec("ALTER TABLE shop_stores ADD COLUMN chat_title TEXT");
    }
    if (!storeCols.includes("chat_link")) {
      mm.exec("ALTER TABLE shop_stores ADD COLUMN chat_link TEXT");
    }
  }

  function mmStoreLinkEscape(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[ch]);
  }

  bot.hears(/^(?:لینک گروه فروشگاه‌ها|نمایش گروه‌های فروشگاه‌ها)$/i, async (ctx) => {
    if (!mmManage(ctx)) {
      return ctx.reply("⛔ این دستور مخصوص مدیران مجاز است.");
    }

    const stores = mm.prepare(`
      SELECT store_id, market, name, chat_id, chat_link
      FROM shop_stores
      ORDER BY market, name
    `).all();

    if (!stores.length) {
      return ctx.reply("هنوز فروشگاهی ثبت نشده است.");
    }

    const lines = ["⟡ لینک و گروه اختصاصی فروشگاه‌ها ⟡"];

    for (const store of stores) {
      const marketName = store.market === "black"
        ? "بازار سیاه"
        : "بازار اصلی";

      if (!store.chat_id) {
        lines.push(
          `\n🏪 ${mmStoreLinkEscape(store.name)} (${marketName})\n` +
          "⛔ گروه اختصاصی تنظیم نشده است."
        );
        continue;
      }

      try {
        const chat = await ctx.api.getChat(String(store.chat_id));
        const title = chat.title || store.chat_title || "گروه رول";
        let link = "";

        if (chat.username) {
          link = `https://t.me/${chat.username}`;
        } else if (store.chat_link) {
          link = store.chat_link;
        } else {
          try {
            const invite = await ctx.api.createChatInviteLink(
              String(store.chat_id),
              { name: `Montadoria - ${store.name}` }
            );
            link = invite.invite_link;
          } catch (_) {
            link = "";
          }
        }

        mm.prepare(`
          UPDATE shop_stores
          SET chat_title = ?, chat_link = ?
          WHERE store_id = ?
        `).run(title, link || null, store.store_id);

        const safeTitle = mmStoreLinkEscape(title);
        const titleText = link
          ? `<a href="${mmStoreLinkEscape(link)}">${safeTitle}</a>`
          : safeTitle;

        lines.push(
          `\n🏪 ${mmStoreLinkEscape(store.name)} (${marketName})\n` +
          `👥 گروه: ${titleText}\n` +
          `🆔 شناسه: <code>${mmStoreLinkEscape(store.chat_id)}</code>` +
          (link ? "" : "\n⚠️ لینک در دسترس نیست؛ دسترسی دعوت ربات را بررسی کن.")
        );
      } catch (err) {
        const reason = String(
          err?.description || err?.message || "خطای نامشخص"
        ).slice(0, 250);

        lines.push(
          `\n🏪 ${mmStoreLinkEscape(store.name)} (${marketName})\n` +
          `🆔 شناسه: <code>${mmStoreLinkEscape(store.chat_id)}</code>\n` +
          `⚠️ خطای تلگرام: ${mmStoreLinkEscape(reason)}`
        );
      }
    }

    return ctx.reply(lines.join("\n"), {
      parse_mode: "HTML",
      disable_web_page_preview: true
    });
  });
  // END MONTADORIA_STORE_GROUP_LINKS_V1


  // ساخت فروشگاه مخفی در بازار سیاه
  bot.hears(/^افزودن فروشگاه مخفی\s*\|\s*بازار سیاه\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*(.+)$/u, async ctx => {
    if (!mmManage(ctx)) return ctx.reply("⛔ فقط مالک یا مدیر اجازه این کار را دارد.");

    const name = hmText(ctx.match[1]);
    const category = hmText(ctx.match[2]);
    const description = hmText(ctx.match[3]);

    if (mm.prepare("SELECT 1 FROM shop_stores WHERE market=? AND name=?")
      .get("بازار سیاه", name)) {
      return ctx.reply("فروشگاهی با این نام از قبل وجود دارد.");
    }

    try {
      mmAddStore.run("بازار سیاه", name, category, description, mmNow());
      mm.prepare(`
        UPDATE shop_stores SET hidden=1, required_job='', required_license=''
        WHERE market=? AND name=?
      `).run("بازار سیاه", name);

      return ctx.reply(
        `✅ فروشگاه مخفی «${name}» ساخته شد.\n` +
        "در حال حاضر برای بازیکنان بسته است.\n" +
        "برای تعیین دسترسی از دستور «تنظیم دسترسی فروشگاه» استفاده کن."
      );
    } catch {
      return ctx.reply("ساخت فروشگاه ناموفق بود.");
    }
  });

  // تعیین شغل و مجوز موردنیاز؛ برای هرکدام «-» یعنی بدون این شرط
  bot.hears(/^تنظیم دسترسی فروشگاه\s*\|\s*بازار سیاه\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*(.+)$/u, async ctx => {
    if (!mmManage(ctx)) return ctx.reply("⛔ فقط مالک یا مدیر اجازه این کار را دارد.");

    const name = hmText(ctx.match[1]);
    const rawJob = hmText(ctx.match[2]);
    const rawLicense = hmText(ctx.match[3]);
    const job = rawJob === "-" ? "" : rawJob;
    const license = rawLicense === "-" ? "" : rawLicense;

    if (!job && !license) {
      return ctx.reply("باید حداقل یک شرط دسترسی، یعنی شغل یا مجوز، تعیین کنی.");
    }

    const store = mmFindStore("بازار سیاه", name);
    if (!store || !Number(store.hidden)) {
      return ctx.reply("فروشگاه مخفی فعالی با این نام پیدا نشد.");
    }

    if (license) {
      let type;
      try {
        type = mm.prepare(`
          SELECT 1 FROM black_market_license_types
          WHERE code=? AND active=1
        `).get(license);
      } catch {
        return ctx.reply("جدول مجوزها در دسترس نیست.");
      }
      if (!type) return ctx.reply("کد مجوز فعال پیدا نشد؛ ابتدا مجوز را تعریف کن.");
    }

    mm.prepare(`
      UPDATE shop_stores
      SET required_job=?, required_license=?
      WHERE store_id=?
    `).run(job, license, store.store_id);

    return ctx.reply(
      `✅ دسترسی فروشگاه «${name}» تنظیم شد.\n` +
      `شغل لازم: ${job || "بدون محدودیت شغلی"}\n` +
      `مجوز لازم: ${license || "بدون مجوز اختصاصی"}`
    );
  });

  // هر بازیکن فقط فروشگاه‌هایی را می‌بیند که اجازه ورود به آن‌ها را دارد.
  bot.hears(/^فروشگاه‌های مخفی$/u, async ctx => {
    const stores = mm.prepare(`
      SELECT * FROM shop_stores
      WHERE market='بازار سیاه' AND active=1 AND hidden=1
      ORDER BY name
    `).all().filter(store => hmCanEnter(ctx, store));

    if (!stores.length) {
      return ctx.reply("هیچ فروشگاه مخفیِ قابل‌دسترسی برای شخصیت شما وجود ندارد.");
    }

    return ctx.reply(
      "🔒 فروشگاه‌های مخفیِ قابل‌دسترسی\n\n" +
      stores.map(store =>
        `• ${store.name}\n${store.category}\n${store.description || ""}\n` +
        `کالاها: کالاهای بازار سیاه | ${store.name}`
      ).join("\n\n")
    );
  });

  // جلوگیری از مشاهده کالاهای فروشگاه مخفی بدون دسترسی
  bot.hears(/^کالاهای\s+بازار سیاه\s*\|\s*(.+)$/u, async (ctx, next) => {
    const name = hmText(ctx.match[1]);
    const store = mmFindStore("بازار سیاه", name);
    if (!store) return next();

    if (!hmCanEnter(ctx, store)) {
      return ctx.reply("🔒 اجازه دسترسی به این فروشگاه را نداری.");
    }
    return next();
  });

  // بررسی دسترسی هنگام خرید
  bot.hears(/^خرید\s*\|\s*بازار سیاه\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*(.+)$/u, async (ctx, next) => {
    const storeName = hmText(ctx.match[1]);
    const store = mmFindStore("بازار سیاه", storeName);
    if (!store) return next();

    if (!hmCanEnter(ctx, store)) {
      return ctx.reply("🔒 برای خرید از این فروشگاه مجوز دسترسی نداری.");
    }
    return next();
  });

  // بررسی دسترسی هنگام فروش کالا
  bot.hears(/^فروش\s*\|\s*بازار سیاه\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*(.+)$/u, async (ctx, next) => {
    const store = mmFindStore("بازار سیاه", hmText(ctx.match[1]));
    if (!store) return next();

    if (!hmCanEnter(ctx, store)) {
      return ctx.reply("🔒 برای معامله در این فروشگاه دسترسی نداری.");
    }
    return next();
  });

  // END MONTADORIA HIDDEN MARKETS V1

  const mmStores = market => mm.prepare(`
    SELECT * FROM shop_stores
    WHERE market=? AND active=1 AND hidden=0 ORDER BY name
  `).all(market);

  bot.hears(/^بازارها$/u, async ctx => {
    return ctx.reply(
      "🏛 بازارهای مونتادوریا\n\n" +
      ["بازار اصلی", "بازار سیاه"].map(m =>
        `${m}: ${mmStores(m).length} فروشگاه فعال`
      ).join("\n") +
      "\n\nفروشگاه‌های بازار اصلی\nفروشگاه‌های بازار سیاه"
    );
  });

  for (const market of ["بازار اصلی", "بازار سیاه"]) {
    bot.hears(new RegExp("^فروشگاه‌های " + market + "$"), async ctx => {
      const stores = mmStores(market);
      if (!stores.length) return ctx.reply("فروشگاه فعالی وجود ندارد.");
      return ctx.reply(
        `🏪 ${market}\n\n` +
        stores.map(x =>
          `• ${x.name}\n${x.category} — ${x.description}`
        ).join("\n\n") +
        `\n\nکالاهای ${market} | نام فروشگاه`
      );
    });
  }

  bot.hears(/^کالاهای\s+(بازار اصلی|بازار سیاه)\s*\|\s*(.+)$/u, async ctx => {
    const market = ctx.match[1], storeName = mmText(ctx.match[2]);
    if (!mmFindStore(market, storeName)) return ctx.reply("فروشگاه پیدا نشد.");

    const rows = mm.prepare(`
      SELECT c.* FROM shop_catalog c
      JOIN shop_stores s ON s.store_id=c.store_id
      WHERE s.market=? AND s.name=? AND s.active=1 AND c.active=1
      ORDER BY c.name
    `).all(market, storeName);

    if (!rows.length) return ctx.reply("در این فروشگاه کالای فعالی وجود ندارد.");

    return ctx.reply(
      `🛒 ${market} | ${storeName}\n\n` +
      rows.map(x =>
        `• ${x.name}\nخرید: ${mmCash(x.buy_price)}\nفروش: ${mmCash(x.sell_price)}\n${x.description || ""}`
      ).join("\n\n") +
      `\n\nخرید | ${market} | ${storeName} | نام کالا | تعداد`
    );
  });

  bot.hears(/^افزودن فروشگاه\s*\|\s*(بازار اصلی|بازار سیاه)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*(.+)$/u, async ctx => {
    if (!mmManage(ctx)) return ctx.reply("⛔ فقط مالک یا مدیر اجازه این کار را دارد.");

    const [, market, rawName, rawCategory, rawDesc] = ctx.match;
    const name = mmText(rawName), category = mmText(rawCategory), desc = mmText(rawDesc);

    try {
      mmAddStore.run(market, name, category, desc, mmNow());
      return ctx.reply(`✅ فروشگاه «${name}» در ${market} ثبت شد.`);
    } catch {
      return ctx.reply("ثبت فروشگاه ناموفق بود؛ احتمالاً نام آن تکراری است.");
    }
  });

  bot.hears(/^حذف فروشگاه\s*\|\s*(بازار اصلی|بازار سیاه)\s*\|\s*(.+)$/u, async ctx => {
    if (!mmManage(ctx)) return ctx.reply("⛔ فقط مالک یا مدیر اجازه این کار را دارد.");

    const result = mm.prepare(`
      UPDATE shop_stores SET active=0, chat_id=NULL
      WHERE market=? AND name=? AND active=1
    `).run(ctx.match[1], mmText(ctx.match[2]));

    return ctx.reply(result.changes
      ? "✅ فروشگاه غیرفعال شد؛ اطلاعات قبلی حفظ شده‌اند."
      : "فروشگاه فعالی با این نام پیدا نشد.");
  });

  bot.hears(/^افزودن کالا\s*\|\s*(بازار اصلی|بازار سیاه)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*(.+)$/u, async ctx => {
    if (!mmManage(ctx)) return ctx.reply("⛔ فقط مالک یا مدیر اجازه این کار را دارد.");

    const [, market, rawStore, rawName, rawBuy, rawSell, rawDesc] = ctx.match;
    const storeName = mmText(rawStore), name = mmText(rawName);
    const buy = mmNum(rawBuy), sell = mmNum(rawSell), desc = mmText(rawDesc);

    if (!Number.isSafeInteger(buy) || buy <= 0 ||
        !Number.isSafeInteger(sell) || sell < 0 || sell > buy * 100) {
      return ctx.reply("قیمت‌ها معتبر نیستند.");
    }

    const store = mmFindStore(market, storeName);
    if (!store) return ctx.reply("فروشگاه فعال پیدا نشد.");

    const exists = mm.prepare(`
      SELECT 1 FROM shop_catalog WHERE store_id=? AND name=? AND active=1
    `).get(store.store_id, name);
    if (exists) return ctx.reply("این کالا از قبل در این فروشگاه ثبت شده است.");

    const code = "market_" + Date.now().toString(36) +
      "_" + Math.random().toString(36).slice(2, 7);

    try {
      mm.prepare(`
        INSERT INTO shop_catalog
          (item_code, name, buy_price, sell_price, description, active, created_at, store_id)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `).run(code, name, buy, sell, desc, mmNow(), store.store_id);

      return ctx.reply(`✅ کالای «${name}» به فروشگاه «${storeName}» اضافه شد.`);
    } catch {
      return ctx.reply("ثبت کالا ناموفق بود.");
    }
  });

  bot.hears(/^حذف کالا\s*\|\s*(بازار اصلی|بازار سیاه)\s*\|\s*([^|]+)\s*\|\s*(.+)$/u, async ctx => {
    if (!mmManage(ctx)) return ctx.reply("⛔ فقط مالک یا مدیر اجازه این کار را دارد.");

    const item = mmFindItem(ctx.match[1], mmText(ctx.match[2]), mmText(ctx.match[3]));
   

 if (!item) return ctx.reply("کالا پیدا نشد.");

    mm.prepare("UPDATE shop_catalog SET active=0 WHERE item_code=?").run(item.item_code);
    return ctx.reply("✅ کالا غیرفعال شد؛ موجودی کیف کاربران حذف نشد.");
  });


  // MONTADORIA SHOP STOCK V1
  bot.hears(/^تنظیم موجودی کالا\s*\|\s*(بازار اصلی|بازار سیاه)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*(-1|[\d۰-۹٠-٩٬,]+)$/u, async ctx => {
    if (!mmManage(ctx)) return ctx.reply("⛔ فقط مالک یا مدیر اجازه این کار را دارد.");

    const market = ctx.match[1];
    const storeName = mmText(ctx.match[2]);
    const itemName = mmText(ctx.match[3]);
    const stock = mmNum(ctx.match[4]);

    if (!Number.isSafeInteger(stock) || stock < -1 || stock > 100000000) {
      return ctx.reply("مقدار موجودی معتبر نیست.");
    }

    const item = mmFindItem(market, storeName, itemName);
    if (!item || !item.store_active) return ctx.reply("کالا یا فروشگاه پیدا نشد.");

    mm.prepare("UPDATE shop_catalog SET stock=? WHERE item_code=?")
      .run(stock, item.item_code);

    return ctx.reply(
      `✅ موجودی «${itemName}» تنظیم شد.\n` +
      `موجودی: ${stock === -1 ? "نامحدود" : mmCash(stock)}`
    );
  });

  bot.hears(/^موجودی فروشگاه\s*\|\s*(بازار اصلی|بازار سیاه)\s*\|\s*(.+)$/u, async ctx => {
    const market = ctx.match[1];
    const storeName = mmText(ctx.match[2]);
    const store = mmFindStore(market, storeName);

    if (!store) return ctx.reply("فروشگاه فعال پیدا نشد.");

    const rows = mm.prepare(`
      SELECT name, stock FROM shop_catalog
      WHERE store_id=? AND active=1 ORDER BY name
    `).all(store.store_id);

    if (!rows.length) return ctx.reply("این فروشگاه کالای فعالی ندارد.");

    return ctx.reply(
      `📦 موجودی انبار: ${storeName}\n\n` +
      rows.map(x =>
        `• ${x.name}\nموجودی: ${Number(x.stock) === -1 ? "نامحدود" : mmCash(x.stock)}`
      ).join("\n\n")
    );
  });
  // END MONTADORIA SHOP STOCK V1

  bot.hears(/^خرید\s*\|\s*(بازار اصلی|بازار سیاه)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*(.+)$/u, async ctx => {
    const [, market, rawStore, rawName, rawQty] = ctx.match;
    const storeName = mmText(rawStore), name = mmText(rawName), qty = mmNum(rawQty);

    if (!Number.isSafeInteger(qty) || qty < 1 || qty > 10000) {
      return ctx.reply("تعداد کالا معتبر نیست.");
    }

    const item = mmFindItem(market, storeName, name);
    if (!item || !item.active || !item.store_active) {
      return ctx.reply("کالای فعالی پیدا نشد.");
    }

    const purchaseChatError = mmStorePurchaseError(ctx, item);
    if (purchaseChatError) return ctx.reply(purchaseChatError);

    const user = getUser(ctx.from.id);
    if (!user) return ctx.reply("حساب شخصیت پیدا نشد؛ ابتدا ثبت‌نام کن.");

    const stock = Number(item.stock ?? -1);
    if (stock !== -1 && stock < qty) {
      return ctx.reply(`موجودی کافی نیست. موجودی فعلی: ${Math.max(0, stock)}`);
    }

    const cost = Number(item.buy_price) * qty;
    if (!user.infinite_money && Number(user.money || 0) < cost) {
      return ctx.reply(`پول نقد کافی نیست. هزینه خرید: ${mmCash(cost)}`);
    }

    try {
      mm.transaction(() => {
        const stockUpdate = mm.prepare(`
          UPDATE shop_catalog
          SET stock=CASE WHEN stock=-1 THEN -1 ELSE stock-? END
          WHERE item_code=? AND active=1 AND (stock=-1 OR stock>=?)
        `).run(qty, item.item_code, qty);

        if (!stockUpdate.changes) throw new Error("INSUFFICIENT_STOCK");


        if (!user.infinite_money) {
          const r = mm.prepare(`
            UPDATE users SET money=money-?
            WHERE telegram_id=? AND money>=?
          `).run(cost, String(ctx.from.id), cost);
          if (!r.changes) throw new Error("INSUFFICIENT_MONEY");
        }

        mm.prepare(`
          INSERT INTO player_inventory (telegram_id, item_code, quantity)
          VALUES (?, ?, ?)
          ON CONFLICT(telegram_id, item_code)
          DO UPDATE SET quantity=quantity+excluded.quantity
        `).run(String(ctx.from.id), item.item_code, qty);
      })();

      return ctx.reply(
        `✅ خرید انجام شد\nکالا: ${item.name}\nتعداد: ${qty}\nهزینه: ${mmCash(cost)}`
      );
    } catch {
      return ctx.reply("خرید انجام نشد؛ ممکن است ساختار حساب کاربری متفاوت باشد.");
    }
  });

  bot.hears(/^فروش\s*\|\s*(بازار اصلی|بازار سیاه)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*(.+)$/u, async ctx => {
    const [, market, rawStore, rawName, rawQty] = ctx.match;
    const storeName = mmText(rawStore), name = mmText(rawName), qty = mmNum(rawQty);

    if (!Number.isSafeInteger(qty) || qty < 1 || qty > 10000) {
      return ctx.reply("تعداد کالا معتبر نیست.");
    }

    const item = mmFindItem(market, storeName, name);
    if (!item) return ctx.reply("کالا در این فروشگاه پیدا نشد.");

    const id = String(ctx.from.id);
    const inv = mm.prepare(`
      SELECT quantity FROM player_inventory WHERE telegram_id=? AND item_code=?
    `).get(id, item.item_code);

    if (!inv || Number(inv.quantity) < qty) {
      return ctx.reply("موجودی این کالا در کیفت کافی نیست.");
    }

    const income = Number(item.sell_price) * qty;

    try {
      mm.transaction(() => {
        const r = mm.prepare(`
          UPDATE player_inventory SET quantity=quantity-?
          WHERE telegram_id=? AND item_code=? AND quantity>=?
        `).run(qty, id, item.item_code, qty);

        if (!r.changes) throw new Error("INSUFFICIENT_ITEMS");

        mm.prepare(`
          DELETE FROM player_inventory
          WHERE telegram_id=? AND item_code=? AND quantity<=0
        `).run(id, item.item_code);

        mm.prepare("UPDATE users SET money=money+? WHERE telegram_id=?")
          .run(income, id);
      })();

      return ctx.reply(
        `✅ فروش انجام شد\nکالا: ${item.name}\nتعداد: ${qty}\nدریافتی: ${mmCash(income)}`
      );
    } catch {
      return ctx.reply("فروش انجام نشد؛ ساختار حساب یا کیف را بررسی کن.");
    }
  });
}
// END MONTADORIA MULTI-MARKET V3


  bot.hears(/^فروشگاه$/u, async ctx => {
    const items = db.prepare(
      "SELECT name, buy_price, sell_price, description FROM shop_catalog WHERE active = 1 ORDER BY name"
    ).all();

    if (!items.length) {
      return ctx.reply("🛒 در حال حاضر کالایی در فروشگاه وجود ندارد.");
    }

    const list = items.map((item, i) =>
      `${i + 1}. ${item.name}\n` +
      `   💰 قیمت خرید: ${item.buy_price.toLocaleString("en-US")}\n` +
      `   💵 قیمت فروش: ${item.sell_price.toLocaleString("en-US")}` +
      (item.description ? `\n   📝 ${item.description}` : "")
    );

    return ctx.reply(
      `༺ فروشگاه مونتادوریا ༻\n\n${list.join("\n\n")}\n\n` +
      `برای خرید: خرید نام کالا تعداد\n` +
      `برای فروش: فروش نام کالا تعداد\n` +
      `برای مشاهده وسایل: کیف`
    );
  });

  // راهنمای مدیریت
  bot.hears(/^مدیریت فروشگاه$/u, async ctx => {
    if (!shopCanManage(ctx)) {
      return ctx.reply("⛔ فقط مالک و ناظران اجازه مدیریت فروشگاه را دارند.");
    }

    return ctx.reply(
      `༺ مدیریت فروشگاه مونتادوریا ༻\n\n` +
      `➕ افزودن کالا:\n` +
      `افزودن کالا | نام کالا | قیمت خرید | قیمت فروش | توضیحات\n\n` +
      `مثال:\n` +
      `افزودن کالا | شمشیر آهنی | ۱۰۰۰ | ۵۰۰ | شمشیر معمولی\n\n` +
      `➖ حذف کالا از فهرست:\n` +
      `حذف کالا | نام کالا\n\n` +
      `📋 مشاهده فهرست کالاها:\n` +
      `فروشگاه\n\n` +
      `حذف کالا، وسایل قبلی کاربران را از کیفشان حذف نمی‌کند.`
    );
  });

  // افزودن کالا
  bot.hears(/^افزودن کالا\s*\|\s*([^|]+?)\s*\|\s*([\d۰-۹٠-٩٬,]+)\s*\|\s*([\d۰-۹٠-٩٬,]+)(?:\s*\|\s*(.*))?$/u, async ctx => {
    if (!shopCanManage(ctx)) {
      return ctx.reply("⛔ فقط مالک و ناظران اجازه افزودن کالا دارند.");
    }

    const name = ctx.match[1].trim();
    const buyPrice = shopAmount(ctx.match[2]);
    const sellPrice = shopAmount(ctx.match[3]);
    const description = String(ctx.match[4] || "").trim();

    if (
      !name ||
      name.length > 80 ||
      buyPrice === null ||
      buyPrice < 1 ||
      sellPrice === null ||
      sellPrice > buyPrice * 100
    ) {
      return ctx.reply(
        "❌ اطلاعات کالا معتبر نیست.\n\n" +
        "نمونه:\nافزودن کالا | شمشیر آهنی | ۱۰۰۰ | ۵۰۰ | شمشیر معمولی"
      );
    }

    if (shopFind(name, true)) {
      return ctx.reply("❌ کالایی با این نام از قبل ثبت شده است.");
    }

    const code = "custom_" + Date.now() + "_" +
      Math.random().toString(36).slice(2, 8);

    try {
      db.prepare(`
        INSERT INTO shop_catalog
          (item_code, name, buy_price, sell_price, description, active, created_at)
        VALUES (?, ?, ?, ?, ?, 1, ?)
      `).run(code, name, buyPrice, sellPrice, description, Date.now());

      return ctx.reply(
        `✅ کالا به فروشگاه اضافه شد.\n\n` +
        `📦 نام: ${name}\n` +
        `💰 قیمت خرید: ${buyPrice.toLocaleString("en-US")}\n` +
        `💵 قیمت فروش: ${sellPrice.toLocaleString("en-US")}`
      );
    } catch (e) {
      console.error("Add shop item error:", e);
      return ctx.reply("❌ ثبت کالا انجام نشد.");
    }
  });

  // حذف کالا از فروشگاه؛ کیف کاربران حفظ می‌شود.
  bot.hears(/^حذف کالا\s*\|\s*(.+)$/u, async ctx => {
    if (!shopCanManage(ctx)) {
      return ctx.reply("⛔ فقط مالک و ناظران اجازه حذف کالا دارند.");
    }

    const name = ctx.match[1].trim();
    const item = shopFind(name, false);

    if (!item) {
      return ctx.reply("❌ این کالا در فهرست فعال فروشگاه پیدا نشد.");
    }

    db.prepare("UPDATE shop_catalog SET active = 0 WHERE item_code = ?")
      .run(item.item_code);

    return ctx.reply(
      `✅ کالا از فهرست فروشگاه خارج شد.\n\n` +
      `📦 کالا: ${item.name}\n` +
      `ℹ️ وسایل قبلی کاربران از کیفشان حذف نمی‌شود.`
    );
  });

  // مشاهده کیف
  bot.hears(/^(?:کیف|وسایلم|انبار)$/u, async ctx => {
    const rows = db.prepare(`
      SELECT i.item_code, i.quantity, c.name, c.active
      FROM player_inventory i
      LEFT JOIN shop_catalog c ON c.item_code = i.item_code
      WHERE i.telegram_id = ? AND i.quantity > 0
      ORDER BY c.name
    `).all(String(ctx.from.id));

    if (!rows.length) return ctx.reply("🎒 کیف تو خالی است.");

    return ctx.reply(
      "🎒 وسایل موجود در کیف:\n\n" +
      rows.map(row =>
        `• ${row.name || row.item_code}: ${row.quantity} عدد` +
        (row.active === 0 ? " (خارج‌شده از فروشگاه)" : "")
      ).join("\n")
    );
  });

  // خرید
  bot.hears(/^خرید\s+(.+?)\s+([\d۰-۹٠-٩٬,]+)$/u, async ctx => {
    const name = ctx.match[1].trim();
    const quantity = shopAmount(ctx.match[2]);
    const item = shopFind(name);

    if (!item) {
      return ctx.reply("❌ این کالا در فروشگاه نیست. برای دیدن کالاها بنویس: فروشگاه");
    }

    const store = item.store_id
      ? db.prepare(`
          SELECT store_id, name, market, chat_id, active
          FROM shop_stores
          WHERE store_id=?
        `).get(item.store_id)
      : null;

    if (!store || !store.active) {
      return ctx.reply(
        "⛔ این کالا به فروشگاه فعالی متصل نیست؛ خرید مستقیم آن غیرفعال است."
      );
    }

    if (store.market === "بازار سیاه") {
      return ctx.reply(
        "برای خرید از بازار سیاه از قالب کامل خرید فروشگاه استفاده کن:\n" +
        "خرید | بازار سیاه | نام فروشگاه | نام کالا | تعداد"
      );
    }

    if (!store.chat_id) {
      return ctx.reply(
        `⛔ گروه رول فروشگاه «${store.name}» هنوز تنظیم نشده است.`
      );
    }

    if (
      !["group", "supergroup"].includes(ctx.chat?.type) ||
      String(ctx.chat?.id) !== String(store.chat_id)
    ) {
      return ctx.reply(
        `⛔ خرید از فروشگاه «${store.name}» فقط در گروه رول اختصاصی آن مجاز است.`
      );
    }

    if (!quantity || quantity < 1 || quantity > 100000) {
      return ctx.reply("❌ تعداد معتبر نیست.");
    }

    const total = item.buy_price * quantity;
    if (!Number.isSafeInteger(total)) {
      return ctx.reply("❌ مبلغ بیش از حد مجاز است.");
    }

    try {
      const user = getUser(ctx.from.id);
      if (!user) return ctx.reply("❌ حساب کاربری پیدا نشد.");

      db.transaction(() => {
        if (!user.infinite_money) {
          const result = db.prepare(
            "UPDATE users SET money = money - ? WHERE telegram_id = ? AND money >= ?"
          ).run(total, ctx.from.id, total);

          if (result.changes !== 1) throw new Error("INSUFFICIENT_FUNDS");
        }

        db.prepare(`
          INSERT INTO player_inventory (telegram_id, item_code, quantity)
          VALUES (?, ?, ?)
          ON CONFLICT(telegram_id, item_code)
          DO UPDATE SET quantity = quantity + excluded.quantity
        `).run(String(ctx.from.id), item.item_code, quantity);
      })();

      return ctx.reply(
        `✅ خرید انجام شد.\n\n` +
        `📦 کالا: ${item.name}\n` +
        `🔢 تعداد: ${quantity}\n` +
        `💰 هزینه: ${total.toLocaleString("en-US")}`
      );
    } catch (e) {
      console.error("Shop purchase error:", e);
      return ctx.reply(
        String(e.message).includes("INSUFFICIENT_FUNDS")
          ? "❌ پول نقد کافی نداری."
          : "❌ خرید انجام نشد."
      );
    }
  });

  // فروش کالاهای موجود در کیف
  bot.hears(/^فروش\s+(.+?)\s+([\d۰-۹٠-٩٬,]+)$/u, async ctx => {
    const name = ctx.match[1].trim();
    const quantity = shopAmount(ctx.match[2]);
    const item = shopFind(name, true);

    if (!item) return ctx.reply("❌ اطلاعات این کالا پیدا نشد.");

    if (!quantity || quantity < 1 || quantity > 100000) {
      return ctx.reply("❌ تعداد معتبر نیست.");
    }

    const payout = item.sell_price * quantity;
    if (!Number.isSafeInteger(payout)) {
      return ctx.reply("❌ مبلغ بیش از حد مجاز است.");
    }

    try {
      db.transaction(() => {
        const row = db.prepare(
          "SELECT quantity FROM player_inventory WHERE telegram_id = ? AND item_code = ?"
        ).get(String(ctx.from.id), item.item_code);

        if (!row || row.quantity < quantity) {
          throw new Error("NOT_ENOUGH_ITEMS");
        }

        db.prepare(
          "UPDATE player_inventory SET quantity = quantity - ? WHERE telegram_id = ? AND item_code = ?"
        ).run(quantity, String(ctx.from.id), item.item_code);

        db.prepare(
          "UPDATE users SET money = COALESCE(money, 0) + ? WHERE telegram_id = ?"
        ).run(payout, ctx.from.id);
      })();

      return ctx.reply(
        `✅ فروش انجام شد.\n\n` +
        `📦 کالا: ${item.name}\n` +
        `🔢 تعداد: ${quantity}\n` +
        `💵 دریافتی: ${payout.toLocaleString("en-US")}`
      );
    } catch (e) {
      console.error("Shop sale error:", e);
      return ctx.reply(
        String(e.message).includes("NOT_ENOUGH_ITEMS")
          ? "❌ این تعداد از کالا را در کیف نداری."
          : "❌ فروش انجام نشد."
      );
    }
  });
}
// END MONTADORIA_SHOP_V2



// MONTADORIA GUIDE PANEL
  // =========================

  const guidePages = {
    home: `༺⟡ 𝐌𝐎𝐍𝐓𝐀𝐃𝐎𝐑𝐈𝐀 ⟡༻

          دفترچه راهنمای قلمرو

به مونتادوریا خوش آمدی؛
جایی که هر انتخاب، بخشی از داستان توست.

از دکمه‌های زیر برای آشنایی با امکانات
و قوانین این قلمرو استفاده کن.`,

    basics: `༺ راهنمای آغازین ༻

/start — شروع کار با ربات
/help — بازکردن دفترچه راهنما
/ping — بررسی پاسخ‌گویی ربات
/id — نمایش شناسه تلگرام

می‌توانی این فرمان‌ها را در گفت‌وگوی
خصوصی یا گروهی که ربات در آن فعال است
استفاده کنی.`,

    profile: `༺ هویت و پروفایل ༻

/profile، رول، پروفایل — نمایش پروفایل ثبت‌شده

اطلاعاتی مانند نقش، شغل، سطح و وضعیت
مالی بر اساس داده‌های ثبت‌شده نمایش
داده می‌شوند.

داشتن پول یا خرید یک وسیله به‌تنهایی
به معنی مهارت یا قدرت بیشتر نیست.`,

    economy: `༺ خزانه و دارایی ༻

دارایی‌های ثبت‌شده در سیستم مالی ربات
نگهداری می‌شوند.

موجودی، بانک و انتقال پول باید مطابق
روش‌های مالی فعال در ربات انجام شوند.

اطلاعات مالی را صرفاً با نوشتن یک پیام
در نقش‌آفرینی تغییر‌یافته فرض نکن.`,

    rp: `༺ آداب نقش‌آفرینی ༻

در گروه‌های نقش‌آفرینی، قالب پیام‌ها
و تگ‌های مورد تأیید همان گروه را رعایت کن.

دیالوگ و کنش شخصیت را روشن بنویس تا
دیگران بتوانند واکنش مناسبی نشان دهند.

قواعد نقش‌آفرینی مخصوص گروه‌های ثبت‌شده
هستند و نباید به گفت‌وگوی آزاد تعمیم داده
شوند.`,

    staff: `༺ مدیریت و نظارت ༻

/​admin — بررسی وضعیت مدیریت
/rpadd — ثبت گروه فعلی به‌عنوان گروه RP
/rpremove — غیرفعال‌کردن ثبت گروه
/rpgroups — مشاهده گروه‌های ثبت‌شده\n/rpunmute شناسه — رفع سکوت کاربر (فقط مالک)

فرمان‌های مدیریتی فقط برای حساب‌های
دارای دسترسی لازم قابل استفاده‌اند.

راهنمای ناظر و مالک یکسان است.`
  };

  function guideKeyboard(user, page) {
    const rows = [];

    if (page === "home") {
      rows.push(
        [
          { text: "📜 راهنمای آغازین", callback_data: "guide:basics" },
          { text: "🪪 هویت و پروفایل", callback_data: "guide:profile" }
        ],
        [
          { text: "🏦 خزانه و دارایی", callback_data: "guide:economy" },
          { text: "🐺 نقش‌آفرینی", callback_data: "guide:rp" }
        ]
      );

      if (isModeratorOrOwner(user)) {
        rows.push([
          { text: "🛡 مدیریت و نظارت", callback_data: "guide:staff" }
        ]);
      }
    } else {
      rows.push([
        { text: "↩ بازگشت به دفترچه", callback_data: "guide:home" }
      ]);
    }

    return { inline_keyboard: rows };
  }

  async function renderGuide(ctx, page = "home", edit = false) {
    const user = getUser(ctx.from.id);

    if (!guidePages[page]) page = "home";

    if (page === "staff" && !isModeratorOrOwner(user)) {
      if (edit) {
        await ctx.answerCallbackQuery({
          text: "⛔ دسترسی به این بخش را نداری.",
          show_alert: true
        });
      } else {
        await ctx.reply("⛔ دسترسی به این بخش را نداری.");
      }
      return;
    }

    if (edit) {
      await ctx.editMessageText(guidePages[page], {
        reply_markup: guideKeyboard(user, page)
      });
    } else {
      await ctx.reply(guidePages[page], {
        reply_markup: guideKeyboard(user, page)
      });
    }
  }

  bot.command("help", async (ctx) => {
    await renderGuide(ctx);
  });

  bot.hears(/^(راهنما|دفترچه قلمرو|راهنمای مونتادوریا)$/i, async (ctx) => {
    await renderGuide(ctx);
  });

  bot.callbackQuery(
    /^guide:(home|basics|profile|economy|rp|staff)$/,
    async (ctx) => {
      const page = ctx.match[1];
      const user = getUser(ctx.from.id);

      if (page === "staff" && !isModeratorOrOwner(user)) {
        await ctx.answerCallbackQuery({
          text: "⛔ دسترسی به این بخش را نداری.",
          show_alert: true
        });
        return;
      }

      await ctx.answerCallbackQuery();
      await renderGuide(ctx, page, true);
    }
  );

  bot.command("ping", async (ctx) => {
    await ctx.reply("🏓 pong")
  })

  bot.command("id", async (ctx) => {
    await ctx.reply(
      `Chat ID: ${ctx.chat.id}\nUser ID: ${ctx.from?.id ?? "unknown"}`
    )
  })

  bot.command("admin", async (ctx) => {
    syncOwner(ctx.from.id)

    const user = getUser(ctx.from.id)

    if (!isModeratorOrOwner(user)) {
      await ctx.reply("⛔ دسترسی ندارید.")
      return
    }

    await ctx.reply(
      [
        "🛡️ دسترسی مدیریتی",
        "",
        `Role: ${ROLES[user.role] ?? user.role}`,
        "",
        "شما به بخش مدیریتی دسترسی دارید.",
      ].join("\n")
    )
  })

  bot.command("owner", async (ctx) => {
    syncOwner(ctx.from.id)

    const user = getUser(ctx.from.id)

    if (!isOwner(user)) {
      await ctx.reply("⛔ این بخش فقط برای مالک است.")
      return
    }

    await ctx.reply(
      [
        "👑 MONTADORIA OWNER PANEL",
        "",
        "مدیریت کاربران:",
        "/user ID",
        "/setrole ID ROLE",
        "/setjob ID JOB",
        "/setmoney ID AMOUNT",
        "/setinfmoney ID",
        "/removeinfmoney ID",
        "/setbank ID AMOUNT",
        "/setxp ID AMOUNT",
        "/setlevel ID LEVEL",
        "",
        "مدیریت مالکیت:",
        "/transferowner ID",
        "/confirmtransfer",
        "",
        "سیستم:",
        "/reset",
        "/confirmreset",
        "",
        "Role ها:",
        "user",
        "moderator",
        "owner",
      ].join("\n"),
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "👥 مدیریت کاربران",
                callback_data: "user_page:0",
              },
            ],
          ],
        },
      }
    )
  })

  bot.command("user", async (ctx) => {
    syncOwner(ctx.from.id)

    const requester = getUser(ctx.from.id)

    if (!isOwner(requester)) {
      await ctx.reply(
        "⛔ فقط مالک می‌تواند اطلاعات مدیریتی کاربران را ببیند."
      )
      return
    }

    const args = ctx.match.trim()

    if (!args) {
      await ctx.reply("استفاده:\n/user USER_ID")
      return
    }

    const targetId = Number(args)

    if (!Number.isInteger(targetId)) {
      await ctx.reply("❌ شناسه کاربر نامعتبر است.")
      return
    }

    const target = getUser(targetId)

    if (!target) {
      await ctx.reply("❌ کاربر پیدا نشد.")
      return
    }

    await ctx.reply(
      [
        "👤 USER INFORMATION",
        "",
        `Name: ${target.display_name}`,
        `Username: ${target.username ? "@" + target.username : "ندارد"}`,
        `ID: ${target.telegram_id}`,
        `Money: ${target.infinite_money ? "♾️" : "$" + target.money}`,
        `Bank: $${target.bank}`,
        `XP: ${target.xp}`,
        `Level: ${target.level}`,
        `Job: ${target.job ?? "Unemployed"}`,
        `Role: ${ROLES[target.role] ?? target.role}`,
      ].join("\n")
    )
  })

  bot.command("setrole", async (ctx) => {
    syncOwner(ctx.from.id)

    const requester = getUser(ctx.from.id)

    if (!isOwner(requester)) {
      await ctx.reply("⛔ فقط مالک.")
      return
    }

    const args = ctx.match.trim().split(/\s+/)

    if (args.length < 2) {
      await ctx.reply(
        "استفاده:\n/setrole USER_ID ROLE\n\n" +
        "Role:\nuser\nmoderator"
      )
      return
    }

    const targetId = Number(args[0])
    const newRole = args[1]

    if (!Number.isInteger(targetId)) {
      await ctx.reply("❌ شناسه کاربر نامعتبر است.")
      return
    }

    if (newRole === "owner") {
      await ctx.reply(
        "⛔ تعیین مالک با /setrole مجاز نیست.\n\n" +
        "برای انتقال مالکیت از /transferowner استفاده کنید."
      )
      return
    }

    if (!["user", "moderator"].includes(newRole)) {
      await ctx.reply("❌ Role نامعتبر است.")
      return
    }

    const target = getUser(targetId)

    if (!target) {
      await ctx.reply("❌ کاربر پیدا نشد.")
      return
    }

    if (target.role === "owner") {
      await ctx.reply(
        "⛔ مالک فعلی قابل تغییر با /setrole نیست.\n\n" +
        "برای تغییر مالکیت از /transferowner استفاده کنید."
      )
      return
    }

    db.prepare(`
      UPDATE users
      SET role = ?,
          updated_at = ?
      WHERE telegram_id = ?
    `).run(
      newRole,
      new Date().toISOString(),
      targetId
    )

    await ctx.reply(
      `✅ Role کاربر ${target.display_name} تغییر کرد.\n\n` +
      `Role جدید: ${ROLES[newRole]}`
    )
  })

  bot.command("setjob", async (ctx) => {
    syncOwner(ctx.from.id)

    const requester = getUser(ctx.from.id)

    if (!isOwner(requester)) {
      await ctx.reply("⛔ فقط مالک.")
      return
    }

    const args = ctx.match.trim().split(/\s+/)

    if (args.length < 2) {
      await ctx.reply("استفاده:\n/setjob USER_ID JOB")
      return
    }

    const targetId = Number(args[0])
    const job = args.slice(1).join(" ")

    if (!Number.isInteger(targetId)) {
      await ctx.reply("❌ شناسه کاربر نامعتبر است.")
      return
    }

    const target = getUser(targetId)

    if (!target) {
      await ctx.reply("❌ کاربر پیدا نشد.")
      return
    }

    db.prepare(`
      UPDATE users
      SET job = ?,
          updated_at = ?
      WHERE telegram_id = ?
    `).run(
      job,
      new Date().toISOString(),
      targetId
    )

    await ctx.reply("✅ شغل کاربر تغییر کرد.")
  })

  bot.command("setmoney", async (ctx) => {
    syncOwner(ctx.from.id)

    const requester = getUser(ctx.from.id)

    if (!isOwner(requester)) {
      await ctx.reply("⛔ فقط مالک.")
      return
    }

    const args = ctx.match.trim().split(/\s+/)

    if (args.length < 2) {
      await ctx.reply("استفاده:\n/setmoney USER_ID AMOUNT")
      return
    }

    const targetId = Number(args[0])
    const amount = safeNumber(args[1])

    if (!Number.isInteger(targetId)) {
      await ctx.reply("❌ شناسه کاربر نامعتبر است.")
      return
    }

    if (amount === null || amount < 0) {
      await ctx.reply("❌ مبلغ نامعتبر است.")
      return
    }

    const target = getUser(targetId)

    if (!target) {
      await ctx.reply("❌ کاربر پیدا نشد.")
      return
    }

    db.prepare(`
      UPDATE users
      SET money = ?,
          updated_at = ?
      WHERE telegram_id = ?
    `).run(
      amount,
      new Date().toISOString(),
      targetId
    )

    await ctx.reply(`✅ Money = $${amount}`)
  })  // =========================
  // SET INFINITE MONEY
  // =========================

  bot.command("setinfmoney", async (ctx) => {
    syncOwner(ctx.from.id)

    const requester = getUser(ctx.from.id)

    if (!isOwner(requester)) {
      return ctx.reply(
        "⛔ فقط مالک می‌تواند این دستور را اجرا کند."
      )
    }

    const targetId = Number(ctx.match?.trim())

    if (!Number.isInteger(targetId) || targetId <= 0) {
      return ctx.reply(
        "❌ شناسه کاربر را درست وارد کن.\n" +
        "مثال:\n" +
        "/setinfmoney 123456789"
      )
    }

    const target = getUser(targetId)

    if (!target) {
      return ctx.reply("❌ کاربر پیدا نشد.")
    }

    db.prepare(`
      UPDATE users
      SET infinite_money = 1,
          updated_at = ?
      WHERE telegram_id = ?
    `).run(
      new Date().toISOString(),
      targetId
    )

    return ctx.reply(
      `♾️ پول بی‌نهایت برای ${target.display_name} فعال شد.`
    )
  })

  // =========================
  // REMOVE INFINITE MONEY
  // =========================

  bot.command("removeinfmoney", async (ctx) => {
    syncOwner(ctx.from.id)

    const requester = getUser(ctx.from.id)

    if (!isOwner(requester)) {
      return ctx.reply(
        "⛔ فقط مالک می‌تواند این دستور را اجرا کند."
      )
    }

    const targetId = Number(ctx.match?.trim())

    if (!Number.isInteger(targetId) || targetId <= 0) {
      return ctx.reply(
        "❌ شناسه کاربر را درست وارد کن.\n" +
        "مثال:\n" +
        "/removeinfmoney 123456789"
      )
    }

    const target = getUser(targetId)

    if (!target) {
      return ctx.reply("❌ کاربر پیدا نشد.")
    }

    db.prepare(`
      UPDATE users
      SET infinite_money = 0,
          updated_at = ?
      WHERE telegram_id = ?
    `).run(
      new Date().toISOString(),
      targetId
    )

    return ctx.reply(
      `✅ پول بی‌نهایت ${target.display_name} غیرفعال شد.`
    )
  })

  // =========================
  // SET BANK
  // =========================

  bot.command("setbank", async (ctx) => {
    syncOwner(ctx.from.id)

    const requester = getUser(ctx.from.id)

    if (!isOwner(requester)) {
      await ctx.reply("⛔ فقط مالک.")
      return
    }

    const args = ctx.match.trim().split(/\s+/)

    if (args.length < 2) {
      await ctx.reply("استفاده:\n/setbank USER_ID AMOUNT")
      return
    }

    const targetId = Number(args[0])
    const amount = safeNumber(args[1])

    if (!Number.isInteger(targetId)) {
      await ctx.reply("❌ شناسه کاربر نامعتبر است.")
      return
    }

    if (amount === null || amount < 0) {
      await ctx.reply("❌ مبلغ نامعتبر است.")
      return
    }

    const target = getUser(targetId)

    if (!target) {
      await ctx.reply("❌ کاربر پیدا نشد.")
      return
    }

    db.prepare(`
      UPDATE users
      SET bank = ?,
          updated_at = ?
      WHERE telegram_id = ?
    `).run(
      amount,
      new Date().toISOString(),
      targetId
    )

    await ctx.reply(`✅ Bank = $${amount}`)
  })
  // =========================
  // SET XP + AUTO LEVEL
  // =========================

  bot.command("setxp", async (ctx) => {
    syncOwner(ctx.from.id)

    const requester = getUser(ctx.from.id)

    if (!isOwner(requester)) {
      await ctx.reply("⛔ فقط مالک.")
      return
    }

    const args = (ctx.match || "").trim().split(/\s+/).filter(Boolean)

    if (args.length < 2) {
      await ctx.reply("استفاده:\n/setxp USER_ID AMOUNT")
      return
    }

    const targetId = Number(args[0])
    const amount = safeNumber(args[1])

    if (!Number.isInteger(targetId) || targetId <= 0) {
      await ctx.reply("❌ شناسه کاربر نامعتبر است.")
      return
    }

    if (amount === null || amount < 0 || !Number.isInteger(amount)) {
      await ctx.reply("❌ مقدار XP باید عدد صحیح و غیرمنفی باشد.")
      return
    }

    const target = getUser(targetId)

    if (!target) {
      await ctx.reply("❌ کاربر پیدا نشد.")
      return
    }

    const newLevel = calculateLevelFromXP(amount)

    db.prepare(`
      UPDATE users
      SET xp = ?,
          level = ?,
          updated_at = ?
      WHERE telegram_id = ?
    `).run(
      amount,
      newLevel,
      new Date().toISOString(),
      targetId
    )

    await ctx.reply(
      `✅ اطلاعات کاربر به‌روزرسانی شد.\n\n` +
      `👤 کاربر: ${target.display_name}\n` +
      `✨ XP: ${amount}\n` +
      `⭐ Level: ${newLevel}`
    )
  })
  // =========================
// TEST XP + AUTO LEVEL
// =========================

bot.command("testxp", async (ctx) => {
  syncOwner(ctx.from.id)

  const requester = getUser(ctx.from.id)

  if (!isOwner(requester)) {
    await ctx.reply("⛔ این دستور فقط برای آزمایش توسط مالک است.")
    return
  }

  const args = (ctx.match || "").trim().split(/\s+/).filter(Boolean)

  if (args.length < 2) {
    await ctx.reply(
      "روش استفاده:\n/testxp USER_ID AMOUNT\n\n" +
      "مثال:\n/testxp 123456789 100"
    )
    return
  }

  const targetId = Number(args[0])
  const amount = Number(args[1])

  if (
    !Number.isSafeInteger(targetId) ||
    targetId <= 0 ||
    !Number.isSafeInteger(amount) ||
    amount <= 0
  ) {
    await ctx.reply("❌ شناسه کاربر و مقدار XP باید اعداد صحیح و معتبر باشند.")
    return
  }

  const target = getUser(targetId)

  if (!target) {
    await ctx.reply("❌ کاربر پیدا نشد.")
    return
  }

  const result = addXP(targetId, amount)

  if (!result) {
    await ctx.reply("❌ اعطای XP ناموفق بود.")
    return
  }

  await ctx.reply(
    `✅ پاداش XP ثبت شد.\n\n` +
    `👤 کاربر: ${target.display_name}\n` +
    `✨ XP قبلی: ${result.oldXP}\n` +
    `✨ XP جدید: ${result.newXP}\n` +
    `🎖 Level قبلی: ${result.oldLevel}\n` +
    `🏆 Level جدید: ${result.newLevel}` +
    (result.levelUp ? "\n\n🎉 کاربر Level Up شد!" : "")
  )
})
   // =========================
  // SET LEVEL
  // =========================


    bot.command("setlevel", async (ctx) => {
    syncOwner(ctx.from.id)

    const requester = getUser(ctx.from.id)

    if (!isOwner(requester)) {
      await ctx.reply("⛔ فقط مالک.")
      return
    }

    const args = (ctx.match || "").trim().split(/\s+/).filter(Boolean)

    if (args.length < 2) {
      await ctx.reply("استفاده:\n/setlevel USER_ID LEVEL")
      return
    }

    const targetId = Number(args[0])
    const level = Number(args[1])

    if (!Number.isInteger(targetId)) {
      await ctx.reply("❌ شناسه کاربر نامعتبر است.")
      return
    }

    if (!Number.isInteger(level) || level < 1) {
      await ctx.reply("❌ Level نامعتبر است.")
      return
    }

    const target = getUser(targetId)

    if (!target) {
      await ctx.reply("❌ کاربر پیدا نشد.")
      return
    }

    db.prepare(`
      UPDATE users
      SET level = ?,
          updated_at = ?
      WHERE telegram_id = ?
    `).run(
      level,
      new Date().toISOString(),
      targetId
    )

    await ctx.reply(`✅ Level = ${level}`)
  })

  // =========================
  // TRANSFER OWNER
  // =========================

  bot.command("transferowner", async (ctx) => {
    syncOwner(ctx.from.id)

    const requester = getUser(ctx.from.id)

    if (!isOwner(requester)) {
      await ctx.reply("⛔ فقط مالک.")
      return
    }

    const targetId = Number(ctx.match.trim())

    if (!Number.isInteger(targetId)) {
      await ctx.reply(
        "استفاده:\n/transferowner USER_ID"
      )
      return
    }

    if (targetId === ctx.from.id) {
      await ctx.reply(
        "❌ شما همین حالا مالک هستید."
      )
      return
    }

    const target = getUser(targetId)

    if (!target) {
      await ctx.reply("❌ کاربر پیدا نشد.")
      return
    }

    if (target.role === "owner") {
      await ctx.reply(
        "❌ این کاربر در حال حاضر مالک است."
      )
      return
    }

    await ctx.reply(
      `⚠️ انتقال مالکیت\n\n` +
      `مالک جدید:\n${target.display_name}\n` +
      `ID: ${target.telegram_id}\n\n` +
      `برای تأیید این انتقال بنویس:\n` +
      `/confirmtransfer`
    )

    bot.pendingOwnerTransfer = {
      from: ctx.from.id,
      to: targetId,
    }
  })

  // =========================
  // CONFIRM OWNER TRANSFER
  // =========================

  bot.command("confirmtransfer", async (ctx) => {
    syncOwner(ctx.from.id)

    const requester = getUser(ctx.from.id)

    if (!isOwner(requester)) {
      await ctx.reply("⛔ فقط مالک.")
      return
    }

    const pending = bot.pendingOwnerTransfer

    if (
      !pending ||
      pending.from !== ctx.from.id
    ) {
      await ctx.reply(
        "❌ انتقال مالکیتی در انتظار تأیید نیست."
      )
      return
    }

    const target = getUser(pending.to)

    if (!target) {
      await ctx.reply(
        "❌ کاربر مقصد پیدا نشد."
      )

      bot.pendingOwnerTransfer = null
      return
    }

    if (target.role === "owner") {
      await ctx.reply(
        "❌ این کاربر دیگر مالک است."
      )

      bot.pendingOwnerTransfer = null
      return
    }

    const currentOwner = getCurrentOwner()

    if (
      !currentOwner ||
      currentOwner.telegram_id !== ctx.from.id
    ) {
      await ctx.reply(
        "⛔ مالک فعلی تغییر کرده است. انتقال لغو شد."
      )

      bot.pendingOwnerTransfer = null
      return
    }

    const now = new Date().toISOString()

    const transaction = db.transaction(() => {

      db.prepare(`
        UPDATE users
        SET role = 'user',
            updated_at = ?
        WHERE telegram_id = ?
      `).run(
        now,
        ctx.from.id
      )

      db.prepare(`
        UPDATE users
        SET role = 'owner',
            updated_at = ?
        WHERE telegram_id = ?
      `).run(
        now,
        pending.to
      )
    })

    transaction()

    bot.pendingOwnerTransfer = null

    await ctx.reply(
      `👑 مالکیت با موفقیت منتقل شد.\n\n` +
      `مالک جدید: ${target.display_name}`
    )
  })

  // =========================
  // RESET
  // =========================

  bot.command("reset", async (ctx) => {
    syncOwner(ctx.from.id)

    const requester = getUser(ctx.from.id)

    if (!isOwner(requester)) {
      await ctx.reply(
        "⛔ فقط مالک می‌تواند سیستم را Reset کند."
      )
      return
    }

    await ctx.reply(
      "⚠️ هشدار!\n\n" +
      "این کار اطلاعات کاربران را پاک می‌کند.\n\n" +
      "اگر مطمئنی، بنویس:\n" +
      "/confirmreset"
    )

    bot.pendingReset = ctx.from.id
  })

  // =========================
  // CONFIRM RESET
  // =========================

  bot.command("confirmreset", async (ctx) => {
    syncOwner(ctx.from.id)

    const requester = getUser(ctx.from.id)

    if (!isOwner(requester)) {
      await ctx.reply("⛔ فقط مالک.")
      return
    }

    if (bot.pendingReset !== ctx.from.id) {
      await ctx.reply(
        "❌ درخواست Reset در انتظار تأیید نیست."
      )
      return
    }

    const currentOwner = getCurrentOwner()

    if (
      !currentOwner ||
      currentOwner.telegram_id !== ctx.from.id
    ) {
      await ctx.reply(
        "⛔ مالک فعلی تغییر کرده است. Reset لغو شد."
      )

      bot.pendingReset = null
      return
    }

    db.prepare("DELETE FROM users").run()

    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO users (
        telegram_id,
        username,
        display_name,
        card_number,
        money,
        infinite_money,
        bank,
        xp,
        level,
        role,
        job,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, 0, 0, 0, 0, 1, 'owner', NULL, ?, ?)
    `).run(
      ctx.from.id,
      ctx.from.username ?? null,
      [
        ctx.from.first_name,
        ctx.from.last_name
      ]
        .filter(Boolean)
        .join(" ") || "Owner",
      generateUniqueCardNumber(),
      now,
      now
    )

    bot.pendingReset = null

    await ctx.reply(
      "✅ Reset با موفقیت انجام شد.\n\n" +
      "حساب مالک حفظ شد و سایر کاربران حذف شدند."
    )
  })

  // =========================
  // OWNER CHECK
  // =========================

  bot.command("ownercheck", async (ctx) => {
    syncOwner(ctx.from.id)

    const user = getUser(ctx.from.id)

    if (!isOwner(user)) {
      await ctx.reply(
        "⛔ شما مالک نیستید."
      )
      return
    }

    await ctx.reply(
      "👑 مالکیت تأیید شد."
    )
  })
    // =========================

  // MONTADORIA_MODERATOR_USER_LIST_ENTRY
  const openUsersList = async (ctx) => {
    syncOwner(ctx.from.id);
    const requester = getUser(ctx.from.id);

    if (!isModeratorOrOwner(requester)) {
      await ctx.reply("⛔ فقط مدیر یا مالک اجازه مشاهده فهرست کاربران را دارد.");
      return;
    }

    await ctx.reply(
      "👥 فهرست کاربران\n\nبرای مشاهده کاربران و اطلاعاتشان، دکمه زیر را بزنید.",
      {
        reply_markup: {
          inline_keyboard: [[
            {
              text: "👥 نمایش فهرست کاربران",
              callback_data: "user_page:0",
            },
          ]],
        },
      }
    );
  };

  bot.command("users", openUsersList);
  bot.hears(/^فهرست کاربران$/u, openUsersList);
  // END MONTADORIA_MODERATOR_USER_LIST_ENTRY

  // CALLBACK: USER LIST
  // =========================

  bot.callbackQuery(
    /^user_page:(\d+)$/,
    async (ctx) => {
      const page = Number(ctx.match[1])

      await showUserList(
        ctx,
        page
      )
    }
  )

  // =========================
  // CALLBACK: USER VIEW
  // =========================

  bot.callbackQuery(
    /^user_view:(\d+):(\d+)$/,
    async (ctx) => {
      const targetId = Number(
        ctx.match[1]
      )

      const page = Number(
        ctx.match[2]
      )

      await showUserDetails(
        ctx,
        targetId,
        page
      )
    }
  )

  // =========================
  // CALLBACK: OWNER PANEL
  // =========================

  bot.callbackQuery(
    "owner_panel",
    async (ctx) => {
      await showOwnerPanel(ctx)
    }
  )

  // =========================
  // CALLBACK: CURRENT PAGE
  // =========================

  bot.callbackQuery(
    "user_page_current",
    async (ctx) => {
      await ctx.answerCallbackQuery({
        text: "صفحه فعلی",
      })
    }
  )

  // =========================
  // CALLBACK: ADMIN STATUS
  // =========================

  bot.callbackQuery(
    "admin_status",
    async (ctx) => {

      const user = getUser(
        ctx.from.id
      )

      if (!isModeratorOrOwner(user)) {
        await ctx.answerCallbackQuery({
          text: "⛔ دسترسی ندارید.",
          show_alert: true,
        })

        return
      }

      await ctx.answerCallbackQuery()

      await ctx.editMessageText(
        [
          "🛡️ دسترسی مدیریتی",
          "",
          `Role: ${
            ROLES[user.role] ??
            user.role
          }`,
          "",
          "شما به بخش مدیریتی دسترسی دارید.",
        ].join("\n"),
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "↩️ بازگشت",
                  callback_data:
                    "owner_panel",
                },
              ],
            ],
          },
        }
      )
    }
  )

  // =========================
  // CALLBACK: USER ROLE
  // =========================

  bot.callbackQuery(
    /^user_role:(\d+):(\d+)$/,
    async (ctx) => {

      const requester = getUser(
        ctx.from.id
      )

      if (!isOwner(requester)) {
        await ctx.answerCallbackQuery({
          text: "⛔ فقط مالک.",
          show_alert: true,
        })

        return
      }

      const targetId = Number(
        ctx.match[1]
      )

      const page = Number(
        ctx.match[2]
      )

      const target = getUser(
        targetId
      )

      if (!target) {
        await ctx.answerCallbackQuery({
          text: "❌ کاربر پیدا نشد.",
          show_alert: true,
        })

        return
      }

      if (target.role === "owner") {
        await ctx.answerCallbackQuery({
          text:
            "⛔ مالک فعلی از این بخش قابل تغییر نیست.",
          show_alert: true,
        })

        return
      }

      await ctx.answerCallbackQuery()

      await ctx.editMessageText(
        [
          "🎭 تغییر نقش",
          "",
          `کاربر: ${target.display_name}`,
          `Role فعلی: ${
            ROLES[target.role] ??
            target.role
          }`,
          "",
          "نقش جدید را انتخاب کنید:",
        ].join("\n"),
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "👤 کاربر عادی",
                  callback_data:
                    `role_set:user:${targetId}:${page}`,
                },
              ],
              [
                {
                  text: "🛡️ مدیر / ناظر",
                  callback_data:
                    `role_set:moderator:${targetId}:${page}`,
                },
              ],
              [
                {
                  text: "↩️ بازگشت",
                  callback_data:
                    `user_view:${targetId}:${page}`,
                },
              ],
            ],
          },
        }
      )
    }
  )

  // =========================
  // CALLBACK: SET ROLE
  // =========================

  bot.callbackQuery(
    /^role_set:(user|moderator):(\d+):(\d+)$/,
    async (ctx) => {

      const requester = getUser(
        ctx.from.id
      )

      if (!isOwner(requester)) {
        await ctx.answerCallbackQuery({
          text: "⛔ فقط مالک.",
          show_alert: true,
        })

        return
      }

      const newRole = ctx.match[1]

      const targetId = Number(
        ctx.match[2]
      )

      const page = Number(
        ctx.match[3]
      )

      const target = getUser(
        targetId
      )

      if (!target) {
        await ctx.answerCallbackQuery({
          text: "❌ کاربر پیدا نشد.",
          show_alert: true,
        })

        return
      }

      if (target.role === "owner") {
        await ctx.answerCallbackQuery({
          text:
            "⛔ مالک فعلی قابل تغییر نیست.",
          show_alert: true,
        })

        return
      }

      db.prepare(`
        UPDATE users
        SET role = ?,
            updated_at = ?
        WHERE telegram_id = ?
      `).run(
        newRole,
        new Date().toISOString(),
        targetId
      )

      await ctx.answerCallbackQuery({
        text: "✅ نقش تغییر کرد.",
      })

      await showUserDetails(
        ctx,
        targetId,
        page
      )
    }
  )

    // =========================
  // CALLBACK: JOB
  // =========================

  bot.callbackQuery(
    /^user_job:(\d+):(\d+)$/,
    async (ctx) => {

      const requester = getUser(
        ctx.from.id
      )

      if (!isOwner(requester)) {
        await ctx.answerCallbackQuery({
          text: "⛔ فقط مالک.",
          show_alert: true,
        })

        return
      }

      const targetId = Number(
        ctx.match[1]
      )

      const page = Number(
        ctx.match[2]
      )

      const target = getUser(targetId)

      if (!target) {
        await ctx.answerCallbackQuery({
          text: "❌ کاربر پیدا نشد.",
          show_alert: true,
        })

        return
      }

      const jobs = db
        .prepare(`
          SELECT id, name, category
          FROM jobs
          WHERE active = 1
          ORDER BY category ASC, id ASC
        `)
        .all()

      const keyboard = []

      for (const job of jobs) {
        keyboard.push([
          {
            text: `${job.name}`,
            callback_data:
              `job_set:${job.id}:${targetId}:${page}`,
          },
        ])
      }

      keyboard.push([
        {
          text: "❌ بیکار / بدون شغل",
          callback_data:
            `job_clear:${targetId}:${page}`,
        },
      ])

      keyboard.push([
        {
          text: "↩️ بازگشت",
          callback_data:
            `user_view:${targetId}:${page}`,
        },
      ])

      await ctx.answerCallbackQuery()

      await ctx.editMessageText(
        [
          "💼 تغییر شغل",
          "",
          `کاربر: ${target.display_name}`,
          `شغل فعلی: ${target.job ?? "Unemployed"}`,
          "",
          "شغل جدید را انتخاب کنید:",
        ].join("\n"),
        {
          reply_markup: {
            inline_keyboard: keyboard,
          },
        }
      )
    }
  )

  // =========================
  // CALLBACK: SET JOB
  // =========================

  bot.callbackQuery(
    /^job_set:(\d+):(\d+):(\d+)$/,
    async (ctx) => {

      const requester = getUser(
        ctx.from.id
      )

      if (!isOwner(requester)) {
        await ctx.answerCallbackQuery({
          text: "⛔ فقط مالک.",
          show_alert: true,
        })

        return
      }

      const jobId = Number(
        ctx.match[1]
      )

      const targetId = Number(
        ctx.match[2]
      )

      const page = Number(
        ctx.match[3]
      )

      const target = getUser(targetId)

      if (!target) {
        await ctx.answerCallbackQuery({
          text: "❌ کاربر پیدا نشد.",
          show_alert: true,
        })

        return
      }

      const job = db
        .prepare(`
          SELECT id, name
          FROM jobs
          WHERE id = ?
            AND active = 1
        `)
        .get(jobId)

      if (!job) {
        await ctx.answerCallbackQuery({
          text: "❌ شغل پیدا نشد.",
          show_alert: true,
        })

        return
      }

      db.prepare(`
        UPDATE users
        SET job = ?,
            updated_at = ?
        WHERE telegram_id = ?
      `).run(
        job.name,
        new Date().toISOString(),
        targetId
      )

      await ctx.answerCallbackQuery({
        text: "✅ شغل تغییر کرد.",
      })

      await showUserDetails(
        ctx,
        targetId,
        page
      )
    }
  )

  // =========================
  // CALLBACK: CLEAR JOB
  // =========================

  bot.callbackQuery(
    /^job_clear:(\d+):(\d+)$/,
    async (ctx) => {

      const requester = getUser(
        ctx.from.id
      )

      if (!isOwner(requester)) {
        await ctx.answerCallbackQuery({
          text: "⛔ فقط مالک.",
          show_alert: true,
        })

        return
      }

      const targetId = Number(
        ctx.match[1]
      )

      const page = Number(
        ctx.match[2]
      )

      const target = getUser(targetId)

      if (!target) {
        await ctx.answerCallbackQuery({
          text: "❌ کاربر پیدا نشد.",
          show_alert: true,
        })

        return
      }

      db.prepare(`
        UPDATE users
        SET job = NULL,
            updated_at = ?
        WHERE telegram_id = ?
      `).run(
        new Date().toISOString(),
        targetId
      )

      await ctx.answerCallbackQuery({
        text: "✅ شغل کاربر حذف شد.",
      })

      await showUserDetails(
        ctx,
        targetId,
        page
      )
    }
  )

  // =========================
  // CALLBACK: MONEY
  // =========================

  bot.callbackQuery(
    /^user_money:(\d+):(\d+)$/,
    async (ctx) => {

      const requester = getUser(
        ctx.from.id
      )

      if (!isOwner(requester)) {
        await ctx.answerCallbackQuery({
          text: "⛔ فقط مالک.",
          show_alert: true,
        })

        return
      }

      const targetId = Number(
        ctx.match[1]
      )

      const page = Number(
        ctx.match[2]
      )

      const target = getUser(targetId)

      if (!target) {
        await ctx.answerCallbackQuery({
          text: "❌ کاربر پیدا نشد.",
          show_alert: true,
        })

        return
      }

      await ctx.answerCallbackQuery()

      await ctx.editMessageText(
        [
          "💰 مدیریت پول",
          "",
          `کاربر: ${target.display_name}`,
          `موجودی فعلی: ${target.infinite_money ? "♾️" : "$" + target.money}`,
          "",
          "عملیات موردنظر را انتخاب کنید:",
          "",
          "برای تعیین مبلغ عادی:",
          `/setmoney ${target.telegram_id} AMOUNT`,
        ].join("\n"),
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "♾️ فعال‌کردن پول بی‌نهایت",
                  callback_data:
                    `money_inf_on:${targetId}:${page}`,
                },
              ],
              [
                {
                  text: "💵 غیرفعال‌کردن پول بی‌نهایت",
                  callback_data:
                    `money_inf_off:${targetId}:${page}`,
                },
              ],
              [
                {
                  text: "↩️ بازگشت",
                  callback_data:
                    `user_view:${targetId}:${page}`,
                },
              ],
            ],
          },
        }
      )
    }
  )
    // =========================
  // CALLBACK: ENABLE INFINITE MONEY
  // =========================

  bot.callbackQuery(
    /^money_inf_on:(\d+):(\d+)$/,
    async (ctx) => {

      const requester = getUser(
        ctx.from.id
      )

      if (!isOwner(requester)) {
        await ctx.answerCallbackQuery({
          text: "⛔ فقط مالک.",
          show_alert: true,
        })

        return
      }

      const targetId = Number(
        ctx.match[1]
      )

      const page = Number(
        ctx.match[2]
      )

      const target = getUser(targetId)

      if (!target) {
        await ctx.answerCallbackQuery({
          text: "❌ کاربر پیدا نشد.",
          show_alert: true,
        })

        return
      }

      db.prepare(`
        UPDATE users
        SET infinite_money = 1,
            updated_at = ?
        WHERE telegram_id = ?
      `).run(
        new Date().toISOString(),
        targetId
      )

      await ctx.answerCallbackQuery({
        text: "♾️ پول بی‌نهایت فعال شد.",
      })

      await showUserDetails(
        ctx,
        targetId,
        page
      )
    }
  )

  // =========================
  // CALLBACK: DISABLE INFINITE MONEY
  // =========================

  bot.callbackQuery(
    /^money_inf_off:(\d+):(\d+)$/,
    async (ctx) => {

      const requester = getUser(
        ctx.from.id
      )

      if (!isOwner(requester)) {
        await ctx.answerCallbackQuery({
          text: "⛔ فقط مالک.",
          show_alert: true,
        })

        return
      }

      const targetId = Number(
        ctx.match[1]
      )

      const page = Number(
        ctx.match[2]
      )

      const target = getUser(targetId)

      if (!target) {
        await ctx.answerCallbackQuery({
          text: "❌ کاربر پیدا نشد.",
          show_alert: true,
        })

        return
      }

      db.prepare(`
        UPDATE users
        SET infinite_money = 0,
            updated_at = ?
        WHERE telegram_id = ?
      `).run(
        new Date().toISOString(),
        targetId
      )

      await ctx.answerCallbackQuery({
        text: "✅ پول بی‌نهایت غیرفعال شد.",
      })

      await showUserDetails(
        ctx,
        targetId,
        page
      )
    }
  )

  // =========================

  // =========================
  // CALLBACK: BANK MANAGEMENT
  // =========================
  bot.callbackQuery(
    /^user_bank:(\d+):(\d+)$/,
    async (ctx) => {
      const requester = getUser(ctx.from.id);

      if (!isOwner(requester)) {
        await ctx.answerCallbackQuery({
          text: "⛔ فقط مالک اجازه مدیریت بانک را دارد.",
          show_alert: true,
        });
        return;
      }

      const targetId = Number(ctx.match[1]);
      const page = Number(ctx.match[2]);
      const target = getUser(targetId);

      if (!target) {
        await ctx.answerCallbackQuery({
          text: "❌ کاربر پیدا نشد.",
          show_alert: true,
        });
        return;
      }

      await ctx.answerCallbackQuery();
      await ctx.editMessageText(
        [
          "🏦 مدیریت بانک",
          "",
          `کاربر: ${target.display_name}`,
          `شناسه: ${target.telegram_id}`,
          `موجودی فعلی بانک: $${target.bank}`,
          "",
          "برای تعیین موجودی جدید:",
          `/setbank ${target.telegram_id} AMOUNT`,
          "",
          "مثال:",
          `/setbank ${target.telegram_id} 5000`,
        ].join("\n"),
        {
          reply_markup: {
            inline_keyboard: [[
              {
                text: "↩️ بازگشت",
                callback_data: `user_view:${targetId}:${page}`,
              },
            ]],
          },
        }
      );
    }
  );

  // CALLBACK: XP / LEVEL
  // =========================

  bot.callbackQuery(
    /^user_xp:(\d+):(\d+)$/,
    async (ctx) => {

      const requester = getUser(
        ctx.from.id
      )

      if (!isOwner(requester)) {
        await ctx.answerCallbackQuery({
          text: "⛔ فقط مالک.",
          show_alert: true,
        })

        return
      }

      const targetId = Number(
        ctx.match[1]
      )

      const page = Number(
        ctx.match[2]
      )

      const target = getUser(targetId)

      if (!target) {
        await ctx.answerCallbackQuery({
          text: "❌ کاربر پیدا نشد.",
          show_alert: true,
        })

        return
      }

      await ctx.answerCallbackQuery()

      await ctx.editMessageText(
        [
          "⭐ مدیریت XP / LEVEL",
          "",
          `کاربر: ${target.display_name}`,
          `XP فعلی: ${target.xp}`,
          `Level فعلی: ${target.level}`,
          "",
          "برای تغییر مستقیم از دستورات زیر استفاده کنید:",
          "",
          `/setxp ${target.telegram_id} AMOUNT`,
          `/setlevel ${target.telegram_id} LEVEL`,
        ].join("\n"),
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "↩️ بازگشت",
                  callback_data:
                    `user_view:${targetId}:${page}`,
                },
              ],
            ],
          },
        }
      )
    }
  )
    }
