-- ARA's journal. What was asked, what was intended, what was decided, whether
-- that was correct.
--
-- Records do not expire. Nothing in this file has a TTL or a retention window:
-- a candidate or decision written with a cache lifetime can never be promoted,
-- because promotion is a later read of something already gone.
--
-- This file declares the table a fresh database gets. An existing database is
-- grown by the ALTER TABLE statements in src/loop.js, which runs them at first
-- use — CREATE TABLE IF NOT EXISTS is a no-op against a table that already
-- exists, so this file cannot add a column to production. The two must agree
-- column for column; if they disagree, this file is the declaration and the
-- ALTERs are the drift.
--
--   wrangler d1 execute DB --remote --file=schema.sql
--
-- Column notes:
--   confidence           the decision's confidence, and only that.
--   intent_confidence    separately measured, never folded into it.
--   domain_confidence    separately measured.
--   evidence_confidence  separately measured.
--   intent_confirmed     written by his verdict alone; never by her reading.
--   domains              the domain set and its roles, as JSON.
--   surface              the product or interface the ask arrived from
--                        (mind, cods, forms), not a reasoning domain.
--   domain               the primary reasoning domain, classified independently
--                        of surface.
--   preference confidence is not here. It accumulates per domain in Memoria.

CREATE TABLE IF NOT EXISTS decisions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  at                  TEXT NOT NULL DEFAULT (datetime('now')),
  domain              TEXT,
  asked               TEXT NOT NULL,
  decided             TEXT,
  correct             INTEGER,
  corrected_to        TEXT,
  outcome             TEXT,
  idiom               TEXT,
  surface             TEXT,
  model               TEXT,
  cost                REAL,
  ms                  INTEGER,
  confidence          REAL,
  intent_explicit     TEXT,
  intent_implicit     TEXT,
  intent_interpreted  TEXT,
  intent_confirmed    TEXT,
  context             TEXT,
  domains             TEXT,
  intent_confidence   REAL,
  domain_confidence   REAL,
  evidence_confidence REAL
);

CREATE INDEX IF NOT EXISTS decisions_domain_at ON decisions (domain, at);
