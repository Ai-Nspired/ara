-- ARA's journal. What was asked, what was decided, whether that was correct.
--
-- Records do not expire. Nothing in this file has a TTL or a retention window:
-- a candidate or decision written with a cache lifetime can never be promoted,
-- because promotion is a later read of something already gone.
--
--   wrangler d1 execute DB --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS decisions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  at            TEXT NOT NULL DEFAULT (datetime('now')),
  domain        TEXT,
  asked         TEXT NOT NULL,
  decided       TEXT,
  correct       INTEGER,
  corrected_to  TEXT
);

CREATE INDEX IF NOT EXISTS decisions_domain_at ON decisions (domain, at);
