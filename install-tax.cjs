const fs = require('fs');
const file = 'src/commands.js';
let s = fs.readFileSync(file, 'utf8');

const marker = '// END MONTADORIA PROPERTY SYSTEM V1';
if (!s.includes(marker)) {
  console.error('خطای نصب: محل درج بخش املاک پیدا نشد.');
  process.exit(1);
}
if (s.includes('MONTADORIA TAX SYSTEM V1')) {
  console.error('سیستم مالیات از قبل وجود دارد؛ نصب متوقف شد.');
  process.exit(1);
}

const code = String.raw`

// MONTADORIA TAX SYSTEM V1
{
  const taxDb = db;
  taxDb.exec(\`
    CREATE TABLE IF NOT EXISTS montadoria_tax_settings (
      setting TEXT PRIMARY KEY,
      value REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS montadoria_tax_cycles (
      user_id INTEGER PRIMARY KEY,
      last_at INTEGER NOT NULL DEFAULT 0,
      debt REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS montadoria_tax_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      description TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  \`);

  const taxDefaults = [
    ['property_rate', 1],
    ['business_rate', 5],
    ['upkeep_rate', 1]
  ];
  const taxGetSetting = taxDb.prepare(
    'SELECT value FROM montadoria_tax_settings WHERE setting = ?'
  );
  const taxSetSetting = taxDb.prepare(\`
    INSERT INTO montadoria_tax_settings(setting, value) VALUES (?, ?)
    ON CONFLICT(setting) DO UPDATE SET value = excluded.value
  \`);
  for (const [key, value] of taxDefaults) {
    if (!taxGetSetting.get(key)) taxSetSetting.run(key, value);
  }

  const taxGetCycle = taxDb.prepare(
    'SELECT * FROM montadoria_tax_cycles WHERE user_id = ?'
  );
  const taxEnsureCycle = taxDb.prepare(
    'INSERT OR IGNORE INTO montadoria_tax_cycles(user_id, last_at, debt) VALUES (?, ?, 0)'
  );
  const taxAddDebt = taxDb.prepare(
    'UPDATE montadoria_tax_cycles SET debt = MIN(100000000, debt + ?), last_at = ? WHERE user_id = ?'
  );
  const taxLog = taxDb.prepare(
    'INSERT INTO montadoria_tax_logs(user_id, amount, description, created_at) VALUES (?, ?, ?, ?)'
  );

  function taxNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  function taxAssets(userId) {
    const properties = taxDb.prepare(
      'SELECT COALESCE(SUM(price), 0) AS total FROM player_properties WHERE owner_id = ?'
    ).get(userId)?.total || 0;

    const businesses = taxDb.prepare(\`
      SELECT COALESCE(SUM(c.price), 0) AS total,
             COALESCE(SUM(c.daily_income), 0) AS income
      FROM player_businesses p
      JOIN business_catalog c ON c.business_id = p.business_id
      WHERE p.owner_id = ?
    \`).get(userId) || { total: 0, income: 0 };

    let cars = { total: 0 };
    try {
      cars = taxDb.prepare(
        'SELECT COALESCE(SUM(price), 0) AS total FROM player_cars WHERE owner_id = ?'
      ).get(userId) || cars;
    } catch (_) {}
    return {
      properties: taxNumber(properties),
      businessValue: taxNumber(businesses.total),
      businessIncome: taxNumber(businesses.income),
      cars: taxNumber(cars.total)
    };
  }

  function taxCalculate(userId) {
    const now = Date.now();
    taxEnsureCycle.run(userId, now);
    let cycle = taxGetCycle.get(userId);
    if (!cycle.last_at || cycle.last_at > now) {
      taxDb.prepare('UPDATE montadoria_tax_cycles SET last_at = ? WHERE user_id = ?').run(now, userId);
      cycle = taxGetCycle.get(userId);
    }

    const elapsedDays = Math.min(7, Math.floor((now - cycle.last_at) / 86400000));
    if (elapsedDays > 0) {
      const a = taxAssets(userId);
      const propertyRate = Number(taxGetSetting.get('property_rate')?.value ?? 1);
      const businessRate = Number(taxGetSetting.get('business_rate')?.value ?? 5);
      const upkeepRate = Number(taxGetSetting.get('upkeep_rate')?.value ?? 1);

      const propertyTax = a.properties * propertyRate / 100 / 30 * elapsedDays;
      const businessTax = a.businessIncome * businessRate / 100 * elapsedDays;
      const upkeep = (a.properties + a.businessValue + a.cars) * upkeepRate / 100 / 30 * elapsedDays;
      const total = Math.max(0, Math.round(propertyTax + businessTax + upkeep));

      taxDb.prepare(
        'UPDATE montadoria_tax_cycles SET debt = MIN(100000000, debt + ?), last_at = ? WHERE user_id = ?'
      ).run(total, cycle.last_at + elapsedDays * 86400000, userId);

      if (total > 0) taxLog.run(userId, total, 'مالیات و نگهداری', now);
    }
    return taxGetCycle.get(userId);
  }

  function taxMoney(n) {
    return Math.round(Number(n) || 0).toLocaleString('en-US');
  }
  function taxReply(ctx, message) {
    return ctx.reply(message);
  }
  function taxIsManager(userId) {
    const u = getUser(userId);
    return u && ['owner', 'moderator'].includes(String(u.role || '').toLowerCase());
  }

  bot.hears(/^(مالیات من|بدهی من)$/u, async (ctx) => {
    const userId = ctx.from.id;
    const cycle = taxCalculate(userId);
    const a = taxAssets(userId);
    const msg =
      '⟡ وضعیت مالیاتی مونتادوریا ⟡\\n' +
      'ارزش املاک: ' + taxMoney(a.properties) + '\\n' +
      'درآمد روزانه کسب‌وکارها: ' + taxMoney(a.businessIncome) + '\\n' +
      'ارزش کسب‌وکارها: ' + taxMoney(a.businessValue) + '\\n' +
      'ارزش خودروها: ' + taxMoney(a.cars) + '\\n' +
      'بدهی قابل پرداخت: ' + taxMoney(cycle.debt);
    return taxReply(ctx, msg);
  });

  bot.hears(/^پرداخت مالیات(?:\s*\|\s*(\d+))?$/u, async (ctx) => {
    const userId = ctx.from.id;
    const cycle = taxCalculate(userId);
    const debt = Math.round(Number(cycle.debt) || 0);
    if (debt <= 0) return taxReply(ctx, '✅ بدهی مالیاتی ندارید.');

    const u = getUser(userId);
    if (!u) return taxReply(ctx, 'ابتدا /start را اجرا کنید.');

    const requested = ctx.match?.[1] ? Number(ctx.match[1]) : debt;
    const amount = Math.min(debt, Math.max(0, Math.floor(requested)));
    if (amount <= 0) return taxReply(ctx, 'مبلغ پرداخت معتبر نیست.');

    const infinite = Number(u.infinite_money || 0) === 1 || u.infinite_money === true;
    if (!infinite && Number(u.money || 0) < amount) {
      return taxReply(ctx, '❌ موجودی کیف پول کافی نیست. مبلغ موردنیاز: ' + taxMoney(amount));
    }

    const pay = taxDb.transaction(() => {
      if (!infinite) {
        taxDb.prepare('UPDATE users SET money = money - ? WHERE telegram_id = ?').run(amount, userId);
      }
      taxDb.prepare(
        'UPDATE montadoria_tax_cycles SET debt = MAX(0, debt - ?) WHERE user_id = ?'
      ).run(amount, userId);
      taxLog.run(userId, -amount, 'پرداخت مالیات', Date.now());
    });
    pay();
    return taxReply(ctx, '✅ پرداخت مالیات انجام شد.\\nمبلغ پرداختی: ' + taxMoney(amount));
  });

  bot.hears(/^تنظیم مالیات\s*\|\s*(ملک|کسب‌وکار|کسب و کار|نگهداری)\s*\|\s*(\d+(?:\.\d+)?)$/u, async (ctx) => {
    if (!taxIsManager(ctx.from.id)) return;
    const category = ctx.match[1].replace(/‌/g, '').replace(/\s/g, '');
    const rate = Number(ctx.match[2]);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      return taxReply(ctx, 'نرخ باید بین ۰ تا ۱۰۰ باشد.');
    }
    const key = category === 'ملک' ? 'property_rate'
      : category === 'نگهداری' ? 'upkeep_rate' : 'business_rate';
    taxSetSetting.run(key, rate);
    return taxReply(ctx, '✅ نرخ مالیات ذخیره شد: ' + category + ' = ' + rate + '%');
  });

  bot.hears(/^گزارش مالیات$/u, async (ctx) => {
    if (!taxIsManager(ctx.from.id)) return;
    const totals = taxDb.prepare(\`
      SELECT COUNT(*) AS people, COALESCE(SUM(debt), 0) AS debt
      FROM montadoria_tax_cycles WHERE debt > 0
    \`).get();
    const p = taxGetSetting.get('property_rate')?.value ?? 1;
    const b = taxGetSetting.get('business_rate')?.value ?? 5;
    const u = taxGetSetting.get('upkeep_rate')?.value ?? 1;
    return taxReply(ctx,
      '⟡ گزارش مالیات ⟡\\n' +
      'افراد بدهکار: ' + totals.people + '\\n' +
      'مجموع بدهی: ' + taxMoney(totals.debt) + '\\n' +
      'نرخ ملک: ' + p + '% ماهانه\\n' +
      'نرخ کسب‌وکار: ' + b + '% از درآمد روزانه\\n' +
      'نرخ نگهداری: ' + u + '% ماهانه');
  });
}
// END MONTADORIA TAX SYSTEM V1
`;

s = s.replace(marker, marker + code);
fs.writeFileSync(file, s);
console.log('بخش مالیات اضافه شد.');
