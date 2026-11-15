from pathlib import Path
import subprocess
import sys

p = Path("src/observer.js")
s = p.read_text(encoding="utf-8")

marker = "  // MONTADORIA_NEEDS_REMINDER_V2"

old = r'''        await warnForNeed(person, "food", foodAt, 8 * 3600,
          "🍽️ یادآوری غذا\nزمان ثبت غذای شخصیتت رسیده است. در گروه مپ از هشتگ #خوردن استفاده کن.",
          "last_food_warning_at");
        await warnForNeed(person, "sleep", sleepAt, 24 * 3600,
          "🌙 یادآوری خواب\nزمان ثبت خواب شخصیتت رسیده است. در گروه مپ از هشتگ #خواب استفاده کن.",
          "last_sleep_warning_at");'''

new = r'''        const needsExempt = db.prepare(
          "SELECT 1 FROM observer_food_sleep_exemptions WHERE telegram_id = ?"
        ).get(person.telegram_id);

        if (!needsExempt) {
          await warnForNeed(person, "food", foodAt, 8 * 3600,
            "🍽️ یادآوری غذا\nزمان ثبت غذای شخصیتت رسیده است. در گروه مپ از هشتگ #خوردن استفاده کن.",
            "last_food_warning_at");
          await warnForNeed(person, "sleep", sleepAt, 24 * 3600,
            "🌙 یادآوری خواب\nزمان ثبت خواب شخصیتت رسیده است. در گروه مپ از هشتگ #خواب استفاده کن.",
            "last_sleep_warning_at");
        }'''

if old not in s:
    print("❌ بخش دقیق یادآوری غذا و خواب پیدا نشد؛ فایل تغییر نکرد.")
    sys.exit(1)

if marker not in s:
    print("❌ محل ثبت قابلیت پیدا نشد؛ فایل تغییر نکرد.")
    sys.exit(1)

if "observer_food_sleep_exemptions" in s:
    print("❌ کد معافیت قبلاً وجود دارد؛ از درج تکراری جلوگیری شد.")
    sys.exit(1)

handlers = r'''
  db.exec(`
    CREATE TABLE IF NOT EXISTS observer_food_sleep_exemptions (
      telegram_id INTEGER PRIMARY KEY,
      exempted_by INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  bot.hears(/^#معاف_از_غذا_و_خواب +([0-9]+)$/u, async ctx => {
    if (!isOwner(ctx)) return;
    const targetId = Number(ctx.match[1]);

    db.prepare(`
      INSERT INTO observer_food_sleep_exemptions
        (telegram_id, exempted_by, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        exempted_by = excluded.exempted_by,
        created_at = excluded.created_at
    `).run(targetId, ctx.from.id, now());

    audit(ctx.from.id, "food_sleep_exemption_added", String(targetId));
    return ctx.reply("✅ معافیت دائمی غذا و خواب ثبت شد.");
  });

  bot.hears(/^#لغو_معافیت_غذا_و_خواب +([0-9]+)$/u, async ctx => {
    if (!isOwner(ctx)) return;
    const targetId = Number(ctx.match[1]);

    const result = db.prepare(
      "DELETE FROM observer_food_sleep_exemptions WHERE telegram_id = ?"
    ).run(targetId);

    audit(ctx.from.id, "food_sleep_exemption_removed", String(targetId));
    return ctx.reply(
      result.changes
        ? "✅ معافیت غذا و خواب لغو شد."
        : "این کاربر معافیت غذا و خواب نداشت."
    );
  });

'''

backup = Path("src/observer.js.before_food_sleep_exemption")
if not backup.exists():
    backup.write_text(s, encoding="utf-8")

s = s.replace(old, new, 1)
s = s.replace(marker, handlers + marker, 1)
p.write_text(s, encoding="utf-8")

check = subprocess.run(["node", "--check", str(p)])
if check.returncode != 0:
    p.write_text(backup.read_text(encoding="utf-8"), encoding="utf-8")
    print("❌ بررسی ناموفق؛ فایل به نسخه پشتیبان برگشت.")
    sys.exit(1)

print("✅ معافیت غذا و خواب اضافه شد.")
print("✅ بررسی JavaScript بدون خطا بود.")
print("✅ سیستم خون‌آشام‌ها تغییر نکرد.")
