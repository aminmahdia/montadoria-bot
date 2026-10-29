const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const file = path.join(process.cwd(), "src/commands.js");
const marker = "// MONTADORIA_UNIVERSAL_ASSET_PRICE_ADMIN_V1";
const anchor = "  // مشاهده کیف";

if (!fs.existsSync(file)) {
  console.error("خطا: فایل src/commands.js پیدا نشد.");
  process.exit(1);
}

let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  console.log("این قابلیت قبلاً نصب شده است؛ تغییری انجام نشد.");
  process.exit(0);
}

if (!source.includes("rtCanRegisterAsset")) {
  console.error("خطا: سامانه دسترسی ثبت دارایی در فایل پیدا نشد.");
  process.exit(1);
}

if (source.split(anchor).length !== 2) {
  console.error("خطا: محل درج کد دقیقاً یک بار پیدا نشد؛ فایل تغییر نکرد.");
  process.exit(1);
}

const required = [
  "CREATE TABLE IF NOT EXISTS car_catalog",
  "CREATE TABLE IF NOT EXISTS player_properties",
  "CREATE TABLE IF NOT EXISTS business_catalog",
  "CREATE TABLE IF NOT EXISTS shop_catalog",
  "buy_price",
  "sell_price",
];

for (const item of required) {
  if (!source.includes(item)) {
    console.error("خطا: ساختار موردنیاز پیدا نشد: " + item);
    process.exit(1);
  }
}

const block = String.raw`  ${marker}
  bot.hears(/^(?:فهرست قیمت‌ها|فهرست قیمت ها)$/u, async ctx => {
    if (!rtCanRegisterAsset(ctx)) {
      return ctx.reply("⛔ دسترسی مدیریت قیمت‌ها را نداری.");
    }

    try {
      const cars = db.prepare(
        "SELECT name, price FROM car_catalog ORDER BY name LIMIT 20"
      ).all();

      const properties = db.prepare(
        "SELECT name, price FROM player_properties ORDER BY name LIMIT 20"
      ).all();

      const businesses = db.prepare(
        "SELECT name, price, daily_income FROM business_catalog ORDER BY name LIMIT 20"
      ).all();

      const items = db.prepare(
        "SELECT item_code, name, buy_price, sell_price FROM shop_catalog ORDER BY name LIMIT 30"
      ).all();

      const sections = [
        "🚗 خودروها",
        cars.length ? cars.map(x => "• " + x.name + " | " + x.price).join("\n") : "موردی ثبت نشده",
        "",
        "🏠 املاک",
        properties.length ? properties.map(x => "• " + x.name + " | " + x.price).join("\n") : "موردی ثبت نشده",
        "",
        "🏢 کسب‌وکارها",
        businesses.length ? businesses.map(x => "• " + x.name + " | قیمت: " + x.price + " | درآمد روزانه: " + x.daily_income).join("\n") : "موردی ثبت نشده",
        "",
        "🛒 کالاها (کد کالا برای تغییر قیمت لازم است)",
        items.length ? items.map(x => "• " + x.item_code + " | " + x.name + " | خرید: " + x.buy_price + " | فروش: " + x.sell_price).join("\n") : "موردی ثبت نشده"
      ];

      let output = sections.join("\n");
      if (output.length > 3900) {
        output = output.slice(0, 3850) + "\n\n… فهرست برای محدودیت پیام کوتاه شد.";
      }
      return ctx.reply(output);
    } catch (e) {
      console.error("فهرست قیمت‌ها:", e);
      return ctx.reply("❌ دریافت فهرست قیمت‌ها انجام نشد.");
    }
  });

  bot.hears(/^تنظیم قیمت\s*\|/u, async ctx => {
    if (!rtCanRegisterAsset(ctx)) {
      return ctx.reply("⛔ دسترسی مدیریت قیمت‌ها را نداری.");
    }

    const parts = String(ctx.message?.text || "")
      .split("|")
      .map(x => x.trim());

    const type = (parts[1] || "").replace(/‌/g, "").toLowerCase();

    const digits = value => String(value || "")
      .replace(/[۰-۹٠-٩]/g, c => ({
        "۰":"0","۱":"1","۲":"2","۳":"3","۴":"4",
        "۵":"5","۶":"6","۷":"7","۸":"8","۹":"9",
        "٠":"0","١":"1","٢":"2","٣":"3","٤":"4",
        "٥":"5","٦":"6","٧":"7","٨":"8","٩":"9"
      })[c])
      .replace(/[٬,]/g, "");

    const number = value => {
      const raw = digits(value);
      if (!/^\d+$/.test(raw)) return null;
      const n = Number(raw);
      return Number.isSafeInteger(n) ? n : null;
    };

    try {
      let result;
      let label;

      if (["خودرو", "ماشین"].includes(type)) {
        if (parts.length !== 4 || !parts[2]) {
          return ctx.reply("فرمت:\nتنظیم قیمت | خودرو | نام خودرو | قیمت");
        }
        const price = number(parts[3]);
        if (price === null) return ctx.reply("❌ قیمت باید عدد صحیح و غیرمنفی باشد.");
        result = db.prepare(
          "UPDATE car_catalog SET price = ? WHERE name = ? COLLATE NOCASE"
        ).run(price, parts[2]);
        label = "خودرو";
      } else if (type === "ملک") {
        if (parts.length !== 4 || !parts[2]) {
          return ctx.reply("فرمت:\nتنظیم قیمت | ملک | نام ملک | قیمت");
        }
        const price = number(parts[3]);
        if (price === null) return ctx.reply("❌ قیمت باید عدد صحیح و غیرمنفی باشد.");
        result = db.prepare(
          "UPDATE player_properties SET price = ? WHERE name = ? COLLATE NOCASE"
        ).run(price, parts[2]);
        label = "ملک";
      } else if (["کسبوکار", "کسب و کار"].includes(type)) {
        if (parts.length !== 4 || !parts[2]) {
          return ctx.reply("فرمت:\nتنظیم قیمت | کسب‌وکار | نام کسب‌وکار | قیمت");
        }
        const price = number(parts[3]);
        if (price === null) return ctx.reply("❌ قیمت باید عدد صحیح و غیرمنفی باشد.");
        result = db.prepare(
          "UPDATE business_catalog SET price = ? WHERE name = ? COLLATE NOCASE"
        ).run(price, parts[2]);
        label = "کسب‌وکار";
      } else if (["کالا", "فروشگاه"].includes(type)) {
        if (parts.length !== 5 || !parts[2]) {
          return ctx.reply(
            "فرمت:\nتنظیم قیمت | کالا | کد کالا | قیمت خرید | قیمت فروش\n" +
            "کد کالا را از «فهرست قیمت‌ها» بردار."
          );
        }
        const buy = number(parts[3]);
        const sell = number(parts[4]);
        if (buy === null || sell === null) {
          return ctx.reply("❌ قیمت خرید و فروش باید عدد صحیح و غیرمنفی باشند.");
        }
        result = db.prepare(
          "UPDATE shop_catalog SET buy_price = ?, sell_price = ? WHERE item_code = ? COLLATE NOCASE"
        ).run(buy, sell, parts[2]);
        label = "کالای فروشگاه";
      } else {
        return ctx.reply(
          "نوع دارایی نامعتبر است.\n" +
          "انواع: خودرو، ملک، کسب‌وکار، کالا\n" +
          "برای دیدن فهرست، بنویس: فهرست قیمت‌ها"
        );
      }

      if (!result || result.changes === 0) {
        return ctx.reply("❌ موردی با این نام یا کد پیدا نشد؛ قیمت تغییر نکرد.");
      }

      return ctx.reply(
        "✅ قیمت ثبت شد.\n" +
        "نوع: " + label + "\n" +
        "مورد: " + parts[2] + "\n" +
        "در صورت وارد کردن قیمت صفر، ارزش ثبت‌شده صفر می‌شود."
      );
    } catch (e) {
      console.error("تنظیم قیمت دارایی:", e);
      return ctx.reply("❌ هنگام تغییر قیمت خطا رخ داد؛ گزارش خطا در لاگ ثبت شد.");
    }
  });

`;

const backup = file + ".before-asset-prices-" +
  new Date().toISOString().replace(/[:.]/g, "-") + ".bak";

fs.copyFileSync(file, backup);
const updated = source.replace(anchor, block + anchor);
fs.writeFileSync(file, updated, "utf8");

try {
  execFileSync("node", ["--check", file], { stdio: "inherit" });
  console.log("\n✅ قابلیت مدیریت قیمت‌ها اضافه شد.");
  console.log("📦 پشتیبان: " + backup);
  console.log("🔎 فرمان فهرست: فهرست قیمت‌ها");
  console.log("🔎 فرمان تغییر: تنظیم قیمت | نوع | نام/کد | قیمت");
} catch (e) {
  fs.copyFileSync(backup, file);
  console.error("\n❌ بررسی نحوی ناموفق بود؛ فایل اصلی خودکار برگردانده شد.");
  console.error("پشتیبان: " + backup);
  process.exit(1);
}
