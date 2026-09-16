const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'data.sqlite');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

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

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES templates(id),
  list_id INTEGER NOT NULL REFERENCES recipient_lists(id),
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

module.exports = db;
