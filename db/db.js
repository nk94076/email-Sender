const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'data.sqlite');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  html_body TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recipient_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id INTEGER NOT NULL REFERENCES recipient_lists(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  data TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS smtp_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  host TEXT,
  port INTEGER,
  secure INTEGER DEFAULT 0,
  user TEXT,
  pass TEXT,
  from_name TEXT,
  from_email TEXT,
  send_delay_ms INTEGER DEFAULT 1000,
  public_base_url TEXT
);

CREATE TABLE IF NOT EXISTS smtp_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 587,
  secure INTEGER NOT NULL DEFAULT 0,
  user TEXT NOT NULL,
  pass TEXT NOT NULL,
  from_name TEXT,
  from_email TEXT NOT NULL,
  send_delay_ms INTEGER NOT NULL DEFAULT 1000,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  public_base_url TEXT,
  default_smtp_profile_id INTEGER REFERENCES smtp_profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER REFERENCES templates(id) ON DELETE SET NULL,
  list_id INTEGER REFERENCES recipient_lists(id) ON DELETE SET NULL,
  smtp_profile_id INTEGER REFERENCES smtp_profiles(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  total INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  include_unsubscribe_header INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS campaign_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  open_token TEXT,
  opened_at TEXT,
  open_count INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

const templateColumns = db.prepare("PRAGMA table_info(templates)").all().map((c) => c.name);
if (!templateColumns.includes('category')) {
  db.exec("ALTER TABLE templates ADD COLUMN category TEXT NOT NULL DEFAULT 'General'");
}

const campaignColumns = db.prepare("PRAGMA table_info(campaigns)").all().map((c) => c.name);
if (!campaignColumns.includes('include_unsubscribe_header')) {
  db.exec('ALTER TABLE campaigns ADD COLUMN include_unsubscribe_header INTEGER NOT NULL DEFAULT 1');
}

const logColumns = db.prepare('PRAGMA table_info(campaign_logs)').all().map((c) => c.name);
if (!logColumns.includes('open_token')) {
  db.exec('ALTER TABLE campaign_logs ADD COLUMN open_token TEXT');
  db.exec('ALTER TABLE campaign_logs ADD COLUMN opened_at TEXT');
  db.exec('ALTER TABLE campaign_logs ADD COLUMN open_count INTEGER NOT NULL DEFAULT 0');
}

const settingsColumns = db.prepare('PRAGMA table_info(smtp_settings)').all().map((c) => c.name);
if (!settingsColumns.includes('public_base_url')) {
  db.exec('ALTER TABLE smtp_settings ADD COLUMN public_base_url TEXT');
}

const campaignColumns2 = db.prepare('PRAGMA table_info(campaigns)').all().map((c) => c.name);
if (!campaignColumns2.includes('smtp_profile_id')) {
  db.exec('ALTER TABLE campaigns ADD COLUMN smtp_profile_id INTEGER REFERENCES smtp_profiles(id) ON DELETE SET NULL');
}

// Older deployments created campaigns.template_id/list_id as NOT NULL with
// no ON DELETE action, so deleting a template or recipient list that had
// ever been used in a campaign threw a raw FOREIGN KEY constraint error
// (surfaced to users as a 500 on the delete button). SQLite can't alter an
// existing column's FK behavior in place, so rebuild the table.
const campaignFks = db.prepare('PRAGMA foreign_key_list(campaigns)').all();
const templateFk = campaignFks.find((fk) => fk.table === 'templates');
const listFk = campaignFks.find((fk) => fk.table === 'recipient_lists');
const needsFkRebuild = (templateFk && templateFk.on_delete !== 'SET NULL') || (listFk && listFk.on_delete !== 'SET NULL');
if (needsFkRebuild) {
  const existingCols = db.prepare('PRAGMA table_info(campaigns)').all().map((c) => c.name);
  const keepCols = [
    'id',
    'template_id',
    'list_id',
    'smtp_profile_id',
    'subject',
    'status',
    'total',
    'sent_count',
    'failed_count',
    'include_unsubscribe_header',
    'created_at',
    'started_at',
    'finished_at',
  ].filter((c) => existingCols.includes(c));

  db.exec('PRAGMA foreign_keys = OFF');
  db.transaction(() => {
    db.exec('ALTER TABLE campaigns RENAME TO campaigns_pre_fk_fix');
    db.exec(`
      CREATE TABLE campaigns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id INTEGER REFERENCES templates(id) ON DELETE SET NULL,
        list_id INTEGER REFERENCES recipient_lists(id) ON DELETE SET NULL,
        smtp_profile_id INTEGER REFERENCES smtp_profiles(id) ON DELETE SET NULL,
        subject TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        total INTEGER NOT NULL DEFAULT 0,
        sent_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        include_unsubscribe_header INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        started_at TEXT,
        finished_at TEXT
      )
    `);
    db.exec(`INSERT INTO campaigns (${keepCols.join(', ')}) SELECT ${keepCols.join(', ')} FROM campaigns_pre_fk_fix`);
    db.exec('DROP TABLE campaigns_pre_fk_fix');
  })();
  db.exec('PRAGMA foreign_keys = ON');
}

// One-time migration: move the old single-row SMTP config into the new
// multi-profile table, so existing installs keep working without the user
// having to re-enter their credentials.
const profileCount = db.prepare('SELECT COUNT(*) AS c FROM smtp_profiles').get().c;
if (profileCount === 0) {
  const legacy = db.prepare('SELECT * FROM smtp_settings WHERE id = 1').get();
  if (legacy && legacy.host && legacy.user) {
    const result = db
      .prepare(
        `INSERT INTO smtp_profiles (name, host, port, secure, user, pass, from_name, from_email, send_delay_ms)
         VALUES ('Default', ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        legacy.host,
        legacy.port || 587,
        legacy.secure || 0,
        legacy.user,
        legacy.pass,
        legacy.from_name,
        legacy.from_email || legacy.user,
        legacy.send_delay_ms || 1000
      );
    db.prepare(
      `INSERT INTO app_settings (id, public_base_url, default_smtp_profile_id) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET public_base_url = excluded.public_base_url, default_smtp_profile_id = excluded.default_smtp_profile_id`
    ).run(legacy.public_base_url || null, result.lastInsertRowid);
  }
}
db.prepare('INSERT OR IGNORE INTO app_settings (id) VALUES (1)').run();

module.exports = db;
