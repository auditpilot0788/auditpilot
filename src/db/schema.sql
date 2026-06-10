-- AuditPilot — Database Schema
-- Safe to run multiple times: all statements use IF NOT EXISTS.
-- Requires PostgreSQL 13+ (gen_random_uuid() is built-in from pg 13).

-- ── Users ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(255),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- ── Subscriptions ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS subscriptions (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan                   VARCHAR(50) NOT NULL DEFAULT 'free'
                           CHECK (plan IN ('free', 'starter', 'agency')),
  status                 VARCHAR(50) NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'cancelled', 'past_due')),
  stripe_customer_id     VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  current_period_start   TIMESTAMPTZ,
  current_period_end     TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id       ON subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_cust   ON subscriptions (stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub    ON subscriptions (stripe_subscription_id);

-- ── Scan Usage ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS scan_usage (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scanned_url     VARCHAR(2048) NOT NULL,
  scanned_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  month_year      VARCHAR(7)    NOT NULL,  -- format: '2026-06' for easy monthly counting
  report_filename VARCHAR(500)             -- filename inside reports/ directory, if saved
);

CREATE INDEX IF NOT EXISTS idx_scan_usage_user_id    ON scan_usage (user_id);
CREATE INDEX IF NOT EXISTS idx_scan_usage_month_year ON scan_usage (user_id, month_year);

-- Add report_filename to existing deployments that were created before this column existed
ALTER TABLE scan_usage ADD COLUMN IF NOT EXISTS report_filename VARCHAR(500);
