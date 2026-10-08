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

  if (!user) {
    return null
  }

  const xpAmount = Number(amount)

  if (
    !Number.isFinite(xpAmount) ||
    xpAmount <= 0
  ) {
    return null
  }

  const newXP =
    Math.floor(user.xp + xpAmount)

  const newLevel =
    calculateLevelFromXP(newXP)

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
    levelUp:
      newLevel > user.level,
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

    const args = ctx.match.trim().split(/\s+/)

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
