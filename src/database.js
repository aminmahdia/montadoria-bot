import Database from "better-sqlite3"

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

export default db
