-- Waitlist for the coming-soon phase. Emails are unique case-insensitively so a
-- repeat signup is a no-op rather than a second row.
CREATE TABLE waitlist (
  id               INTEGER PRIMARY KEY,
  email            TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  role             TEXT    CHECK (role IN ('launching', 'trading', 'integrating')),
  contract_address TEXT    CHECK (contract_address IS NULL OR length(contract_address) = 42),
  ip_hash          TEXT    NOT NULL,
  user_agent       TEXT,
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Fixed-window counters. The bucket key already contains the window number,
-- so old rows are just garbage to sweep, never read again.
CREATE TABLE rate_limits (
  bucket     TEXT    PRIMARY KEY,
  hits       INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX rate_limits_expires_at ON rate_limits (expires_at);

-- Runtime switches (e.g. coming_soon -> live) that must flip without a redeploy.
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO settings (key, value) VALUES ('site_mode', 'coming_soon');
