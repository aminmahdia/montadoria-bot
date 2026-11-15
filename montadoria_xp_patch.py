from pathlib import Path
from datetime import datetime
import re
import shutil
import subprocess
import sys

ROOT = Path.cwd()
COMMANDS = ROOT / "src" / "commands.js"
OBSERVER = ROOT / "src" / "observer.js"
XP_FILE = ROOT / "src" / "xp.js"

if not (COMMANDS.exists() and OBSERVER.exists()):
    print("خطا: این اسکریپت باید داخل پوشه اصلی montadoria-bot اجرا شود.")
    sys.exit(1)

xp_code = r'''import db from "./database.js";

const DAY_SECONDS = 24 * 60 * 60;

const DAILY_CAPS = Object.freeze({
  economy: 12,
  training: 24,
  combat: 60
});

const ACTIVITY_RULES = Object.freeze({
  shop_purchase: { xp: 2, category: "economy", cooldownSeconds: 3 * 60 * 60 },
  shop_sale: { xp: 3, category: "economy", cooldownSeconds: 3 * 60 * 60 },
  asset_purchase: { xp: 5, category: "economy", cooldownSeconds: DAY_SECONDS },
  asset_sale: { xp: 3, category: "economy", cooldownSeconds: DAY_SECONDS },
  training: { xp: 8, category: "training", cooldownSeconds: 6 * 60 * 60 },
  training_hard: { xp: 18, category: "training", cooldownSeconds: 12 * 60 * 60 },
  mission: { xp: 15, category: "training", cooldownSeconds: DAY_SECONDS }
});

db.exec(`
  CREATE TABLE IF NOT EXISTS montadoria_xp_awards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT NOT NULL,
    activity TEXT NOT NULL,
    category TEXT NOT NULL,
    event_key TEXT NOT NULL UNIQUE,
    xp INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_montadoria_xp_user_activity_time
  ON montadoria_xp_awards (telegram_id, activity, created_at);

  CREATE INDEX IF NOT EXISTS idx_montadoria_xp_user_category_time
  ON montadoria_xp_awards (telegram_id, category, created_at);
`);

function xpRequiredForLevel(level) {
  if (level <= 1) return 0;
  return Math.floor(100 * Math.pow(level - 1, 1.5));
}

function calculateLevelFromXP(xp) {
  let level = 1;
  while (xp >= xpRequiredForLevel(level + 1) && level < 1000) {
    level++;
  }
  return level;
}

export function xpEventKey(ctx, action) {
  const chatId = ctx?.chat?.id ?? "private";
  const messageId = ctx?.message?.message_id ?? ctx?.update?.update_id ?? Date.now();
  return `${String(action)}:${String(chatId)}:${String(messageId)}`;
}

function applyAward(telegramId, activity, eventKey, rule) {
  const id = String(telegramId ?? "");
  const key = String(eventKey ?? "").trim();

  if (!/^\d{1,20}$/.test(id) || !key || key.length > 200) return null;

  const now = Math.floor(Date.now() / 1000);
  const dayStart = Math.floor(now / DAY_SECONDS) * DAY_SECONDS;

  try {
    return db.transaction(() => {
      const user = db.prepare(`
        SELECT xp, level, infinite_money
        FROM users
        WHERE telegram_id = ?
      `).get(id);

      if (!user) return null;
      if (db.prepare(
        "SELECT 1 FROM montadoria_xp_awards WHERE event_key = ? LIMIT 1"
      ).get(key)) {
        return null;
      }

      // خریدهای حساب‌های دارای پول نامحدود XP اقتصادی تولید نمی‌کنند.
      if (rule.category === "economy" && Number(user.infinite_money || 0) === 1) {
        return { gainedXP: 0, reason: "infinite_money" };
      }

      const lastAward = db.prepare(`
        SELECT created_at
        FROM montadoria_xp_awards
        WHERE telegram_id = ? AND activity = ? AND created_at > ?
        ORDER BY created_at DESC
        LIMIT 1
      `).get(id, activity, now - rule.cooldownSeconds);

      if (lastAward) return { gainedXP: 0, reason: "cooldown" };

      const earnedToday = Number(db.prepare(`
        SELECT COALESCE(SUM(xp), 0) AS total
        FROM montadoria_xp_awards
        WHERE telegram_id = ? AND category = ? AND created_at >= ?
      `).get(id, rule.category, dayStart)?.total || 0);

      const dailyCap = DAILY_CAPS[rule.category];
      if (!dailyCap || earnedToday + rule.xp > dailyCap) {
        return { gainedXP: 0, reason: "daily_cap" };
      }

      const oldXP = Number(user.xp || 0);
      const oldLevel = Number(user.level || 1);
      const newXP = oldXP + rule.xp;
      if (!Number.isSafeInteger(newXP)) return null;

      const newLevel = calculateLevelFromXP(newXP);
      const updated = db.prepare(`
        UPDATE users
        SET xp = ?, level = ?, updated_at = ?
        WHERE telegram_id = ?
      `).run(newXP, newLevel, new Date().toISOString(), id);

      if (updated.changes !== 1) return null;

      db.prepare(`
        INSERT INTO montadoria_xp_awards
          (telegram_id, activity, category, event_key, xp, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, activity, rule.category, key, rule.xp, now);

      return {
        oldXP,
        newXP,
        oldLevel,
        newLevel,
        gainedXP: rule.xp,
        levelUp: newLevel > oldLevel
      };
    })();
  } catch (error) {
    console.error("Montadoria XP award error:", error);
    return null;
  }
}

export function awardActivityXP(telegramId, activity, eventKey) {
  const rule = ACTIVITY_RULES[activity];
  if (!rule) return null;
  return applyAward(telegramId, activity, eventKey, rule);
}

// برای اتصال به سیستم مبارزه پس از معتبرشدن نتیجه نبرد آماده است.
export function awardCombatVictoryXP(winnerTelegramId, loserTelegramId, eventKey) {
  const winner = db.prepare(
    "SELECT level FROM users WHERE telegram_id = ?"
  ).get(String(winnerTelegramId ?? ""));
  const loser = db.prepare(
    "SELECT level FROM users WHERE telegram_id = ?"
  ).get(String(loserTelegramId ?? ""));

  if (!winner || !loser || String(winnerTelegramId) === String(loserTelegramId)) {
    return null;
  }

  const levelGap = Number(loser.level || 1) - Number(winner.level || 1);
  const xp = levelGap >= 5 ? 60
    : levelGap >= 2 ? 40
    : levelGap >= -1 ? 25
    : 10;

  return applyAward(
    winnerTelegramId,
    `combat_win:${String(loserTelegramId)}`,
    eventKey,
    { xp, category: "combat", cooldownSeconds: DAY_SECONDS }
  );
}

export function xpAwardText(result) {
  if (!result?.gainedXP) return "";
  return `\n\n✨ پاداش فعالیت: +${result.gainedXP} XP` +
    (result.levelUp ? `\n🎉 تبریک! به Level ${result.newLevel} رسیدی.` : "");
}
'''

commands = COMMANDS.read_text(encoding="utf-8")
observer = OBSERVER.read_text(encoding="utf-8")

# Fail safely if the repository version differs from the reviewed version.
def replace_once(source, old, new, label):
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"لنگر کد برای «{label}» باید دقیقاً یک‌بار پیدا شود؛ تعداد فعلی: {count}")
    return source.replace(old, new, 1)

# Commands: import centralized XP functions.
commands = replace_once(
    commands,
    'import { randomBytes } from "node:crypto"\n',
    'import { randomBytes } from "node:crypto"\nimport { awardActivityXP, xpAwardText, xpEventKey } from "./xp.js"\n',
    "واردکردن ماژول XP"
)

# Business purchase.
commands = replace_once(
    commands,
    '    if (r.error) return ctx.reply("❌ " + r.error);\n\n    return ctx.reply(\n      `✅ کسب‌وکار «${r.name}» خریداری شد.\\n` +\n      `💰 هزینه: ${r.price}\\n` +\n      `📈 درآمد روزانه: ${r.income}\\n\\n` +\n      `⏳ اولین درآمد، پس از گذشت ۲۴ ساعت قابل دریافت است.`\n    );',
    '    if (r.error) return ctx.reply("❌ " + r.error);\n\n    const xpReward = awardActivityXP(ctx.from.id, "asset_purchase", xpEventKey(ctx, "business-purchase"));\n    return ctx.reply(\n      `✅ کسب‌وکار «${r.name}» خریداری شد.\\n` +\n      `💰 هزینه: ${r.price}\\n` +\n      `📈 درآمد روزانه: ${r.income}\\n\\n` +\n      `⏳ اولین درآمد، پس از گذشت ۲۴ ساعت قابل دریافت است.` +\n      xpAwardText(xpReward)\n    );',
    "پاداش خرید کسب‌وکار"
)

# Business sale.
commands = replace_once(
    commands,
    '    if (result.error) return ctx.reply("❌ " + result.error);\n\n    return ctx.reply(\n      `✅ کسب‌وکار «${result.name}» فروخته شد.\\n` +\n      `💰 مبلغ دریافتی (۷۰٪ قیمت ثبت‌شده): ${result.payout}`\n    );',
    '    if (result.error) return ctx.reply("❌ " + result.error);\n\n    const xpReward = awardActivityXP(ctx.from.id, "asset_sale", xpEventKey(ctx, "business-sale"));\n    return ctx.reply(\n      `✅ کسب‌وکار «${result.name}» فروخته شد.\\n` +\n      `💰 مبلغ دریافتی (۷۰٪ قیمت ثبت‌شده): ${result.payout}` +\n      xpAwardText(xpReward)\n    );',
    "پاداش فروش کسب‌وکار"
)

# Car purchase and sale.
commands = replace_once(
    commands,
    '    return ctx.reply(`✅ خودرو «${result.name}» با قیمت ${result.price} خریداری شد.`);',
    '    const xpReward = awardActivityXP(ctx.from.id, "asset_purchase", xpEventKey(ctx, "car-purchase"));\n    return ctx.reply(`✅ خودرو «${result.name}» با قیمت ${result.price} خریداری شد.${xpAwardText(xpReward)}`);',
    "پاداش خرید خودرو"
)
commands = replace_once(
    commands,
    '    return ctx.reply(`✅ خودرو «${result.name}» فروخته شد.\\n💰 مبلغ دریافتی: ${result.payout}`);',
    '    const xpReward = awardActivityXP(ctx.from.id, "asset_sale", xpEventKey(ctx, "car-sale"));\n    return ctx.reply(`✅ خودرو «${result.name}» فروخته شد.\\n💰 مبلغ دریافتی: ${result.payout}${xpAwardText(xpReward)}`);',
    "پاداش فروش خودرو"
)

# Property purchase and sale.
commands = replace_once(
    commands,
    '    if (result.error) return ctx.reply("❌ " + result.error);\n    return ctx.reply(`✅ ملک «${result.prop.name}» به نام تو ثبت شد.\\n💰 قیمت: ${Number(result.prop.price).toLocaleString("en-US")} سکه`);',
    '    if (result.error) return ctx.reply("❌ " + result.error);\n    const xpReward = awardActivityXP(ctx.from.id, "asset_purchase", xpEventKey(ctx, "property-purchase"));\n    return ctx.reply(`✅ ملک «${result.prop.name}» به نام تو ثبت شد.\\n💰 قیمت: ${Number(result.prop.price).toLocaleString("en-US")} سکه${xpAwardText(xpReward)}`);',
    "پاداش خرید ملک"
)
commands = replace_once(
    commands,
    '  if (!sale()) return ctx.reply("❌ فروش انجام نشد.");\n  return ctx.reply(`✅ ملک «${prop.name}» فروخته شد.\\n💰 دریافتی: ${Number(prop.price).toLocaleString("en-US")} سکه`);',
    '  if (!sale()) return ctx.reply("❌ فروش انجام نشد.");\n  const xpReward = awardActivityXP(ctx.from.id, "asset_sale", xpEventKey(ctx, "property-sale"));\n  return ctx.reply(`✅ ملک «${prop.name}» فروخته شد.\\n💰 دریافتی: ${Number(prop.price).toLocaleString("en-US")} سکه${xpAwardText(xpReward)}`);',
    "پاداش فروش ملک"
)

# Multi-market shop purchase and sale.
commands = replace_once(
    commands,
    '      return ctx.reply(\n        `✅ خرید انجام شد\\nکالا: ${item.name}\\nتعداد: ${qty}\\nهزینه: ${mmCash(cost)}`\n      );',
    '      const xpReward = awardActivityXP(ctx.from.id, "shop_purchase", xpEventKey(ctx, "shop-purchase"));\n      return ctx.reply(\n        `✅ خرید انجام شد\\nکالا: ${item.name}\\nتعداد: ${qty}\\nهزینه: ${mmCash(cost)}${xpAwardText(xpReward)}`\n      );',
    "پاداش خرید از بازار چندفروشگاهی"
)
commands = replace_once(
    commands,
    '      return ctx.reply(\n        `✅ فروش انجام شد\\nکالا: ${item.name}\\nتعداد: ${qty}\\nدریافتی: ${mmCash(income)}`\n      );',
    '      const xpReward = awardActivityXP(ctx.from.id, "shop_sale", xpEventKey(ctx, "shop-sale"));\n      return ctx.reply(\n        `✅ فروش انجام شد\\nکالا: ${item.name}\\nتعداد: ${qty}\\nدریافتی: ${mmCash(income)}${xpAwardText(xpReward)}`\n      );',
    "پاداش فروش از بازار چندفروشگاهی"
)

# Legacy shop commands that are still enabled.
commands = replace_once(
    commands,
    '      return ctx.reply(\n        `✅ خرید انجام شد.\\n\\n` +\n        `📦 کالا: ${item.name}\\n` +\n        `🔢 تعداد: ${quantity}\\n` +\n        `💰 هزینه: ${total.toLocaleString("en-US")}`\n      );',
    '      const xpReward = awardActivityXP(ctx.from.id, "shop_purchase", xpEventKey(ctx, "shop-purchase-legacy"));\n      return ctx.reply(\n        `✅ خرید انجام شد.\\n\\n` +\n        `📦 کالا: ${item.name}\\n` +\n        `🔢 تعداد: ${quantity}\\n` +\n        `💰 هزینه: ${total.toLocaleString("en-US")}` +\n        xpAwardText(xpReward)\n      );',
    "پاداش خرید از فروشگاه قدیمی"
)
commands = replace_once(
    commands,
    '      return ctx.reply(\n        `✅ فروش انجام شد.\\n\\n` +\n        `📦 کالا: ${item.name}\\n` +\n        `🔢 تعداد: ${quantity}\\n` +\n        `💵 دریافتی: ${payout.toLocaleString("en-US")}`\n      );',
    '      const xpReward = awardActivityXP(ctx.from.id, "shop_sale", xpEventKey(ctx, "shop-sale-legacy"));\n      return ctx.reply(\n        `✅ فروش انجام شد.\\n\\n` +\n        `📦 کالا: ${item.name}\\n` +\n        `🔢 تعداد: ${quantity}\\n` +\n        `💵 دریافتی: ${payout.toLocaleString("en-US")}` +\n        xpAwardText(xpReward)\n      );',
    "پاداش فروش از فروشگاه قدیمی"
)

# Observer: XP for meaningful, valid training roleplay only.
observer = replace_once(
    observer,
    'import db from "./database.js";\n',
    'import db from "./database.js";\nimport { awardActivityXP, xpEventKey } from "./xp.js";\n',
    "واردکردن XP در ناظر"
)
observer = replace_once(
    observer,
    '      return ["#خوردن", "#خوابیدن", "#خواب"].includes(tag);',
    '      return ["#خوردن", "#خوابیدن", "#خواب", "#تمرین"].includes(tag);',
    "الزام حضور در مپ برای تمرین"
)
observer = replace_once(
    observer,
    '    const hasNeedTag = tag => text.split(/\\\\r?\\\\n/).some(',
    '    const hasNeedTag = tag => text.split(/\\r?\\n/).some(',
    "اصلاح تشخیص خطوط چندگانه غذا و خواب"
)
observer = replace_once(
    observer,
    '    const validation = validateRoleplay(text);\n\n    if (!validation.ok) {\n      await warn(ctx, validation.reason);\n    }',
    '    const validation = validateRoleplay(text);\n\n    if (!validation.ok) {\n      await warn(ctx, validation.reason);\n    }\n\n    // پاداش تمرین فقط برای رول معتبر، با توضیح اکشن کافی و حضور در مپ ثبت می‌شود.\n    if (validation.ok && hasMapTag("#تمرین")) {\n      const actionText = text.split(/\\r?\\n/)\n        .map(line => line.trim())\n        .filter(line => /^\\*[^*].*\\*$/.test(line))\n        .map(line => line.slice(1, -1).trim())\n        .join(" ");\n\n      if (actionText.length >= 40) {\n        const reward = awardActivityXP(\n          user.id,\n          "training",\n          xpEventKey(ctx, "training")\n        );\n\n        if (reward?.gainedXP) {\n          await report(ctx,\n            `🏋️ ثبت تمرین معتبر | کاربر: ${user.id} | پاداش: ${reward.gainedXP} XP | گروه: ${ctx.chat.id}`\n          );\n        }\n      }\n    }',
    "پاداش تمرین معتبر"
)

# Ensure this exact local version has not already been patched or partially patched.
if XP_FILE.exists():
    raise RuntimeError("src/xp.js از قبل وجود دارد؛ برای جلوگیری از بازنویسی، اسکریپت متوقف شد.")

stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
backups = [
    (COMMANDS, COMMANDS.with_name(f"commands.js.before-xp-{stamp}.bak")),
    (OBSERVER, OBSERVER.with_name(f"observer.js.before-xp-{stamp}.bak")),
]
for source, backup in backups:
    shutil.copy2(source, backup)

try:
    XP_FILE.write_text(xp_code, encoding="utf-8")
    COMMANDS.write_text(commands, encoding="utf-8")
    OBSERVER.write_text(observer, encoding="utf-8")

    for file in (XP_FILE, COMMANDS, OBSERVER):
        check = subprocess.run(
            ["node", "--check", str(file)],
            cwd=ROOT,
            text=True,
            capture_output=True
        )
        if check.returncode != 0:
            raise RuntimeError(f"خطای بررسی نحوی در {file.name}:\n{check.stderr or check.stdout}")
except Exception:
    if XP_FILE.exists():
        XP_FILE.unlink()
    for source, backup in backups:
        if backup.exists():
            shutil.copy2(backup, source)
    raise

print("✅ سیستم پایه XP با موفقیت به فایل‌های محلی اضافه شد.")
print("✅ نسخه‌های پشتیبان ساخته شدند:")
for _, backup in backups:
    print(" -", backup.name)
print("✅ بررسی نحوی Node.js برای xp.js، commands.js و observer.js بدون خطا بود.")
print("محدودهٔ فعلی: خرید/فروش کالا و دارایی + تمرین معتبر. نتیجهٔ مبارزه هنوز به هندلر مبارزه متصل نشده است.")
