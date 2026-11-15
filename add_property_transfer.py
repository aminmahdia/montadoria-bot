from pathlib import Path

p = Path("src/commands.js")
s = p.read_text()
tag = "// MONTADORIA PROPERTY TRANSFER V1"
marker = "// END MONTADORIA PROPERTY SYSTEM V1"

if tag in s:
    print("قابلیت انتقال ملک قبلاً اضافه شده است.")
    raise SystemExit(0)

if marker not in s:
    print("بخش سیستم املاک پیدا نشد؛ فایلی تغییر نکرد.")
    raise SystemExit(1)

code = r'''
// MONTADORIA PROPERTY TRANSFER V1
bot.hears(/^انتقال ملک\s*\|/i, async ctx => {
  const a = ctx.message.text.split("|").map(x => x.trim());

  if (a.length < 3 || !a[1] || !/^\d+$/.test(a[2])) {
    return ctx.reply("فرمت دستور:\nانتقال ملک | نام ملک | آیدی عددی گیرنده");
  }

  const propertyName = a[1];
  const recipientId = a[2];
  const senderId = String(ctx.from.id);

  if (recipientId === senderId) {
    return ctx.reply("❌ نمی‌توانی ملک را به خودت منتقل کنی.");
  }

  const recipient = getUser(recipientId);
  if (!recipient) {
    return ctx.reply("❌ گیرنده در ربات ثبت‌نام نکرده است.");
  }

  const transfer = db.transaction(() => {
    const property = db.prepare(`
      SELECT property_id, name, owner_id
      FROM player_properties
      WHERE name = ? COLLATE NOCASE
    `).get(propertyName);

    if (!property) return { error: "ملک پیدا نشد." };

    if (String(property.owner_id) !== senderId) {
      return { error: "این ملک به نام تو نیست." };
    }

    const result = db.prepare(`
      UPDATE player_properties
      SET owner_id = ?
      WHERE property_id = ? AND owner_id = ?
    `).run(recipientId, property.property_id, senderId);

    if (!result.changes) return { error: "انتقال انجام نشد؛ دوباره تلاش کن." };

    return { name: property.name };
  });

  try {
    const result = transfer();
    if (result.error) return ctx.reply("❌ " + result.error);

    await ctx.reply(
      `✅ مالکیت ملک «${result.name}» به کاربر ${recipientId} منتقل شد.`
    );

    try {
      await ctx.api.sendMessage(
        Number(recipientId),
        `🏰 یک ملک به تو منتقل شد.\nنام ملک: ${result.name}`
      );
    } catch (e) {
      console.error("Property transfer notification failed:", e);
    }
  } catch (e) {
    console.error("Property transfer error:", e);
    return ctx.reply("❌ خطا هنگام انتقال ملک.");
  }
});
// END MONTADORIA PROPERTY TRANSFER V1

'''

p.write_text(s.replace(marker, code + "\n" + marker, 1))
print("قابلیت انتقال ملک اضافه شد.")
