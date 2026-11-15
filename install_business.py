from pathlib import Path

p = Path("src/commands.js")
s = p.read_text(encoding="utf-8")

START = "// MONTADORIA BUSINESS SYSTEM V1"
END = "// END MONTADORIA BUSINESS SYSTEM V1"
MARKER = "// MONTADORIA DAILY SALARY V1"

if START in s and END in s:
    print("سیستم کسب‌وکار قبلاً نصب شده است.")
    raise SystemExit(0)

if START in s and END not in s:
    pos = s.index(START)
    marker_pos = s.find(MARKER, pos)
    if marker_pos == -1:
        print("بخش ناقص احتمالی پیدا شد، اما محل پایان مشخص نیست؛ فایلی تغییر نکرد.")
        raise SystemExit(1)
    s = s[:pos] + s[marker_pos:]

if "player_businesses" in s or "business_catalog" in s:
    print("کد مشابه سیستم کسب‌وکار پیدا شد؛ نصب متوقف شد تا از تداخل جلوگیری شود.")
    raise SystemExit(1)

if MARKER not in s:
    print("محل مناسب نصب پیدا نشد؛ فایلی تغییر نکرد.")
    raise SystemExit(1)

code = r'''
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
'''

pos = s.index(MARKER)
s = s[:pos] + code + "\n\n" + s[pos:]
p.write_text(s, encoding="utf-8")
print("سیستم کسب‌وکار با موفقیت به commands.js اضافه شد.")
