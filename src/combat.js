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
const MAX_ACTION_LENGTH = 250;

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
ensureColumn("combat_duels", "energy_a", "INTEGER NOT NULL DEFAULT 100");
ensureColumn("combat_duels", "energy_b", "INTEGER NOT NULL DEFAULT 100");
ensureColumn("combat_duels", "panel_message_id", "INTEGER");
ensureColumn("combat_duels", "last_round_text", "TEXT");
ensureColumn("combat_duels", "end_request_by", "TEXT");
ensureColumn("combat_duels", "end_request_at", "INTEGER");
ensureColumn("combat_duels", "winner_id", "TEXT");
ensureColumn("combat_duels", "panel_notice", "TEXT");

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

// MONTADORIA_COMBAT_OWNERSHIP_V1
function getWeapon(id) {
  return db.prepare(`
    SELECT w.*, i.instance_id
    FROM combat_loadouts l
    JOIN combat_weapon_instances i
      ON i.instance_id=l.weapon_instance_id
     AND i.holder_id=l.telegram_id
    JOIN combat_weapons w ON w.id=i.weapon_id
    WHERE l.telegram_id=? AND w.approved=1
  `).get(String(id)) || null;
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
  const text = String(raw || "").trim();

  if (text.length < 2) return { error: "short" };

  const forbidden = /خون.?آشام|گرگ.?نما|قدرت.?نژادی|قدرت.?خون|کنترل.?خون|تغییر.?شکل|تبدیل.*(گرگ|حیوان)|نامرئی|پرواز|تله.?پاتی|بازسازی.?فوری|سرعت.?فراطبیعی|قدرت.?فراطبیعی/iu;

  // متن کامل باید بررسی شود؛ بریدن متن قبل از این بررسی راه دورزدن فیلتر بود.
  if (forbidden.test(text)) return { error: "racial" };
  if (text.length > MAX_ACTION_LENGTH) return { error: "long" };

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


// MONTADORIA_COMBAT_PANEL_V2

function hpBar(value) {
  const amount = Math.max(0, Math.min(100, Number(value ?? 100)));
  const filled = Math.round(amount / 10);
  return "🟩".repeat(filled) + "⬛".repeat(10 - filled);
}

function duelText(duel) {
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

  if (duel.panel_notice) {
    text += `

━━━━━━━━━━━━━━

${duel.panel_notice}`;
  }

  return text;
}

function combatKeyboard(duel) {
  if (!duel || duel.status !== "active") {
    return { inline_keyboard: [] };
  }

  const id = Number(duel.id);

  if (duel.end_request_by) {
    return {
      inline_keyboard: [
        [
          {
            text: "🏳️ تسلیم",
            callback_data: `cmp_surr:${id}`
          }
        ],
        [
          {
            text: "✅ قبول پایان",
            callback_data: `cmp_end_accept:${id}`
          },
          {
            text: "❌ رد درخواست",
            callback_data: `cmp_end_reject:${id}`
          },
          {
            text: "↩️ لغو درخواست",
            callback_data: `cmp_end_cancel:${id}`
          }
        ]
      ]
    };
  }

  return {
    inline_keyboard: [
      [
        {
          text: "🏳️ تسلیم",
          callback_data: `cmp_surr:${id}`
        }
      ],
      [
        {
          text: "🤝 درخواست پایان توافقی",
          callback_data: `cmp_end_request:${id}`
        }
      ]
    ]
  };
}

function saveDuelNotice(id, message) {
  db.prepare(`
    UPDATE combat_duels
    SET panel_notice=?
    WHERE id=?
  `).run(String(message || "").slice(-1300), id);
}

async function updateCombatPanel(api, id) {
  const duel = db.prepare(`
    SELECT *
    FROM combat_duels
    WHERE id=?
  `).get(id);

  if (!duel) return;

  const text = duelText(duel);
  const options = {
    reply_markup: combatKeyboard(duel)
  };

  if (duel.panel_message_id) {
    try {
      await api.editMessageText(
        duel.chat_id,
        Number(duel.panel_message_id),
        text,
        options
      );
      return;
    } catch (error) {
      const message = String(error?.description || error?.message || error);

      if (/message is not modified/i.test(message)) return;

      if (!/message to edit not found|message_id_invalid|message identifier is not specified/i.test(message)) {
        throw error;
      }

      db.prepare(`
        UPDATE combat_duels
        SET panel_message_id=NULL
        WHERE id=?
      `).run(id);
    }
  }

  const sent = await api.sendMessage(duel.chat_id, text, options);

  db.prepare(`
    UPDATE combat_duels
    SET panel_message_id=?
    WHERE id=?
  `).run(sent.message_id, id);
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

const acceptDuel = db.transaction((id, uid, chatId) => {
  cleanExpiredInvitations();

  const duel = db.prepare(`
    SELECT *
    FROM combat_duels
    WHERE id=? AND status='pending' AND opponent_id=? AND chat_id=?
  `).get(id, uid, chatId);

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
    WHERE id=? AND status='pending' AND opponent_id=? AND chat_id=?
  `).run(now + TURN_SECONDS, now, id, uid, chatId);

  if (!updated.changes) return null;

  return db.prepare(
    "SELECT * FROM combat_duels WHERE id=?"
  ).get(id);
});



const finishBySurrender = db.transaction((id, uid, chatId) => {
  const duel = db.prepare(`
    SELECT *
    FROM combat_duels
    WHERE id=? AND chat_id=? AND status='active'
  `).get(id, chatId);

  if (!duel) return { error: "invalid" };

  if (![String(duel.challenger_id), String(duel.opponent_id)].includes(uid)) {
    return { error: "not_player" };
  }

  const winner = uid === String(duel.challenger_id)
    ? String(duel.opponent_id)
    : String(duel.challenger_id);

  const notice = `🏳️ ${playerName(uid)} تسلیم شد.
🏆 ${playerName(winner)} برنده مبارزه شد.`;

  const updated = db.prepare(`
    UPDATE combat_duels
    SET status='finished',
        winner_id=?,
        turn_deadline_at=NULL,
        end_request_by=NULL,
        end_request_at=NULL,
        last_action_at=?,
        last_round_text=?
    WHERE id=? AND status='active'
  `).run(
    winner,
    Math.floor(Date.now() / 1000),
    notice,
    id
  );

  if (!updated.changes) return { error: "finished" };

  return {
    ok: true,
    winner,
    loser: uid
  };
});

const requestDuelEnd = db.transaction((id, uid, chatId) => {
  const duel = db.prepare(`
    SELECT *
    FROM combat_duels
    WHERE id=? AND chat_id=? AND status='active'
  `).get(id, chatId);

  if (!duel) return { error: "invalid" };

  if (![String(duel.challenger_id), String(duel.opponent_id)].includes(uid)) {
    return { error: "not_player" };
  }

  if (duel.end_request_by) {
    return {
      error: String(duel.end_request_by) === uid ? "already_own" : "pending"
    };
  }

  const notice = `📨 ${playerName(uid)} درخواست پایان توافقی مبارزه را ثبت کرد.`;

  const updated = db.prepare(`
    UPDATE combat_duels
    SET end_request_by=?,
        end_request_at=?,
        last_round_text=?
    WHERE id=? AND status='active'
      AND end_request_by IS NULL
  `).run(
    uid,
    Math.floor(Date.now() / 1000),
    notice,
    id
  );

  if (!updated.changes) return { error: "pending" };

  return { ok: true };
});

const respondDuelEnd = db.transaction((id, uid, chatId, action) => {
  const duel = db.prepare(`
    SELECT *
    FROM combat_duels
    WHERE id=? AND chat_id=? AND status='active'
  `).get(id, chatId);

  if (!duel || !duel.end_request_by) return { error: "no_request" };

  const requester = String(duel.end_request_by);
  const isPlayer = [
    String(duel.challenger_id),
    String(duel.opponent_id)
  ].includes(uid);

  if (!isPlayer) return { error: "not_player" };

  if (action === "cancel" && uid !== requester) {
    return { error: "not_requester" };
  }

  if ((action === "accept" || action === "reject") && uid === requester) {
    return { error: "requester_cannot_answer" };
  }

  if (!["accept", "reject", "cancel"].includes(action)) {
    return { error: "invalid_action" };
  }

  const now = Math.floor(Date.now() / 1000);

  if (action === "accept") {
    const notice = `🤝 پایان توافقی مبارزه پذیرفته شد.
هر دو بازیکن با پایان مبارزه موافقت کردند.`;

    const updated = db.prepare(`
      UPDATE combat_duels
      SET status='draw',
          winner_id=NULL,
          turn_deadline_at=NULL,
          end_request_by=NULL,
          end_request_at=NULL,
          last_action_at=?,
          last_round_text=?
      WHERE id=? AND status='active'
        AND end_request_by=?
    `).run(now, notice, id, requester);

    if (!updated.changes) return { error: "no_request" };
    return { ok: true, action: "accepted" };
  }

  const notice = action === "reject"
    ? `❌ ${playerName(uid)} درخواست پایان توافقی را رد کرد. مبارزه ادامه دارد.`
    : `↩️ ${playerName(uid)} درخواست پایان توافقی را لغو کرد. مبارزه ادامه دارد.`;

  const updated = db.prepare(`
    UPDATE combat_duels
    SET end_request_by=NULL,
        end_request_at=NULL,
        last_action_at=?,
        last_round_text=?
    WHERE id=? AND status='active'
      AND end_request_by=?
  `).run(now, notice, id, requester);

  if (!updated.changes) return { error: "no_request" };

  return { ok: true, action };
});

function isCombatPanelMessage(ctx, id) {
  const message = ctx.callbackQuery?.message;
  if (!message) return false;

  const duel = db.prepare(`
    SELECT chat_id,panel_message_id
    FROM combat_duels
    WHERE id=?
  `).get(id);

  if (!duel || !duel.panel_message_id) return false;

  return String(message.chat?.id) === String(duel.chat_id) &&
    Number(message.message_id) === Number(duel.panel_message_id);
}

async function recordCombatWinner(api, id, winner, loser) {
  const reward = awardCombatVictoryXP(
    winner,
    loser,
    `combat:${id}:winner`
  );

  const rewardText = xpAwardText(reward) ||
    "پاداش XP به دلیل محدودیت روزانه یا ثبت قبلی تعلق نگرفت.";

  const current = db.prepare(`
    SELECT last_round_text
    FROM combat_duels
    WHERE id=?
  `).get(id);

  const previous = current?.last_round_text || "";

  saveDuelNotice(
    id,
    `${previous}

🏆 پیروز میدان: ${playerName(winner)}
${rewardText}`
  );

  await updateCombatPanel(api, id);
}

function energyCost(action) {
  if (action.kind === "pass") return 0;
  if (action.kind === "defense") return 8;
  if (action.kind === "dodge") return 10;
  if (action.style === "heavy") return 35;
  if (action.style === "quick") return 22;
  return 12;
}

function prepareActionForEnergy(action, energy) {
  const available = Math.max(0, Number(energy || 0));

  if (
    action.kind === "attack" &&
    action.style === "heavy" &&
    available < 35
  ) {
    return {
      ...action,
      style: "normal",
      text: action.text + " (به‌دلیل انرژی کم، حرکت عادی اجرا شد)"
    };
  }

  if (
    action.kind === "attack" &&
    action.style === "quick" &&
    available < 22
  ) {
    return {
      ...action,
      style: "normal",
      text: action.text + " (به‌دلیل انرژی کم، حرکت عادی اجرا شد)"
    };
  }

  return action;
}

function nextEnergy(current, action) {
  const value = Math.max(0, Math.min(100, Number(current ?? 100)));
  const cost = Math.min(value, energyCost(action));
  return Math.min(100, Math.max(0, value - cost) + 10);
}

function energyBar(value) {
  const amount = Math.max(0, Math.min(100, Number(value || 0)));
  const filled = Math.round(amount / 10);
  return "🟦".repeat(filled) + "⬛".repeat(10 - filled);
}

function resolveRound(fresh, now) {
  const energyAStart = Math.max(0, Math.min(100, Number(fresh.energy_a ?? 100)));
  const energyBStart = Math.max(0, Math.min(100, Number(fresh.energy_b ?? 100)));

  const actionA = prepareActionForEnergy(
    readAction(fresh.action_a),
    energyAStart
  );
  const actionB = prepareActionForEnergy(
    readAction(fresh.action_b),
    energyBStart
  );

  const energyA = nextEnergy(energyAStart, actionA);
  const energyB = nextEnergy(energyBStart, actionB);

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

  const done = hpA === 0 || hpB === 0;
  const winner = hpA === hpB
    ? null
    : hpA > hpB ? fresh.challenger_id : fresh.opponent_id;

  db.prepare(`
    UPDATE combat_duels
    SET hp_a=?,
        hp_b=?,
        energy_a=?,
        energy_b=?,
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
    energyA,
    energyB,
    done ? (winner ? "finished" : "draw") : "active",
    fresh.challenger_id,
    done ? null : now + TURN_SECONDS,
    now,
    fresh.id
  );

  const result = {
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
    energyA,
    energyB,
    done,
    winner
  };

  db.prepare(`
    UPDATE combat_duels
    SET last_round_text=?,
        winner_id=?
    WHERE id=?
  `).run(
    formatResult(result),
    winner ? String(winner) : null,
    fresh.id
  );

  return result;
}

const submitMove = db.transaction((id, uid, move, chatId) => {
  const duel = db.prepare(`
    SELECT *
    FROM combat_duels
    WHERE id=? AND status='active' AND chat_id=?
  `).get(id, chatId);

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

  return resolveRound(fresh, now);
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

    const fresh = db.prepare(
      "SELECT * FROM combat_duels WHERE id=?"
    ).get(id);

    // اگر حریف قبلاً حرکتش را ثبت کرده باشد، PASS همان لحظه دور را می‌بندد.
    if (fresh?.action_a && fresh?.action_b) {
      const resolved = resolveRound(fresh, now);

      saveDuelNotice(
        id,
        `⏳ مهلت ${playerName(duel.turn_owner_id)} تمام شد و حرکت او ثبت نشد.

${formatResult(resolved)}`
      );

      return {
        ...resolved,
        type: "resolved",
        chatId: duel.chat_id,
        missed: duel.turn_owner_id
      };
    }

    const notice = `⏳ مهلت ${playerName(duel.turn_owner_id)} به پایان رسید.
نوبت به ${playerName(nextPlayer)} منتقل شد.
۳ دقیقه فرصت باقی است.`;

    saveDuelNotice(id, notice);

    return {
      type: "passed",
      chatId: duel.chat_id,
      duelId: duel.id,
      missed: duel.turn_owner_id,
      next: nextPlayer
    };
  }

  // کسر XP و لغو پرونده در یک تراکنش واحد انجام می‌شوند.
  const penaltyA = deductCombatTimeoutXP(duel.challenger_id, 20);
  const penaltyB = deductCombatTimeoutXP(duel.opponent_id, 20);
  if (!penaltyA || !penaltyB) {
    throw new Error(`Combat timeout XP penalty failed for duel ${id}`);
  }

  const updated = db.prepare(`
    UPDATE combat_duels
    SET status='cancelled',
        winner_id=NULL,
        turn_deadline_at=NULL,
        end_request_by=NULL,
        end_request_at=NULL,
        last_action_at=?
    WHERE id=? AND status='active'
      AND turn_deadline_at <= ?
  `).run(now, id, now);

  if (!updated.changes) return null;

  saveDuelNotice(
    id,
    `⛓️ مبارزه شماره ${duel.id} لغو شد.
هر دو بازیکن مهلت خود را از دست دادند.

🥀 ${playerName(duel.challenger_id)}: کسر ${penaltyA.lostXP} XP
🥀 ${playerName(duel.opponent_id)}: کسر ${penaltyB.lostXP} XP`
  );

  return {
    type: "cancelled",
    chatId: duel.chat_id,
    duelId: duel.id,
    playerA: duel.challenger_id,
    playerB: duel.opponent_id,
    lostA: penaltyA.lostXP,
    lostB: penaltyB.lostXP
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

    const duelId = Number(result.id || result.duelId);

    try {
      if (result.type === "cancelled") {
        try {
          await api.sendMessage(
            result.chatId,
            `⛓️ مبارزه شماره ${duelId} لغو شد.
مهلت هر دو بازیکن برای انجام حرکت به پایان رسید.

🥀 ${playerName(result.playerA)}: ${result.lostA} امتیاز تجربه کسر شد.
🥀 ${playerName(result.playerB)}: ${result.lostB} امتیاز تجربه کسر شد.

این کسر امتیاز به دلیل لغو مبارزه اعمال شد.`
          );
        } catch (announcementError) {
          console.error("Combat cancellation announcement error:", announcementError);
        }
      }

      if (result.type === "passed") {
        saveDuelNotice(
          duelId,
          `⏳ مهلت ${playerName(result.missed)} به پایان رسید.
نوبت به ${playerName(result.next)} منتقل شد.
۳ دقیقه فرصت باقی است.`
        );
      } else if (result.type === "resolved" && result.done && result.winner) {
        const loser = String(result.winner) === String(result.challenger)
          ? result.opponent
          : result.challenger;

        await recordCombatWinner(api, duelId, result.winner, loser);
        continue;
      } else if (result.type === "resolved" && result.done) {
        saveDuelNotice(
          duelId,
          `${formatResult(result)}

🤝 مبارزه با نتیجه مساوی پایان یافت.`
        );
      }

      // همه رویدادها در پیام پنل همان مبارزه نمایش داده می‌شوند.
      await updateCombatPanel(api, duelId);
    } catch (error) {
      console.error("Combat panel timeout update error:", error);
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

❤️ ${playerName(result.challenger)}: ${result.hpA}/100
${hpBar(result.hpA)}
⚡ ${energyBar(result.energyA)} ${result.energyA}/100

❤️ ${playerName(result.opponent)}: ${result.hpB}/100
${hpBar(result.hpB)}
⚡ ${energyBar(result.energyB)} ${result.energyB}/100`;
}

const WEAPON_KIND_ORDER = [
  "شمشیر", "خنجر", "تبر", "گرز", "نیزه",
  "کمان", "پرتابی", "زنجیری", "رزمی", "سپر"
];

function getWeaponKinds() {
  const kinds = db.prepare(`
    SELECT DISTINCT kind
    FROM combat_weapons
    WHERE approved=1
  `).all().map(row => row.kind);

  return kinds.sort((a, b) => {
    const ai = WEAPON_KIND_ORDER.indexOf(a);
    const bi = WEAPON_KIND_ORDER.indexOf(b);
    const av = ai < 0 ? 999 : ai;
    const bv = bi < 0 ? 999 : bi;
    return av - bv || a.localeCompare(b, "fa");
  });
}

function arsenalKeyboard(page, totalPages) {
  const previous = Math.max(0, page - 1);
  const next = Math.min(totalPages - 1, page + 1);

  return {
    inline_keyboard: [[
      {
        text: "صفحه قبل",
        callback_data: `combat_weapons:${previous}`
      },
      {
        text: "صفحه بعد",
        callback_data: `combat_weapons:${next}`
      }
    ]]
  };
}

function arsenalContent(page) {
  const kinds = getWeaponKinds();
  const totalPages = Math.max(1, kinds.length);
  const current = Math.max(0, Math.min(totalPages - 1, page));
  const kind = kinds[current];

  if (!kind) {
    return {
      page: 0,
      totalPages: 1,
      text: "⚔️ زرادخانه خالی است.",
      keyboard: arsenalKeyboard(0, 1)
    };
  }

  const weapons = db.prepare(`
    SELECT id,name,kind,damage,speed,reach,price
    FROM combat_weapons
    WHERE approved=1 AND kind=?
    ORDER BY damage DESC, speed DESC, name
  `).all(kind);

  const lines = weapons.map(w =>
    `${w.id}. ${w.name}
آسیب: ${w.damage} | سرعت: ${w.speed} | برد: ${w.reach}
قیمت خرید: ${Number(w.price || 0).toLocaleString("en-US")}`
  );

  const text = `⚔️ زرادخانه مونتادوریا

دسته: ${kind}
صفحه ${current + 1} از ${totalPages}
تعداد سلاح‌ها: ${weapons.length}

${lines.join("\n\n")}

برای خرید:
#خرید_سلاح شناسه [تعداد]

برای تجهیز نسخه خریداری‌شده:
#انتخاب_سلاح شناسه_وسیله

شناسه وسیله را از #سلاح‌های_من بردار.`;

  return {
    page: current,
    totalPages,
    text,
    keyboard: arsenalKeyboard(current, totalPages)
  };
}

async function showArsenal(ctx, page, edit = false) {
  const result = arsenalContent(page);

  if (edit) {
    await ctx.editMessageText(result.text, {
      reply_markup: result.keyboard
    });
  } else {
    await ctx.reply(result.text, {
      reply_markup: result.keyboard
    });
  }
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

  bot.hears(/^#سلاح‌ها(?:\\s+([0-9]+))?$/u, async ctx => {
    const requested = Math.max(1, Number(ctx.match[1] || 1));
    await showArsenal(ctx, requested - 1, false);
  });

  bot.callbackQuery(/^combat_weapons:([0-9]+)$/u, async ctx => {
    const page = Number(ctx.match[1]);
    try {
      await showArsenal(ctx, page, true);
      await ctx.answerCallbackQuery();
    } catch (error) {
      console.error("Combat arsenal page error:", error);
      await ctx.answerCallbackQuery({
        text: "خطا در باز کردن صفحه سلاح‌ها",
        show_alert: true
      });
    }
  });

  // انتخاب سلاح در src/combat_weapons.js با بررسی مالکیت انجام می‌شود.

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

    if (!getWeapon(a)) {
      return ctx.reply(
        `⛔ ${playerName(a)} سلاحی خریداری‌شده یا امانتی را تجهیز نکرده است.`
      );
    }

    if (!getWeapon(b)) {
      return ctx.reply(
        `⛔ ${playerName(b)} هنوز سلاح معتبر و تجهیزشده ندارد.`
      );
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
    const invitation = db.prepare(`
      SELECT challenger_id, opponent_id
      FROM combat_duels
      WHERE id=? AND status='pending'
        AND opponent_id=? AND chat_id=?
    `).get(id, String(ctx.from.id), String(ctx.chat.id));

    if (invitation && !getWeapon(invitation.challenger_id)) {
      return ctx.reply("⛔ دعوت‌کننده دیگر سلاح معتبر و تجهیزشده ندارد.");
    }

    if (invitation && !getWeapon(invitation.opponent_id)) {
      return ctx.reply("⛔ ابتدا باید یک سلاح معتبر را تجهیز کنی.");
    }

    const duel = acceptDuel(id, String(ctx.from.id), String(ctx.chat.id));

    if (!duel) {
      return ctx.reply("❌ دعوت پیدا نشد، منقضی شده یا برای تو نیست.");
    }

    await updateCombatPanel(bot.api, id);
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

    if (parsed.error === "long") {
      return ctx.reply("❌ متن حرکت بیش از ۲۵۰ نویسه است.");
    }

    await processDueDuels(bot.api);

    const result = submitMove(id, uid, parsed, String(ctx.chat.id));

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
      saveDuelNotice(
        id,
        `✅ حرکت ${playerName(uid)} ثبت شد.
نوبت ${playerName(result.nextPlayer)} است.
۳ دقیقه فرصت دارد.`
      );

      await updateCombatPanel(bot.api, id);
      return;
    }

    if (result.done && result.winner) {
      const loser = String(result.winner) === String(result.challenger)
        ? result.opponent
        : result.challenger;

      await recordCombatWinner(
        bot.api,
        id,
        result.winner,
        loser
      );
      return;
    }

    if (result.done && !result.winner) {
      saveDuelNotice(
        id,
        `${formatResult(result)}

🤝 مبارزه با نتیجه مساوی پایان یافت.`
      );
    }

    await updateCombatPanel(bot.api, id);
  });


  // دکمه تسلیم
  bot.callbackQuery(/^cmp_surr:([0-9]+)$/u, async ctx => {
    const id = Number(ctx.match[1]);
    const uid = String(ctx.from.id);
    const chatId = String(ctx.callbackQuery.message?.chat?.id ?? "");

    if (!isCombatPanelMessage(ctx, id)) {
      return ctx.answerCallbackQuery({
        text: "این پنل دیگر معتبر نیست.",
        show_alert: true
      });
    }

    const result = finishBySurrender(id, uid, chatId);

    if (result.error) {
      return ctx.answerCallbackQuery({
        text: result.error === "not_player"
          ? "تو بازیکن این مبارزه نیستی."
          : "این مبارزه دیگر فعال نیست.",
        show_alert: true
      });
    }

    await recordCombatWinner(
      bot.api,
      id,
      result.winner,
      result.loser
    );

    await ctx.answerCallbackQuery({ text: "تسلیم ثبت شد." });
  });

  // درخواست پایان توافقی
  bot.callbackQuery(/^cmp_end_request:([0-9]+)$/u, async ctx => {
    const id = Number(ctx.match[1]);
    const uid = String(ctx.from.id);
    const chatId = String(ctx.callbackQuery.message?.chat?.id ?? "");

    if (!isCombatPanelMessage(ctx, id)) {
      return ctx.answerCallbackQuery({
        text: "این پنل دیگر معتبر نیست.",
        show_alert: true
      });
    }

    const result = requestDuelEnd(id, uid, chatId);

    if (result.error) {
      const messages = {
        invalid: "مبارزه فعال پیدا نشد.",
        not_player: "تو بازیکن این مبارزه نیستی.",
        already_own: "درخواست پایان را قبلاً ثبت کرده‌ای.",
        pending: "درخواست دیگری در انتظار پاسخ است."
      };

      return ctx.answerCallbackQuery({
        text: messages[result.error] || "درخواست انجام نشد.",
        show_alert: true
      });
    }

    await updateCombatPanel(bot.api, id);
    await ctx.answerCallbackQuery({
      text: "درخواست پایان برای بازیکن مقابل ثبت شد."
    });
  });

  // قبول پایان توافقی، رد درخواست یا لغو درخواست خود
  for (const action of ["accept", "reject", "cancel"]) {
    bot.callbackQuery(
      new RegExp(`^cmp_end_${action}:([0-9]+)$`, "u"),
      async ctx => {
        const id = Number(ctx.match[1]);
        const uid = String(ctx.from.id);
        const chatId = String(ctx.callbackQuery.message?.chat?.id ?? "");

        if (!isCombatPanelMessage(ctx, id)) {
          return ctx.answerCallbackQuery({
            text: "این پنل دیگر معتبر نیست.",
            show_alert: true
          });
        }

        const result = respondDuelEnd(id, uid, chatId, action);

        if (result.error) {
          const messages = {
            no_request: "درخواست پایان فعالی وجود ندارد.",
            not_player: "تو بازیکن این مبارزه نیستی.",
            not_requester: "فقط ثبت‌کننده درخواست می‌تواند آن را لغو کند.",
            requester_cannot_answer: "ثبت‌کننده درخواست نمی‌تواند درخواست خودش را قبول یا رد کند."
          };

          return ctx.answerCallbackQuery({
            text: messages[result.error] || "این عملیات مجاز نیست.",
            show_alert: true
          });
        }

        await updateCombatPanel(bot.api, id);

        const answer = action === "accept"
          ? "پایان توافقی ثبت شد."
          : action === "reject"
            ? "درخواست رد شد؛ مبارزه ادامه دارد."
            : "درخواست خودت لغو شد.";

        await ctx.answerCallbackQuery({ text: answer });
      }
    );
  }

  const timer = setInterval(() => {
    processDueDuels(bot.api).catch(error => {
      console.error("Combat timer error:", error);
    });
  }, 5000);

  timer.unref?.();
}
