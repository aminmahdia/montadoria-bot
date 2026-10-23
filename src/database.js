import Database from "better-sqlite3"
import { randomBytes } from "node:crypto"

const db = new Database("/data/montadoria.db")

db.pragma("journal_mode = WAL")

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER UNIQUE NOT NULL,
    username TEXT,
    display_name TEXT NOT NULL,
    money INTEGER NOT NULL DEFAULT 0,
    infinite_money INTEGER NOT NULL DEFAULT 0,
    bank INTEGER NOT NULL DEFAULT 0,
    xp INTEGER NOT NULL DEFAULT 0,
    level INTEGER NOT NULL DEFAULT 1,
    role TEXT NOT NULL DEFAULT 'user',
    job TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    permission_required INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  )
`)

// =========================
// DEFAULT JOBS
// =========================

const defaultJobs = [
  ["کارمند دولت", "حکومت و قانون"],
  ["کارمند شهرداری", "حکومت و قانون"],
  ["ثبت احوال", "حکومت و قانون"],
  ["پلیس", "حکومت و قانون"],
  ["کارآگاه", "حکومت و قانون"],
  ["قاضی", "حکومت و قانون"],
  ["وکیل", "حکومت و قانون"],

  ["پزشک", "پزشکی و سلامت"],
  ["پرستار", "پزشکی و سلامت"],
  ["دامپزشک", "پزشکی و سلامت"],
  ["مربی بدنسازی", "پزشکی و سلامت"],

  ["کارمند بانک", "بانک و تجارت"],
  ["حسابدار", "بانک و تجارت"],
  ["مشاور املاک", "بانک و تجارت"],
  ["فروشنده", "بانک و تجارت"],

  ["آشپز", "خدمات و گردشگری"],
  ["گارسون", "خدمات و گردشگری"],
  ["کارمند هتل", "خدمات و گردشگری"],

  ["مکانیک", "فنی و مکانیکی"],

  ["کشاورز", "کشاورزی و دامداری"],
  ["دامدار", "کشاورزی و دامداری"],
  ["کارگر اصطبل", "کشاورزی و دامداری"],
  ["مربی اسب", "کشاورزی و دامداری"],

  ["خبرنگار", "رسانه و امنیت"],
  ["نگهبان", "رسانه و امنیت"],

  ["عضو خاندان BONDS", "ویژه"]
]

const insertJob = db.prepare(`
  INSERT OR IGNORE INTO jobs (
    name,
    category,
    created_at
  )
  VALUES (?, ?, ?)
`)

const insertJobs = db.transaction(() => {
  const now = new Date().toISOString()

  for (const [name, category] of defaultJobs) {
    insertJob.run(
      name,
      category,
      now
    )
  }
})

insertJobs()

// =========================
// USERS MIGRATION
// =========================

const columns = db
  .prepare(`PRAGMA table_info(users)`)
  .all()

const hasInfiniteMoney = columns.some(
  (column) => column.name === "infinite_money"
)

if (!hasInfiniteMoney) {
  db.exec(`
    ALTER TABLE users
    ADD COLUMN infinite_money INTEGER NOT NULL DEFAULT 0
  `)
}


// MONTADORIA_VIRTUAL_BANK_CARDS_V1
const cardColumns = db.prepare("PRAGMA table_info(users)").all();
if (!cardColumns.some(column => column.name === "card_number")) {
  db.exec("ALTER TABLE users ADD COLUMN card_number TEXT");
}

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS users_card_number_unique
  ON users(card_number)
  WHERE card_number IS NOT NULL AND card_number <> ''
`);

function generateDatabaseCardNumber() {
  const exists = db.prepare(
    "SELECT 1 FROM users WHERE card_number = ? LIMIT 1"
  );

  for (let attempt = 0; attempt < 1000; attempt++) {
    const randomValue = BigInt(
      "0x" + randomBytes(8).toString("hex")
    );
    const cardNumber = (
      1000000000000000n + randomValue % 9000000000000000n
    ).toString();

    if (!exists.get(cardNumber)) return cardNumber;
  }

  throw new Error("Could not generate a unique Montadoria card number");
}

const usersWithoutCards = db.prepare(`
  SELECT telegram_id
  FROM users
  WHERE card_number IS NULL OR TRIM(card_number) = ''
`).all();

const assignDatabaseCard = db.prepare(`
  UPDATE users SET card_number = ?
  WHERE telegram_id = ?
    AND (card_number IS NULL OR TRIM(card_number) = '')
`);

for (const user of usersWithoutCards) {
  assignDatabaseCard.run(
    generateDatabaseCardNumber(),
    user.telegram_id
  );
}
// END MONTADORIA_VIRTUAL_BANK_CARDS_V1

export default db
