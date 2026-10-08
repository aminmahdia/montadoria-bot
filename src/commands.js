import db from "./database.js"

const OWNER_ID = Number(process.env.OWNER_ID)

const ROLES = {
  user: "کاربر عادی",
  moderator: "مدیر / ناظر",
  owner: "مالک",
}

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

  const user = getUser(telegramId)

  if (user && user.role !== "owner") {
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

    let existingUser = getUser(telegramId)

    // مالک اصلی
    if (telegramId === OWNER_ID && existingUser) {
      db.prepare(`
        UPDATE users
        SET role = 'owner',
            username = ?,
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
    }

    // ساخت کاربر جدید
    if (!existingUser) {
      const role =
        telegramId === OWNER_ID
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

    // بروزرسانی اطلاعات کاربر
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

    await ctx.reply(
      `سلام ${displayName}! 👋\n\n` +
      `به MONTADORIA خوش آمدی.`
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
        `💰 Money: $${user.money}`,
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
      ].join("\n")
    )
  })

  // =========================
  // USER VIEW
  // =========================

  bot.command("user", async (ctx) => {
    syncOwner(ctx.from.id)

    const requester = getUser(ctx.from.id)

    if (!isOwner(requester)) {
      await ctx.reply("⛔ فقط مالک می‌تواند اطلاعات مدیریتی کاربران را ببیند.")
      return
    }

    const args = ctx.match.trim()

    if (!args) {
      await ctx.reply("استفاده:\n/user USER_ID")
      return
    }

    const target = getUser(Number(args))

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
        "Role:\nuser\nmoderator\nowner"
      )
      return
    }

    const targetId = Number(args[0])
    const newRole = args[1]

    if (!ROLES[newRole]) {
      await ctx.reply("❌ Role نامعتبر است.")
      return
    }

    if (targetId === OWNER_ID && newRole !== "owner") {
      await ctx.reply("⛔ مالک اصلی قابل تنزل نیست.")
      return
    }

    const target = getUser(targetId)

    if (!target) {
      await ctx.reply("❌ کاربر پیدا نشد.")
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
    const amount = Number(args[1])

    if (!Number.isFinite(amount) || amount < 0) {
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
    const amount = Number(args[1])

    if (!Number.isFinite(amount) || amount < 0) {
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
    const amount = Number(args[1])

    if (!Number.isFinite(amount) || amount < 0) {
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

    if (!targetId) {
      await ctx.reply("استفاده:\n/transferowner USER_ID")
      return
    }

    const target = getUser(targetId)

    if (!target) {
      await ctx.reply("❌ کاربر پیدا نشد.")
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
      await ctx.reply("❌ انتقال مالکیتی در انتظار تأیید نیست.")
      return
    }

    const target = getUser(pending.to)

    if (!target) {
      await ctx.reply("❌ کاربر مقصد پیدا نشد.")
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
      `).run(now, ctx.from.id)

      db.prepare(`
        UPDATE users
        SET role = 'owner',
            updated_at = ?
        WHERE telegram_id = ?
      `).run(now, pending.to)
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
      await ctx.reply("⛔ فقط مالک می‌تواند سیستم را Reset کند.")
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
      await ctx.reply("❌ درخواست Reset در انتظار تأیید نیست.")
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
      [ctx.from.first_name, ctx.from.last_name]
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
      await ctx.reply("⛔ شما مالک نیستید.")
      return
    }

    await ctx.reply("👑 مالکیت تأیید شد.")
  })
      }
