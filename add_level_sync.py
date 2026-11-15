from pathlib import Path
import shutil
import sys

p = Path("src/commands.js")
s = p.read_text(encoding="utf-8")

# بررسی نسخه و تغییر قبلی
if 'function removeXP(telegramId, amount)' not in s:
    print("تابع کسر XP پیدا نشد؛ فایل تغییر نکرد.")
    sys.exit(1)

if 'bot.command("removexp"' not in s:
    print("دستور removexp پیدا نشد؛ فایل تغییر نکرد.")
    sys.exit(1)

if 'bot.command("removelevel"' in s or 'bot.command("synclevel"' in s:
    print("یکی از دستورهای جدید از قبل وجود دارد؛ برای جلوگیری از تکرار، فایل تغییر نکرد.")
    sys.exit(1)

# 1) تابع کاهش Level همراه با هماهنگ‌سازی XP
helper_marker = "function userButtonName(user) {"

if helper_marker not in s:
    print("محل درج تابع کمکی پیدا نشد؛ فایل تغییر نکرد.")
    sys.exit(1)

helper = '''
function removeLevel(telegramId, amount) {
  const user = getUser(telegramId)
  if (!user) return null

  const levelAmount = Number(amount)
  const oldXP = Number(user.xp || 0)

  if (
    !Number.isSafeInteger(levelAmount) ||
    levelAmount <= 0 ||
    !Number.isSafeInteger(oldXP) ||
    oldXP < 0
  ) {
    return null
  }

  const oldLevel = calculateLevelFromXP(oldXP)
  const newLevel = Math.max(1, oldLevel - levelAmount)

  // XP را در بالاترین مقدار مجاز Level جدید نگه می‌داریم.
  const maxXPForNewLevel = xpRequiredForLevel(newLevel + 1) - 1
  const newXP = Math.min(oldXP, maxXPForNewLevel)
  const verifiedLevel = calculateLevelFromXP(newXP)

  if (verifiedLevel !== newLevel) return null

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
    oldXP,
    newXP,
    oldLevel,
    newLevel,
    removedXP: oldXP - newXP,
    decreasedLevels: oldLevel - newLevel
  }
}

'''

s = s.replace(helper_marker, helper + helper_marker, 1)

# 2) دستورات کسر Level و همگام‌سازی
marker = '    bot.command("setlevel", async (ctx) => {'

if marker not in s:
    print("محل درج دستورات قبل از setlevel پیدا نشد؛ فایل اصلی هنوز تغییر نکرده است.")
    sys.exit(1)

commands = r'''
    bot.command("removelevel", async (ctx) => {
      syncOwner(ctx.from.id)

      const requester = getUser(ctx.from.id)
      if (!isOwner(requester)) {
        return ctx.reply("⛔ فقط مالک اجازه استفاده از این دستور را دارد.")
      }

      const args = (ctx.match || "").trim().split(/\s+/).filter(Boolean)
      const targetId = Number(args[0])
      const amount = Number(args[1])

      if (
        !Number.isSafeInteger(targetId) || targetId <= 0 ||
        !Number.isSafeInteger(amount) || amount <= 0
      ) {
        return ctx.reply(
          "فرمت صحیح:\n/removelevel USER_ID AMOUNT\n\n" +
          "معادل فارسی:\nکسر لول | USER_ID | AMOUNT"
        )
      }

      const target = getUser(targetId)
      if (!target) return ctx.reply("❌ کاربر پیدا نشد.")

      const result = removeLevel(targetId, amount)
      if (!result) return ctx.reply("❌ کاهش Level انجام نشد.")

      return ctx.reply(
        "⟡ کاهش Level انجام شد ⟡\n\n" +
        `👤 کاربر: ${target.display_name}\n` +
        `🎖 Level قبلی: ${result.oldLevel}\n` +
        `🎖 Level جدید: ${result.newLevel}\n` +
        `✨ XP قبلی: ${result.oldXP}\n` +
        `✨ XP جدید: ${result.newXP}\n` +
        `➖ XP کسرشده: ${result.removedXP}` +
        (result.decreasedLevels === 0
          ? "\n\nℹ️ کاربر از قبل در Level 1 بود."
          : "")
      )
    })

    bot.hears(/^کسر لول\s*\|/i, async (ctx) => {
      syncOwner(ctx.from.id)

      const requester = getUser(ctx.from.id)
      if (!isOwner(requester)) {
        return ctx.reply("⛔ فقط مالک اجازه استفاده از این دستور را دارد.")
      }

      const parts = ctx.message.text.split("|").map(x => x.trim())
      const targetId = Number(parts[1])
      const amount = Number(parts[2])

      if (
        parts.length !== 3 ||
        !Number.isSafeInteger(targetId) || targetId <= 0 ||
        !Number.isSafeInteger(amount) || amount <= 0
      ) {
        return ctx.reply("فرمت صحیح:\nکسر لول | USER_ID | AMOUNT")
      }

      const target = getUser(targetId)
      if (!target) return ctx.reply("❌ کاربر پیدا نشد.")

      const result = removeLevel(targetId, amount)
      if (!result) return ctx.reply("❌ کاهش Level انجام نشد.")

      return ctx.reply(
        "⟡ کاهش Level انجام شد ⟡\n\n" +
        `👤 کاربر: ${target.display_name}\n` +
        `🎖 Level قبلی: ${result.oldLevel}\n` +
        `🎖 Level جدید: ${result.newLevel}\n` +
        `✨ XP قبلی: ${result.oldXP}\n` +
        `✨ XP جدید: ${result.newXP}\n` +
        `➖ XP کسرشده: ${result.removedXP}` +
        (result.decreasedLevels === 0
          ? "\n\nℹ️ کاربر از قبل در Level 1 بود."
          : "")
      )
    })

    bot.command("synclevel", async (ctx) => {
      syncOwner(ctx.from.id)

      const requester = getUser(ctx.from.id)
      if (!isOwner(requester)) {
        return ctx.reply("⛔ فقط مالک اجازه استفاده از این دستور را دارد.")
      }

      const targetId = Number((ctx.match || "").trim())
      if (!Number.isSafeInteger(targetId) || targetId <= 0) {
        return ctx.reply("فرمت صحیح:\n/synclevel USER_ID")
      }

      const target = getUser(targetId)
      if (!target) return ctx.reply("❌ کاربر پیدا نشد.")

      const xp = Number(target.xp || 0)
      if (!Number.isSafeInteger(xp) || xp < 0) {
        return ctx.reply("❌ XP ذخیره‌شده کاربر معتبر نیست.")
      }

      const oldLevel = Number(target.level || 1)
      const newLevel = calculateLevelFromXP(xp)

      db.prepare(`
        UPDATE users
        SET level = ?,
            updated_at = ?
        WHERE telegram_id = ?
      `).run(newLevel, new Date().toISOString(), targetId)

      return ctx.reply(
        "⟡ همگام‌سازی XP و Level ⟡\n\n" +
        `👤 کاربر: ${target.display_name}\n` +
        `✨ XP: ${xp}\n` +
        `🎖 Level قبلی: ${oldLevel}\n` +
        `🎖 Level هماهنگ‌شده: ${newLevel}` +
        (oldLevel === newLevel
          ? "\n\n✅ اطلاعات از قبل هماهنگ بود."
          : "\n\n✅ Level بر اساس XP اصلاح شد.")
      )
    })

    bot.hears(/^همگام(?:‌|\s)?سازی\s*(?:لول|level)(?:\s*(?:و|&)\s*(?:xp|تجربه))?\s*\|/i, async (ctx) => {
      syncOwner(ctx.from.id)

      const requester = getUser(ctx.from.id)
      if (!isOwner(requester)) {
        return ctx.reply("⛔ فقط مالک اجازه استفاده از این دستور را دارد.")
      }

      const parts = ctx.message.text.split("|").map(x => x.trim())
      const targetId = Number(parts[1])

      if (parts.length !== 2 || !Number.isSafeInteger(targetId) || targetId <= 0) {
        return ctx.reply("فرمت صحیح:\nهمگام‌سازی لول و XP | USER_ID")
      }

      const target = getUser(targetId)
      if (!target) return ctx.reply("❌ کاربر پیدا نشد.")

      const xp = Number(target.xp || 0)
      if (!Number.isSafeInteger(xp) || xp < 0) {
        return ctx.reply("❌ XP ذخیره‌شده کاربر معتبر نیست.")
      }

      const oldLevel = Number(target.level || 1)
      const newLevel = calculateLevelFromXP(xp)

      db.prepare(`
        UPDATE users
        SET level = ?,
            updated_at = ?
        WHERE telegram_id = ?
      `).run(newLevel, new Date().toISOString(), targetId)

      return ctx.reply(
        "⟡ همگام‌سازی XP و Level ⟡\n\n" +
        `👤 کاربر: ${target.display_name}\n` +
        `✨ XP: ${xp}\n` +
        `🎖 Level قبلی: ${oldLevel}\n` +
        `🎖 Level هماهنگ‌شده: ${newLevel}` +
        (oldLevel === newLevel
          ? "\n\n✅ اطلاعات از قبل هماهنگ بود."
          : "\n\n✅ Level بر اساس XP اصلاح شد.")
      )
    })

'''

s = s.replace(marker, commands + marker, 1)

# 3) اصلاح setlevel برای هماهنگ کردن XP
set_start = s.find('bot.command("setlevel", async (ctx) => {')
transfer_start = s.find('bot.command("transferowner"', set_start)

if set_start < 0 or transfer_start < 0:
    print("بخش setlevel یا transferowner پیدا نشد؛ فایل تغییر نکرد.")
    sys.exit(1)

set_block = s[set_start:transfer_start]

old_validation = 'if (!Number.isInteger(level) || level < 1) {'
new_validation = 'if (!Number.isInteger(level) || level < 1 || level > 1001) {'

if old_validation not in set_block:
    print("اعتبارسنجی Level مطابق انتظار نبود؛ فایل تغییر نکرد.")
    sys.exit(1)

set_block = set_block.replace(old_validation, new_validation, 1)

old_update = '''    db.prepare(`
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
'''

new_update = '''    const synchronizedXP = xpRequiredForLevel(level)

    db.prepare(`
      UPDATE users
      SET level = ?,
          xp = ?,
          updated_at = ?
      WHERE telegram_id = ?
    `).run(
      level,
      synchronizedXP,
      new Date().toISOString(),
      targetId
    )

    await ctx.reply(
      `✅ Level کاربر روی ${level} تنظیم شد.\\n` +
      `✨ XP هماهنگ‌شده: ${synchronizedXP}`
    )
'''

if old_update not in set_block:
    print("بخش ذخیره setlevel مطابق انتظار نبود؛ فایل تغییر نکرد.")
    sys.exit(1)

set_block = set_block.replace(old_update, new_update, 1)
s = s[:set_start] + set_block + s[transfer_start:]

# 4) به‌روزرسانی راهنمای پنل‌های مدیریت
old_help = '"/setlevel ID LEVEL",'
new_help = (
    '"/setlevel ID LEVEL",\n'
    '      "/removexp ID AMOUNT",\n'
    '      "/removelevel ID AMOUNT",\n'
    '      "/synclevel ID",'
)

if old_help in s:
    s = s.replace(old_help, new_help)

old_user_help = '`/setlevel ${target.telegram_id} LEVEL`,'
new_user_help = (
    '`/setlevel ${target.telegram_id} LEVEL`,\n'
    '          `/removexp ${target.telegram_id} AMOUNT`,\n'
    '          `/removelevel ${target.telegram_id} AMOUNT`,\n'
    '          `/synclevel ${target.telegram_id}`,'
)

if old_user_help in s:
    s = s.replace(old_user_help, new_user_help, 1)

# ذخیره با بکاپ
backup = Path("src/commands.js.before-level-sync.bak")
shutil.copy2(p, backup)
p.write_text(s, encoding="utf-8")

print("کسر Level، همگام‌سازی و اصلاح setlevel انجام شد.")
print(f"بکاپ: {backup}")
