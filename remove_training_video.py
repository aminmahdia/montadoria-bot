from pathlib import Path
import re

p = Path("src/training.js")
s = p.read_text(encoding="utf-8")
original = s

def need(condition, message):
    if not condition:
        raise SystemExit("توقف امن: " + message)

def cut(start, end, label):
    global s
    a = s.find(start)
    need(a >= 0, f"ابتدای {label} پیدا نشد.")
    b = s.find(end, a + len(start))
    need(b > a, f"انتهای {label} پیدا نشد.")
    s = s[:a] + s[b:]

need(not Path("src/training.js.before_video_removal").exists(),
     "نسخه پشتیبان از قبل وجود دارد.")

# حذف importهای رسانه
for line in [
    'import { InputFile } from "grammy";\n',
    'import sharp from "sharp";\n',
    'import ffmpegPath from "ffmpeg-static";\n',
    'import { execFile } from "node:child_process";\n',
    'import { promisify } from "node:util";\n',
    'import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";\n',
    'import { tmpdir } from "node:os";\n',
    'import { join } from "node:path";\n',
    'const runFFmpeg = promisify(execFile);\n',
    'sharp.concurrency(1);\n',
    'const PROFILE_SKILLS_LIMIT = 4;\n'
]:
    s = s.replace(line, "")

# حذف جدول‌های مخصوص کارت ویدئویی
for table in [
    "training_profile_posts",
    "training_profile_videos",
    "training_profile_photo_requests"
]:
    pattern = (
        r"CREATE TABLE IF NOT EXISTS " + table +
        r" \([\s\S]*?\n\);\n"
    )
    s, n = re.subn(pattern, "", s, count=1)
    need(n == 1, f"تعریف جدول {table} پیدا نشد.")

s, n = re.subn(
    r'db\.exec\(`\s*CREATE TABLE IF NOT EXISTS training_profile_video_request_once[\s\S]*?`\);\s*',
    '',
    s,
    count=1
)
need(n == 1, "جدول درخواست یک‌باره ویدئو پیدا نشد.")

# حذف تابع SVG
cut("function escapeSvg(value) {",
    "function calculateLevelFromXP", "تابع SVG")

# حذف موتور کارت ویدئویی، با حفظ weaponIcon و notifyPlayer
cut("function fireColor(percent) {",
    "// NOTIFY PLAYER", "موتور تولید کارت ویدئویی")

# حذف بخش حذف پیام کارت از گزارش نهایی؛ گزارش ناظران حفظ می‌شود
old = '''  // حذف پیام موقت قدیمی از کانال مهارت.
  const channelId =
    review.channel_id || getSetting("skill_channel_id");

  if (channelId && review.channel_message_id) {
    try {
      await bot.api.deleteMessage(
        channelId,
        review.channel_message_id
      );
    } catch (error) {
      console.error(
        "TRAINING_SKILL_REQUEST_DELETE_ERROR:",
        error?.description || error?.message || error
      );
    }
  }
'''
need(s.count(old) == 1, "بخش پاک‌سازی پیام کارت پیدا نشد.")
s = s.replace(old, "", 1)

# حذف دستور وضعیت، دریافت ویدئو و تغییر ویدئو
cut(
    "  // READ-ONLY LIVE STATUS OF THE RUNNING DATABASE.",
    "  // DELETE PLAYER SKILLS COMMANDS",
    "دستورات ویدئویی"
)

# حذف به‌روزرسانی کارت پس از حذف مهارت
card_update = '''      try {
        await updatePersistentSkillProfile(bot, targetId);
      } catch (err) {
        console.error("Skill profile update failed:", err);
      }

'''
need(s.count(card_update) == 2, "فراخوانی به‌روزرسانی کارت پس از حذف مهارت‌ها پیدا نشد.")
s = s.replace(card_update, "", 2)

# حذف وابستگی به کانال مهارت در ثبت تمرین
old = '''    const skillChannel = getSetting("skill_channel_id");
    const reviewGroup = getSetting("training_review_group_id");

    if (!skillChannel || !reviewGroup) {
      return ctx.reply(
        "⚙️ تنظیم کانال‌ها کامل نیست.\\n" +
        (!skillChannel
          ? "کانال مهارت: /skillchannel شناسه_کانال\\n"
          : "") +
        (!reviewGroup
          ? "گروه اطلاعات: دستور /trainingreviewgroup را داخل همان گروه اجرا کنید."
          : "")
      );
    }
'''
new = '''    const reviewGroup = getSetting("training_review_group_id");

    if (!reviewGroup) {
      return ctx.reply(
        "⚙️ گروه بررسی تمرین تنظیم نشده است. دستور /trainingreviewgroup را داخل همان گروه اجرا کنید."
      );
    }
'''
need(s.count(old) == 1, "بخش تنظیم کانال هنگام ثبت تمرین پیدا نشد.")
s = s.replace(old, new, 1)

# حذف ستون کانال از درخواست‌های جدید؛ ستون قدیمی دیتابیس دست‌نخورده می‌ماند
old = '''        duration_minutes,points,xp,status,created_at,
        channel_id,source_chat_id,source_message_id
      )
      VALUES(?,?,?,?,?,?,?,'pending',?,?,?,?)
'''
new = '''        duration_minutes,points,xp,status,created_at,
        source_chat_id,source_message_id
      )
      VALUES(?,?,?,?,?,?,?,'pending',?,?,?)
'''
need(s.count(old) == 1, "ساختار ثبت درخواست تمرین پیدا نشد.")
s = s.replace(old, new, 1)

old = '''      now,
      String(skillChannel),
      chatId,
      sourceMessageId
'''
new = '''      now,
      chatId,
      sourceMessageId
'''
need(s.count(old) == 1, "پارامتر کانال در ثبت تمرین پیدا نشد.")
s = s.replace(old, new, 1)

# حذف درخواست ویدئو پس از ثبت تمرین
old = '''      try {
        await requestTrainingProfileVideo(bot, id, chatId);
      } catch (error) {
        console.error(
          "TRAINING_PROFILE_PHOTO_REQUEST_ERROR:",
          error?.description || error?.message || error
        );
      }

'''
need(s.count(old) == 1, "درخواست ویدئو پس از ثبت تمرین پیدا نشد.")
s = s.replace(old, "", 1)

# حذف تنظیم کانال کارت
cut("  // SET SKILL CHANNEL",
    "  // TEXT PROFILE", "دستور کانال کارت")

# حذف متن وابسته به آتش از پروفایل متنی
old = '''      `${body}\\n\\n` +
      "🔥 هر مهارت با رسیدن به ۱۰۰ امتیاز، به آتش رنگی کامل می‌رسد."
'''
need(s.count(old) == 1, "متن قدیمی کارت در پروفایل متنی پیدا نشد.")
s = s.replace(old, '''      `${body}`
''', 1)

# حذف ساخت کارت بعد از تأیید؛ عملیات تأیید و XP باقی می‌ماند
cut(
    "    // به‌روزرسانی کارت دائمی بازیکن.",
    "    await notifyPlayer(bot, approved, true);",
    "به‌روزرسانی کارت پس از تأیید"
)

# کنترل نهایی
for term in [
    "updatePersistentSkillProfile",
    "requestTrainingProfileVideo",
    "buildSkillProfileVideo",
    "getTrainingProfileVideoBuffer",
    "message:video",
    "#تغییر_ویدئو_کارت",
    "#وضعیت_کارت_مهارت",
    "ffmpeg-static",
    "sharp(",
    "skill_channel_id",
    "InputFile"
]:
    need(term not in s, "وابستگی ویدئویی باقی مانده: " + term)

for term in [
    "export function registerTraining(bot)",
    "training:approve:",
    "training:reject:",
    "awardTrainingXP",
    "trainingprofile",
    "training_sessions",
    "training_reviews",
    "training_skills",
    "trainingreviewgroup",
    "notifyPlayer(bot, approved, true)"
]:
    need(term in s, "بخش اصلی سیستم پیدا نشد: " + term)

# ذخیره امن: اول پشتیبان، بعد فایل جدید
backup = Path("src/training.js.before_video_removal")
backup.write_text(original, encoding="utf-8")
p.write_text(s, encoding="utf-8")

print("✅ کد کارت ویدئویی حذف شد.")
print("✅ سیستم تمرین، تأیید، رد، XP، سطح و پروفایل متنی حفظ شد.")
print("✅ نسخه پشتیبان ساخته شد.")
