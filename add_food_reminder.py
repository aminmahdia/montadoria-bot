from pathlib import Path

p = Path("src/observer.js")
s = p.read_text()
marker = "  const vampireReminderTimer = setInterval(() => {"
tag = "MONTADORIA_FOOD_REMINDER_V1"

if tag in s:
    print("هشدار گرسنگی از قبل اضافه شده است.")
    raise SystemExit(0)

if marker not in s:
    print("خطا: محل درج پیدا نشد؛ فایل تغییر نکرد.")
    raise SystemExit(1)

code = '''
  // MONTADORIA_FOOD_REMINDER_V1
  try {
    db.exec("ALTER TABLE observer_needs ADD COLUMN last_food_warning_at INTEGER");
  } catch (e) {
    if (!String(e.message).includes("duplicate column")) throw e;
  }

  const checkFoodReminders = async () => {
    const t = now();
    const people = db.prepare(`
      SELECT telegram_id, last_food_at
      FROM observer_needs
      WHERE last_food_at > 0
        AND ? - last_food_at >= 28800
        AND (last_food_warning_at IS NULL OR last_food_warning_at < last_food_at)
    `).all(t);

    for (const person of people) {
      try {
        await bot.api.sendMessage(
          Number(person.telegram_id),
          "🍽️ یادآوری مونتادوریا\\n\\nمدت زیادی از آخرین غذایت گذشته است. پس از ورود به مپ با #ورود، برای ثبت غذا از #خوردن استفاده کن."
        );
        db.prepare(`
          UPDATE observer_needs
          SET last_food_warning_at = ?, updated_at = ?
          WHERE telegram_id = ?
        `).run(t, t, person.telegram_id);

        await report(bot.api, `🍽️ هشدار گرسنگی ارسال شد | شناسه: ${person.telegram_id}`);
      } catch (e) {
        console.error("خطا در هشدار گرسنگی:", e);
      }
    }
  };

  const foodReminderTimer = setInterval(() => {
    checkFoodReminders().catch(console.error);
  }, 60000);
  foodReminderTimer.unref?.();
  checkFoodReminders().catch(console.error);
  // END MONTADORIA_FOOD_REMINDER_V1

'''

p.write_text(s.replace(marker, code + marker, 1))
print("هشدار گرسنگی اضافه شد.")
