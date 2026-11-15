from pathlib import Path

p = Path("src/commands.js")
s = p.read_text(encoding="utf-8")

start = "// MONTADORIA CAR SYSTEM V1"
end = "// END MONTADORIA CAR SYSTEM V1"

if start in s and end in s:
    print("سیستم خودرو قبلاً نصب شده است.")
    raise SystemExit(0)

if "MONTADORIA PROPERTY SYSTEM V1" not in s:
    print("بخش املاک پیدا نشد؛ فایلی تغییر نکرد.")
    raise SystemExit(1)

if "const carNow =" in s or "player_cars" in s:
    print("کدهای مشابه سیستم خودرو از قبل وجود دارند؛ نصب متوقف شد.")
    raise SystemExit(1)

code = r'''
// MONTADORIA CAR SYSTEM V1
db.exec(`
  CREATE TABLE IF NOT EXISTS car_catalog (
    car_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    description TEXT NOT NULL DEFAULT '',
    price INTEGER NOT NULL CHECK(price >= 0),
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS player_cars (
    car_id INTEGER PRIMARY KEY,
    owner_id TEXT,
    purchased_at INTEGER,
    FOREIGN KEY(car_id) REFERENCES car_catalog(car_id)
  );
`);

const carNow = () => Math.floor(Date.now() / 1000);
const carParts = (ctx) => String(ctx.message?.text || "").trim().split(/\s*\|\s*/);
const carIsManager = (u) => ["owner", "moderator"].includes(String(u?.role || "").toLowerCase());

bot.hears(/^ثبت خودرو\s*\|/i, async (ctx) => {
  const a = carParts(ctx);
  const u = getUser(ctx.from.id);
  if (!carIsManager(u)) return ctx.reply("⛔ فقط مدیر یا مالک می‌تواند خودرو ثبت کند.");
  if (a.length < 4 || !a[1] || !/^\d+$/.test(a[2])) {
    return ctx.reply("فرمت صحیح:\nثبت خودرو | نام خودرو | قیمت | توضیحات");
  }
  const price = Number(a[2]);
  if (!Number.isSafeInteger(price) || price < 0) return ctx.reply("قیمت معتبر نیست.");
  try {
    const result = db.prepare(`
      INSERT INTO car_catalog (name, description, price, created_at)
      VALUES (?, ?, ?, ?)
    `).run(a[1], a.slice(3).join(" | "), price, carNow());
    db.prepare("INSERT INTO player_cars (car_id) VALUES (?)").run(Number(result.lastInsertRowid));
    return ctx.reply("✅ خودرو به فهرست فروش اضافه شد.");
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) return ctx.reply("این خودرو قبلاً ثبت شده است.");
    console.error("ثبت خودرو:", e);
    return ctx.reply("ثبت خودرو انجام نشد.");
  }
});

bot.hears(/^خودروها$/i, async (ctx) => {
  const rows = db.prepare(`
    SELECT c.name, c.description, c.price
    FROM car_catalog c
    JOIN player_cars p ON p.car_id = c.car_id
    WHERE p.owner_id IS NULL
    ORDER BY c.car_id DESC LIMIT 50
  `).all();
  if (!rows.length) return ctx.reply("🚘 فعلاً خودرویی برای خرید موجود نیست.");
  return ctx.reply("🚘 فهرست خودروهای قابل خرید:\n\n" + rows.map((r, i) =>
    `${i + 1}. ${r.name}\n💰 قیمت: ${r.price}\n${r.description || ""}`
  ).join("\n\n"));
});

bot.hears(/^خرید خودرو\s*\|/i, async (ctx) => {
  const a = carParts(ctx);
  if (a.length < 2 || !a[1]) return ctx.reply("فرمت صحیح:\nخرید خودرو | نام خودرو");
  const userId = String(ctx.from.id);
  const transaction = db.transaction(() => {
    const u = getUser(ctx.from.id);
    if (!u) return { error: "ابتدا با ربات شروع کنید." };
    const car = db.prepare(`
      SELECT c.*, p.owner_id FROM car_catalog c
      JOIN player_cars p ON p.car_id = c.car_id
      WHERE c.name = ? COLLATE NOCASE
    `).get(a[1]);
    if (!car) return { error: "خودرو پیدا نشد." };
    if (car.owner_id !== null && car.owner_id !== undefined) return { error: "این خودرو قبلاً فروخته شده است." };
    if (!u.infinite_money && Number(u.money || 0) < car.price) return { error: "موجودی پولت کافی نیست." };
    if (!u.infinite_money) {
      const debit = db.prepare(`
        UPDATE users SET money = money - ? WHERE telegram_id = ? AND money >= ?
      `).run(car.price, userId, car.price);
      if (!debit.changes) return { error: "موجودی پولت کافی نیست." };
    }
    const assign = db.prepare(`
      UPDATE player_cars SET owner_id = ?, purchased_at = ?
      WHERE car_id = ? AND owner_id IS NULL
    `).run(userId, carNow(), car.car_id);
    if (!assign.changes) throw new Error("CAR_ALREADY_SOLD");
    return { name: car.name, price: car.price };
  });
  try {
    const result = transaction();
    if (result.error) return ctx.reply("❌ " + result.error);
    return ctx.reply(`✅ خودرو «${result.name}» با قیمت ${result.price} خریداری شد.`);
  } catch (e) {
    if (String(e.message).includes("CAR_ALREADY_SOLD")) return ctx.reply("این خودرو قبلاً فروخته شده است.");
    console.error("خرید خودرو:", e);
    return ctx.reply("خرید خودرو انجام نشد.");
  }
});

bot.hears(/^خودروهای من$/i, async (ctx) => {
  const rows = db.prepare(`
    SELECT c.name, c.description, c.price
    FROM player_cars p JOIN car_catalog c ON c.car_id = p.car_id
    WHERE p.owner_id = ? ORDER BY c.name
  `).all(String(ctx.from.id));
  if (!rows.length) return ctx.reply("🚘 خودرویی به نام تو ثبت نشده است.");
  return ctx.reply("🚘 خودروهای تو:\n\n" + rows.map((r, i) =>
    `${i + 1}. ${r.name}\n💰 قیمت ثبت‌شده: ${r.price}\n${r.description || ""}`
  ).join("\n\n"));
});

bot.hears(/^فروش خودرو\s*\|/i, async (ctx) => {
  const a = carParts(ctx);
  if (a.length < 2 || !a[1]) return ctx.reply("فرمت صحیح:\nفروش خودرو | نام خودرو");
  const userId = String(ctx.from.id);
  const transaction = db.transaction(() => {
    const car = db.prepare(`
      SELECT c.car_id, c.name, c.price FROM car_catalog c
      JOIN player_cars p ON p.car_id = c.car_id
      WHERE c.name = ? COLLATE NOCASE AND p.owner_id = ?
    `).get(a[1], userId);
    if (!car) return { error: "این خودرو متعلق به تو نیست." };
    const payout = Math.floor(car.price * 0.7);
    const sold = db.prepare(`
      UPDATE player_cars SET owner_id = NULL, purchased_at = NULL
      WHERE car_id = ? AND owner_id = ?
    `).run(car.car_id, userId);
    if (!sold.changes) return { error: "فروش خودرو انجام نشد." };
    db.prepare("UPDATE users SET money = money + ? WHERE telegram_id = ?").run(payout, userId);
    return { name: car.name, payout };
  });
  try {
    const result = transaction();
    if (result.error) return ctx.reply("❌ " + result.error);
    return ctx.reply(`✅ خودرو «${result.name}» فروخته شد.\n💰 مبلغ دریافتی: ${result.payout}`);
  } catch (e) {
    console.error("فروش خودرو:", e);
    return ctx.reply("فروش خودرو انجام نشد.");
  }
});

bot.hears(/^انتقال خودرو\s*\|/i, async (ctx) => {
  const a = carParts(ctx);
  if (a.length < 3 || !a[1] || !/^\d+$/.test(a[2])) {
    return ctx.reply("فرمت صحیح:\nانتقال خودرو | نام خودرو | آیدی عددی گیرنده");
  }
  const senderId = String(ctx.from.id);
  const recipientId = String(a[2]);
  if (senderId === recipientId) return ctx.reply("نمی‌توانی خودرو را به خودت منتقل کنی.");
  if (!getUser(Number(recipientId))) return ctx.reply("گیرنده باید ابتدا ربات را شروع کرده باشد.");
  const result = db.prepare(`
    UPDATE player_cars SET owner_id = ?, purchased_at = ?
    WHERE car_id = (
      SELECT c.car_id FROM car_catalog c
      JOIN player_cars p ON p.car_id = c.car_id
      WHERE c.name = ? COLLATE NOCASE AND p.owner_id = ?
    ) AND owner_id = ?
  `).run(recipientId, carNow(), a[1], senderId, senderId);
  if (!result.changes) return ctx.reply("خودرو پیدا نشد یا مالک آن نیستی.");
  await ctx.reply(`✅ خودرو «${a[1]}» به آیدی ${recipientId} منتقل شد.`);
  try {
    await bot.api.sendMessage(Number(recipientId), `🚘 خودروی «${a[1]}» به تو منتقل شد.`);
  } catch {}
});
// END MONTADORIA CAR SYSTEM V1
'''

marker = "// MONTADORIA PROPERTY SYSTEM V1"
pos = s.index(marker)
s = s[:pos] + code + "\n\n" + s[pos:]
p.write_text(s, encoding="utf-8")
print("سیستم خودرو اضافه شد.")
