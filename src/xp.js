import db from "./database.js";

const DAY_SECONDS = 24 * 60 * 60;

const DAILY_CAPS = Object.freeze({
  economy: 12,
  training: 24,
  combat: 60
});

const ACTIVITY_RULES = Object.freeze({
  shop_purchase: { xp: 2, category: "economy", cooldownSeconds: 3 * 60 * 60 },
  shop_sale: { xp: 3, category: "economy", cooldownSeconds: 3 * 60 * 60 },
  asset_purchase: { xp: 5, category: "economy", cooldownSeconds: DAY_SECONDS },
  asset_sale: { xp: 3, category: "economy", cooldownSeconds: DAY_SECONDS },
  training: { xp: 8, category: "training", cooldownSeconds: 6 * 60 * 60 },
  training_hard: { xp: 18, category: "training", cooldownSeconds: 12 * 60 * 60 },
  mission: { xp: 15, category: "training", cooldownSeconds: DAY_SECONDS }
});

db.exec(`
  CREATE TABLE IF NOT EXISTS montadoria_xp_awards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT NOT NULL,
    activity TEXT NOT NULL,
    category TEXT NOT NULL,
    event_key TEXT NOT NULL UNIQUE,
    xp INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_montadoria_xp_user_activity_time
  ON montadoria_xp_awards (telegram_id, activity, created_at);

  CREATE INDEX IF NOT EXISTS idx_montadoria_xp_user_category_time
  ON montadoria_xp_awards (telegram_id, category, created_at);
`);

function xpRequiredForLevel(level) {
  if (level <= 1) return 0;
  return Math.floor(100 * Math.pow(level - 1, 1.5));
}

function calculateLevelFromXP(xp) {
  let level = 1;
  while (xp >= xpRequiredForLevel(level + 1) && level < 1000) {
    level++;
  }
  return level;
}

export function xpEventKey(ctx, action) {
  const chatId = ctx?.chat?.id ?? "private";
  const messageId = ctx?.message?.message_id ?? ctx?.update?.update_id ?? Date.now();
  return `${String(action)}:${String(chatId)}:${String(messageId)}`;
}

function applyAward(telegramId, activity, eventKey, rule) {
  const id = String(telegramId ?? "");
  const key = String(eventKey ?? "").trim();

  if (!/^\d{1,20}$/.test(id) || !key || key.length > 200) return null;

  const now = Math.floor(Date.now() / 1000);
  const dayStart = Math.floor(now / DAY_SECONDS) * DAY_SECONDS;

  try {
    return db.transaction(() => {
      const user = db.prepare(`
        SELECT xp, level, infinite_money
        FROM users
        WHERE telegram_id = ?
      `).get(id);

      if (!user) return null;
      if (db.prepare(
        "SELECT 1 FROM montadoria_xp_awards WHERE event_key = ? LIMIT 1"
      ).get(key)) {
        return null;
      }

      // خریدهای حساب‌های دارای پول نامحدود XP اقتصادی تولید نمی‌کنند.
      if (rule.category === "economy" && Number(user.infinite_money || 0) === 1) {
        return { gainedXP: 0, reason: "infinite_money" };
      }

      const lastAward = db.prepare(`
        SELECT created_at
        FROM montadoria_xp_awards
        WHERE telegram_id = ? AND activity = ? AND created_at > ?
        ORDER BY created_at DESC
        LIMIT 1
      `).get(id, activity, now - rule.cooldownSeconds);

      if (lastAward) return { gainedXP: 0, reason: "cooldown" };

      const earnedToday = Number(db.prepare(`
        SELECT COALESCE(SUM(xp), 0) AS total
        FROM montadoria_xp_awards
        WHERE telegram_id = ? AND category = ? AND created_at >= ?
      `).get(id, rule.category, dayStart)?.total || 0);

      const dailyCap = DAILY_CAPS[rule.category];
      if (!dailyCap || earnedToday + rule.xp > dailyCap) {
        return { gainedXP: 0, reason: "daily_cap" };
      }

      const oldXP = Number(user.xp || 0);
      const oldLevel = Number(user.level || 1);
      const newXP = oldXP + rule.xp;
      if (!Number.isSafeInteger(newXP)) return null;

      const newLevel = calculateLevelFromXP(newXP);
      const updated = db.prepare(`
        UPDATE users
        SET xp = ?, level = ?, updated_at = ?
        WHERE telegram_id = ?
      `).run(newXP, newLevel, new Date().toISOString(), id);

      if (updated.changes !== 1) return null;

      db.prepare(`
        INSERT INTO montadoria_xp_awards
          (telegram_id, activity, category, event_key, xp, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, activity, rule.category, key, rule.xp, now);

      return {
        oldXP,
        newXP,
        oldLevel,
        newLevel,
        gainedXP: rule.xp,
        levelUp: newLevel > oldLevel
      };
    })();
  } catch (error) {
    console.error("Montadoria XP award error:", error);
    return null;
  }
}

export function awardActivityXP(telegramId, activity, eventKey) {
  const rule = ACTIVITY_RULES[activity];
  if (!rule) return null;
  return applyAward(telegramId, activity, eventKey, rule);
}

// برای اتصال به سیستم مبارزه پس از معتبرشدن نتیجه نبرد آماده است.
export function awardCombatVictoryXP(winnerTelegramId, loserTelegramId, eventKey) {
  const winner = db.prepare(
    "SELECT level FROM users WHERE telegram_id = ?"
  ).get(String(winnerTelegramId ?? ""));
  const loser = db.prepare(
    "SELECT level FROM users WHERE telegram_id = ?"
  ).get(String(loserTelegramId ?? ""));

  if (!winner || !loser || String(winnerTelegramId) === String(loserTelegramId)) {
    return null;
  }

  const levelGap = Number(loser.level || 1) - Number(winner.level || 1);
  const xp = levelGap >= 5 ? 60
    : levelGap >= 2 ? 40
    : levelGap >= -1 ? 25
    : 10;

  return applyAward(
    winnerTelegramId,
    `combat_win:${String(loserTelegramId)}`,
    eventKey,
    { xp, category: "combat", cooldownSeconds: DAY_SECONDS }
  );
}

export function xpAwardText(result) {
  if (!result?.gainedXP) return "";
  return `\n\n✨ پاداش فعالیت: +${result.gainedXP} XP` +
    (result.levelUp ? `\n🎉 تبریک! به Level ${result.newLevel} رسیدی.` : "");
}
