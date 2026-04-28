-- Shikin Migration 015: Primary Account

ALTER TABLE accounts ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0;
