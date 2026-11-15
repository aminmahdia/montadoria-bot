#!/usr/bin/env python3
# MONTADORIA: fix food/sleep warnings, Telegram mentions, and needs restrictions.
# Run from ~/montadoria-bot:
#   python3 /sdcard/Download/montadoria_needs_warning_fix.py
from pathlib import Path
from datetime import datetime
import shutil
import subprocess
import sys

TARGET = Path('src/observer.js')
if not TARGET.is_file():
    print('ERROR: src/observer.js پیدا نشد. ابتدا وارد پوشه ~/montadoria-bot شو.')
    sys.exit(1)
source = TARGET.read_text(encoding='utf-8')
updated = source

def replace_once(old, new, label):
    global updated
    count = updated.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: باید دقیقاً یک مورد پیدا می‌شد؛ تعداد پیدا شده: {count}')
    updated = updated.replace(old, new, 1)

def replace_between(start, end, new, label):
    global updated
    a = updated.find(start)
    b = updated.find(end, a + len(start))
    if a < 0 or b < 0 or b <= a:
        raise RuntimeError(f'بخش موردنظر پیدا نشد: {label}')
    updated = updated[:a] + new + updated[b:]

replace_once(
    'const RESTRICTION_MINUTES = Math.max(1, Number(process.env.RESTRICTION_MINUTES || 30));',
    '''const RESTRICTION_MINUTES = Math.max(1, Number(process.env.RESTRICTION_MINUTES || 30));
const NEEDS_RESTRICTION_MINUTES = Math.max(1, Number(process.env.NEEDS_RESTRICTION_MINUTES || 120));''',
    'مدت محدودیت نیازها')

replace_once(
    'const now = () => Math.floor(Date.now() / 1000);',
    '''const now = () => Math.floor(Date.now() / 1000);

function toUnixSeconds(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value > 1e12 ? value / 1000 : value);
  const raw = String(value).trim();
  if (!raw) return 0;
  if (/^[+-]?\\d+(?:\\.\\d+)?$/.test(raw)) {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n > 1e12 ? n / 1000 : n) : 0;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

// Normalize old ISO restriction dates to Unix seconds.
{
  const rows = db.prepare("SELECT id, restricted_until FROM observer_restrictions").all();
  const update = db.prepare("UPDATE observer_restrictions SET restricted_until = ? WHERE id = ?");
  for (const row of rows) {
    const ts = toUnixSeconds(row.restricted_until);
    if (ts > 0 && String(ts) !== String(row.restricted_until)) update.run(String(ts), row.id);
  }
}''',
    'یکسان‌سازی زمان محدودیت')

replace_once('async function restrictAcrossGroups(api, telegramId, username = "") {',
             'async function restrictAcrossGroups(api, telegramId, username = "", durationMinutes = RESTRICTION_MINUTES) {',
             'امضای تابع محدودیت')
replace_once('Math.floor(Date.now() / 1000) + RESTRICTION_MINUTES * 60;',
             'Math.floor(Date.now() / 1000) + durationMinutes * 60;', 'محاسبه زمان محدودیت')
replace_once('const restrictedUntil = new Date(untilUnix * 1000).toISOString();',
             'const restrictedUntil = String(untilUnix);', 'ذخیره زمان یونیکس')
replace_once('WHERE restored_at IS NULL\n      AND restricted_until <= ?',
             'WHERE restored_at IS NULL\n      AND CAST(restricted_until AS INTEGER) <= ?', 'بررسی پایان محدودیت')
replace_once('مدت: ${RESTRICTION_MINUTES} دقیقه\\n',
             'مدت: ${durationMinutes} دقیقه\\n', 'نمایش مدت محدودیت')
replace_once('AND restricted_until > ?\n      LIMIT 1',
             'AND CAST(restricted_until AS INTEGER) > ?\n      LIMIT 1', 'بررسی محدودیت فعال')

replace_once(
    '''  const username = user.username ? `@${escapeHtml(user.username)}` : "بدون یوزرنیم";
  const randomWarning = WARNINGS[Math.floor(Math.random() * WARNINGS.length)];

  try {
    await ctx.reply(
      `⚠️ ${escapeHtml(randomWarning)}\\nاخطار فعال: ${total}/${WARNING_LIMIT}`
    );
  } catch {}''',
    '''  const username = user.username ? `@${escapeHtml(user.username)}` : "بدون یوزرنیم";
  const mention = '<a href="tg://user?id=' + user.id + '">' + escapeHtml(user.first_name || "کاربر") + "</a>";
  const randomWarning = WARNINGS[Math.floor(Math.random() * WARNINGS.length)];

  try {
    await ctx.reply(
      `${mention}\\n⚠️ ${escapeHtml(randomWarning)}\\nاخطار فعال: ${total}/${WARNING_LIMIT}`,
      { parse_mode: "HTML" }
    );
  } catch {}''',
    'منشن در اخطار قالب رول')

replace_once('function validateRoleplay(text) {',
'''async function warnNeed(api, person, need, currentTime) {
  const telegramId = Number(person.telegram_id);
  const chatId = Number(person.chat_id);
  const food = need === "food";
  const reasonCode = food ? "NEED_FOOD" : "NEED_SLEEP";
  const heading = food ? "اخطار عدم ثبت غذا" : "اخطار عدم ثبت خواب";
  const detail = food
    ? "در بازهٔ ۸ ساعته غذا ثبت نکرده‌ای."
    : "در بازهٔ ۲۴ ساعته خواب ثبت نکرده‌ای.";
  const instruction = food
    ? "برای ثبت غذا، در همین گروه هشتگ #خوردن را ارسال کن."
    : "برای ثبت خواب، در همین گروه هشتگ #خوابیدن یا #خواب را ارسال کن.";
  const displayName = person.display_name || (person.username ? "@" + person.username : "کاربر مونتادوریا");
  const mention = '<a href="tg://user?id=' + telegramId + '">' + escapeHtml(displayName) + "</a>";

  const inserted = db.prepare(`
    INSERT INTO observer_warnings (telegram_id, chat_id, message_id, reason, created_at)
    VALUES (?, ?, NULL, ?, ?)
  `).run(telegramId, chatId, reasonCode, currentTime);
  const total = getActiveWarnings(telegramId);

  try {
    await api.sendMessage(
      chatId,
      `${mention}\\n⚠️ <b>${heading}</b>\\n\\n${detail}\\n${instruction}\\nاخطار فعال: <b>${total}/${WARNING_LIMIT}</b>`,
      { parse_mode: "HTML" }
    );
  } catch (error) {
    db.prepare("UPDATE observer_warnings SET active = 0, cleared_at = ? WHERE id = ? AND active = 1")
      .run(currentTime, inserted.lastInsertRowid);
    console.error("Needs warning send failed:", telegramId, chatId, error.message || error);
    await report(api, `⚠️ ارسال اخطار نیاز ناموفق بود | شناسه: ${telegramId} | گروه: ${chatId} | ${escapeHtml(error.message || String(error))}`);
    return;
  }

  const warningColumn = food ? "last_food_warning_at" : "last_sleep_warning_at";
  db.prepare(`UPDATE observer_needs SET ${warningColumn} = ?, updated_at = ? WHERE telegram_id = ?`)
    .run(currentTime, currentTime, telegramId);

  await report(api, `⚠️ ${heading} | کاربر: ${telegramId} | گروه: ${chatId} | اخطار فعال: ${total}/${WARNING_LIMIT}`);

  if (total >= WARNING_LIMIT) {
    const active = db.prepare(`
      SELECT 1 FROM observer_restrictions
      WHERE telegram_id = ? AND restored_at IS NULL
        AND CAST(restricted_until AS INTEGER) > ?
      LIMIT 1
    `).get(telegramId, currentTime);
    if (!active) {
      await restrictAcrossGroups(api, telegramId, person.username || "", NEEDS_RESTRICTION_MINUTES);
    }
  }
}

function validateRoleplay(text) {''', 'مسیر مشترک اخطار غذا و خواب')

replace_once('function updateNeed(telegramId, field) {',
'''function clearNeedWarnings(telegramId, need) {
  const reasonCode = need === "food" ? "NEED_FOOD" : "NEED_SLEEP";
  db.prepare(`
    UPDATE observer_warnings SET active = 0, cleared_at = ?
    WHERE telegram_id = ? AND active = 1 AND reason = ?
  `).run(now(), telegramId, reasonCode);
  const warningColumn = need === "food" ? "last_food_warning_at" : "last_sleep_warning_at";
  db.prepare(`UPDATE observer_needs SET ${warningColumn} = 0, updated_at = ? WHERE telegram_id = ?`)
    .run(now(), telegramId);
}

function updateNeed(telegramId, field) {''', 'پاک‌سازی اخطار نیاز')
replace_once(
    '''  `).run(now(), now(), telegramId);
}

export function registerObserver(bot) {''',
    '''  `).run(now(), now(), telegramId);

  if (field === "food" || field === "sleep") clearNeedWarnings(telegramId, field);
}

export function registerObserver(bot) {''',
    'پاک کردن اخطار پس از ثبت نیاز')

replace_between(
    '  // MONTADORIA_FOOD_REMINDER_V1',
    '  // END MONTADORIA_FOOD_REMINDER_V1',
    '''  // MONTADORIA_NEEDS_WARNING_V2
  for (const column of ["last_food_warning_at", "last_sleep_warning_at"]) {
    try {
      db.exec(`ALTER TABLE observer_needs ADD COLUMN ${column} INTEGER`);
    } catch (error) {
      if (!String(error.message).includes("duplicate column")) throw error;
    }
  }

  // Convert legacy ISO values in need timestamps before comparing them.
  for (const column of ["last_food_at", "last_sleep_at", "sleep_until", "last_food_warning_at", "last_sleep_warning_at"]) {
    const rows = db.prepare(`SELECT telegram_id, ${column} AS value FROM observer_needs WHERE typeof(${column}) = 'text'`).all();
    const update = db.prepare(`UPDATE observer_needs SET ${column} = ? WHERE telegram_id = ?`);
    for (const row of rows) update.run(toUnixSeconds(row.value) || null, row.telegram_id);
  }

  const startTime = now();
  db.prepare(`
    INSERT OR IGNORE INTO observer_needs (telegram_id, last_food_at, last_sleep_at, updated_at)
    SELECT telegram_id, ?, ?, ? FROM observer_active_map
  `).run(startTime, startTime, startTime);
  db.prepare(`
    UPDATE observer_needs
    SET
      last_food_at = CASE WHEN CAST(COALESCE(last_food_at, 0) AS INTEGER) <= 0 THEN ? ELSE last_food_at END,
      last_sleep_at = CASE WHEN CAST(COALESCE(last_sleep_at, 0) AS INTEGER) <= 0 THEN ? ELSE last_sleep_at END,
      updated_at = ?
    WHERE telegram_id IN (SELECT telegram_id FROM observer_active_map)
  `).run(startTime, startTime, startTime);

  let needsWarningCheckRunning = false;
  const checkNeedsWarnings = async () => {
    if (needsWarningCheckRunning) return;
    needsWarningCheckRunning = true;
    try {
      const currentTime = now();
      const people = db.prepare(`
        SELECT n.telegram_id, n.last_food_at, n.last_sleep_at,
               n.last_food_warning_at, n.last_sleep_warning_at,
               m.chat_id, u.username, u.display_name
        FROM observer_needs n
        INNER JOIN observer_active_map m ON m.telegram_id = n.telegram_id
        LEFT JOIN users u ON u.telegram_id = n.telegram_id
      `).all();

      for (const person of people) {
        const foodAt = toUnixSeconds(person.last_food_at);
        const sleepAt = toUnixSeconds(person.last_sleep_at);
        const foodWarnAt = toUnixSeconds(person.last_food_warning_at);
        const sleepWarnAt = toUnixSeconds(person.last_sleep_warning_at);

        if (foodAt > 0 && currentTime - foodAt >= 8 * 3600 &&
            (!foodWarnAt || currentTime - foodWarnAt >= 4 * 3600)) {
          await warnNeed(bot.api, person, "food", currentTime);
        }
        if (sleepAt > 0 && currentTime - sleepAt >= 24 * 3600 &&
            (!sleepWarnAt || currentTime - sleepWarnAt >= 4 * 3600)) {
          await warnNeed(bot.api, person, "sleep", currentTime);
        }
      }
    } finally {
      needsWarningCheckRunning = false;
    }
  };

  const needsWarningTimer = setInterval(() => {
    checkNeedsWarnings().catch(error => console.error("Needs warning check failed:", error));
  }, 60_000);
  needsWarningTimer.unref?.();
  checkNeedsWarnings().catch(console.error);
  // END MONTADORIA_NEEDS_WARNING_V2''',
    'زمان‌بندی یکپارچه اخطار غذا و خواب')

replace_once(r'line => line.trim().split(/\\s+/)[0] === tag',
             r'line => line.trim().split(/\s+/)[0] === tag',
             'اصلاح تشخیص هشتگ نیاز')

replace_once(
    '''        `).run(user.id, ctx.chat.id, now(), user.username || null);

        await report(ctx,
          `🚪 ورود به مپ | کاربر: ${user.id} | گروه: ${ctx.chat.id}`
        );''',
    '''        `).run(user.id, ctx.chat.id, now(), user.username || null);

        const enteredAt = now();
        ensureNeeds(user.id);
        db.prepare(`
          UPDATE observer_needs
          SET last_food_at = COALESCE(NULLIF(last_food_at, 0), ?),
              last_sleep_at = COALESCE(NULLIF(last_sleep_at, 0), ?),
              updated_at = ?
          WHERE telegram_id = ?
        `).run(enteredAt, enteredAt, enteredAt, user.id);

        await report(ctx,
          `🚪 ورود به مپ | کاربر: ${user.id} | گروه: ${ctx.chat.id}`
        );''',
    'شروع زمان نیازها هنگام ورود')

replace_once(
    '''        `).run(
          currentTime,
          currentTime + sleepHours * 3600,
          currentTime,
          user.id
        );

        await report(ctx,
          `🌙 ثبت خواب''',
    '''        `).run(
          currentTime,
          currentTime + sleepHours * 3600,
          currentTime,
          user.id
        );

        clearNeedWarnings(user.id, "sleep");

        await report(ctx,
          `🌙 ثبت خواب''',
    'پاکسازی اخطار بعد از خواب')

checks = {
    'زمان‌بندی غذا و خواب': 'MONTADORIA_NEEDS_WARNING_V2' in updated,
    'ثبت اخطار غذا': 'NEED_FOOD' in updated,
    'ثبت اخطار خواب': 'NEED_SLEEP' in updated,
    'محدودیت دو ساعته': 'NEEDS_RESTRICTION_MINUTES || 120' in updated,
    'منشن قابل کلیک': 'href="tg://user?id=' in updated,
    'اصلاح تشخیص هشتگ': r'split(/\s+/)[0] === tag' in updated,
    'مقایسه عددی محدودیت': 'CAST(restricted_until AS INTEGER) > ?' in updated,
    'حذف زمان‌بندی قدیمی غذا': '  // MONTADORIA_FOOD_REMINDER_V1' not in updated,
}
if not all(checks.values()):
    print('ERROR: بررسی نهایی ناموفق بود:')
    for key, value in checks.items():
        print(f'  {key}: {"OK" if value else "FAILED"}')
    sys.exit(2)
if updated == source:
    print('این اصلاحات قبلاً روی فایل اعمال شده‌اند؛ تغییری انجام نشد.')
    sys.exit(0)

backup = TARGET.with_name(TARGET.name + '.before-needs-warning-fix-' + datetime.now().strftime('%Y%m%d-%H%M%S') + '.bak')
shutil.copy2(TARGET, backup)
TARGET.write_text(updated, encoding="utf-8")
check = subprocess.run(["node", "--check", str(TARGET)], text=True, capture_output=True)
if check.returncode != 0:
    shutil.copy2(backup, TARGET)
    print("❌ بررسی نحوی Node.js ناموفق بود؛ فایل اصلی از نسخه پشتیبان بازگردانده شد.")
    print(check.stdout)
    print(check.stderr)
    sys.exit(3)

print("✅ اصلاحات روی src/observer.js اعمال شد.")
print(f"نسخه پشتیبان: {backup}")
print("✅ بررسی نحوی Node.js موفق بود.")
print("اکنون فقط این دستور را هم اجرا کن:")
print("git diff --check")
