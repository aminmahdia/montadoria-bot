from pathlib import Path
import shutil
import re
import subprocess

p = Path("src/observer.js")
s = p.read_text(encoding="utf-8")

if "MONTADORIA_FOOD_EXEMPTION_V1" in s:
    raise SystemExit("قابلیت قبلاً اضافه شده است.")

marker = "  // MONTADORIA_NEEDS_REMINDER_V2"
if marker not in s:
    raise SystemExit("محل سیستم نیازها پیدا نشد.")

pattern = re.compile(
    r'(?m)^(\s*)await warnForNeed\(person, "food", foodAt, 8 \* 3600,'
    r'.*?^\s*"last_food_warning_at"\);',
    re.S
)

match = pattern.search(s)
if not match:
    raise SystemExit("فراخوانی یادآوری غذا پیدا نشد؛ فایل تغییر نکرد.")

handlers = '''
  // MONTADORIA_FOOD_EXEMPTION_V1
  db.exec(`
    CREATE TABLE IF NOT EXISTS observer_food_exemptions (
      telegram_id INTEGER PRIMARY KEY,
      exempted_by INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  bot.hears(/^#معاف_از_غذا\\\\s+(\\\\d+)$/u, async ctx => {
    if (!isOwner(ctx)) return ctx.reply("⛔ فقط مالک ربات اجازه دارد.");
    const targetId = Number(ctx.match[1]);
    const target = db.prepare(
      "SELECT telegram_id FROM users WHERE telegram_id = ?"
    ).get(targetId);

    if (!target) return ctx.reply("⛔ کاربر در دیتابیس پیدا نشد.");

    db.prepare(`
      INSERT INTO observer_food_exemptions
        (telegram_id, exempted_by, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        exempted_by = excluded.exempted_by,
        created_at = excluded.created_at
    `).run(targetId, ctx.from.id, now());

    audit(ctx.from.id, "food_exemption_added", `telegram_id=${targetId}`);
    await report(ctx, `🍽️ معافیت غذای اجباری ثبت شد | شناسه کاربر: ${targetId}`);
    return ctx.reply(`✅ کاربر ${targetId} از غذای اجباری معاف شد.`);
  });

  bot.hears(/^#لغو_معافیت_غذا\\\\s+(\\\\d+)$/u, async ctx => {
    if (!isOwner(ctx)) return ctx.reply("⛔ فقط مالک ربات اجازه دارد.");
    const targetId = Number(ctx.match[1]);

    const result = db.prepare(
      "DELETE FROM observer_food_exemptions WHERE telegram_id = ?"
    ).run(targetId);

    if (!result.changes) return ctx.reply("این کاربر معافیت فعال غذا ندارد.");

    audit(ctx.from.id, "food_exemption_removed", `telegram_id=${targetId}`);
    await report(ctx, `🍽️ معافیت غذای اجباری لغو شد | شناسه کاربر: ${targetId}`);
    return ctx.reply(`✅ معافیت غذای کاربر ${targetId} لغو شد.`);
  });
  // END MONTADORIA_FOOD_EXEMPTION_V1

'''

food_call = match.group(0)
indent = match.group(1)
wrapped = (
    indent + 'const foodExempt = db.prepare('
    + '"SELECT 1 FROM observer_food_exemptions WHERE telegram_id = ?"'
    + ').get(person.telegram_id);\n'
    + indent + 'if (!foodExempt) {\n'
    + ''.join(indent + '  ' + line if line.strip() else line
              for line in food_call.splitlines(keepends=True))
    + indent + '}\n'
)

new = s.replace(marker, handlers + marker, 1)
new = new[:match.start()] + wrapped + new[match.end():]

backup = Path("src/observer.js.before_food_exemption_v2")
if backup.exists():
    raise SystemExit("نسخه پشتیبان v2 از قبل وجود دارد؛ فایل تغییر نکرد.")
shutil.copy2(p, backup)
p.write_text(new, encoding="utf-8")

check = subprocess.run(["node", "--check", str(p)])
if check.returncode:
    shutil.copy2(backup, p)
    raise SystemExit("بررسی جاوااسکریپت ناموفق بود؛ فایل به نسخه پشتیبان برگشت.")

print("✅ دستور معافیت غذا اضافه شد.")
print("✅ دستور لغو معافیت اضافه شد.")
print("✅ یادآوری و جریمه غذای افراد معاف متوقف شد.")
print("✅ قوانین خواب و خون بدون تغییر ماند.")
print("✅ بررسی نحوی موفق بود.")
