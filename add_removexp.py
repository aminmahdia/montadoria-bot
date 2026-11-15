from pathlib import Path
import shutil
import sys

p = Path("src/commands.js")
s = p.read_text(encoding="utf-8")

if 'bot.command("removexp"' in s:
    print("دستور قبلاً اضافه شده؛ تغییری انجام نشد.")
    sys.exit(0)

marker = '    bot.command("setlevel", async (ctx) => {'
pos = s.find(marker)
helper_pos = s.find("function addXP(telegramId, amount) {")

if pos < 0 or helper_pos < 0:
    print("محل درج پیدا نشد؛ فایل اصلی تغییر نکرد.")
    sys.exit(1)

helper_end = s.find("\nfunction ", helper_pos + 1)
if helper_end < 0:
    helper_end = s.find("\nconst ", helper_pos + 1)

if helper_end < 0:
    print("انتهای تابع addXP پیدا نشد؛ فایل اصلی تغییر نکرد.")
    sys.exit(1)

helper = '''
function removeXP(telegramId, amount) {
  const user = getUser(telegramId)
  if (!user) return null

  const xpAmount = Number(amount)
  if (!Number.isSafeInteger(xpAmount) || xpAmount <= 0) return null

  const oldXP = Number(user.xp || 0)
  const newXP = Math.max(0, oldXP - xpAmount)
  const newLevel = calculateLevelFromXP(newXP)

  db.prepare(`
    UPDATE users
    SET xp = ?, level = ?, updated_at = ?
    WHERE telegram_id = ?
  `).run(newXP, newLevel, new Date().toISOString(), telegramId)

  return {
    oldXP,
    newXP,
    oldLevel: Number(user.level || 0),
    newLevel,
    removedXP: oldXP - newXP,
    levelDown: newLevel < Number(user.level || 0)
  }
}

'''

command = '''
    bot.command("removexp", async (ctx) => {
      syncOwner(ctx.from.id)
      if (String(ctx.from.id) !== String(OWNER_ID)) {
        return ctx.reply("⛔ فقط مالک ربات اجازه استفاده دارد.")
      }

      const parts = ctx.message.text.trim().split(/\\\\s+/)
      const id = Number(parts[1])
      const amount = Number(parts[2])

      if (!Number.isSafeInteger(id) || id <= 0 ||
          !Number.isSafeInteger(amount) || amount <= 0) {
        return ctx.reply("فرمت صحیح:\\n/removexp USER_ID AMOUNT")
      }

      if (!getUser(id)) return ctx.reply("❌ کاربر پیدا نشد.")

      const r = removeXP(id, amount)
      if (!r) return ctx.reply("❌ عملیات انجام نشد.")

      return ctx.reply(
        "⟡ کسر تجربه انجام شد ⟡\\n\\n" +
        `XP قبلی: ${r.oldXP}\\n` +
        `XP کسرشده: ${r.removedXP}\\n` +
        `XP جدید: ${r.newXP}\\n` +
        `Level قبلی: ${r.oldLevel}\\n` +
        `Level جدید: ${r.newLevel}` +
        (r.levelDown ? "\\n⚠️ Level کاهش یافت." : "") +
        (r.removedXP < amount ? "\\nℹ️ موجودی XP تا صفر کاهش یافت." : "")
      )
    })

    bot.hears(/^کسر تجربه\\s*\\|/i, async (ctx) => {
      syncOwner(ctx.from.id)
      if (String(ctx.from.id) !== String(OWNER_ID)) {
        return ctx.reply("⛔ فقط مالک ربات اجازه استفاده دارد.")
      }

      const parts = ctx.message.text.split("|").map(x => x.trim())
      const id = Number(parts[1])
      const amount = Number(parts[2])

      if (parts.length !== 3 || !Number.isSafeInteger(id) || id <= 0 ||
          !Number.isSafeInteger(amount) || amount <= 0) {
        return ctx.reply("فرمت صحیح:\\nکسر تجربه | USER_ID | AMOUNT")
      }

      if (!getUser(id)) return ctx.reply("❌ کاربر پیدا نشد.")

      const r = removeXP(id, amount)
      if (!r) return ctx.reply("❌ عملیات انجام نشد.")

      return ctx.reply(
        "⟡ کسر تجربه انجام شد ⟡\\n\\n" +
        `XP قبلی: ${r.oldXP}\\n` +
        `XP کسرشده: ${r.removedXP}\\n` +
        `XP جدید: ${r.newXP}\\n` +
        `Level قبلی: ${r.oldLevel}\\n` +
        `Level جدید: ${r.newLevel}` +
        (r.levelDown ? "\\n⚠️ Level کاهش یافت." : "") +
        (r.removedXP < amount ? "\\nℹ️ موجودی XP تا صفر کاهش یافت." : "")
      )
    })

'''

new_s = s[:helper_end] + helper + s[helper_end:]
pos = new_s.find(marker)
new_s = new_s[:pos] + command + new_s[pos:]

shutil.copy2(p, "src/commands.js.before-removexp.bak")
p.write_text(new_s, encoding="utf-8")
print("دستور کسر XP اضافه شد و بکاپ ساخته شد.")
