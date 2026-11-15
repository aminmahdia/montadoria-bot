from pathlib import Path

p = Path("src/commands.js")
s = p.read_text()
tag = "// MONTADORIA PROPERTY SYSTEM V1"
marker = "// MONTADORIA MULTI-MARKET V3"

if tag in s:
    print("سیستم املاک قبلاً نصب شده است.")
    raise SystemExit(0)

if marker not in s:
    print("محل نصب پیدا نشد؛ هیچ تغییری انجام نشد.")
    raise SystemExit(1)

code = r'''
// MONTADORIA PROPERTY SYSTEM V1
db.exec(`
  CREATE TABLE IF NOT EXISTS player_properties (
    property_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    description TEXT NOT NULL DEFAULT '',
    price INTEGER NOT NULL CHECK(price >= 0),
    owner_id TEXT,
    created_at INTEGER NOT NULL
  )
`);

const propertyNow = () => Math.floor(Date.now() / 1000);
const propertyParts = text => text.split("|").map(x => x.trim());
const propertyIsManager = ctx =>
  String(ctx.from?.id) === String(process.env.OWNER_ID) ||
  ["owner", "moderator"].includes(
    String(getUser(ctx.from.id)?.role || "").toLowerCase()
  );

bot.hears(/^ثبت ملک\s*\|/i, async ctx => {
  if (!propertyIsManager(ctx))
    return ctx.reply("⛔ فقط مالک یا مدیر می‌تواند ملک ثبت کند.");

  const a = propertyParts(ctx.message.text);
  if (a.length < 4 || !a[1] || !/^\d+$/.test(a[2]))
    return ctx.reply("فرمت:\nثبت ملک | نام ملک | قیمت | توضیحات");

  try {
    db.prepare(`
      INSERT INTO player_properties (name, price, description, created_at)
      VALUES (?, ?, ?, ?)
    `).run(a[1], Number(a[2]), a.slice(3).join(" | "), propertyNow());
    return ctx.reply(`✅ ملک «${a[1]}» با قیمت ${Number(a[2]).toLocaleString("en-US")} سکه ثبت شد.`);
  } catch (e) {
    if (String(e.message).includes("UNIQUE"))
      return ctx.reply("این ملک قبلاً ثبت شده است.");
    console.error(e);
    return ctx.reply("❌ ثبت ملک انجام نشد.");
  }
});

bot.hears(/^املاک$/i, async ctx => {
  const rows = db.prepare(`
    SELECT name, description, price, owner_id
    FROM player_properties ORDER BY property_id DESC LIMIT 50
  `).all();
  if (!rows.length) return ctx.reply("🏘️ هنوز ملکی ثبت نشده است.");
  return ctx.reply("🏘️ املاک مونتادوریا\n\n" + rows.map(x =>
    `🏠 ${x.name}\n💰 ${Number(x.price).toLocaleString("en-US")} سکه\n📌 ${x.owner_id ? "فروخته‌شده" : "قابل خرید"}${x.description ? "\n📝 " + x.description : ""}`
  ).join("\n\n"));
});

bot.hears(/^املاک من$/i, async ctx => {
  const rows = db.prepare(`
    SELECT name, description, price FROM player_properties
    WHERE owner_id = ? ORDER BY property_id DESC
  `).all(String(ctx.from.id));
  if (!rows.length) return ctx.reply("🏠 ملکی به نام تو ثبت نشده است.");
  return ctx.reply("🏰 املاک تو:\n\n" + rows.map(x =>
    `🏠 ${x.name}\n💰 ${Number(x.price).toLocaleString("en-US")} سکه${x.description ? "\n📝 " + x.description : ""}`
  ).join("\n\n"));
});

bot.hears(/^خرید ملک\s*\|/i, async ctx => {
  const a = propertyParts(ctx.message.text);
  if (!a[1]) return ctx.reply("فرمت:\nخرید ملک | نام ملک");

  const user = getUser(ctx.from.id);
  if (!user) return ctx.reply("ابتدا /start را برای ربات بفرست.");

  try {
    const purchase = db.transaction(() => {
      const prop = db.prepare(
        "SELECT * FROM player_properties WHERE name = ? COLLATE NOCASE"
      ).get(a[1]);
      if (!prop) return { error: "ملک پیدا نشد." };
      if (prop.owner_id) return { error: "این ملک قبلاً فروخته شده است." };

      if (!user.infinite_money) {
        const debit = db.prepare(`
          UPDATE users SET money = money - ?
          WHERE telegram_id = ? AND money >= ?
        `).run(prop.price, String(ctx.from.id), prop.price);
        if (!debit.changes) return { error: "موجودی نقدی کافی نیست." };
      }

      const changed = db.prepare(`
        UPDATE player_properties SET owner_id = ?
        WHERE property_id = ? AND owner_id IS NULL
      `).run(String(ctx.from.id), prop.property_id);
      if (!changed.changes) throw new Error("PROPERTY_RACE");
      return { prop };
    });

    const result = purchase();
    if (result.error) return ctx.reply("❌ " + result.error);
    return ctx.reply(`✅ ملک «${result.prop.name}» به نام تو ثبت شد.\n💰 قیمت: ${Number(result.prop.price).toLocaleString("en-US")} سکه`);
  } catch (e) {
    console.error("Property purchase error:", e);
    return ctx.reply("❌ خرید انجام نشد.");
  }
});

bot.hears(/^فروش ملک\s*\|/i, async ctx => {
  const a = propertyParts(ctx.message.text);
  if (!a[1]) return ctx.reply("فرمت:\nفروش ملک | نام ملک");

  const prop = db.prepare(
    "SELECT * FROM player_properties WHERE name = ? COLLATE NOCASE"
  ).get(a[1]);
  if (!prop) return ctx.reply("❌ ملک پیدا نشد.");
  if (String(prop.owner_id) !== String(ctx.from.id))
    return ctx.reply("⛔ این ملک به نام تو نیست.");

  const sale = db.transaction(() => {
    const result = db.prepare(`
      UPDATE player_properties SET owner_id = NULL
      WHERE property_id = ? AND owner_id = ?
    `).run(prop.property_id, String(ctx.from.id));
    if (!result.changes) return false;
    db.prepare("UPDATE users SET money = money + ? WHERE telegram_id = ?")
      .run(prop.price, String(ctx.from.id));
    return true;
  });

  if (!sale()) return ctx.reply("❌ فروش انجام نشد.");
  return ctx.reply(`✅ ملک «${prop.name}» فروخته شد.\n💰 دریافتی: ${Number(prop.price).toLocaleString("en-US")} سکه`);
});
// END MONTADORIA PROPERTY SYSTEM V1

'''

p.write_text(s.replace(marker, code + "\n" + marker, 1))
print("سیستم املاک اضافه شد.")
