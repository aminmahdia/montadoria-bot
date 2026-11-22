from pathlib import Path
import re

p = Path("src/combat.js")
s = p.read_text(encoding="utf-8")
original = s

# حذف سقف ۱۰ دور
s = s.replace("const MAX_ROUNDS = 10;\n", "")

# جایگزینی کامل پنل متنی با HUD ثابت
start = s.find("function duelText(duel) {")
end = s.find("\nfunction combatKeyboard(duel) {", start)

if start < 0 or end < 0:
    raise SystemExit("تابع duelText پیدا نشد؛ فایل تغییر نکرد.")

hud = r'''function duelText(duel) {
  const hpA = Math.max(0, Math.min(100, Number(duel.hp_a ?? 100)));
  const hpB = Math.max(0, Math.min(100, Number(duel.hp_b ?? 100)));
  const energyA = Math.max(0, Math.min(100, Number(duel.energy_a ?? 100)));
  const energyB = Math.max(0, Math.min(100, Number(duel.energy_b ?? 100)));

  const bar = (value, color) => {
    const filled = Math.round(value / 10);
    return color.repeat(filled) + "⬛".repeat(10 - filled);
  };

  let status = "⚔️ مبارزه در جریان";
  if (duel.status === "finished") status = "🏆 مبارزه پایان یافت";
  if (duel.status === "draw") status = "🤝 پایان توافقی";
  if (duel.status === "cancelled") status = "⛓️ مبارزه لغو شد";
  if (duel.status === "pending") status = "⌛ منتظر پذیرش مبارزه";

  const playerA = playerName(duel.challenger_id);
  const playerB = playerName(duel.opponent_id);

  let text = `⚔️ DUEL #${duel.id}
${status}

${playerA}
❤️ ${hpA}/100
${bar(hpA, "🟩")}
⚡ ${energyA}/100
${bar(energyA, "🟦")}

━━━━━━━━━━━━━━

${playerB}
❤️ ${hpB}/100
${bar(hpB, "🟩")}
⚡ ${energyB}/100
${bar(energyB, "🟦")}`;

  if (duel.status === "active") {
    text += `

⚔️ نوبت: ${playerName(duel.turn_owner_id)}`;
  }

  if (duel.status === "finished" && duel.winner_id) {
    text += `

🏆 ${playerName(duel.winner_id)}`;
  }

  if (duel.status === "active" && duel.end_request_by) {
    text += `

🤝 درخواست پایان توافقی در انتظار پاسخ`;
  }

  return text;
}
'''

s = s[:start] + hud + s[end:]

# مبارزه فقط با صفر شدن جان تمام می‌شود؛ محدودیت تعداد دور حذف می‌شود.
old = "const done = hpA === 0 || hpB === 0 || fresh.turn >= MAX_ROUNDS;"
new = "const done = hpA === 0 || hpB === 0;"

if old not in s:
    raise SystemExit("شرط پایان ۱۰ دور پیدا نشد؛ فایل تغییر نکرد.")

s = s.replace(old, new, 1)

if s == original:
    raise SystemExit("هیچ تغییری اعمال نشد.")

if "MAX_ROUNDS" in s:
    raise SystemExit("هنوز MAX_ROUNDS در فایل وجود دارد؛ فایل ذخیره نشد.")

if "function duelText(duel)" not in s:
    raise SystemExit("تابع پنل نامعتبر است؛ فایل ذخیره نشد.")

# کنترل تعداد تغییرات
if s.count("function duelText(duel)") != 1:
    raise SystemExit("تعداد تابع پنل غیرمنتظره است؛ فایل ذخیره نشد.")

backup = Path("src/combat.js.before_hud_unlimited")
if not backup.exists():
    backup.write_text(original, encoding="utf-8")

p.write_text(s, encoding="utf-8")
print("✅ پنل ثابت HUD جایگزین شد.")
print("✅ تاریخچه دورها از پنل حذف شد.")
print("✅ شمارش دور از پنل حذف شد.")
print("✅ سقف ۱۰ دور حذف شد.")
print("✅ نوار جان و انرژی برای هر بازیکن حفظ شد.")
print("✅ نسخه پشتیبان: src/combat.js.before_hud_unlimited")
