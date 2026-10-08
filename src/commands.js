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
             money, bank, xp, level, role, job
      FROM users
      WHERE telegram_id = ?
    `)
    .get(telegramId)
}

function getAllUsers() {
  return db
    .prepare(`
      SELECT telegram_id, username, display_name,
             money, bank, xp, level, role, job
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

/*
  OWNER_ID فقط برای شناسایی مالک اولیه استفاده می‌شود.
  بعد از انتقال مالکیت، مالک فعلی دیتابیس ملاک است.
*/
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
    `💰 Money: $${target.money}`,
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

  // =========================
  // START
  // =========================

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
      /*
        اگر مالک فعلی در دیتابیس وجود دارد،
        OWNER_ID قدیمی دیگر نمی‌تواند دوباره مالک شود.
      */
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
          bank,
          xp,
          level,
          role,
          job,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, 0, 0, 0, 1, ?, NULL, ?, ?)
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

  // =========================
  // PROFILE
  // =========================

  bot.command("profile", async (ctx) => {
    syncOwner(ctx.from.id)

    const user = getUser(ctx.from.id)

    if (!user) {
      await ctx.reply("ابتدا /start را بزنید.")
      return
    }

    await ctx.reply(
      [
        "👤 PROFILE",
        "",
        `Name: ${user.display_name}`,
        `Username: ${user.username ? "@" + user.username : "ندارد"}`,
        `🆔 ID: ${user.telegram_id}`,
        "",
        `💰 Money: ${user.infinite_money ? "♾️" : "$" + user.money}`,
        `🏦 Bank: $${user.bank}`,
        `⭐ Level: ${user.level}`,
        `✨ XP: ${user.xp}`,
        `💼 Job: ${user.job ?? "Unemployed"}`,
        `🎭 Role: ${ROLES[user.role] ?? user.role}`,
      ].join("\n")
    )
  })

  // =========================
  // HELP
  // =========================

  bot.command("help", async (ctx) => {
    await ctx.reply(
      [
        "🤖 MONTADORIA",
        "",
        "دستورات:",
        "/start — شروع ربات",
        "/profile — پروفایل",
        "/help — راهنما",
        "/ping — وضعیت ربات",
        "/id — شناسه",
        "",
        "دستورات مدیریتی:",
        "/owner — پنل مالک",
        "/admin — وضعیت مدیریت",
      ].join("\n")
    )
  })

  // =========================
  // PING
  // =========================

  bot.command("ping", async (ctx) => {
    await ctx.reply("🏓 pong")
  })

  // =========================
  // ID
  // =========================

  bot.command("id", async (ctx) => {
    await ctx.reply(
      `Chat ID: ${ctx.chat.id}\nUser ID: ${ctx.from?.id ?? "unknown"}`
    )
  })

  // =========================
  // ADMIN
  // =========================

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

  // =========================
  // OWNER PANEL
  // =========================

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

  // =========================
  // USER VIEW
  // =========================

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
        `Money: $${target.money}`,
        `Bank: $${target.bank}`,
        `XP: ${target.xp}`,
        `Level: ${target.level}`,
        `Job: ${target.job ?? "Unemployed"}`,
        `Role: ${ROLES[target.role] ?? target.role}`,
      ].join("\n")
    )
  })

  // =========================
  // SET ROLE
  // =========================

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

    /*
      مالک فعلی هرگز با /setrole قابل تنزل نیست.
      تنها راه تغییر مالکیت، فرآیند انتقال مالکیت است.
    */
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

  // =========================
  // SET JOB
  // =========================

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

  // =========================
  // SET MONEY
  // =========================

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
  })
 bot.command("setinfmoney", async (ctx) => {
  if (!isOwner(ctx.from.id)) {
    return ctx.reply("⛔ فقط مالک می‌تواند این دستور را اجرا کند.")
  }

  const targetId = Number(ctx.match?.trim())

  if (!Number.isInteger(targetId) || targetId <= 0) {
    return ctx.reply("❌ شناسه کاربر را درست وارد کن.\nمثال:\n/setinfmoney 123456789")
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
  `).run(new Date().toISOString(), targetId)

  return ctx.reply(
    `♾️ پول بی‌نهایت برای ${target.display_name} فعال شد.`
  )
})

bot.command("removeinfmoney", async (ctx) => {
  if (!isOwner(ctx.from.id)) {
    return ctx.reply("⛔ فقط مالک می‌تواند این دستور را اجرا کند.")
  }

  const targetId = Number(ctx.match?.trim())

  if (!Number.isInteger(targetId) || targetId <= 0) {
    return ctx.reply("❌ شناسه کاربر را درست وارد کن.\nمثال:\n/removeinfmoney 123456789")
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
  `).run(new Date().toISOString(), targetId)

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
  // SET XP
  // =========================

  bot.command("setxp", async (ctx) => {
    syncOwner(ctx.from.id)

    const requester = getUser(ctx.from.id)

    if (!isOwner(requester)) {
      await ctx.reply("⛔ فقط مالک.")
      return
    }

    const args = ctx.match.trim().split(/\s+/)

    if (args.length < 2) {
      await ctx.reply("استفاده:\n/setxp USER_ID AMOUNT")
      return
    }

    const targetId = Number(args[0])
    const amount = safeNumber(args[1])

    if (!Number.isInteger(targetId)) {
      await ctx.reply("❌ شناسه کاربر نامعتبر است.")
      return
    }

    if (amount === null || amount < 0) {
      await ctx.reply("❌ مقدار نامعتبر است.")
      return
    }

    const target = getUser(targetId)

    if (!target) {
      await ctx.reply("❌ کاربر پیدا نشد.")
      return
    }

    db.prepare(`
      UPDATE users
      SET xp = ?,
          updated_at = ?
      WHERE telegram_id = ?
    `).run(
      amount,
      new Date().toISOString(),
      targetId
    )

    await ctx.reply(`✅ XP = ${amount}`)
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

    const args = ctx.match.trim().split(/\s+/)

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
        bank,
        xp,
        level,
        role,
        job,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, 0, 0, 0, 1, 'owner', NULL, ?, ?)
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

      /*
        مالک فعلی نباید از طریق پنل Role عوض کند.
        انتقال مالکیت فقط از طریق فرآیند انتقال انجام می‌شود.
      */
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

      await ctx.answerCallbackQuery({
        text:
          "💼 مدیریت شغل را در مرحله بعد اضافه می‌کنیم.",
        show_alert: true,
      })
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

      await ctx.answerCallbackQuery({
        text:
          "💰 مدیریت پول را در مرحله بعد اضافه می‌کنیم.",
        show_alert: true,
      })
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

      await ctx.answerCallbackQuery({
        text:
          "⭐ مدیریت XP / Level را در مرحله بعد اضافه می‌کنیم.",
        show_alert: true,
      })
    }
  )
        }
