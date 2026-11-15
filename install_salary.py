from pathlib import Path

p = Path("src/commands.js")
s = p.read_text(encoding="utf-8")

start = "// MONTADORIA DAILY SALARY V1"
end = "// END MONTADORIA DAILY SALARY V1"

if start in s and end in s:
    print("سیستم حقوق روزانه قبلاً نصب شده است.")
    raise SystemExit(0)

if 'bot.hears(/^دریافت حقوق' in s or 'salary_jobs' in s:
    print("کد مشابه سیستم حقوق پیدا شد؛ نصب متوقف شد تا از تداخل جلوگیری شود.")
    raise SystemExit(1)

code = r'''
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
'''

marker = "// MONTADORIA CAR SYSTEM V1"
if marker not in s:
    print("محل درج سیستم خودرو پیدا نشد؛ فایلی تغییر نکرد.")
    raise SystemExit(1)

pos = s.index(marker)
s = s[:pos] + code + "\n\n" + s[pos:]
p.write_text(s, encoding="utf-8")
print("سیستم حقوق روزانه اضافه شد.")
