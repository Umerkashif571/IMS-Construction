-- Bank Book auto-linking: finance entries create paired bank_transactions rows.
-- 2026-08-10
-- vendor_payments / salaries / petty_cash / amount_received:
-- which bank account the money moved through (all 4 entry types go through bank).
-- Optional NULL for legacy rows; new rows must provide bank_id (validated by API).
ALTER TABLE vendor_payments ADD COLUMN IF NOT EXISTS bank_id UUID REFERENCES banks(id);
ALTER TABLE salaries ADD COLUMN IF NOT EXISTS bank_id UUID REFERENCES banks(id);
ALTER TABLE petty_cash ADD COLUMN IF NOT EXISTS bank_id UUID REFERENCES banks(id);
ALTER TABLE amount_received ADD COLUMN IF NOT EXISTS bank_id UUID REFERENCES banks(id);
ALTER TABLE amount_received ADD COLUMN IF NOT EXISTS received_from VARCHAR;

-- bank_transactions: origin metadata for auto-created entries.
-- source_type: 'manual' (default) | 'vendor_payment' | 'salary' | 'amount_received'
-- source_ref:   id of the finance row that created this entry (enables deletion pairing).
-- source_party: who/where the money came from (credit entries, e.g. client name).
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS source_party VARCHAR;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS source_type VARCHAR NOT NULL DEFAULT 'manual';
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS source_ref UUID;
CREATE INDEX IF NOT EXISTS idx_bank_tx_source ON bank_transactions (source_type, source_ref);