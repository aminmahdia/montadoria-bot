from pathlib import Path
from datetime import datetime
import subprocess
import shutil
import sys

p = Path("src/combat.js")
if not p.exists():
    sys.exit("❌ فایل src/combat.js پیدا نشد.")

s = p.read_text(encoding="utf-8")
original = s

def replace_once(old, new, label):
    global s
    count = s.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: تعداد تطبیق باید ۱ باشد، اما {count} مورد پیدا شد.")
    s = s.replace(old, new, 1)

try:
    replace_once(
        "const MAX_ACTION_LENGTH = 220;",
        "const MAX_ACTION_LENGTH = 250;",
        "حداکثر طول حرکت"
    )

    replace_once(
'''function parseAction(raw) {
  const text = String(raw || "").trim().slice(0, MAX_ACTION_LENGTH);

  if (text.length < 2) return { error: "short" };

  const forbidden = /خون.?آشام|گرگ.?نما|قدرت.?نژادی|قدرت.?خون|کنترل.?خون|تغییر.?شکل|تبدیل.*(گرگ|حیوان)|نامرئی|پرواز|تله.?پاتی|بازسازی.?فوری|سرعت.?فراطبیعی|قدرت.?فراطبیعی/iu;

  if (forbidden.test(text)) return { error: "racial" };''',
'''function parseAction(raw) {
  const text = String(raw || "").trim();

  if (text.length < 2) return { error: "short" };

  const forbidden = /خون.?آشام|گرگ.?نما|قدرت.?نژادی|قدرت.?خون|کنترل.?خون|تغییر.?شکل|تبدیل.*(گرگ|حیوان)|نامرئی|پرواز|تله.?پاتی|بازسازی.?فوری|سرعت.?فراطبیعی|قدرت.?فراطبیعی/iu;

  // متن کامل باید بررسی شود؛ بریدن متن قبل از این بررسی راه دورزدن فیلتر بود.
  if (forbidden.test(text)) return { error: "racial" };
  if (text.length > MAX_ACTION_LENGTH) return { error: "long" };''',
        "بررسی کامل متن حرکت"
    )

    replace_once(
'''const acceptDuel = db.transaction((id, uid) => {
  cleanExpiredInvitations();

  const duel = db.prepare(`
    SELECT *
    FROM combat_duels
    WHERE id=? AND status='pending' AND opponent_id=?
  `).get(id, uid);''',
'''const acceptDuel = db.transaction((id, uid, chatId) => {
  cleanExpiredInvitations();

  const duel = db.prepare(`
    SELECT *
    FROM combat_duels
    WHERE id=? AND status='pending' AND opponent_id=? AND chat_id=?
  `).get(id, uid, chatId);''',
        "کنترل گروه هنگام پذیرش"
    )

    replace_once(
'''    WHERE id=? AND status='pending' AND opponent_id=?
  `).run(now + TURN_SECONDS, now, id, uid);''',
'''    WHERE id=? AND status='pending' AND opponent_id=? AND chat_id=?
  `).run(now + TURN_SECONDS, now, id, uid, chatId);''',
        "کنترل گروه هنگام تغییر وضعیت دعوت"
    )

    helper = '''function resolveRound(fresh, now) {
  const actionA = readAction(fresh.action_a);
  const actionB = readAction(fresh.action_b);
  const weaponA = getWeapon(fresh.challenger_id);
  const weaponB = getWeapon(fresh.opponent_id);

  const hitA = strike(
    fresh.challenger_id,
    fresh.opponent_id,
    weaponA,
    actionA,
    actionB
  );

  const hitB = strike(
    fresh.opponent_id,
    fresh.challenger_id,
    weaponB,
    actionB,
    actionA
  );

  const hpA = Math.max(0, fresh.hp_a - hitB.damage);
  const hpB = Math.max(0, fresh.hp_b - hitA.damage);

  const done = hpA === 0 || hpB === 0 || fresh.turn >= MAX_ROUNDS;
  const winner = hpA === hpB
    ? null
    : hpA > hpB ? fresh.challenger_id : fresh.opponent_id;

  db.prepare(`
    UPDATE combat_duels
    SET hp_a=?,
        hp_b=?,
        turn=turn+1,
        action_a=NULL,
        action_b=NULL,
        status=?,
        turn_owner_id=?,
        turn_deadline_at=?,
        timeout_stage=0,
        last_action_at=?
    WHERE id=? AND status='active'
  `).run(
    hpA,
    hpB,
    done ? (winner ? "finished" : "draw") : "active",
    fresh.challenger_id,
    done ? null : now + TURN_SECONDS,
    now,
    fresh.id
  );

  return {
    resolved: true,
    id: fresh.id,
    chatId: fresh.chat_id,
    turn: fresh.turn,
    challenger: fresh.challenger_id,
    opponent: fresh.opponent_id,
    weaponA: weaponA.name,
    weaponB: weaponB.name,
    actionA,
    actionB,
    hitA: hitA.text,
    hitB: hitB.text,
    hpA,
    hpB,
    done,
    winner
  };
}

'''

    replace_once(
        "const submitMove = db.transaction((id, uid, move) => {",
        helper + "const submitMove = db.transaction((id, uid, move, chatId) => {",
        "افزودن تابع مشترک پایان دور"
    )

    replace_once(
'''    SELECT *
    FROM combat_duels
    WHERE id=? AND status='active'
  `).get(id);

  if (!duel) return { error: "invalid" };''',
'''    SELECT *
    FROM combat_duels
    WHERE id=? AND status='active' AND chat_id=?
  `).get(id, chatId);

  if (!duel) return { error: "invalid" };''',
        "کنترل گروه هنگام ثبت حرکت"
    )

    old_round = '''  const actionA = readAction(fresh.action_a);
  const actionB = readAction(fresh.action_b);
  const weaponA = getWeapon(fresh.challenger_id);
  const weaponB = getWeapon(fresh.opponent_id);

  const hitA = strike(
    fresh.challenger_id,
    fresh.opponent_id,
    weaponA,
    actionA,
    actionB
  );

  const hitB = strike(
    fresh.opponent_id,
    fresh.challenger_id,
    weaponB,
    actionB,
    actionA
  );

  const hpA = Math.max(0, fresh.hp_a - hitB.damage);
  const hpB = Math.max(0, fresh.hp_b - hitA.damage);

  const done = hpA === 0 || hpB === 0 || fresh.turn >= MAX_ROUNDS;
  const winner = hpA === hpB
    ? null
    : hpA > hpB ? fresh.challenger_id : fresh.opponent_id;

  db.prepare(`
    UPDATE combat_duels
    SET hp_a=?,
        hp_b=?,
        turn=turn+1,
        action_a=NULL,
        action_b=NULL,
        status=?,
        turn_owner_id=?,
        turn_deadline_at=?,
        timeout_stage=0,
        last_action_at=?
    WHERE id=? AND status='active'
  `).run(
    hpA,
    hpB,
    done ? (winner ? "finished" : "draw") : "active",
    fresh.challenger_id,
    now + TURN_SECONDS,
    now,
    id
  );

  return {
    resolved: true,
    id,
    turn: fresh.turn,
    challenger: fresh.challenger_id,
    opponent: fresh.opponent_id,
    weaponA: weaponA.name,
    weaponB: weaponB.name,
    actionA,
    actionB,
    hitA: hitA.text,
    hitB: hitB.text,
    hpA,
    hpB,
    done,
    winner
  };'''

    replace_once(old_round, "  return resolveRound(fresh, now);",
                 "یکپارچه‌سازی محاسبهٔ دور مبارزه")

    replace_once(
'''    if (!updated.changes) return null;

    return {
      type: "passed",
      chatId: duel.chat_id,
      duelId: duel.id,
      missed: duel.turn_owner_id,
      next: nextPlayer
    };''',
'''    if (!updated.changes) return null;

    const fresh = db.prepare(
      "SELECT * FROM combat_duels WHERE id=?"
    ).get(id);

    // اگر حریف قبلاً حرکتش را ثبت کرده باشد، PASS باید همان لحظه دور را ببندد.
    if (fresh?.action_a && fresh?.action_b) {
      return {
        ...resolveRound(fresh, now),
        type: "resolved",
        chatId: duel.chat_id,
        missed: duel.turn_owner_id
      };
    }

    return {
      type: "passed",
      chatId: duel.chat_id,
      duelId: duel.id,
      missed: duel.turn_owner_id,
      next: nextPlayer
    };''',
        "رفع گیرکردن دور پس از timeout"
    )

    replace_once(
'''  const updated = db.prepare(`
    UPDATE combat_duels
    SET status='cancelled',
        turn_deadline_at=NULL,
        last_action_at=?
    WHERE id=? AND status='active'
      AND turn_deadline_at <= ?
  `).run(now, id, now);

  if (!updated.changes) return null;

  return {
    type: "cancelled",
    chatId: duel.chat_id,
    duelId: duel.id,
    playerA: duel.challenger_id,
    playerB: duel.opponent_id
  };''',
'''  // کسر XP و لغو پرونده در یک تراکنش واحد انجام می‌شوند.
  const penaltyA = deductCombatTimeoutXP(duel.challenger_id, 20);
  const penaltyB = deductCombatTimeoutXP(duel.opponent_id, 20);
  if (!penaltyA || !penaltyB) {
    throw new Error(`Combat timeout XP penalty failed for duel ${id}`);
  }

  const updated = db.prepare(`
    UPDATE combat_duels
    SET status='cancelled',
        turn_deadline_at=NULL,
        last_action_at=?
    WHERE id=? AND status='active'
      AND turn_deadline_at <= ?
  `).run(now, id, now);

  if (!updated.changes) return null;

  return {
    type: "cancelled",
    chatId: duel.chat_id,
    duelId: duel.id,
    playerA: duel.challenger_id,
    playerB: duel.opponent_id,
    lostA: penaltyA.lostXP,
    lostB: penaltyB.lostXP
  };''',
        "اتمی‌کردن جریمهٔ XP"
    )

    replace_once(
'''      if (result.type === "passed") {
        await api.sendMessage(
          result.chatId,
          `⏳ مهلت ${playerName(result.missed)} به پایان رسید.
نوبت به ${playerName(result.next)} منتقل شد.
۳ دقیقه فرصت باقی است.`
        );
      } else {
        const penaltyA = deductCombatTimeoutXP(result.playerA, 20);
        const penaltyB = deductCombatTimeoutXP(result.playerB, 20);

        await api.sendMessage(
          result.chatId,
          `⛓️ مبارزه شماره ${result.duelId} لغو شد.
هر دو بازیکن مهلت خود را از دست دادند.

🥀 ${playerName(result.playerA)}: کسر ${penaltyA?.lostXP ?? 0} XP
🥀 ${playerName(result.playerB)}: کسر ${penaltyB?.lostXP ?? 0} XP`
        );
      }''',
'''      if (result.type === "passed") {
        await api.sendMessage(
          result.chatId,
          `⏳ مهلت ${playerName(result.missed)} به پایان رسید.
نوبت به ${playerName(result.next)} منتقل شد.
۳ دقیقه فرصت باقی است.`
        );
      } else if (result.type === "resolved") {
        await api.sendMessage(result.chatId, formatResult(result));

        if (result.done && result.winner) {
          const loser = result.winner === result.challenger
            ? result.opponent
            : result.challenger;
          const reward = awardCombatVictoryXP(
            result.winner,
            loser,
            `combat:${result.id}:winner`
          );
          await api.sendMessage(
            result.chatId,
            `🏆 پیروز میدان: ${playerName(result.winner)}
${xpAwardText(reward) || "پاداش XP به دلیل محدودیت روزانه یا ثبت قبلی تعلق نگرفت."}`
          );
        } else if (result.done) {
          await api.sendMessage(result.chatId, "🤝 مبارزه با نتیجه مساوی پایان یافت.");
        } else {
          const next = db.prepare(
            "SELECT * FROM combat_duels WHERE id=?"
          ).get(result.id);
          await api.sendMessage(result.chatId, duelText(next));
        }
      } else {
        await api.sendMessage(
          result.chatId,
          `⛓️ مبارزه شماره ${result.duelId} لغو شد.
هر دو بازیکن مهلت خود را از دست دادند.

🥀 ${playerName(result.playerA)}: کسر ${result.lostA} XP
🥀 ${playerName(result.playerB)}: کسر ${result.lostB} XP`
        );
      }''',
        "اعلان نتیجهٔ timeout"
    )

    replace_once(
        "const duel = acceptDuel(id, String(ctx.from.id));",
        "const duel = acceptDuel(id, String(ctx.from.id), String(ctx.chat.id));",
        "ارسال شناسهٔ گروه به پذیرش"
    )

    replace_once(
'''    if (parsed.error === "racial") {
      return ctx.reply(
        "⛔ استفاده از قابلیت‌های فراطبیعی و نژادی در مبارزه مجاز نیست. فقط حرکت رزمی عادی ثبت کن."
      );
    }

    await processDueDuels(bot.api);

    const result = submitMove(id, uid, parsed);''',
'''    if (parsed.error === "racial") {
      return ctx.reply(
        "⛔ استفاده از قابلیت‌های فراطبیعی و نژادی در مبارزه مجاز نیست. فقط حرکت رزمی عادی ثبت کن."
      );
    }

    if (parsed.error === "long") {
      return ctx.reply("❌ متن حرکت بیش از ۲۵۰ نویسه است.");
    }

    await processDueDuels(bot.api);

    const result = submitMove(id, uid, parsed, String(ctx.chat.id));''',
        "ارسال شناسهٔ گروه و کنترل طول حرکت"
    )

except Exception as e:
    sys.exit(f"❌ وصله اعمال نشد؛ فایل دست‌نخورده باقی ماند.\nجزئیات: {e}")

if s == original:
    sys.exit("❌ هیچ تغییری ایجاد نشد.")

backup = p.with_name(
    p.name + ".backup_" + datetime.now().strftime("%Y%m%d_%H%M%S")
)
shutil.copy2(p, backup)
p.write_text(s, encoding="utf-8")

check = subprocess.run(
    ["node", "--check", str(p)],
    text=True,
    capture_output=True
)

if check.returncode != 0:
    shutil.copy2(backup, p)
    print(check.stdout)
    print(check.stderr)
    sys.exit("❌ بررسی نحوی شکست خورد؛ نسخهٔ اصلی بازگردانده شد.")

print("✅ اصلاحات مرحلهٔ اول اعمال شد.")
print(f"✅ نسخهٔ پشتیبان: {backup}")
print("✅ node --check موفق بود.")
print("⚠️ هنوز آزمون عملی تلگرام و دیتابیس انجام نشده است.")
