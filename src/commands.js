import db from "./database.js"

const OWNER_ID = Number(process.env.OWNER_ID)

const ROLES = {
  user: "کاربر عادی",
  moderator: "مدیر / ناظر",
  owner: "مالک",
}

const USERS_PER_PAGE = 8

function getUser(telegramId) {
  return db
    .prepare(`
      SELECT telegram_id, username, display_name,
             money, infinite_money, bank, xp, level, role, job
      FROM users
      WHERE telegram_id = ?
    `)
    .get(telegramId)
}

function getAllUsers() {
  return db
    .prepare(`
      SELECT telegram_id, username, display_name,
             money, infinite_money, bank, xp, level, role, job
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

  if (!isOwner(requester)) {
    await ctx.answerCallbackQuery({
      text: "⛔ فقط مالک دسترسی دارد.",
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

  if (!isOwner(requester)) {
    await ctx.answerCallbackQuery({
      text: "⛔ فقط مالک دسترسی دارد.",
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

      db.prepare(`
        INSERT INTO users (
          telegram_id,
          username,
          display_name,
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
        VALUES (?, ?, ?, 0, 0, 0, 0, 1, ?, NULL, ?, ?)
      `).run(
        telegramId,
        username,
        displayName,
        role,
        now,
        now
      )

      await ctx.reply(
        `سلام ${displayName}! 👋\n\n` +
        `به MONTADORIA خوش آمدی.\n\n` +
        `حساب تو با موفقیت ساخته شد.`
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

    const profileText = [
        "༺⟡ 𝐌𝐎𝐍𝐓𝐀𝐃𝐎𝐑𝐈𝐀 ⟡༻",
        "",
        "      شناسنامهٔ رسمی قلمرو",
        "━━━━━━━━━━━━━━━━━━",
        "",
        `👤 نام حساب: ${user.display_name}`,
        `🔰 نام کاربری: ${user.username ? "@" + user.username : "ثبت نشده"}`,
        `🆔 شناسهٔ شهروند: ${user.telegram_id}`,
        "",
        `💰 دارایی نقدی: ${user.infinite_money ? "♾️ نامحدود" : user.money}`,
        `🏦 موجودی خزانه: ${user.bank}`,
        `⭐ سطح شخصیت: ${user.level}`,
        `✨ امتیاز تجربه: ${user.xp}`,
        `⚒ پیشه: ${user.job ?? "بدون شغل"}`,
        `🏛 جایگاه در قلمرو: ${ROLES[user.role] ?? user.role}`,
        "",
        "╔═══⟡༺𓃦༻⟡═══╗",
    "             𝐌𝐎𝐍𝐓𝐀𝐃𝐎𝐑𝐈𝐀",
    "╚═══⟡༺𓃦༻⟡═══╝",
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
        `🎭 نام رول: ${registration.character_name}`,
        `🔢 کد اختصاصی: ${registration.registration_code}`,
        `👤 نام واقعی سلبریتی: ${registration.celebrity_name}`,
        `🔰 نام کاربری ثبت‌شده: @${registration.telegram_username}`,
        `🏰 خاندان: ${registration.family_name || "ثبت نشده"}`,
        `👩 مادر: ${registration.mother_username ? "@" + registration.mother_username : "ثبت نشده"}`,
        `👨 پدر: ${registration.father_username ? "@" + registration.father_username : "ثبت نشده"}`,
        `🆔 شناسه تلگرام: ${user.telegram_id}`,
      ].join("\n")
    : "🎭 شناسنامه‌ای برای این نام کاربری در کانال ثبت نشده است."

  const fullProfileText = `${profileText}\n\n━━━━━━━━━━━━━━━━━━\n${registrationText}`

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
// END MONTADORIA PROPERTY SYSTEM V1


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
    SELECT c.*, s.market, s.name AS store_name, s.active AS store_active
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
      UPDATE shop_stores SET active=0
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
      VALUES (?, ?, ?, 0, 0, 0, 0, 1, 'owner', NULL, ?, ?)
    `).run(
      ctx.from.id,
      ctx.from.username ?? null,
      [
        ctx.from.first_name,
        ctx.from.last_name
      ]
        .filter(Boolean)
        .join(" ") || "Owner",
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
