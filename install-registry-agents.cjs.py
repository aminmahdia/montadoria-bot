from pathlib import Path
from datetime import datetime
import os
import subprocess
import sys
import tempfile

file = Path("src/commands.js")
src = file.read_text(encoding="utf-8")

if "MONTADORIA_REGISTRY_AGENTS_V1" in src:
    print("سیستم مأمور ثبت قبلاً نصب شده؛ هیچ تغییری انجام نشد.")
    sys.exit(1)

def replace_once(old, new, label):
    global src
    count = src.count(old)
    if count != 1:
        raise RuntimeError(
            f"{label}: انتظار یک تطبیق بود، اما {count} مورد پیدا شد."
        )
    src = src.replace(old, new, 1)

def replace_in_handler(marker, old, new, label):
    global src
    start = src.find(marker)
    if start < 0:
        raise RuntimeError(f"ابتدای فرمان پیدا نشد: {label}")

    next_handler = src.find("\n  bot.hears(", start + len(marker))
    if next_handler < 0:
        next_handler = len(src)

    section = src[start:next_handler]
    if section.count(old) != 1:
        raise RuntimeError(f"شرط دسترسی فرمان «{label}» دقیقاً پیدا نشد.")

    section = section.replace(old, new, 1)
    src = src[:start] + section + src[next_handler:]

registry_code = r'''
  // MONTADORIA_REGISTRY_AGENTS_V1
  db.exec(`
    CREATE TABLE IF NOT EXISTS montadoria_registry_agents (
      telegram_id TEXT PRIMARY KEY,
      added_by TEXT NOT NULL,
      added_at INTEGER NOT NULL
    )
  `);

  // مالک اصلی فقط شناسه‌ای است که در OWNER_ID تنظیم شده است.
  const rtIsPrimaryOwner = ctx =>
    Number(OWNER_ID) > 0 &&
    String(ctx.from?.id ?? "") === String(OWNER_ID);

  const rtIsRegistrar = ctx => {
    if (!ctx?.from?.id) return false;
    if (rtIsPrimaryOwner(ctx)) return true;

    return Boolean(db.prepare(
      "SELECT 1 FROM montadoria_registry_agents WHERE telegram_id = ?"
    ).get(String(ctx.from.id)));
  };

  const rtCanRegisterAsset = ctx => rtIsRegistrar(ctx);

  bot.hears(/^افزودن\s+م[اأ]مور\s+ثبت\s*\|/u, async ctx => {
    if (!rtIsPrimaryOwner(ctx)) {
      return ctx.reply("⛔ فقط مالک اصلی ربات می‌تواند مأمور ثبت اضافه کند.");
    }

    const parts = String(ctx.message?.text || "").split("|").map(x => x.trim());
    const id = parts[1] || "";

    if (parts.length !== 2 || !/^\d{1,20}$/.test(id)) {
      return ctx.reply("فرمت صحیح:\nافزودن مامور ثبت | شناسه عددی تلگرام");
    }

    if (String(OWNER_ID) === id) {
      return ctx.reply("مالک اصلی از قبل دسترسی کامل دارد.");
    }

    const result = db.prepare(`
      INSERT OR IGNORE INTO montadoria_registry_agents
        (telegram_id, added_by, added_at)
      VALUES (?, ?, ?)
    `).run(id, String(ctx.from.id), Math.floor(Date.now() / 1000));

    return ctx.reply(result.changes
      ? `✅ شناسه ${id} به مأموران ثبت اضافه شد.`
      : `شناسه ${id} از قبل مأمور ثبت است.`);
  });

  bot.hears(/^حذف\s+م[اأ]مور\s+ثبت\s*\|/u, async ctx => {
    if (!rtIsPrimaryOwner(ctx)) {
      return ctx.reply("⛔ فقط مالک اصلی ربات می‌تواند مأمور ثبت حذف کند.");
    }

    const parts = String(ctx.message?.text || "").split("|").map(x => x.trim());
    const id = parts[1] || "";

    if (parts.length !== 2 || !/^\d{1,20}$/.test(id)) {
      return ctx.reply("فرمت صحیح:\nحذف مامور ثبت | شناسه عددی تلگرام");
    }

    const result = db.prepare(
      "DELETE FROM montadoria_registry_agents WHERE telegram_id = ?"
    ).run(id);

    return ctx.reply(result.changes
      ? `✅ شناسه ${id} از مأموران ثبت حذف شد.`
      : `شناسه ${id} در فهرست مأموران ثبت نبود.`);
  });

  bot.hears(/^(?:فهرست\s+)?م[اأ]موران\s+ثبت$/u, async ctx => {
    if (!rtIsPrimaryOwner(ctx)) {
      return ctx.reply("⛔ فقط مالک اصلی ربات اجازه مشاهده این فهرست را دارد.");
    }

    const rows = db.prepare(`
      SELECT telegram_id FROM montadoria_registry_agents ORDER BY added_at
    `).all();

    return ctx.reply(rows.length
      ? "⟡ فهرست مأموران ثبت ⟡\n\n" +
        rows.map((r, i) => `${i + 1}. ${r.telegram_id}`).join("\n")
      : "فهرست مأموران ثبت خالی است.");
  });
  // END MONTADORIA_REGISTRY_AGENTS_V1
'''

try:
    anchor = "  const shopCanManage = ctx => {"
    if src.count(anchor) != 1:
        raise RuntimeError("محل درج helper در بخش فروشگاه دقیقاً پیدا نشد.")

    # ثبت کسب‌وکار، خودرو و ملک
    replace_once(
        "if (!businessManager(getUser(ctx.from.id))) {",
        "if (!rtCanRegisterAsset(ctx)) {",
        "ثبت کسب‌وکار"
    )
    replace_once(
        "if (!carIsManager(u)) return ctx.reply(",
        "if (!rtCanRegisterAsset(ctx)) return ctx.reply(",
        "ثبت خودرو"
    )
    replace_once(
        "if (!propertyIsManager(ctx))",
        "if (!rtCanRegisterAsset(ctx))",
        "ثبت ملک"
    )

    # ساخت فروشگاه‌ها و افزودن کالا به بازارها
    replace_in_handler(
        "bot.hears(/^افزودن فروشگاه مخفی\\s*\\|",
        "if (!mmManage(ctx))",
        "if (!rtCanRegisterAsset(ctx))",
        "افزودن فروشگاه مخفی"
    )
    replace_in_handler(
        "bot.hears(/^افزودن فروشگاه\\s*\\|",
        "if (!mmManage(ctx))",
        "if (!rtCanRegisterAsset(ctx))",
        "افزودن فروشگاه"
    )
    replace_in_handler(
        "bot.hears(/^افزودن کالا\\s*\\|\\s*(بازار اصلی|بازار سیاه)",
        "if (!mmManage(ctx))",
        "if (!rtCanRegisterAsset(ctx))",
        "افزودن کالای بازار"
    )
    replace_in_handler(
        "bot.hears(/^افزودن کالا\\s*\\|\\s*([^|]+?)",
        "if (!shopCanManage(ctx))",
        "if (!rtCanRegisterAsset(ctx))",
        "افزودن کالای فروشگاه"
    )

    # helper باید قبل از اولین استفاده و داخل registerCommands باشد.
    src = src.replace(anchor, registry_code + "\n" + anchor, 1)

    # اعتبارسنجی فایل موقت قبل از تغییر فایل اصلی
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", suffix=".js",
        prefix="commands-registry-check-",
        dir=str(file.parent), delete=False
    ) as temp:
        temp.write(src)
        temp_path = temp.name

    try:
        check = subprocess.run(
            ["node", "--check", temp_path],
            capture_output=True, text=True
        )
        if check.returncode:
            raise RuntimeError(
                "بررسی نحوی ناموفق بود؛ فایل اصلی تغییر نکرد.\n" +
                (check.stderr or check.stdout)
            )
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

    backup = file.with_name(
        "commands.js.before-registry-agents-" +
        datetime.now().strftime("%Y%m%d-%H%M%S") + ".bak"
    )
    backup.write_text(file.read_text(encoding="utf-8"), encoding="utf-8")

    temp_file = file.with_name("commands.js.registry-tmp")
    temp_file.write_text(src, encoding="utf-8")
    os.replace(temp_file, file)

    print("✅ سیستم مأمور ثبت نصب شد.")
    print(f"✅ پشتیبان: {backup}")
    print("✅ node --check موفق بود.")
    print("فرمان‌ها:")
    print("افزودن مامور ثبت | شناسه")
    print("حذف مامور ثبت | شناسه")
    print("ماموران ثبت")

except Exception as e:
    print(f"❌ نصب متوقف شد: {e}")
    print("اگر خطا قبل از پیام نصب موفق رخ داده باشد، فایل اصلی تغییر نکرده است.")
    sys.exit(1)
