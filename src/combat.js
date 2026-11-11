import db from "./database.js";
import { randomInt } from "node:crypto";
import { awardCombatVictoryXP, xpAwardText } from "./xp.js";

const DUEL_TTL = 15 * 60;
const WEAPONS = [
  ["شمشیر یک‌دست", "شمشیر", 22, 7, 2], ["شمشیر دوسر", "شمشیر", 28, 5, 2],
  ["شمشیر بلند", "شمشیر", 26, 6, 3], ["شمشیر کوتاه", "شمشیر", 17, 9, 1],
  ["شمشیر پهن", "شمشیر", 25, 5, 2], ["شمشیر خمیده", "شمشیر", 23, 7, 2],
  ["کاتانا", "شمشیر", 24, 8, 2], ["واکیزاشی", "شمشیر", 18, 9, 1],
  ["شمشیر پهلوانی", "شمشیر", 29, 4, 3], ["شمشیر تشریفاتی", "شمشیر", 15, 7, 2],
  ["راپیر", "شمشیر", 19, 10, 2], ["فلوره", "شمشیر", 16, 10, 1],
  ["سابر", "شمشیر", 21, 9, 2], ["فالشیون", "شمشیر", 24, 6, 2],
  ["شمشیر گلادیاتوری", "شمشیر", 23, 7, 2], ["شمشیر اسکاتلندی", "شمشیر", 27, 5, 3],
  ["خنجر", "خنجر", 13, 10, 1], ["خنجر دو لبه", "خنجر", 15, 10, 1],
  ["خنجر خمیده", "خنجر", 14, 11, 1], ["دِرک", "خنجر", 16, 9, 1],
  ["استیلتو", "خنجر", 17, 10, 1], ["کارد شکاری", "خنجر", 16, 8, 1],
  ["چاقوی رزمی", "خنجر", 15, 10, 1], ["پنجه بوکس", "خنجر", 18, 9, 1],
  ["تبر دستی", "تبر", 20, 7, 2], ["تبر جنگی", "تبر", 27, 4, 3],
  ["تبر دوسر", "تبر", 29, 4, 3], ["تبر فرانکی", "تبر", 22, 7, 2],
  ["تبر دسته‌بلند", "تبر", 26, 5, 3], ["گرز", "گرز", 24, 5, 2],
  ["گرز زنجیری", "گرز", 27, 6, 3], ["چماق", "گرز", 17, 6, 1],
  ["پتک جنگی", "گرز", 29, 3, 3], ["دَبوس", "گرز", 22, 6, 2],
  ["نیزه", "نیزه", 22, 7, 4], ["نیزه بلند", "نیزه", 25, 5, 5],
  ["نیزه کوتاه", "نیزه", 18, 9, 2], ["پیک", "نیزه", 24, 6, 4],
  ["هلبرد", "نیزه", 29, 4, 4], ["گلیو", "نیزه", 25, 6, 3],
  ["ناگیناتا", "نیزه", 26, 6, 4], ["نیزه سه‌شاخ", "نیزه", 21, 7, 3],
  ["نیزه پرتابی", "نیزه", 17, 9, 5], ["چنگک جنگی", "نیزه", 19, 7, 3],
  ["کمان کوتاه", "کمان", 18, 8, 5], ["کمان بلند", "کمان", 24, 6, 7],
  ["کمان ترکیبی", "کمان", 25, 7, 7], ["کمان خمیده", "کمان", 22, 8, 6],
  ["تیرکمان", "کمان", 14, 10, 4], ["تیر و کمان جنگی", "کمان", 23, 7, 7],
  ["زوبین", "پرتابی", 19, 8, 6], ["نیزه‌انداز", "پرتابی", 21, 7, 7],
  ["تبر پرتابی", "پرتابی", 20, 7, 5], ["چاکرام", "پرتابی", 18, 9, 5],
  ["فلاخن", "پرتابی", 15, 9, 6], ["دارت", "پرتابی", 12, 10, 4],
  ["شمشیر زنجیری", "زنجیری", 21, 8, 3], ["شلاق", "زنجیری", 14, 9, 3],
  ["زنجیر جنگی", "زنجیری", 20, 7, 3], ["سای", "رزمی", 15, 10, 1],
  ["تونفا", "رزمی", 17, 8, 1], ["ننشاکو", "رزمی", 19, 9, 2],
  ["باتوم", "رزمی", 16, 8, 1], ["بو", "رزمی", 18, 7, 2],
  ["جو", "رزمی", 16, 9, 2], ["کاما", "رزمی", 18, 9, 1],
  ["کوبوتان", "رزمی", 11, 10, 1], ["پنجه ببر", "رزمی", 17, 9, 1],
  ["سپر سبک", "سپر", 8, 7, 1], ["سپر برجسته", "سپر", 12, 4, 1],
  ["سپر شمشیری", "سپر", 16, 5, 1], ["سپر گرد", "سپر", 10, 6, 1]
];

db.exec(`
CREATE TABLE IF NOT EXISTS combat_weapons (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL COLLATE NOCASE UNIQUE,
 kind TEXT NOT NULL, damage INTEGER NOT NULL, speed INTEGER NOT NULL,
 reach INTEGER NOT NULL, custom INTEGER NOT NULL DEFAULT 0,
 approved INTEGER NOT NULL DEFAULT 1, created_by TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS combat_loadouts (
 telegram_id TEXT PRIMARY KEY, weapon_id INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS combat_duels (
 id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL,
 challenger_id TEXT NOT NULL, opponent_id TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending', turn INTEGER NOT NULL DEFAULT 1,
 hp_a INTEGER NOT NULL DEFAULT 100, hp_b INTEGER NOT NULL DEFAULT 100,
 last_action_at INTEGER NOT NULL, action_a TEXT, action_b TEXT,
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS combat_duels_status_idx ON combat_duels(status, created_at);
`);

const insertWeapon = db.prepare(`INSERT OR IGNORE INTO combat_weapons
(name,kind,damage,speed,reach,custom,approved,created_at) VALUES(?,?,?,?,?,0,1,?)`);

const seed = db.transaction(() => {
  const now = Math.floor(Date.now()/1000);
  for (const w of WEAPONS) insertWeapon.run(...w, now);
});
seed();
function manager(ctx) {
  const role = db.prepare("SELECT role FROM users WHERE telegram_id=?").get(String(ctx.from?.id))?.role;
  return ["owner", "moderator", "admin"].includes(String(role || "").toLowerCase());
}

function playerName(id) {
  const u = db.prepare("SELECT display_name,username FROM users WHERE telegram_id=?").get(String(id));
  return u?.display_name || (u?.username ? "@"+u.username : "بازیکن "+id);
}

function getWeapon(id) {
  return db.prepare(`SELECT w.* FROM combat_loadouts l JOIN combat_weapons w ON w.id=l.weapon_id
    WHERE l.telegram_id=? AND w.approved=1`).get(String(id)) ||
    db.prepare("SELECT * FROM combat_weapons WHERE approved=1 ORDER BY id LIMIT 1").get();
}

function getTraining(id, kind) {
  const row = db.prepare(`SELECT COALESCE(SUM(points),0) AS points FROM training_skills
    WHERE telegram_id=? AND (skill LIKE ? OR skill LIKE ?)`)
    .get(String(id), `%${kind}%`, `%${kind === "شمشیر" ? "سلاح" : kind}%`);
  return Math.min(20, Math.floor(Number(row?.points || 0) / 20));
}

function cleanExpired() {
  const limit = Math.floor(Date.now()/1000) - DUEL_TTL;
  db.prepare("UPDATE combat_duels SET status='expired' WHERE status='pending' AND created_at<?").run(limit);
  db.prepare("UPDATE combat_duels SET status='draw' WHERE status='active' AND last_action_at<?").run(limit);
}

function rollAttack(attacker, defender, weapon, move, defenderMove) {
  const skill = getTraining(attacker, weapon.kind);
  const defense = defenderMove === "دفاع" ? 12 : defenderMove === "جا خالی" ? 8 : 0;
  const attackBonus = move === "حمله سنگین" ? 8 : move === "حمله سریع" ? 2 : 0;
  const hit = randomInt(1, 21) + weapon.speed + skill + attackBonus;
  const guard = 10 + defense + randomInt(1, 11);

  if (hit <= guard) return { damage: 0, text: "ضربه مهار شد" };

  let damage = weapon.damage + randomInt(-4, 6) + skill - (defenderMove === "دفاع" ? 8 : 0);
  if (move === "حمله سنگین") damage += 7;
  if (move === "حمله سریع") damage -= 4;

  damage = Math.max(2, Math.min(38, damage));
  return { damage, text: `ضربه وارد شد: ${damage} آسیب` };
}

function duelText(d) {
  return `⚔️ مبارزه شماره ${d.id}\n\n`+
    `🥀 ${playerName(d.challenger_id)}: ${d.hp_a} HP\n`+
    `🛡 ${playerName(d.opponent_id)}: ${d.hp_b} HP\n\n`+
    `نوبت ${d.turn} — هر دو بازیکن باید حرکت خود را انتخاب کنند.`;
}


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

