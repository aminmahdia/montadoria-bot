from pathlib import Path

p = Path("src/combat.js")
s = p.read_text(encoding="utf-8")
original = s

# 1) ایجاد ستون جداگانه برای اعلان پنل
anchor = 'ensureColumn("combat_duels", "winner_id", "TEXT");'

if anchor not in s:
    raise SystemExit("ستون winner_id پیدا نشد؛ فایل تغییر نکرد.")

if 'ensureColumn("combat_duels", "panel_notice", "TEXT");' not in s:
    s = s.replace(
        anchor,
        anchor + '\nensureColumn("combat_duels", "panel_notice", "TEXT");',
        1
    )

# 2) انتقال اعلان‌ها به ستون جداگانه
old_notice = '''function saveDuelNotice(id, message) {
  db.prepare(`
    UPDATE combat_duels
    SET last_round_text=?
    WHERE id=?
  `).run(String(message || "").slice(-1300), id);
}'''

new_notice = '''function saveDuelNotice(id, message) {
  db.prepare(`
    UPDATE combat_duels
    SET panel_notice=?
    WHERE id=?
  `).run(String(message || "").slice(-1300), id);
}'''

if old_notice in s:
    s = s.replace(old_notice, new_notice, 1)
elif new_notice not in s:
    raise SystemExit("تابع saveDuelNotice قابل شناسایی نیست؛ فایل تغییر نکرد.")

# 3) نمایش اعلان در پنل ثابت
anchor = '''  if (duel.status === "active" && duel.end_request_by) {
    text += `

🤝 درخواست پایان توافقی در انتظار پاسخ`;
  }

  return text;
}'''

replacement = '''  if (duel.status === "active" && duel.end_request_by) {
    text += `

🤝 درخواست پایان توافقی در انتظار پاسخ`;
  }

  if (duel.panel_notice) {
    text += `

━━━━━━━━━━━━━━

${duel.panel_notice}`;
  }

  return text;
}'''

if anchor not in s:
    raise SystemExit("محل نمایش اعلان در پنل پیدا نشد؛ فایل تغییر نکرد.")

s = s.replace(anchor, replacement, 1)

if s == original:
    raise SystemExit("هیچ تغییری اعمال نشد.")

backup = Path("src/combat.js.before_timeout_notice")
if not backup.exists():
    backup.write_text(original, encoding="utf-8")

p.write_text(s, encoding="utf-8")

print("✅ اعلان مهلت به ستون مستقل منتقل شد.")
print("✅ اعلان در پنل ثابت مبارزه نمایش داده می‌شود.")
print("✅ تاریخچه دورها دست‌کاری نشد.")
print("✅ نسخه پشتیبان ساخته شد.")
