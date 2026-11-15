from pathlib import Path
from datetime import datetime
import re
import shutil
import subprocess
import sys

ROOT = Path.cwd()
COMBAT = ROOT / "src" / "combat.js"
INDEX = ROOT / "index.js"
NEW_FILE = ROOT / "src" / "combat_weapons.js"

for path in (COMBAT, INDEX):
    if not path.is_file():
        print(f"خطا: فایل پیدا نشد: {path}")
        sys.exit(1)

combat = COMBAT.read_text(encoding="utf-8")
index = INDEX.read_text(encoding="utf-8")

if "MONTADORIA_COMBAT_OWNERSHIP_V1" in combat:
    print("سیستم مالکیت سلاح قبلاً نصب شده است.")
    sys.exit(0)

if NEW_FILE.exists():
    print("فایل src/combat_weapons.js از قبل وجود دارد؛ نصب متوقف شد.")
    sys.exit(1)

def replace_once(source, old, new, label):
    count = source.count(old)
    if count != 1:
        raise RuntimeError(
            f"محل اصلاح «{label}» باید دقیقاً یک بار باشد؛ تعداد: {count}"
        )
    return source.replace(old, new, 1)

# --------------------------------------------------
# ماژول مستقل مالکیت، خرید، تجهیز، امانت و انتقال
# --------------------------------------------------

NEW_MODULE = r'''import db from "./database.js";

const REQUEST_LIFETIME = 15 * 60;
const MAX_PURCHASE_QUANTITY = 20;

function asciiDigits(value) {
  const map = {
    "۰":"0","۱":"1","۲":"2","۳":"3","۴":"4",
    "۵":"5","۶":"6","۷":"7","۸":"8","۹":"9",
    "٠":"0","١":"1","٢":"2","٣":"3","٤":"4",
    "٥":"5","٦":"6","٧":"7","٨":"8","٩":"9"
  };

  return String(value ?? "").replace(/[۰-۹٠-٩]/g, c => map[c] ?? c);
}

function positiveNumber(value) {
  const n = Number(
    asciiDigits(value).replace(/[,\u066C٬\s]/g, "")
  );

  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function cash(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function playerName(id) {
  const user = db.prepare(`
    SELECT display_name, username
    FROM users
    WHERE telegram_id=?
  `).get(String(id));

  return user?.display_name ||
    (user?.username ? "@" + user.username : "بازیکن " + id);
}

function isRegistered(id) {
  return Boolean(
    db.prepare("SELECT 1 FROM users WHERE telegram_id=?")
      .get(String(id))
  );
}

function isManager(ctx) {
  const role = db.prepare(
    "SELECT role FROM users WHERE telegram_id=?"
  ).get(String(ctx.from?.id))?.role;

  return (
    String(process.env.OWNER_ID || "") === String(ctx.from?.id) ||
    ["owner", "moderator", "admin"].includes(
      String(role || "").toLowerCase()
    )
  );
}

function hasOpenDuel(id) {
  return Boolean(db.prepare(`
    SELECT 1
    FROM combat_duels
    WHERE status IN ('pending','active')
      AND (challenger_id=? OR opponent_id=?)
    LIMIT 1
  `).get(String(id), String(id)));
}

function hasOpenDuelForPair(a, b) {
  return Boolean(db.prepare(`
    SELECT 1
    FROM combat_duels
    WHERE status IN ('pending','active')
      AND (
        challenger_id IN (?,?) OR
        opponent_id IN (?,?)
      )
    LIMIT 1
  `).get(String(a), String(b), String(a), String(b)));
}

function clearLoadout(userId, instanceId) {
  db.prepare(`
    UPDATE combat_loadouts
    SET weapon_instance_id=NULL
    WHERE telegram_id=? AND weapon_instance_id=?
  `).run(String(userId), Number(instanceId));
}

function defaultWeaponPrice(weapon) {
  return Math.max(
    500,
    Number(weapon.damage) * 100 +
    Number(weapon.speed) * 80 +
    Number(weapon.reach) * 40
  );
}

function initializeWeaponEconomy() {
  const weaponColumns = db.prepare(
    "PRAGMA table_info(combat_weapons)"
  ).all();

  if (!weaponColumns.some(column => column.name === "price")) {
    db.exec(`
      ALTER TABLE combat_weapons
      ADD COLUMN price INTEGER NOT NULL DEFAULT 0
    `);
  }

  const loadoutColumns = db.prepare(
    "PRAGMA table_info(combat_loadouts)"
  ).all();

  if (!loadoutColumns.some(column => column.name === "weapon_instance_id")) {
    db.exec(`
      ALTER TABLE combat_loadouts
      ADD COLUMN weapon_instance_id INTEGER
    `);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS combat_weapon_instances (
      instance_id INTEGER PRIMARY KEY AUTOINCREMENT,
      weapon_id INTEGER NOT NULL,
      owner_id TEXT NOT NULL,
      holder_id TEXT NOT NULL,
      loan_request_id INTEGER,
      acquired_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS combat_weapon_instances_owner_idx
    ON combat_weapon_instances(owner_id);

    CREATE INDEX IF NOT EXISTS combat_weapon_instances_holder_idx
    ON combat_weapon_instances(holder_id);

    CREATE TABLE IF NOT EXISTS combat_weapon_requests (
      request_id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_type TEXT NOT NULL
        CHECK(request_type IN ('loan','transfer')),
      instance_id INTEGER NOT NULL,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN (
          'pending','accepted','returned','cancelled','expired'
        )),
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      reviewed_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS combat_weapon_requests_target_idx
    ON combat_weapon_requests(to_id, status, expires_at);

    CREATE UNIQUE INDEX IF NOT EXISTS combat_weapon_one_pending_request_idx
    ON combat_weapon_requests(instance_id)
    WHERE status='pending';

    CREATE TRIGGER IF NOT EXISTS combat_weapon_default_price
    AFTER INSERT ON combat_weapons
    WHEN NEW.price IS NULL OR NEW.price <= 0
    BEGIN
      UPDATE combat_weapons
      SET price=MAX(
        500,
        NEW.damage * 100 + NEW.speed * 80 + NEW.reach * 40
      )
      WHERE id=NEW.id;
    END;
  `);

  // قیمت سلاح‌های قدیمی که هنوز قیمت نداشتند، یک بار تعیین می‌شود.
  db.prepare(`
    UPDATE combat_weapons
    SET price=MAX(500, damage * 100 + speed * 80 + reach * 40)
    WHERE price IS NULL OR price <= 0
  `).run();
}

function expireOldRequests() {
  db.prepare(`
    UPDATE combat_weapon_requests
    SET status='expired'
    WHERE status='pending' AND expires_at <= ?
  `).run(nowSeconds());
}

function createRequest(ctx, type, instanceId) {
  const target = ctx.message?.reply_to_message?.from;

  if (!target || !target.id || target.is_bot) {
    return ctx.reply(
      "برای درخواست امانت یا انتقال، روی پیام گیرنده ریپلای کن."
    );
  }

  const fromId = String(ctx.from.id);
  const toId = String(target.id);
  const chatId = String(ctx.chat.id);

  if (fromId === toId) {
    return ctx.reply("❌ نمی‌توانی سلاح را به خودت بدهی.");
  }

  if (!isRegistered(toId)) {
    return ctx.reply("❌ گیرنده باید ابتدا در مونتادوریا ثبت‌نام کند.");
  }

  if (hasOpenDuelForPair(fromId, toId)) {
    return ctx.reply(
      "⛔ تا پایان دعوت یا مبارزه بازیکنان، امکان امانت یا انتقال سلاح وجود ندارد."
    );
  }

  expireOldRequests();

  try {
    const result = db.transaction(() => {
      const item = db.prepare(`
        SELECT i.instance_id, i.weapon_id, i.owner_id, i.holder_id,
               w.name
        FROM combat_weapon_instances i
        JOIN combat_weapons w ON w.id=i.weapon_id
        WHERE i.instance_id=?
      `).get(instanceId);

      if (!item) return { error: "شناسه وسیله پیدا نشد." };

      if (
        String(item.owner_id) !== fromId ||
        String(item.holder_id) !== fromId
      ) {
        return {
          error: "این سلاح مالک تو نیست یا در حال حاضر در اختیار تو نیست."
        };
      }

      if (hasOpenDuelForPair(fromId, toId)) {
        return { error: "یکی از بازیکنان وارد دعوت یا مبارزه شده است." };
      }

      const info = db.prepare(`
        INSERT INTO combat_weapon_requests
          (request_type,instance_id,from_id,to_id,chat_id,
           status,created_at,expires_at)
        VALUES(?,?,?,?,?,'pending',?,?)
      `).run(
        type,
        instanceId,
        fromId,
        toId,
        chatId,
        nowSeconds(),
        nowSeconds() + REQUEST_LIFETIME
      );

      return {
        requestId: Number(info.lastInsertRowid),
        weaponName: item.name
      };
    })();

    if (result.error) return ctx.reply("❌ " + result.error);

    const command = type === "loan"
      ? `#پذیرش_امانت ${result.requestId}`
      : `#پذیرش_انتقال_سلاح ${result.requestId}`;

    const title = type === "loan" ? "درخواست امانت سلاح" : "درخواست انتقال مالکیت";

    return ctx.reply(
      `⚔️ ${title}

سلاح: ${result.weaponName}
فرستنده: ${playerName(fromId)}
گیرنده: ${playerName(toId)}
شماره درخواست: ${result.requestId}

گیرنده برای تأیید بنویسد:
${command}

⏳ مهلت تأیید: ۱۵ دقیقه`
    );
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) {
      return ctx.reply("⛔ برای این سلاح یک درخواست بررسی‌نشده وجود دارد.");
    }

    console.error("Combat weapon request error:", error);
    return ctx.reply("❌ ثبت درخواست انجام نشد.");
  }
}

function acceptRequest(requestId, targetId, chatId, expectedType) {
  return db.transaction(() => {
    const request = db.prepare(`
      SELECT *
      FROM combat_weapon_requests
      WHERE request_id=?
        AND request_type=?
        AND to_id=?
        AND chat_id=?
        AND status='pending'
    `).get(
      Number(requestId),
      expectedType,
      String(targetId),
      String(chatId)
    );

    if (!request) return { error: "درخواست معتبر پیدا نشد یا برای تو نیست." };

    const now = nowSeconds();

    if (Number(request.expires_at) <= now) {
      db.prepare(`
        UPDATE combat_weapon_requests
        SET status='expired', reviewed_at=?
        WHERE request_id=? AND status='pending'
      `).run(now, request.request_id);

      return { error: "مهلت این درخواست تمام شده است." };
    }

    if (hasOpenDuelForPair(request.from_id, request.to_id)) {
      return {
        error: "یکی از دو بازیکن درگیر دعوت یا مبارزه است؛ بعداً دوباره امتحان کن."
      };
    }

    const item = db.prepare(`
      SELECT i.instance_id, i.weapon_id, i.owner_id, i.holder_id,
             w.name, w.approved
      FROM combat_weapon_instances i
      JOIN combat_weapons w ON w.id=i.weapon_id
      WHERE i.instance_id=?
    `).get(request.instance_id);

    if (
      !item ||
      !item.approved ||
      String(item.owner_id) !== String(request.from_id) ||
      String(item.holder_id) !== String(request.from_id)
    ) {
      db.prepare(`
        UPDATE combat_weapon_requests
        SET status='cancelled', reviewed_at=?
        WHERE request_id=?
      `).run(now, request.request_id);

      return { error: "وضعیت سلاح تغییر کرده و این درخواست دیگر معتبر نیست." };
    }

    let updated;

    if (expectedType === "loan") {
      updated = db.prepare(`
        UPDATE combat_weapon_instances
        SET holder_id=?, loan_request_id=?
        WHERE instance_id=? AND owner_id=? AND holder_id=?
      `).run(
        String(request.to_id),
        Number(request.request_id),
        Number(request.instance_id),
        String(request.from_id),
        String(request.from_id)
      );
    } else {
      updated = db.prepare(`
        UPDATE combat_weapon_instances
        SET owner_id=?, holder_id=?, loan_request_id=NULL
        WHERE instance_id=? AND owner_id=? AND holder_id=?
      `).run(
        String(request.to_id),
        String(request.to_id),
        Number(request.instance_id),
        String(request.from_id),
        String(request.from_id)
      );
    }

    if (!updated.changes) {
      return { error: "تغییر وضعیت سلاح انجام نشد؛ درخواست را دوباره بررسی کن." };
    }

    clearLoadout(request.from_id, request.instance_id);

    db.prepare(`
      UPDATE combat_weapon_requests
      SET status='accepted', reviewed_at=?
      WHERE request_id=? AND status='pending'
    `).run(now, request.request_id);

    return {
      weaponName: item.name,
      fromId: String(request.from_id),
      toId: String(request.to_id),
      instanceId: Number(request.instance_id),
      type: expectedType
    };
  })();
}

export function registerCombatWeapons(bot) {
  initializeWeaponEconomy();

  // خرید سلاح از موجودی کیف پول
  bot.hears(
    /^#خرید_سلاح\s+([0-9۰-۹٠-٩]+)(?:\s+([0-9۰-۹٠-٩]+))?$/u,
    async ctx => {
      const weaponId = positiveNumber(ctx.match[1]);
      const quantity = ctx.match[2]
        ? positiveNumber(ctx.match[2])
        : 1;

      if (
        !weaponId ||
        !quantity ||
        quantity > MAX_PURCHASE_QUANTITY
      ) {
        return ctx.reply(
          `❌ تعداد معتبر نیست. حداکثر خرید در هر درخواست ${MAX_PURCHASE_QUANTITY} عدد است.`
        );
      }

      const userId = String(ctx.from.id);

      try {
        const result = db.transaction(() => {
          const user = db.prepare(`
            SELECT money, infinite_money
            FROM users
            WHERE telegram_id=?
          `).get(userId);

          if (!user) return { error: "حساب کاربری پیدا نشد." };

          const weapon = db.prepare(`
            SELECT id,name,kind,price
            FROM combat_weapons
            WHERE id=? AND approved=1
          `).get(weaponId);

          if (!weapon) return { error: "این سلاح در زرادخانه موجود نیست." };

          const price = Number(weapon.price);
          const total = price * quantity;

          if (
            !Number.isSafeInteger(price) ||
            price <= 0 ||
            !Number.isSafeInteger(total) ||
            total <= 0
          ) {
            return { error: "قیمت این سلاح معتبر نیست؛ مدیر باید قیمت آن را تنظیم کند." };
          }

          if (!Number(user.infinite_money)) {
            const debit = db.prepare(`
              UPDATE users
              SET money=money-?, updated_at=?
              WHERE telegram_id=? AND money>=?
            `).run(
              total,
              new Date().toISOString(),
              userId,
              total
            );

            if (!debit.changes) {
              return { error: "پول نقد کافی در کیف پولت نداری." };
            }
          }

          const insert = db.prepare(`
            INSERT INTO combat_weapon_instances
              (weapon_id,owner_id,holder_id,acquired_at)
            VALUES(?,?,?,?)
          `);

          const instanceIds = [];

          for (let i = 0; i < quantity; i++) {
            const info = insert.run(
              weapon.id,
              userId,
              userId,
              nowSeconds()
            );
            instanceIds.push(Number(info.lastInsertRowid));
          }

          return {
            weapon,
            quantity,
            total,
            instanceIds,
            infinite: Boolean(user.infinite_money)
          };
        })();

        if (result.error) return ctx.reply("❌ " + result.error);

        return ctx.reply(
          `✅ خرید سلاح انجام شد.

⚔️ سلاح: ${result.weapon.name}
🔢 تعداد: ${result.quantity}
💰 هزینه: ${result.infinite ? "حساب نامحدود" : cash(result.total)}

شناسه نسخه‌های خریداری‌شده:
${result.instanceIds.join("، ")}

برای مشاهده وسایل:
#سلاح‌های_من`
        );
      } catch (error) {
        console.error("Combat weapon purchase error:", error);
        return ctx.reply("❌ خرید سلاح انجام نشد؛ هیچ خرید ناقصی ثبت نشد.");
      }
    }
  );

  // تنظیم قیمت فقط توسط مدیر یا مالک
  bot.hears(
    /^#قیمت_سلاح\s+([0-9۰-۹٠-٩]+)\s+([0-9۰-۹٠-٩٬,]+)$/u,
    async ctx => {
      if (!isManager(ctx)) {
        return ctx.reply("⛔ فقط مدیر یا مالک اجازه تغییر قیمت سلاح را دارد.");
      }

      const weaponId = positiveNumber(ctx.match[1]);
      const price = positiveNumber(ctx.match[2]);

      if (!weaponId || !price || price > 1000000000) {
        return ctx.reply("❌ شناسه یا قیمت معتبر نیست.");
      }

      const result = db.prepare(`
        UPDATE combat_weapons
        SET price=?
        WHERE id=? AND approved=1
      `).run(price, weaponId);

      if (!result.changes) {
        return ctx.reply("❌ سلاحی با این شناسه پیدا نشد.");
      }

      return ctx.reply(
        `✅ قیمت سلاح با شناسه ${weaponId} به ${cash(price)} تغییر کرد.`
      );
    }
  );

  // فهرست مالکیت‌ها؛ شناسه این فهرست با شناسه زرادخانه فرق دارد.
  bot.hears(/^#سلاح‌های_من$/u, async ctx => {
    const userId = String(ctx.from.id);

    const rows = db.prepare(`
      SELECT i.instance_id, i.weapon_id, i.owner_id, i.holder_id,
             w.name, w.price
      FROM combat_weapon_instances i
      JOIN combat_weapons w ON w.id=i.weapon_id
      WHERE i.owner_id=? OR i.holder_id=?
      ORDER BY i.instance_id DESC
      LIMIT 100
    `).all(userId, userId);

    if (!rows.length) {
      return ctx.reply(
        "⚔️ هنوز سلاحی نداری.\nبرای دیدن زرادخانه بنویس: #سلاح‌ها"
      );
    }

    const active = db.prepare(`
      SELECT weapon_instance_id
      FROM combat_loadouts
      WHERE telegram_id=?
    `).get(userId)?.weapon_instance_id;

    const lines = rows.map(item => {
      const owner = String(item.owner_id);
      const holder = String(item.holder_id);

      let status;

      if (owner === userId && holder === userId) {
        status = "در اختیار خودت";
      } else if (owner === userId) {
        status = `امانت نزد ${playerName(holder)}`;
      } else {
        status = `امانتی از ${playerName(owner)}`;
      }

      return (
        `شناسه وسیله: ${item.instance_id}\n` +
        `سلاح: ${item.name}\n` +
        `وضعیت: ${status}` +
        (Number(active) === Number(item.instance_id) ? "\n🟢 سلاح فعال" : "")
      );
    });

    return ctx.reply(
      "⚔️ فهرست سلاح‌ها و مالکیت‌ها\n\n" +
      lines.join("\n\n") +
      "\n\nبرای تجهیز:\n#انتخاب_سلاح شناسه_وسیله"
    );
  });

  // وسایلی که اکنون واقعاً در اختیار بازیکن هستند
  bot.hears(/^#تجهیزات_من$/u, async ctx => {
    const userId = String(ctx.from.id);

    const rows = db.prepare(`
      SELECT i.instance_id, i.owner_id, w.name
      FROM combat_weapon_instances i
      JOIN combat_weapons w ON w.id=i.weapon_id
      WHERE i.holder_id=? AND w.approved=1
      ORDER BY i.instance_id DESC
    `).all(userId);

    if (!rows.length) {
      return ctx.reply("🎒 در حال حاضر هیچ سلاحی همراهت نیست.");
    }

    const active = db.prepare(`
      SELECT weapon_instance_id
      FROM combat_loadouts
      WHERE telegram_id=?
    `).get(userId)?.weapon_instance_id;

    return ctx.reply(
      "🎒 سلاح‌های در اختیار تو:\n\n" +
      rows.map(item =>
        `شناسه وسیله: ${item.instance_id}\n` +
        `سلاح: ${item.name}\n` +
        `مالک: ${String(item.owner_id) === userId ? "خودت" : playerName(item.owner_id)}` +
        (Number(active) === Number(item.instance_id) ? "\n🟢 سلاح فعال" : "")
      ).join("\n\n") +
      "\n\nبرای تجهیز:\n#انتخاب_سلاح شناسه_وسیله"
    );
  });

  // تجهیز فقط با شناسه یک نسخه واقعی از سلاح
  bot.hears(/^#انتخاب_سلاح\s+([0-9۰-۹٠-٩]+)$/u, async ctx => {
    const userId = String(ctx.from.id);
    const instanceId = positiveNumber(ctx.match[1]);

    if (!instanceId) return ctx.reply("❌ شناسه وسیله معتبر نیست.");

    if (hasOpenDuel(userId)) {
      return ctx.reply("⛔ هنگام دعوت یا مبارزه امکان تغییر سلاح وجود ندارد.");
    }

    const item = db.prepare(`
      SELECT i.instance_id, i.weapon_id, w.name
      FROM combat_weapon_instances i
      JOIN combat_weapons w ON w.id=i.weapon_id
      WHERE i.instance_id=? AND i.holder_id=? AND w.approved=1
    `).get(instanceId, userId);

    if (!item) {
      return ctx.reply(
        "⛔ این سلاح خریداری‌شده یا به‌صورت امانت در اختیار تو نیست.\n" +
        "فهرست وسایل همراهت: #تجهیزات_من"
      );
    }

    db.prepare(`
      INSERT INTO combat_loadouts
        (telegram_id,weapon_id,weapon_instance_id)
      VALUES(?,?,?)
      ON CONFLICT(telegram_id)
      DO UPDATE SET
        weapon_id=excluded.weapon_id,
        weapon_instance_id=excluded.weapon_instance_id
    `).run(userId, item.weapon_id, item.instance_id);

    return ctx.reply(
      `⚔️ سلاح فعال تو «${item.name}» شد.\nشناسه وسیله: ${item.instance_id}`
    );
  });

  // نمایش سلاح فعال
  bot.hears(/^#سلاح_فعال$/u, async ctx => {
    const userId = String(ctx.from.id);

    const item = db.prepare(`
      SELECT i.instance_id, i.owner_id, w.name
      FROM combat_loadouts l
      JOIN combat_weapon_instances i
        ON i.instance_id=l.weapon_instance_id
       AND i.holder_id=l.telegram_id
      JOIN combat_weapons w ON w.id=i.weapon_id
      WHERE l.telegram_id=? AND w.approved=1
    `).get(userId);

    if (!item) {
      return ctx.reply("⚔️ هنوز سلاح فعالی انتخاب نکرده‌ای.");
    }

    return ctx.reply(
      `⚔️ سلاح فعال: ${item.name}\n` +
      `شناسه وسیله: ${item.instance_id}\n` +
      `مالک: ${String(item.owner_id) === userId ? "خودت" : playerName(item.owner_id)}`
    );
  });

  // درخواست امانت؛ مالکیت تغییر نمی‌کند.
  bot.hears(/^#امانت_سلاح\s+([0-9۰-۹٠-٩]+)$/u, async ctx => {
    const instanceId = positiveNumber(ctx.match[1]);
    if (!instanceId) return ctx.reply("❌ شناسه وسیله معتبر نیست.");
    return createRequest(ctx, "loan", instanceId);
  });

  // درخواست انتقال دائمی مالکیت
  bot.hears(/^#انتقال_سلاح\s+([0-9۰-۹٠-٩]+)$/u, async ctx => {
    const instanceId = positiveNumber(ctx.match[1]);
    if (!instanceId) return ctx.reply("❌ شناسه وسیله معتبر نیست.");
    return createRequest(ctx, "transfer", instanceId);
  });

  // تأیید امانت توسط گیرنده
  bot.hears(/^#پذیرش_امانت\s+([0-9۰-۹٠-٩]+)$/u, async ctx => {
    const requestId = positiveNumber(ctx.match[1]);
    if (!requestId) return ctx.reply("❌ شماره درخواست معتبر نیست.");

    try {
      const result = acceptRequest(
        requestId,
        String(ctx.from.id),
        String(ctx.chat.id),
        "loan"
      );

      if (result.error) return ctx.reply("❌ " + result.error);

      return ctx.reply(
        `✅ امانت سلاح پذیرفته شد.

سلاح: ${result.weaponName}
مالک اصلی: ${playerName(result.fromId)}
استفاده‌کننده فعلی: ${playerName(result.toId)}

مالکیت سلاح تغییر نکرده است.
برای تجهیز:
#تجهیزات_من`
      );
    } catch (error) {
      console.error("Accept weapon loan error:", error);
      return ctx.reply("❌ پذیرش امانت انجام نشد.");
    }
  });

  // تأیید انتقال دائمی توسط گیرنده
  bot.hears(/^#پذیرش_انتقال_سلاح\s+([0-9۰-۹٠-٩]+)$/u, async ctx => {
    const requestId = positiveNumber(ctx.match[1]);
    if (!requestId) return ctx.reply("❌ شماره درخواست معتبر نیست.");

    try {
      const result = acceptRequest(
        requestId,
        String(ctx.from.id),
        String(ctx.chat.id),
        "transfer"
      );

      if (result.error) return ctx.reply("❌ " + result.error);

      return ctx.reply(
        `✅ انتقال دائمی سلاح انجام شد.

سلاح: ${result.weaponName}
مالک جدید: ${playerName(result.toId)}

برای تجهیز:
#تجهیزات_من`
      );
    } catch (error) {
      console.error("Accept weapon transfer error:", error);
      return ctx.reply("❌ انتقال مالکیت انجام نشد.");
    }
  });

  // بازگرداندن سلاح امانتی به مالک اصلی
  bot.hears(/^#بازگرداندن_سلاح\s+([0-9۰-۹٠-٩]+)$/u, async ctx => {
    const instanceId = positiveNumber(ctx.match[1]);
    const userId = String(ctx.from.id);

    if (!instanceId) return ctx.reply("❌ شناسه وسیله معتبر نیست.");

    if (hasOpenDuel(userId)) {
      return ctx.reply("⛔ در زمان دعوت یا مبارزه نمی‌توانی سلاح امانتی را پس بدهی.");
    }

    try {
      const result = db.transaction(() => {
        const item = db.prepare(`
          SELECT i.instance_id, i.owner_id, i.holder_id,
                 i.loan_request_id, w.name
          FROM combat_weapon_instances i
          JOIN combat_weapons w ON w.id=i.weapon_id
          WHERE i.instance_id=? AND i.holder_id=?
        `).get(instanceId, userId);

        if (!item) return { error: "این سلاح در اختیار تو نیست." };

        if (
          String(item.owner_id) === userId ||
          !item.loan_request_id
        ) {
          return { error: "این سلاح امانتی نیست." };
        }

        const update = db.prepare(`
          UPDATE combat_weapon_instances
          SET holder_id=owner_id, loan_request_id=NULL
          WHERE instance_id=? AND holder_id=? AND owner_id=?
        `).run(instanceId, userId, String(item.owner_id));

        if (!update.changes) return { error: "بازگرداندن سلاح انجام نشد." };

        clearLoadout(userId, instanceId);

        db.prepare(`
          UPDATE combat_weapon_requests
          SET status='returned', reviewed_at=?
          WHERE request_id=? AND status='accepted'
        `).run(nowSeconds(), Number(item.loan_request_id));

        return {
          weaponName: item.name,
          ownerId: String(item.owner_id)
        };
      })();

      if (result.error) return ctx.reply("❌ " + result.error);

      await ctx.reply(
        `✅ سلاح «${result.weaponName}» به مالک اصلی بازگردانده شد.`
      );

      try {
        await ctx.api.sendMessage(
          Number(result.ownerId),
          `⚔️ سلاح امانتی «${result.weaponName}» به تو بازگردانده شد.`
        );
      } catch {}
    } catch (error) {
      console.error("Return weapon error:", error);
      return ctx.reply("❌ بازگرداندن سلاح انجام نشد.");
    }
  });

  // لغو درخواست بررسی‌نشده توسط فرستنده
  bot.hears(/^#لغو_درخواست_سلاح\s+([0-9۰-۹٠-٩]+)$/u, async ctx => {
    const requestId = positiveNumber(ctx.match[1]);
    if (!requestId) return ctx.reply("❌ شماره درخواست معتبر نیست.");

    const result = db.prepare(`
      UPDATE combat_weapon_requests
      SET status='cancelled', reviewed_at=?
      WHERE request_id=? AND from_id=? AND status='pending'
    `).run(
      nowSeconds(),
      requestId,
      String(ctx.from.id)
    );

    return ctx.reply(
      result.changes
        ? "✅ درخواست سلاح لغو شد."
        : "❌ درخواست فعال متعلق به تو پیدا نشد."
    );
  });

  // راهنمای فرمان‌ها
  bot.hears(/^#راهنمای_سلاح$/u, async ctx => {
    return ctx.reply(
      `⚔️ راهنمای خرید و مالکیت سلاح

#سلاح‌ها
نمایش زرادخانه و شناسه سلاح‌ها

#خرید_سلاح شناسه [تعداد]
خرید از پول کیف پول؛ حداکثر ۲۰ عدد در هر درخواست

#سلاح‌های_من
نمایش مالکیت‌ها و سلاح‌های امانت‌داده‌شده

#تجهیزات_من
نمایش سلاح‌هایی که اکنون در اختیار تو هستند

#انتخاب_سلاح شناسه_وسیله
تجهیز یک نسخه خریداری‌شده یا امانتی

#سلاح_فعال
نمایش سلاح فعلی

برای امانت:
روی پیام دوستت ریپلای کن و بنویس:
#امانت_سلاح شناسه_وسیله

گیرنده بنویسد:
#پذیرش_امانت شماره_درخواست

برای انتقال دائمی:
روی پیام گیرنده ریپلای کن و بنویس:
#انتقال_سلاح شناسه_وسیله

گیرنده بنویسد:
#پذیرش_انتقال_سلاح شماره_درخواست

بازگرداندن امانت:
#بازگرداندن_سلاح شناسه_وسیله

لغو درخواست:
#لغو_درخواست_سلاح شماره_درخواست

توجه:
در امانت، مالک اصلی تغییر نمی‌کند.
انتقال دائمی فقط پس از تأیید گیرنده انجام می‌شود.
سلاح باید هنگام مبارزه در اختیار بازیکن و تجهیزشده باشد.`
    );
  });
}
'''

# --------------------------------------------------
# اصلاح فایل مبارزه
# --------------------------------------------------

match = re.search(
    r"function getWeapon\(id\) \{[\s\S]*?\n\}",
    combat
)

if not match:
    raise RuntimeError("تابع getWeapon در combat.js پیدا نشد.")

new_get_weapon = r'''// MONTADORIA_COMBAT_OWNERSHIP_V1
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
}'''

combat = combat[:match.start()] + new_get_weapon + combat[match.end():]

combat = replace_once(
    combat,
    "    SELECT id,name,kind,damage,speed,reach\n",
    "    SELECT id,name,kind,damage,speed,reach,price\n",
    "نمایش قیمت در زرادخانه"
)

combat = replace_once(
    combat,
    r'''  const lines = weapons.map(w =>
    `${w.id}. ${w.name}
آسیب: ${w.damage} | سرعت: ${w.speed} | برد: ${w.reach}`
  );''',
    r'''  const lines = weapons.map(w =>
    `${w.id}. ${w.name}
آسیب: ${w.damage} | سرعت: ${w.speed} | برد: ${w.reach}
قیمت خرید: ${Number(w.price || 0).toLocaleString("en-US")}`
  );''',
    "نمایش قیمت سلاح"
)

combat = replace_once(
    combat,
    '''برای انتخاب سلاح:
#انتخاب_سلاح شماره''',
    '''برای خرید:
#خرید_سلاح شناسه [تعداد]

برای تجهیز نسخه خریداری‌شده:
#انتخاب_سلاح شناسه_وسیله

شناسه وسیله را از #سلاح‌های_من بردار.''',
    "راهنمای زرادخانه"
)

# فرمان قدیمی که اجازه انتخاب هر سلاح زرادخانه را می‌داد حذف می‌شود.
start_marker = r"  bot.hears(/^#انتخاب_سلاح\s+([0-9]+)$/u, async ctx => {"
end_marker = r"  bot.hears(/^#افزودن_سلاح"

start = combat.find(start_marker)
end = combat.find(end_marker, start + len(start_marker))

if start < 0 or end < 0:
    raise RuntimeError("بخش انتخاب سلاح قدیمی پیدا نشد؛ تغییر انجام نشد.")

combat = (
    combat[:start] +
    "  // انتخاب سلاح در src/combat_weapons.js با بررسی مالکیت انجام می‌شود.\n\n" +
    combat[end:]
)

# هر دو مبارز باید پیش از ارسال دعوت، سلاح معتبر و تجهیزشده داشته باشند.
combat = replace_once(
    combat,
    "    const result = createDuel(String(ctx.chat.id), a, b);",
    '''    if (!getWeapon(a)) {
      return ctx.reply(
        `⛔ ${playerName(a)} سلاحی خریداری‌شده یا امانتی را تجهیز نکرده است.`
      );
    }

    if (!getWeapon(b)) {
      return ctx.reply(
        `⛔ ${playerName(b)} هنوز سلاح معتبر و تجهیزشده ندارد.`
      );
    }

    const result = createDuel(String(ctx.chat.id), a, b);''',
    "الزام سلاح پیش از دعوت"
)

# اگر سلاح بین دعوت و پذیرش از دست رفته باشد، مبارزه شروع نمی‌شود.
combat = replace_once(
    combat,
    "    const duel = acceptDuel(id, String(ctx.from.id), String(ctx.chat.id));",
    '''    const invitation = db.prepare(`
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

    const duel = acceptDuel(id, String(ctx.from.id), String(ctx.chat.id));''',
    "بررسی سلاح هنگام پذیرش"
)

# --------------------------------------------------
# ثبت ماژول جدید در index.js
# --------------------------------------------------

index = replace_once(
    index,
    'import { registerCombat } from "./src/combat.js";',
    'import { registerCombat } from "./src/combat.js";\nimport { registerCombatWeapons } from "./src/combat_weapons.js";',
    "وارد کردن ماژول مالکیت سلاح"
)

index = replace_once(
    index,
    "registerCombat(bot);",
    "registerCombat(bot);\nregisterCombatWeapons(bot);",
    "ثبت ماژول مالکیت سلاح"
)

# --------------------------------------------------
# پشتیبان، نصب و بررسی نحوی؛ در صورت خطا بازگشت خودکار
# --------------------------------------------------

stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
backups = {
    COMBAT: COMBAT.with_name(f"combat.js.before_weapon_{stamp}.bak"),
    INDEX: INDEX.with_name(f"index.js.before_weapon_{stamp}.bak"),
}

try:
    shutil.copy2(COMBAT, backups[COMBAT])
    shutil.copy2(INDEX, backups[INDEX])

    NEW_FILE.write_text(NEW_MODULE, encoding="utf-8")
    COMBAT.write_text(combat, encoding="utf-8")
    INDEX.write_text(index, encoding="utf-8")

    for path in (NEW_FILE, COMBAT, INDEX):
        result = subprocess.run(
            ["node", "--check", str(path)],
            text=True,
            capture_output=True
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"بررسی نحوی {path.name} ناموفق بود:\n" +
                (result.stderr or result.stdout)
            )

except Exception as error:
    if NEW_FILE.exists():
        NEW_FILE.unlink()

    for original, backup in backups.items():
        if backup.exists():
            shutil.copy2(backup, original)

    print("\n❌ نصب کامل نشد؛ فایل‌های قبلی بازگردانده شدند.")
    print(str(error))
    sys.exit(1)

print("\n✅ سیستم مالکیت و امانت سلاح نصب شد.")
print("✅ خرید سلاح و کسر پول کیف پول فعال شد.")
print("✅ تجهیز فقط برای سلاح خریداری‌شده یا امانتی مجاز است.")
print("✅ امانت بدون تغییر مالکیت فعال شد.")
print("✅ انتقال دائمی با تأیید گیرنده فعال شد.")
print("✅ شروع مبارزه بدون سلاح معتبر مسدود شد.")
print("✅ بررسی نحوی هر سه فایل موفق بود.")
print("\nنسخه‌های پشتیبان:")
for backup in backups.values():
    print(backup.name)
