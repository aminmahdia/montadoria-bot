from pathlib import Path
import shutil
import sys

FILE = Path('src/observer.js')
if not FILE.exists():
    print('ERROR: از پوشه اصلی montadoria-bot اجرا کن؛ src/observer.js پیدا نشد.')
    sys.exit(1)

source = FILE.read_text(encoding='utf-8')
if 'MONTADORIA_NEEDS_REMINDER_V2' in source:
    print('این نسخه از اصلاحات نیازها قبلاً اضافه شده است؛ تغییری انجام نشد.')
    sys.exit(0)


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'محل تغییر «{label}» باید دقیقاً یک بار باشد؛ تعداد پیدا شده: {count}')
    return text.replace(old, new, 1)


s = source

# Timestamp compatibility: supports both old ISO strings and Unix seconds.
s = replace_once(
    s,
    'const now = () => Math.floor(Date.now() / 1000);\n',
    r'''const now = () => Math.floor(Date.now() / 1000);

function timestampToUnix(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value > 1e12 ? value / 1000 : value);
  const raw = String(value).trim();
  if (/^[+-]?\d+(?:\.\d+)?$/.test(raw)) {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return Math.floor(numeric > 1e12 ? numeric / 1000 : numeric);
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}
''',
    'تابع تبدیل زمان'
)

# Clear active warnings for one need after the user satisfies it.
s = replace_once(
    s,
    'export function registerObserver(bot) {',
    r'''function clearNeedWarnings(telegramId, needType) {
  const allowed = { food: "last_food_warning_at", sleep: "last_sleep_warning_at", blood: "last_blood_warning_at" };
  const column = allowed[needType];
  if (!column) return;
  const currentTime = now();
  db.prepare(`
    UPDATE observer_need_warnings SET active = 0, cleared_at = ?
    WHERE telegram_id = ? AND need_type = ? AND active = 1
  `).run(currentTime, telegramId, needType);
  ensureNeeds(telegramId);
  db.prepare(`
    UPDATE observer_needs SET ${column} = 0, updated_at = ?
    WHERE telegram_id = ?
  `).run(currentTime, telegramId);
}

export function registerObserver(bot) {''',
    'تابع پاک‌سازی اخطار نیاز'
)

# Keep the ordinary RP warning restriction at its existing default (30 minutes),
# but allow needs-related restrictions to use 120 minutes.
s = replace_once(
    s,
    'async function restrictAcrossGroups(api, telegramId, username = "") {',
    'async function restrictAcrossGroups(api, telegramId, username = "", durationMinutes = RESTRICTION_MINUTES, reason = "") {',
    'پارامتری کردن مدت محدودیت'
)
s = replace_once(
    s,
    'Math.floor(Date.now() / 1000) + RESTRICTION_MINUTES * 60;',
    'Math.floor(Date.now() / 1000) + durationMinutes * 60;',
    'محاسبه مدت محدودیت'
)
s = replace_once(
    s,
    'const restrictedUntil = new Date(untilUnix * 1000).toISOString();',
    'const restrictedUntil = String(untilUnix);',
    'ذخیره زمان محدودیت به‌صورت یونیکس'
)
if '${RESTRICTION_MINUTES} دقیقه' not in s:
    raise RuntimeError('متن گزارش مدت محدودیت پیدا نشد.')
s = s.replace('${RESTRICTION_MINUTES} دقیقه', '${durationMinutes} دقیقه')

# Fix restriction-expiry bookkeeping for both historical ISO and new Unix timestamps.
restore_start = s.find('async function restoreExpiredRestrictions(bot) {')
warning_start = s.find('function getActiveWarnings(telegramId) {', restore_start)
if restore_start < 0 or warning_start < 0:
    raise RuntimeError('بخش بازگردانی محدودیت پیدا نشد.')
s = s[:restore_start] + r'''async function restoreExpiredRestrictions(bot) {
  const currentTime = now();
  const pending = db.prepare(`
    SELECT id, restricted_until FROM observer_restrictions
    WHERE restored_at IS NULL
  `).all();
  const expired = pending.filter(row => {
    const until = timestampToUnix(row.restricted_until);
    return until > 0 && until <= currentTime;
  });
  if (!expired.length) return;
  const markRestored = db.prepare(`
    UPDATE observer_restrictions SET restored_at = ?
    WHERE id = ? AND restored_at IS NULL
  `);
  let restoredCount = 0;
  for (const item of expired) restoredCount += markRestored.run(currentTime, item.id).changes;
  if (restoredCount) {
    await report(bot.api,
      `✅ مدت محدودیت ${restoredCount} مورد به پایان رسید. تلگرام محدودیت زمان‌دار را به‌صورت خودکار منقضی می‌کند.`
    );
  }
}

''' + s[warning_start:]

# Correct the active-restriction check used by ordinary RP warnings.
s = replace_once(
    s,
    '''    const existingRestriction = db.prepare(`
      SELECT 1 FROM observer_restrictions
      WHERE telegram_id = ? AND restored_at IS NULL
        AND restricted_until > ?
      LIMIT 1
    `).get(user.id, now());

    if (!existingRestriction) {''',
    '''    const activeRestrictionRows = db.prepare(`
      SELECT restricted_until FROM observer_restrictions
      WHERE telegram_id = ? AND restored_at IS NULL
    `).all(user.id);
    const existingRestriction = activeRestrictionRows.some(row =>
      timestampToUnix(row.restricted_until) > now()
    );
    if (!existingRestriction) {''',
    'بررسی محدودیت فعال'
)

# Replace the old food-only reminder with unified food/sleep/vampire-blood reminders.
food_start_marker = '  // MONTADORIA_FOOD_REMINDER_V1'
food_end_marker = '  // END MONTADORIA_FOOD_REMINDER_V1'
food_start = s.find(food_start_marker)
food_end = s.find(food_end_marker, food_start)
if food_start < 0 or food_end < 0:
    raise RuntimeError('بلوک قبلی یادآوری غذا پیدا نشد.')
food_end += len(food_end_marker)

new_block = r'''  // MONTADORIA_NEEDS_REMINDER_V2
  for (const column of ["last_food_warning_at", "last_sleep_warning_at", "last_blood_warning_at"]) {
    try {
      db.exec(`ALTER TABLE observer_needs ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`);
    } catch (error) {
      if (!String(error.message).toLowerCase().includes("duplicate column")) throw error;
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS observer_need_warnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER NOT NULL,
      need_type TEXT NOT NULL,
      chat_id INTEGER NOT NULL,
      reason TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      cleared_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_observer_need_warnings_active
    ON observer_need_warnings (telegram_id, active);
  `);

  let needReminderCheckRunning = false;
  const checkNeedReminders = async () => {
    if (needReminderCheckRunning) return;
    needReminderCheckRunning = true;
    try {
      const currentTime = now();
      const people = db.prepare(`
        SELECT m.telegram_id, m.chat_id, m.entered_at,
          m.username AS map_username,
          n.last_food_at, n.last_sleep_at, n.last_blood_at,
          n.last_food_warning_at, n.last_sleep_warning_at, n.last_blood_warning_at,
          r.race, r.updated_at AS race_updated_at,
          u.display_name, u.username AS user_username
        FROM observer_active_map m
        LEFT JOIN observer_needs n ON n.telegram_id = m.telegram_id
        LEFT JOIN observer_races r ON r.telegram_id = m.telegram_id
        LEFT JOIN users u ON u.telegram_id = m.telegram_id
      `).all();

      const warnForNeed = async (person, needType, baseline, intervalSeconds, detail, warningColumn) => {
        const telegramId = Number(person.telegram_id);
        const chatId = Number(person.chat_id);
        const lastWarningAt = timestampToUnix(person[warningColumn]);
        if (!baseline || currentTime - baseline < intervalSeconds) return;
        if (lastWarningAt > 0 && currentTime - lastWarningAt < 4 * 3600) return;

        const displayName = person.display_name ||
          (person.user_username ? `@${person.user_username}` : "") ||
          (person.map_username ? `@${person.map_username}` : "") || "بازیکن";
        const mention = `<a href="tg://user?id=${telegramId}">${escapeHtml(displayName)}</a>`;
        // پیام عمومی نوع نیاز و نژاد را فاش نمی‌کند.
        const groupMessage =
          "⚠️ <b>یادآوری وضعیت شخصیت</b>\n\n" +
          `${mention}، زمان رسیدگی به یکی از نیازهای دوره‌ای شخصیتت گذشته است. لطفاً وضعیت مربوطه را ثبت کن.`;

        try {
          await bot.api.sendMessage(chatId, groupMessage, {
            parse_mode: "HTML", disable_web_page_preview: true
          });
        } catch (error) {
          console.error("ارسال اخطار نیاز ناموفق بود:", telegramId, needType, error.message || error);
          return;
        }

        // جزئیات خون فقط در پیام خصوصی یادآوری خون‌آشام موجود ارسال می‌شود.
        if (needType !== "blood") {
          try {
            await bot.api.sendMessage(
              telegramId,
              detail + "\n\nوضعیت را در گروهی که با #ورود در آن حضور داری ثبت کن."
            );
          } catch (error) {
            console.warn("ارسال جزئیات خصوصی نیاز ممکن نشد:", telegramId, needType, error.message || error);
          }
        }

        ensureNeeds(telegramId);
        db.prepare(`
          INSERT INTO observer_need_warnings
            (telegram_id, need_type, chat_id, reason, active, created_at)
          VALUES (?, ?, ?, ?, 1, ?)
        `).run(telegramId, needType, chatId, "عدم رسیدگی به نیاز دوره‌ای شخصیت", currentTime);
        db.prepare(`
          UPDATE observer_needs SET ${warningColumn} = ?, updated_at = ?
          WHERE telegram_id = ?
        `).run(currentTime, currentTime, telegramId);

        const activeNeedWarnings = db.prepare(`
          SELECT COUNT(*) AS total FROM observer_need_warnings
          WHERE telegram_id = ? AND active = 1
        `).get(telegramId).total;
        await report(bot.api,
          `⚠️ اخطار نیاز دوره‌ای ثبت شد | کاربر: ${telegramId} | گروه: ${chatId} | اخطار فعال نیازها: ${activeNeedWarnings}/${WARNING_LIMIT}`
        );

        if (activeNeedWarnings >= WARNING_LIMIT) {
          const restrictionRows = db.prepare(`
            SELECT restricted_until FROM observer_restrictions
            WHERE telegram_id = ? AND restored_at IS NULL
          `).all(telegramId);
          const latestUntil = restrictionRows.reduce(
            (latest, row) => Math.max(latest, timestampToUnix(row.restricted_until)), 0
          );
          const requiredUntil = currentTime + 120 * 60;
          if (latestUntil < requiredUntil) {
            try {
              await bot.api.sendMessage(chatId,
                `⛔ ${mention} به حد ${WARNING_LIMIT} اخطار فعال نیازهای شخصیت رسیده است. محدودیت ارسال پیام به مدت ۲ ساعت در گروه‌های نقش‌آفرینی اعمال می‌شود.`,
                { parse_mode: "HTML" }
              );
            } catch {}
            await restrictAcrossGroups(
              bot.api, telegramId,
              person.user_username || person.map_username || "",
              120,
              "عدم رسیدگی به نیازهای دوره‌ای شخصیت"
            );
          }
        }
      };

      for (const person of people) {
        const enteredAt = timestampToUnix(person.entered_at);
        const foodAt = timestampToUnix(person.last_food_at) || enteredAt;
        const sleepAt = timestampToUnix(person.last_sleep_at) || enteredAt;
        await warnForNeed(person, "food", foodAt, 8 * 3600,
          "🍽️ یادآوری غذا\nزمان ثبت غذای شخصیتت رسیده است. در گروه مپ از هشتگ #خوردن استفاده کن.",
          "last_food_warning_at");
        await warnForNeed(person, "sleep", sleepAt, 24 * 3600,
          "🌙 یادآوری خواب\nزمان ثبت خواب شخصیتت رسیده است. در گروه مپ از هشتگ #خواب استفاده کن.",
          "last_sleep_warning_at");

        if (person.race === "خون‌آشام") {
          const bloodAt = timestampToUnix(person.last_blood_at) ||
            timestampToUnix(person.race_updated_at);
          await warnForNeed(person, "blood", bloodAt, 12 * 3600,
            "🩸 یادآوری نیاز شخصیت\nزمان نوشیدن خون رسیده است. پس از انجام آن، در گروه مپ هشتگ #خون را ثبت کن.",
            "last_blood_warning_at");
        }
      }
    } finally {
      needReminderCheckRunning = false;
    }
  };

  const needReminderTimer = setInterval(() => {
    checkNeedReminders().catch(error =>
      console.error("خطا در بررسی نیازهای شخصیت:", error)
    );
  }, 60_000);
  needReminderTimer.unref?.();
  checkNeedReminders().catch(console.error);
  // END MONTADORIA_NEEDS_REMINDER_V2'''

s = s[:food_start] + new_block + s[food_end:]

# Start food and sleep clocks when a player enters a map for the first time.
s = replace_once(
    s,
    '''      if (!activeMap) {
        db.prepare(`
          INSERT INTO observer_active_map
            (telegram_id, chat_id, entered_at, username)
          VALUES (?, ?, ?, ?)
        `).run(user.id, ctx.chat.id, now(), user.username || null);

        await report(ctx,''',
    '''      if (!activeMap) {
        const enteredAt = now();
        db.prepare(`
          INSERT INTO observer_active_map
            (telegram_id, chat_id, entered_at, username)
          VALUES (?, ?, ?, ?)
        `).run(user.id, ctx.chat.id, enteredAt, user.username || null);
        ensureNeeds(user.id);
        db.prepare(`
          UPDATE observer_needs
          SET last_food_at = COALESCE(last_food_at, ?),
              last_sleep_at = COALESCE(last_sleep_at, ?),
              updated_at = ?
          WHERE telegram_id = ?
        `).run(enteredAt, enteredAt, enteredAt, user.id);
        await report(ctx,''',
    'آغاز شمارش نیازها هنگام ورود به مپ'
)

# Clear blood warnings after #خون is registered.
s = replace_once(
    s,
    '''      db.prepare(`
        UPDATE observer_needs
        SET last_blood_at = ?, updated_at = ?
        WHERE telegram_id = ?
      `).run(bloodTime, bloodTime, user.id);

      db.prepare(`''',
    '''      db.prepare(`
        UPDATE observer_needs
        SET last_blood_at = ?, updated_at = ?
        WHERE telegram_id = ?
      `).run(bloodTime, bloodTime, user.id);
      clearNeedWarnings(user.id, "blood");

      db.prepare(`''',
    'پاک‌سازی اخطار خون پس از ثبت'
)

# The original regex had an extra backslash and did not split whitespace correctly.
old_regex = r'line.trim().split(/\\s+/)[0] === tag'
new_regex = r'line.trim().split(/\s+/)[0] === tag'
s = replace_once(s, old_regex, new_regex, 'اصلاح تشخیص هشتگ نیاز')

# Clear food warnings after successful #خوردن.
s = replace_once(
    s,
    '''        updateNeed(user.id, "food");

        await report(ctx,''',
    '''        updateNeed(user.id, "food");
        clearNeedWarnings(user.id, "food");

        await report(ctx,''',
    'پاک‌سازی اخطار غذا'
)

# Clear sleep warnings after successful #خواب / #خوابیدن.
sleep_marker = '        await report(ctx,\n          `🌙 ثبت خواب | کاربر:'
if s.count(sleep_marker) != 1:
    raise RuntimeError('محل ثبت موفق خواب پیدا نشد یا تکراری است.')
s = s.replace(
    sleep_marker,
    '        clearNeedWarnings(user.id, "sleep");\n\n' + sleep_marker,
    1
)

if 'MONTADORIA_NEEDS_REMINDER_V2' not in s:
    raise RuntimeError('نشان نسخه جدید نیازها ایجاد نشد.')

# Only write once all transformations have succeeded.
backup = Path('src/observer.js.before-needs-v2.bak')
shutil.copy2(FILE, backup)
FILE.write_text(s, encoding='utf-8')
print('اصلاح سیستم غذا، خواب، خون و اخطارهای ۲ ساعته اعمال شد.')
print(f'بکاپ ساخته شد: {backup}')
print('اکنون node --check src/observer.js و git diff --check را اجرا کن.')
