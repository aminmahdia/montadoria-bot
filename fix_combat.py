from pathlib import Path
import subprocess
import sys

p = Path("src/combat.js")
s = p.read_text(encoding="utf-8")
marker = "export function registerCombat(bot) {"

if marker not in s:
    print("❌ تابع مبارزه پیدا نشد؛ فایل تغییر نکرد.")
    sys.exit(1)

backup = Path("src/combat.js.before_persian_commands")
if not backup.exists():
    backup.write_text(s, encoding="utf-8")

new_func = r'''
export function registerCombat(bot) {
  const MAX_ACTIVE_DUELS = 100;

  const createDuel = db.transaction((chatId, a, b) => {
    cleanExpired();

    const busy = db.prepare(`
      SELECT id FROM combat_duels
      WHERE status IN ('pending','active')
      AND (challenger_id IN (?,?) OR opponent_id IN (?,?))
      LIMIT 1
    `).get(a, b, a, b);

    if (busy) return { error: "busy" };

    const count = db.prepare(`
      SELECT COUNT(*) AS total FROM combat_duels
      WHERE status IN ('pending','active')
    `).get().total;

    if (count >= MAX_ACTIVE_DUELS) return { error: "full" };

    const now = Math.floor(Date.now() / 1000);
    const info = db.prepare(`
      INSERT INTO combat_duels
      (chat_id,challenger_id,opponent_id,last_action_at,created_at)
      VALUES(?,?,?,?,?)
    `).run(chatId, a, b, now, now);

    return { id: Number(info.lastInsertRowid) };
  });

  const acceptDuel = db.transaction((id, uid) => {
    cleanExpired();

    const d = db.prepare(`
      SELECT * FROM combat_duels
      WHERE id=? AND status='pending' AND opponent_id=?
    `).get(id, uid);

    if (!d) return null;

    const now = Math.floor(Date.now() / 1000);
    const result = db.prepare(`
      UPDATE combat_duels
      SET status='active',last_action_at=?
      WHERE id=? AND status='pending' AND opponent_id=?
    `).run(now, id, uid);

    if (!result.changes) return null;
    return db.prepare("SELECT * FROM combat_duels WHERE id=?").get(id);
  });

  const submitMove = db.transaction((id, uid, move) => {
    cleanExpired();

    const d = db.prepare(`
      SELECT * FROM combat_duels WHERE id=? AND status='active'
    `).get(id);

    if (!d || ![d.challenger_id, d.opponent_id].includes(uid)) {
      return { error: "invalid" };
    }

    const col = uid === d.challenger_id ? "action_a" : "action_b";
    if (d[col]) return { error: "already" };

    const now = Math.floor(Date.now() / 1000);
    const saved = db.prepare(`
      UPDATE combat_duels SET ${col}=?,last_action_at=?
      WHERE id=? AND status='active' AND ${col} IS NULL
    `).run(move, now, id);

    if (!saved.changes) return { error: "already" };

    const fresh = db.prepare("SELECT * FROM combat_duels WHERE id=?").get(id);

    if (!fresh.action_a || !fresh.action_b) {
      return { waiting: true };
    }

    const wa = getWeapon(fresh.challenger_id);
    const wb = getWeapon(fresh.opponent_id);

    const hitA = rollAttack(
      fresh.challenger_id, fresh.opponent_id,
      wa, fresh.action_a, fresh.action_b
    );
    const hitB = rollAttack(
      fresh.opponent_id, fresh.challenger_id,
      wb, fresh.action_b, fresh.action_a
    );

    const hpA = Math.max(0, fresh.hp_a - hitB.damage);
    const hpB = Math.max(0, fresh.hp_b - hitA.damage);
    const done = hpA === 0 || hpB === 0 || fresh.turn >= 10;
    const winner = hpA === hpB
      ? null
      : hpA > hpB ? fresh.challenger_id : fresh.opponent_id;

    db.prepare(`
      UPDATE combat_duels
      SET hp_a=?,hp_b=?,turn=turn+1,
          action_a=NULL,action_b=NULL,status=?,last_action_at=?
      WHERE id=? AND status='active'
    `).run(
      hpA, hpB,
      done ? (winner ? "finished" : "draw") : "active",
      now, id
    );

    return {
      resolved: true,
      id,
      turn: fresh.turn,
      challenger: fresh.challenger_id,
      opponent: fresh.opponent_id,
      weaponA: wa.name,
      weaponB: wb.name,
      hitA: hitA.text,
      hitB: hitB.text,
      hpA,
      hpB,
      done,
      winner
    };
  });

  bot.hears(/^#راهنمای_مبارزه$/u, async ctx => {
    await ctx.reply(
      "⚔️ راهنمای مبارزه مونتادوریا\n\n" +
      "۱. برای دعوت، روی پیام حریف ریپلای کن:\n" +
      "#مبارزه\n\n" +
      "۲. حریف دعوت را بپذیرد:\n" +
      "#پذیرش شماره\n\n" +
      "۳. هر دو بازیکن در هر نوبت یکی از حرکت‌ها را بفرستند:\n" +
      "#حرکت شماره حمله سریع\n" +
      "#حرکت شماره حمله سنگین\n" +
      "#حرکت شماره دفاع\n" +
      "#حرکت شماره جا خالی\n\n" +
      "برای دیدن سلاح‌ها:\n#سلاح‌ها\n\n" +
      "برای انتخاب سلاح:\n#انتخاب_سلاح شماره\n\n" +
      "هر بازیکن فقط یک حرکت در هر نوبت ثبت می‌کند. " +
      "حداکثر ۱۰۰ مبارزه می‌توانند هم‌زمان فعال باشند."
    );
  });

  bot.hears(/^#سلاح‌ها$/u, async ctx => {
    const rows = db.prepare(`
      SELECT id,name,kind,damage,speed,reach
      FROM combat_weapons WHERE approved=1 ORDER BY kind,id
    `).all();

    const groups = new Map();
    for (const w of rows) {
      if (!groups.has(w.kind)) groups.set(w.kind, []);
      groups.get(w.kind).push(
        `${w.id}. ${w.name} — آسیب ${w.damage}، سرعت ${w.speed}، برد ${w.reach}`
      );
    }

    let out = "⚔️ فهرست سلاح‌های مونتادوریا\n";
    for (const [kind, items] of groups) {
      out += `\n【${kind}】\n${items.join("\n")}\n`;
    }

    if (out.length > 3900) {
      out = out.slice(0, 3850) + "\n… فهرست طولانی است.";
    }

    await ctx.reply(out);
  });

  bot.hears(/^#انتخاب_سلاح\s+(\d+)$/u, async ctx => {
    const weapon = db.prepare(`
      SELECT id,name FROM combat_weapons
      WHERE id=? AND approved=1
    `).get(Number(ctx.match[1]));

    if (!weapon) return ctx.reply("❌ شناسه سلاح معتبر نیست.");

    db.prepare(`
      INSERT INTO combat_loadouts(telegram_id,weapon_id)
      VALUES(?,?)
      ON CONFLICT(telegram_id)
      DO UPDATE SET weapon_id=excluded.weapon_id
    `).run(String(ctx.from.id), weapon.id);

    await ctx.reply(`✅ سلاح فعال تو «${weapon.name}» شد.`);
  });

  bot.hears(/^#افزودن_سلاح\s+(.+)\s+(\S+)\s+(\d+)\s+(\d+)\s+(\d+)$/u, async ctx => {
    if (!manager(ctx)) return;

    const name = ctx.match[1].trim();
    const kind = ctx.match[2].trim();
    const damage = Number(ctx.match[3]);
    const speed = Number(ctx.match[4]);
    const reach = Number(ctx.match[5]);

    if (
      !name || name.length > 40 ||
      !kind || kind.length > 20 ||
      !Number.isInteger(damage) || damage < 5 || damage > 35 ||
      !Number.isInteger(speed) || speed < 1 || speed > 10 ||
      !Number.isInteger(reach) || reach < 1 || reach > 10
    ) {
      return ctx.reply(
        "قالب:\n#افزودن_سلاح نام سلاح دسته آسیب سرعت برد"
      );
    }

    try {
      db.prepare(`
        INSERT INTO combat_weapons
        (name,kind,damage,speed,reach,custom,approved,created_by,created_at)
        VALUES(?,?,?,?,?,1,1,?,?)
      `).run(
        name, kind, damage, speed, reach,
        String(ctx.from.id), Math.floor(Date.now() / 1000)
      );

      await ctx.reply(`✅ سلاح «${name}» اضافه شد.`);
    } catch {
      await ctx.reply("❌ نام این سلاح از قبل ثبت شده است.");
    }
  });

  bot.hears(/^#مبارزه$/u, async ctx => {
    cleanExpired();

    if (!ctx.message?.reply_to_message?.from) {
      return ctx.reply("برای دعوت، روی پیام حریف ریپلای کن و #مبارزه بفرست.");
    }

    const opponent = ctx.message.reply_to_message.from;
    const a = String(ctx.from.id);
    const b = String(opponent.id);

    if (a === b || opponent.is_bot) {
      return ctx.reply("❌ حریف معتبر نیست.");
    }

    if (
      !db.prepare("SELECT 1 FROM users WHERE telegram_id=?").get(a) ||
      !db.prepare("SELECT 1 FROM users WHERE telegram_id=?").get(b)
    ) {
      return ctx.reply("❌ هر دو بازیکن باید در مونتادوریا ثبت‌نام کرده باشند.");
    }

    const result = createDuel(String(ctx.chat.id), a, b);

    if (result.error === "busy") {
      return ctx.reply("⛔ یکی از بازیکنان درگیر مبارزه دیگری است.");
    }

    if (result.error === "full") {
      return ctx.reply("⛔ ظرفیت ۱۰۰ مبارزه هم‌زمان تکمیل شده است.");
    }

    await ctx.reply(
      `⚔️ ${playerName(a)}، ${playerName(b)} را به مبارزه دعوت کرد.\n` +
      `شماره مبارزه: ${result.id}\n` +
      `حریف برای پذیرش بزند:\n#پذیرش ${result.id}`
    );
  });

  bot.hears(/^#پذیرش\s+(\d+)$/u, async ctx => {
    const id = Number(ctx.match[1]);
    const current = acceptDuel(id, String(ctx.from.id));

    if (!current) {
      return ctx.reply("❌ دعوت پیدا نشد، منقضی شده یا برای تو نیست.");
    }

    await ctx.reply(
      "✅ مبارزه آغاز شد!\n\n" + duelText(current) +
      `\n\nحرکت خود را بفرست:\n` +
      `#حرکت ${id} حمله سریع\n` +
      `#حرکت ${id} حمله سنگین\n` +
      `#حرکت ${id} دفاع\n` +
      `#حرکت ${id} جا خالی`
    );
  });

  bot.hears(/^#حرکت\s+(\d+)\s+(حمله سریع|حمله سنگین|دفاع|جا خالی)$/u, async ctx => {
    const id = Number(ctx.match[1]);
    const move = ctx.match[2];
    const uid = String(ctx.from.id);

    const result = submitMove(id, uid, move);

    if (result.error === "invalid") {
      return ctx.reply("❌ مبارزه فعال یا مجاز پیدا نشد.");
    }

    if (result.error === "already") {
      return ctx.reply("⏳ حرکت این نوبت را قبلاً ثبت کرده‌ای.");
    }

    if (result.waiting) {
      return ctx.reply("✅ حرکت ثبت شد؛ منتظر انتخاب حریف بمان.");
    }

    await ctx.reply(
      `⚔️ نتیجه نوبت ${result.turn}\n` +
      `${playerName(result.challenger)} (${result.weaponA}): ${result.hitA}\n` +
      `${playerName(result.opponent)} (${result.weaponB}): ${result.hitB}\n\n` +
      `❤️ ${playerName(result.challenger)}: ${result.hpA}\n` +
      `❤️ ${playerName(result.opponent)}: ${result.hpB}`
    );

    if (result.done) {
      if (!result.winner) {
        return ctx.reply("🤝 مبارزه مساوی شد.");
      }

      const loser = result.winner === result.challenger
        ? result.opponent
        : result.challenger;

      const reward = awardCombatVictoryXP(
        result.winner, loser, `combat:${id}:winner`
      );

      return ctx.reply(
        `🏆 برنده: ${playerName(result.winner)}\n` +
        `${xpAwardText(reward) || "پاداش XP به دلیل محدودیت روزانه یا ثبت قبلی تعلق نگرفت."}`
      );
    }

    const next = db.prepare(
      "SELECT * FROM combat_duels WHERE id=?"
    ).get(id);

    await ctx.reply(
      duelText(next) +
      `\n\n#حرکت ${id} حمله سریع` +
      `\n#حرکت ${id} حمله سنگین` +
      `\n#حرکت ${id} دفاع` +
      `\n#حرکت ${id} جا خالی`
    );
  });
}
'''

start = s.index(marker)
updated = s[:start] + new_func + "\n"
p.write_text(updated, encoding="utf-8")

check = subprocess.run(["node", "--check", str(p)])
if check.returncode != 0:
    p.write_text(s, encoding="utf-8")
    print("❌ بررسی کد ناموفق بود؛ نسخه قبلی بازگردانده شد.")
    sys.exit(1)

print("✅ فرمان‌های فارسی مبارزه اضافه شدند.")
print("✅ سقف ۱۰۰ مبارزه هم‌زمان اعمال شد.")
print("✅ سیستم سلاح، مهارت و پاداش XP حفظ شد.")
print("✅ بررسی ساختار جاوااسکریپت بدون خطا بود.")
print("📦 نسخه پشتیبان در src/combat.js.before_persian_commands ذخیره شد.")
