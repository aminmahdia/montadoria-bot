import db from "./database.js";
import { randomInt } from "node:crypto";
import {
  awardCombatVictoryXP,
  xpAwardText,
  deductCombatTimeoutXP
} from "./xp.js";

const TURN_SECONDS = 180;
const INVITE_SECONDS = 15 * 60;
const MAX_ACTIVE_DUELS = 100;
const MAX_ROUNDS = 10;
const MAX_ACTION_LENGTH = 220;

const WEAPONS = [
  ["شمشیر یک‌دست", "شمشیر", 22, 7, 2],
  ["شمشیر دوسر", "شمشیر", 27, 5, 2],
  ["شمشیر بلند", "شمشیر", 25, 6, 3],
  ["شمشیر کوتاه", "شمشیر", 17, 9, 1],
  ["شمشیر پهن", "شمشیر", 24, 5, 2],
  ["شمشیر خمیده", "شمشیر", 22, 7, 2],
  ["کاتانا", "شمشیر", 23, 8, 2],
  ["واکیزاشی", "شمشیر", 18, 9, 1],
  ["شمشیر پهلوانی", "شمشیر", 28, 4, 3],
  ["راپیر", "شمشیر", 19, 10, 2],
  ["فلوره", "شمشیر", 16, 10, 1],
  ["سابر", "شمشیر", 21, 9, 2],
  ["فالشیون", "شمشیر", 24, 6, 2],
  ["شمشیر گلادیاتوری", "شمشیر", 23, 7, 2],
  ["شمشیر اسکاتلندی", "شمشیر", 27, 5, 3],

  ["خنجر", "خنجر", 13, 10, 1],
  ["خنجر دو لبه", "خنجر", 15, 10, 1],
  ["خنجر خمیده", "خنجر", 14, 11, 1],
  ["دِرک", "خنجر", 16, 9, 1],
  ["استیلتو", "خنجر", 16, 10, 1],
  ["کارد شکاری", "خنجر", 15, 8, 1],
  ["چاقوی رزمی", "خنجر", 15, 10, 1],

  ["تبر دستی", "تبر", 20, 7, 2],
  ["تبر جنگی", "تبر", 27, 4, 3],
  ["تبر دوسر", "تبر", 28, 4, 3],
  ["تبر فرانکی", "تبر", 22, 7, 2],
  ["تبر دسته‌بلند", "تبر", 26, 5, 3],

  ["گرز", "گرز", 23, 5, 2],
  ["گرز زنجیری", "گرز", 26, 6, 3],
  ["چماق", "گرز", 17, 6, 1],
  ["پتک جنگی", "گرز", 29, 3, 3],
  ["دَبوس", "گرز", 22, 6, 2],

  ["نیزه", "نیزه", 22, 7, 4],
  ["نیزه بلند", "نیزه", 25, 5, 5],
  ["نیزه کوتاه", "نیزه", 18, 9, 2],
  ["پیک", "نیزه", 24, 6, 4],
  ["هلبرد", "نیزه", 28, 4, 4],
  ["گلیو", "نیزه", 24, 6, 3],
  ["ناگیناتا", "نیزه", 25, 6, 4],
  ["نیزه سه‌شاخ", "نیزه", 21, 7, 3],

  ["کمان کوتاه", "کمان", 18, 8, 5],
  ["کمان بلند", "کمان", 24, 6, 7],
  ["کمان ترکیبی", "کمان", 24, 7, 7],
  ["کمان خمیده", "کمان", 22, 8, 6],
  ["تیرکمان", "کمان", 14, 10, 4],

  ["زوبین", "پرتابی", 19, 8, 6],
  ["نیزه‌انداز", "پرتابی", 21, 7, 7],
  ["تبر پرتابی", "پرتابی", 20, 7, 5],
  ["چاکرام", "پرتابی", 18, 9, 5],
  ["فلاخن", "پرتابی", 15, 9, 6],
  ["دارت", "پرتابی", 12, 10, 4],

  ["شمشیر زنجیری", "زنجیری", 21, 8, 3],
  ["شلاق", "زنجیری", 14, 9, 3],
  ["زنجیر جنگی", "زنجیری", 20, 7, 3],

  ["سای", "رزمی", 15, 10, 1],
  ["تونفا", "رزمی", 17, 8, 1],
  ["ننشاکو", "رزمی", 19, 9, 2],
  ["باتوم", "رزمی", 16, 8, 1],
  ["بو", "رزمی", 18, 7, 2],
  ["جو", "رزمی", 16, 9, 2],
  ["کاما", "رزمی", 18, 9, 1],
  ["کوبوتان", "رزمی", 11, 10, 1],

  ["سپر سبک", "سپر", 8, 7, 1],
  ["سپر برجسته", "سپر", 12, 4, 1],
  ["سپر گرد", "سپر", 10, 6, 1]
];

db.exec(`
CREATE TABLE IF NOT EXISTS combat_weapons (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL COLLATE NOCASE UNIQUE,
 kind TEXT NOT NULL,
 damage INTEGER NOT NULL,
 speed INTEGER NOT NULL,
 reach INTEGER NOT NULL,
 custom INTEGER NOT NULL DEFAULT 0,
 approved INTEGER NOT NULL DEFAULT 1,
 created_by TEXT,
 created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS combat_loadouts (
 telegram_id TEXT PRIMARY KEY,
 weapon_id INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS combat_duels (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 chat_id TEXT NOT NULL,
 challenger_id TEXT NOT NULL,
 opponent_id TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 turn INTEGER NOT NULL DEFAULT 1,
 hp_a INTEGER NOT NULL DEFAULT 100,
 hp_b INTEGER NOT NULL DEFAULT 100,
 last_action_at INTEGER NOT NULL,
 action_a TEXT,
 action_b TEXT,
 created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS combat_duels_status_idx
ON combat_duels(status, created_at);
`);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(item => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("combat_duels", "turn_owner_id", "TEXT");
ensureColumn("combat_duels", "turn_deadline_at", "INTEGER");
ensureColumn("combat_duels", "timeout_stage", "INTEGER NOT NULL DEFAULT 0");

db.exec(`
  UPDATE combat_duels
  SET
    turn_owner_id = CASE
      WHEN action_a IS NOT NULL AND action_b IS NULL
      THEN opponent_id
      ELSE challenger_id
    END,
    turn_deadline_at = last_action_at + ${TURN_SECONDS},
    timeout_stage = 0
  WHERE status = 'active'
    AND turn_owner_id IS NULL
`);

const insertWeapon = db.prepare(`
  INSERT INTO combat_weapons
    (name,kind,damage,speed,reach,custom,approved,created_at)
  VALUES(?,?,?,?,?,0,1,?)
  ON CONFLICT(name) DO UPDATE SET
    kind=excluded.kind,
    damage=excluded.damage,
    speed=excluded.speed,
    reach=excluded.reach
  WHERE combat_weapons.custom=0
`);

db.transaction(() => {
  const now = Math.floor(Date.now() / 1000);
  for (const weapon of WEAPONS) {
    insertWeapon.run(...weapon, now);
  }
})();

function manager(ctx) {
  const role = db.prepare(
    "SELECT role FROM users WHERE telegram_id=?"
  ).get(String(ctx.from?.id))?.role;

  return ["owner", "moderator", "admin"].includes(
    String(role || "").toLowerCase()
  );
}

function playerName(id) {
  const user = db.prepare(`
    SELECT display_name,username
    FROM users
    WHERE telegram_id=?
  `).get(String(id));

  return user?.display_name ||
    (user?.username ? "@" + user.username : "بازیکن " + id);
}

function getWeapon(id) {
  return db.prepare(`
    SELECT w.*
    FROM combat_loadouts l
    JOIN combat_weapons w ON w.id=l.weapon_id
    WHERE l.telegram_id=? AND w.approved=1
  `).get(String(id)) || db.prepare(`
    SELECT *
    FROM combat_weapons
    WHERE approved=1
    ORDER BY id
    LIMIT 1
  `).get();
}

function getTraining(id, kind) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(points),0) AS points
    FROM training_skills
    WHERE telegram_id=?
      AND (skill LIKE ? OR skill LIKE ?)
  `).get(
    String(id),
    `%${kind}%`,
    `%${kind === "شمشیر" ? "سلاح" : kind}%`
  );

  return Math.min(20, Math.floor(Number(row?.points || 0) / 20));
}

function cleanExpiredInvitations() {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    UPDATE combat_duels
    SET status='expired'
    WHERE status='pending' AND created_at <= ?
  `).run(now - INVITE_SECONDS);
}

function parseAction(raw) {
  const text = String(raw || "").trim().slice(0, MAX_ACTION_LENGTH);

  if (text.length < 2) return { error: "short" };

  const forbidden = /خون.?آشام|گرگ.?نما|قدرت.?نژادی|قدرت.?خون|کنترل.?خون|تغییر.?شکل|تبدیل.*(گرگ|حیوان)|نامرئی|پرواز|تله.?پاتی|بازسازی.?فوری|سرعت.?فراطبیعی|قدرت.?فراطبیعی/iu;

  if (forbidden.test(text)) return { error: "racial" };

  let kind = "attack";
  let style = "normal";

  if (/جا\s*خالی|جاخالی|گریز|کنار\s*می‌روم|از\s*مسیر\s*ضربه\s*خارج/iu.test(text)) {
    kind = "dodge";
  } else if (/دفاع|سپر|مهار|دفع\s*ضربه|مسدود|ضربه\s*را\s*می‌گیرم/iu.test(text)) {
    kind = "defense";
  } else if (/حمله\s*سنگین|ضربه\s*سنگین|محکم|با\s*تمام\s*نیرو|سهمگین/iu.test(text)) {
    style = "heavy";
  } else if (/حمله\s*سریع|ضربه\s*سریع|پیاپی|پی‌درپی|چابک/iu.test(text)) {
    style = "quick";
  }

  return { kind, style, text };
}

function readAction(value) {
  if (value === "PASS") {
    return { kind: "pass", style: "normal", text: "از دست دادن نوبت" };
  }

  try {
    const parsed = JSON.parse(value);
    if (parsed && ["attack", "defense", "dodge"].includes(parsed.kind)) {
      return parsed;
    }
  } catch {}

  return { kind: "pass", style: "normal", text: "حرکت ثبت‌نشده" };
}

function actionLabel(action) {
  if (action.kind === "pass") return "نوبت از دست رفت";
  if (action.kind === "defense") return "حالت دفاعی";
  if (action.kind === "dodge") return "جاخالی";
  if (action.style === "heavy") return "حمله سنگین";
  if (action.style === "quick") return "حمله سریع";
  return "حمله معمولی";
}

function strike(attackerId, defenderId, weapon, attack, defense) {
  if (attack.kind !== "attack") {
    return {
      damage: 0,
      text: attack.kind === "pass"
        ? "حرکتی انجام نشد"
        : "در حالت دفاعی ماند"
    };
  }

  const skill = getTraining(attackerId, weapon.kind);
  const attackBonus = attack.style === "heavy" ? 7
    : attack.style === "quick" ? 2 : 0;

  const hit = randomInt(1, 21) + weapon.speed + skill + attackBonus;
  const guardBonus = defense.kind === "defense" ? 10
    : defense.kind === "dodge" ? 5 : 0;
  const guard = 10 + randomInt(1, 11) + guardBonus;

  if (
    defense.kind === "dodge" &&
    randomInt(1, 101) <= 35
  ) {
    return { damage: 0, text: "حریف با جاخالی از ضربه گریخت" };
  }

  if (hit <= guard) {
    return { damage: 0, text: "ضربه مهار شد" };
  }

  let damage = weapon.damage + randomInt(-3, 6) + skill;

  if (attack.style === "heavy") damage += 6;
  if (attack.style === "quick") damage -= 4;

  if (defense.kind === "defense") {
    damage = Math.floor(damage * 0.45);
  } else if (defense.kind === "dodge") {
    damage = Math.floor(damage * 0.75);
  }

  damage = Math.max(2, Math.min(35, damage));

  return {
    damage,
    text: `ضربه موفق؛ ${damage} آسیب`
  };
}

function duelText(duel) {
  const owner = duel.turn_owner_id;

  return `⚔️ پرونده مبارزه شماره ${duel.id}

🥀 ${playerName(duel.challenger_id)}: ${duel.hp_a} HP
🛡 ${playerName(duel.opponent_id)}: ${duel.hp_b} HP

دور: ${duel.turn} از ${MAX_ROUNDS}
نوبت فعلی: ${playerName(owner)}
⏳ مهلت حرکت: ۳ دقیقه`;
}

const createDuel = db.transaction((chatId, a, b) => {
  cleanExpiredInvitations();

  const busy = db.prepare(`
    SELECT id
    FROM combat_duels
    WHERE status IN ('pending','active')
      AND (
        challenger_id IN (?,?) OR
        opponent_id IN (?,?)
      )
    LIMIT 1
  `).get(a, b, a, b);

  if (busy) return { error: "busy" };

  const count = db.prepare(`
    SELECT COUNT(*) AS total
    FROM combat_duels
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
  cleanExpiredInvitations();

  const duel = db.prepare(`
    SELECT *
    FROM combat_duels
    WHERE id=? AND status='pending' AND opponent_id=?
  `).get(id, uid);

  if (!duel) return null;

  const now = Math.floor(Date.now() / 1000);
  const updated = db.prepare(`
    UPDATE combat_duels
    SET status='active',
        turn=1,
        turn_owner_id=challenger_id,
        turn_deadline_at=?,
        timeout_stage=0,
        last_action_at=?
    WHERE id=? AND status='pending' AND opponent_id=?
  `).run(now + TURN_SECONDS, now, id, uid);

  if (!updated.changes) return null;

  return db.prepare(
    "SELECT * FROM combat_duels WHERE id=?"
  ).get(id);
});

const submitMove = db.transaction((id, uid, move) => {
  const duel = db.prepare(`
    SELECT *
    FROM combat_duels
    WHERE id=? AND status='active'
  `).get(id);

  if (!duel) return { error: "invalid" };

  if (![duel.challenger_id, duel.opponent_id].includes(uid)) {
    return { error: "invalid" };
  }

  if (String(duel.turn_owner_id) !== uid) {
    return { error: "not_turn", owner: duel.turn_owner_id };
  }

  const now = Math.floor(Date.now() / 1000);

  if (Number(duel.turn_deadline_at || 0) <= now) {
    return { error: "timeout" };
  }

  const column = uid === duel.challenger_id ? "action_a" : "action_b";
  const saved = db.prepare(`
    UPDATE combat_duels
    SET ${column}=?,
        last_action_at=?,
        turn_owner_id=?,
        turn_deadline_at=?
    WHERE id=? AND status='active'
      AND turn_owner_id=?
      AND ${column} IS NULL
  `).run(
    JSON.stringify(move),
    now,
    uid === duel.challenger_id ? duel.opponent_id : duel.challenger_id,
    now + TURN_SECONDS,
    id,
    uid
  );

  if (!saved.changes) return { error: "already" };

  const fresh = db.prepare(
    "SELECT * FROM combat_duels WHERE id=?"
  ).get(id);

  if (!fresh.action_a || !fresh.action_b) {
    return {
      waiting: true,
      id,
      nextPlayer: fresh.turn_owner_id,
      deadline: fresh.turn_deadline_at
    };
  }

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
  };
});

const processOneTimeout = db.transaction((id, now) => {
  const duel = db.prepare(`
    SELECT *
    FROM combat_duels
    WHERE id=? AND status='active'
      AND turn_deadline_at IS NOT NULL
      AND turn_deadline_at <= ?
  `).get(id, now);

  if (!duel) return null;

  if (Number(duel.timeout_stage || 0) === 0) {
    const missedColumn =
      String(duel.turn_owner_id) === String(duel.challenger_id)
        ? "action_a"
        : "action_b";

    const nextPlayer =
      String(duel.turn_owner_id) === String(duel.challenger_id)
        ? duel.opponent_id
        : duel.challenger_id;

    const updated = db.prepare(`
      UPDATE combat_duels
      SET ${missedColumn}='PASS',
          turn_owner_id=?,
          turn_deadline_at=?,
          timeout_stage=1,
          last_action_at=?
      WHERE id=? AND status='active'
        AND turn_deadline_at <= ?
    `).run(nextPlayer, now + TURN_SECONDS, now, id, now);

    if (!updated.changes) return null;

    return {
      type: "passed",
      chatId: duel.chat_id,
      duelId: duel.id,
      missed: duel.turn_owner_id,
      next: nextPlayer
    };
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
    playerB: duel.opponent_id
  };
});

async function processDueDuels(api) {
  const now = Math.floor(Date.now() / 1000);

  cleanExpiredInvitations();

  const due = db.prepare(`
    SELECT id
    FROM combat_duels
    WHERE status='active'
      AND turn_deadline_at IS NOT NULL
      AND turn_deadline_at <= ?
    ORDER BY turn_deadline_at
    LIMIT 100
  `).all(now);

  for (const item of due) {
    const result = processOneTimeout(item.id, now);
    if (!result) continue;

    try {
      if (result.type === "passed") {
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
      }
    } catch (error) {
      console.error("Combat timeout notification error:", error);
    }
  }
}

function formatResult(result) {
  return `⚔️ نتیجه دور ${result.turn}

🥀 ${playerName(result.challenger)}
سلاح: ${result.weaponA}
حرکت: ${actionLabel(result.actionA)}
نتیجه: ${result.hitA}

🛡 ${playerName(result.opponent)}
سلاح: ${result.weaponB}
حرکت: ${actionLabel(result.actionB)}
نتیجه: ${result.hitB}

━━━━━━━━━━━━━━
❤️ ${playerName(result.challenger)}: ${result.hpA} HP
❤️ ${playerName(result.opponent)}: ${result.hpB} HP`;
}

export function registerCombat(bot) {
  bot.hears(/^#راهنمای_مبارزه$/u, async ctx => {
    await ctx.reply(
      `⚔️ راهنمای مبارزه مونتادوریا

۱. روی پیام حریف ریپلای کن و بنویس:
#مبارزه

۲. حریف دعوت را بپذیرد:
#پذیرش شماره

۳. بازیکن صاحب نوبت، حرکت آزاد خود را ثبت کند:
#حرکت شماره متن حرکت

نمونه:
#حرکت 12 با شمشیر از سمت راست به او ضربه می‌زنم

نمونه دفاع:
#حرکت 12 سپرم را بالا می‌آورم و ضربه را مهار می‌کنم

نمونه جاخالی:
#حرکت 12 سریع به سمت چپ جاخالی می‌دهم

⏳ مهلت هر نوبت: ۳ دقیقه
🩸 دو بار از دست دادن مهلت پیاپی: لغو مبارزه و کسر ۲۰ XP از هر بازیکن
⚔️ حداکثر مبارزه هم‌زمان: ۱۰۰

#سلاح‌ها
#انتخاب_سلاح شماره`
    );
  });

  bot.hears(/^#سلاح‌ها(?:\s+([0-9]+))?$/u, async ctx => {
    const page = Math.max(1, Number(ctx.match[1] || 1));
    const rows = db.prepare(`
      SELECT id,name,kind,damage,speed,reach
      FROM combat_weapons
      WHERE approved=1
      ORDER BY
        CASE kind
          WHEN 'شمشیر' THEN 1
          WHEN 'خنجر' THEN 2
          WHEN 'تبر' THEN 3
          WHEN 'گرز' THEN 4
          WHEN 'نیزه' THEN 5
          WHEN 'کمان' THEN 6
          WHEN 'پرتابی' THEN 7
          WHEN 'زنجیری' THEN 8
          WHEN 'رزمی' THEN 9
          WHEN 'سپر' THEN 10
          ELSE 11
        END,
        damage DESC,
        speed DESC,
        name
    `).all();

    const pageSize = 12;
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));

    if (page > totalPages) {
      return ctx.reply(`❌ این صفحه وجود ندارد. تعداد صفحات: ${totalPages}`);
    }

    const selected = rows.slice((page - 1) * pageSize, page * pageSize);
    const output = selected.map(w =>
      `${w.id}. ${w.name} | ${w.kind}
آسیب: ${w.damage} | سرعت: ${w.speed} | برد: ${w.reach}`
    );

    await ctx.reply(
      `⚔️ زرادخانه مونتادوریا
صفحه ${page} از ${totalPages}

${output.join("\n\n")}

برای صفحه بعد:
#سلاح‌ها ${Math.min(page + 1, totalPages)}`
    );
  });

  bot.hears(/^#انتخاب_سلاح\s+([0-9]+)$/u, async ctx => {
    const uid = String(ctx.from.id);

    const busy = db.prepare(`
      SELECT 1
      FROM combat_duels
      WHERE status='active'
        AND (challenger_id=? OR opponent_id=?)
      LIMIT 1
    `).get(uid, uid);

    if (busy) {
      return ctx.reply("⛔ هنگام مبارزه امکان تغییر سلاح وجود ندارد.");
    }

    const weapon = db.prepare(`
      SELECT id,name
      FROM combat_weapons
      WHERE id=? AND approved=1
    `).get(Number(ctx.match[1]));

    if (!weapon) return ctx.reply("❌ شناسه سلاح معتبر نیست.");

    db.prepare(`
      INSERT INTO combat_loadouts(telegram_id,weapon_id)
      VALUES(?,?)
      ON CONFLICT(telegram_id)
      DO UPDATE SET weapon_id=excluded.weapon_id
    `).run(uid, weapon.id);

    await ctx.reply(`⚔️ سلاح فعال تو «${weapon.name}» شد.`);
  });

  bot.hears(/^#افزودن_سلاح\s+(.+)\s+(\S+)\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)$/u, async ctx => {
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
        "قالب:\n#افزودن_سلاح نام_سلاح دسته آسیب سرعت برد"
      );
    }

    try {
      db.prepare(`
        INSERT INTO combat_weapons
          (name,kind,damage,speed,reach,custom,approved,created_by,created_at)
        VALUES(?,?,?,?,?,1,1,?,?)
      `).run(
        name,
        kind,
        damage,
        speed,
        reach,
        String(ctx.from.id),
        Math.floor(Date.now() / 1000)
      );

      await ctx.reply(`✅ سلاح «${name}» به زرادخانه اضافه شد.`);
    } catch {
      await ctx.reply("❌ نام این سلاح قبلاً ثبت شده است.");
    }
  });

  bot.hears(/^#مبارزه$/u, async ctx => {
    cleanExpiredInvitations();

    if (!ctx.message?.reply_to_message?.from) {
      return ctx.reply(
        "برای دعوت به مبارزه، روی پیام حریف ریپلای کن و #مبارزه بفرست."
      );
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
      `⚔️ دعوت رسمی مبارزه

🥀 ${playerName(a)}
در برابر
🛡 ${playerName(b)}

شماره پرونده: ${result.id}

برای پذیرش:
#پذیرش ${result.id}

دعوت تا ۱۵ دقیقه معتبر است.`
    );
  });

  bot.hears(/^#پذیرش\s+([0-9]+)$/u, async ctx => {
    const id = Number(ctx.match[1]);
    const duel = acceptDuel(id, String(ctx.from.id));

    if (!duel) {
      return ctx.reply("❌ دعوت پیدا نشد، منقضی شده یا برای تو نیست.");
    }

    await ctx.reply(
      `⚔️ مبارزه آغاز شد.

${duelText(duel)}

حرکت اول با ${playerName(duel.challenger_id)} است.
برای ثبت حرکت:
#حرکت ${id} متن حرکت`
    );
  });

  bot.hears(/^#حرکت\s+([0-9]+)\s+([\s\S]{2,250})$/u, async ctx => {
    const id = Number(ctx.match[1]);
    const uid = String(ctx.from.id);
    const parsed = parseAction(ctx.match[2]);

    if (parsed.error === "short") {
      return ctx.reply("❌ حرکت باید توضیح کافی داشته باشد.");
    }

    if (parsed.error === "racial") {
      return ctx.reply(
        "⛔ استفاده از قابلیت‌های فراطبیعی و نژادی در مبارزه مجاز نیست. فقط حرکت رزمی عادی ثبت کن."
      );
    }

    await processDueDuels(bot.api);

    const result = submitMove(id, uid, parsed);

    if (result.error === "invalid") {
      return ctx.reply("❌ مبارزه فعال یا مجاز پیدا نشد.");
    }

    if (result.error === "not_turn") {
      return ctx.reply(
        `⏳ هنوز نوبت تو نیست. نوبت ${playerName(result.owner)} است.`
      );
    }

    if (result.error === "timeout") {
      return ctx.reply("⏳ مهلت این نوبت تمام شده است.");
    }

    if (result.error === "already") {
      return ctx.reply("⛔ حرکت این نوبت قبلاً ثبت شده است.");
    }

    if (result.waiting) {
      return ctx.reply(
        `✅ حرکت ثبت شد.
نوبت ${playerName(result.nextPlayer)} است.
۳ دقیقه فرصت دارد.`
      );
    }

    await ctx.reply(formatResult(result));

    if (result.done) {
      if (!result.winner) {
        return ctx.reply("🤝 مبارزه با نتیجه مساوی پایان یافت.");
      }

      const loser = result.winner === result.challenger
        ? result.opponent
        : result.challenger;

      const reward = awardCombatVictoryXP(
        result.winner,
        loser,
        `combat:${id}:winner`
      );

      return ctx.reply(
        `🏆 پیروز میدان: ${playerName(result.winner)}
${xpAwardText(reward) || "پاداش XP به دلیل محدودیت روزانه یا ثبت قبلی تعلق نگرفت."}`
      );
    }

    const next = db.prepare(
      "SELECT * FROM combat_duels WHERE id=?"
    ).get(id);

    await ctx.reply(duelText(next));
  });

  const timer = setInterval(() => {
    processDueDuels(bot.api).catch(error => {
      console.error("Combat timer error:", error);
    });
  }, 5000);

  timer.unref?.();
}
