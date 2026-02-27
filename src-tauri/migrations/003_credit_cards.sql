-- Valute Migration 003: Credit Card Fields
-- Adds credit card specific fields to accounts table

ALTER TABLE accounts ADD COLUMN credit_limit INTEGER;           -- centavos
ALTER TABLE accounts ADD COLUMN statement_closing_day INTEGER;  -- 1-31
ALTER TABLE accounts ADD COLUMN payment_due_day INTEGER;        -- 1-31
