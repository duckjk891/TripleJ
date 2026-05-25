-- Wedding MV Studio — Postgres bootstrap (run once against the `mv_wedding` database)
-- Tester instructions (manual, do not auto-run):
--   1. Connect to host Postgres as a superuser.
--   2. CREATE DATABASE mv_wedding OWNER aimu_user;
--   3. \c mv_wedding
--   4. \i infra/init_postgres.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  profile_image TEXT,
  bio TEXT,
  is_banned BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
