const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const target = path.resolve("src/commands.js");
const marker = "// MONTADORIA_ASSET_DELETE_ADMIN_V1";
const anchor = "// MONTADORIA TAX SYSTEM V1";

if (!fs.existsSync(target)) {
  console.error("❌ فایل src/commands.js پیدا نشد.");
  process.exit(1);
}

const source = fs.readFileSync(target, "utf8");

if (source.includes(marker)) {
  console.log("ℹ️ دستورهای حذف قبلاً اضافه شده‌اند؛ تغییری انجام نشد.");
  process.exit(0);
}

if (
  source.indexOf(anchor) === -1 ||
  source.indexOf(anchor) !== source.lastIndexOf(anchor)
) {
  console.error("❌ محل درج کد یکتا نیست؛ فایل تغییر نکرد.");
  process.exit(1);
}

const required = [
  "rtCanRegisterAsset",
  "CREATE TABLE IF NOT EXISTS car_catalog",
  "CREATE TABLE IF NOT EXISTS player_cars",
  "CREATE TABLE IF NOT EXISTS player_properties",
  "CREATE TABLE IF NOT EXISTS business_catalog",
  "CREATE TABLE IF NOT EXISTS player_businesses"
];

for (const item of required) {
  if (!source.includes(item)) {
    console.error("❌ ساختار مورد انتظار پیدا نشد: " + item);
    console.error("هیچ تغییری در فایل انجام نشد.");
    process.exit(1);
  }
}

const patch = String.raw`// MONTADORIA_ASSET_DELETE_ADMIN_V1
{
  const madCanManage = ctx => rtCanRegisterAsset(ctx);

  const madDeleteCar = db.transaction(name => {
    const row = db.prepare(`
      SELECT c.car_id, c.name,
             p.car_id AS linked_car_id, p.owner_id
      FROM car_catalog c
      LEFT JOIN player_cars p ON p.car_id = c.car_id
      WHERE c.name = ? COLLATE NOCASE
      LIMIT 1
    `).get(name);

    if (!row) return { status: "not_found" };
    if (row.linked_car_id == null) return { status: "invalid" };

    if (row.owner_id != null && String(row.owner_id).trim() !== "") {
      return { status: "owned", name: row.name };
    }

    db.prepare("DELETE FROM player_cars WHERE car_id = ?")
      .run(row.car_id);
    db.prepare("DELETE FROM car_catalog WHERE car_id = ?")
      .run(row.car_id);

    return { status: "deleted", name: row.name };
  });

  const madDeleteProperty = db.transaction(name => {
    const row = db.prepare(`
      SELECT property_id, name, owner_id
      FROM player_properties
      WHERE name = ? COLLATE NOCASE
      LIMIT 1
    `).get(name);

    if (!row) return { status: "not_found" };

    if (row.owner_id != null && String(row.owner_id).trim() !== "") {
      return { status: "owned", name: row.name };
    }

    db.prepare("DELETE FROM player_properties WHERE property_id = ?")
      .run(row.property_id);

    return { status: "deleted", name: row.name };
  });

  const madDeactivateBusiness = db.transaction(name => {
    const row = db.prepare(`
      SELECT b.business_id, b.name, b.active,
             p.business_id AS linked_business_id, p.owner_id
      FROM business_catalog b
      LEFT JOIN player_businesses p
        ON p.business_id = b.business_id
      WHERE b.name = ? COLLATE NOCASE
      LIMIT 1
    `).get(name);

    if (!row) return { status: "not_found" };
    if (row.linked_business_id == null) {
      return { status: "invalid" };
    }

    if (row.owner_id != null && String(row.owner_id).trim() !== "") {
      return { status: "owned", name: row.name };
    }

    if (!Number(row.active)) {
      return { status: "inactive", name: row.name };
    }

    db.prepare(`
      UPDATE business_catalog
      SET active = 0
      WHERE business_id = ?
    `).run(row.business_id);

    return { status: "deactivated", name: row.name };
  });

  const madReply = (ctx, result, type) => {
    const labels = {
      car: "خودرو",
      property: "ملک",
      business: "کسب‌وکار"
    };
    const label = labels[type];

    switch (result.status) {
      case "deleted":
        return ctx.reply("✅ " + label + " «" + result.name + "» حذف شد.");
      case "deactivated":
        return ctx.reply(
          "✅ کسب‌وکار «" + result.name +
          "» غیرفعال شد؛ سابقه آن حفظ شده است."
        );
      case "inactive":
        return ctx.reply(
          "ℹ️ کسب‌وکار «" + result.name + "» از قبل غیرفعال است."
        );
      case "owned":
        return ctx.reply(
          "⛔ " + label + " «" + result.name +
          "» مالک دارد و برای جلوگیری از حذف دارایی بازیکن، حذف نشد."
        );
      case "invalid":
        return ctx.reply(
          "❌ ارتباط اطلاعات " + label +
          " ناقص است؛ هیچ رکوردی حذف نشد."
        );
      default:
        return ctx.reply(
          "❌ " + label + " با این نام پیدا نشد."
        );
    }
  };

  const madHandle = async (ctx, type, rawName) => {
    if (!madCanManage(ctx)) {
      return ctx.reply(
        "⛔ فقط مالک یا مأمور مجاز ثبت دارایی می‌تواند این کار را انجام دهد."
      );
    }

    const name = String(rawName || "").trim();

    if (!name || name.length > 150) {
      return ctx.reply("نام واردشده معتبر نیست.");
    }

    try {
      let result;

      if (type === "car") result = madDeleteCar(name);
      else if (type === "property") result = madDeleteProperty(name);
      else result = madDeactivateBusiness(name);

      return madReply(ctx, result, type);
    } catch (error) {
      console.error("MONTADORIA asset removal error:", error);
      return ctx.reply("❌ عملیات انجام نشد؛ خطا در پایگاه داده رخ داد.");
    }
  };

  bot.hears(/^حذف\s+(?:خودرو|ماشین)\s*\|\s*(.+)$/u, async ctx => {
    return madHandle(ctx, "car", ctx.match[1]);
  });

  bot.hears(/^حذف\s+ملک\s*\|\s*(.+)$/u, async ctx => {
    return madHandle(ctx, "property", ctx.match[1]);
  });

  bot.hears(/^حذف\s+کسب[‌ ]وکار\s*\|\s*(.+)$/u, async ctx => {
    return madHandle(ctx, "business", ctx.match[1]);
  });
}
// END MONTADORIA_ASSET_DELETE_ADMIN_V1
`;

const position = source.indexOf(anchor);
const updated =
  source.slice(0, position) +
  patch +
  "\n\n" +
  source.slice(position);

const checkFile = path.resolve("src/.commands-asset-delete-check.mjs");

try {
  fs.writeFileSync(checkFile, updated, "utf8");

  const check = spawnSync(
    process.execPath,
    ["--check", checkFile],
    { encoding: "utf8" }
  );

  if (check.status !== 0) {
    console.error("❌ بررسی نحوی ناموفق بود؛ فایل اصلی تغییر نکرد.");
    if (check.stderr) console.error(check.stderr);
    process.exitCode = 1;
    return;
  }

  const backup =
    target + ".before-asset-delete-" +
    new Date().toISOString().replace(/[:.]/g, "-") +
    ".bak";

  fs.copyFileSync(target, backup);
  fs.writeFileSync(target, updated, "utf8");

  console.log("✅ دستورهای حذف اضافه شدند.");
  console.log("✅ بررسی نحوی کد موفق بود.");
  console.log("✅ پشتیبان ساخته شد: " + backup);
  console.log("");
  console.log("دستورهای جدید:");
  console.log("حذف خودرو | نام خودرو");
  console.log("حذف ماشین | نام خودرو");
  console.log("حذف ملک | نام ملک");
  console.log("حذف کسب‌وکار | نام کسب‌وکار");
  console.log("");
  console.log("⚠️ هنوز باید تغییرات را بررسی و سپس در Git ثبت و Push کنی.");
} catch (error) {
  console.error("❌ نصب انجام نشد:", error.message);
  process.exitCode = 1;
} finally {
  try {
    fs.unlinkSync(checkFile);
  } catch {}
}
