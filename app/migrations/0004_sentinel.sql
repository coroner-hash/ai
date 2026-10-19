-- Sentinel: watch a token's contract and email when something material changes.
-- Double opt-in: a row is inert until the owner of the email clicks the confirmation link.
CREATE TABLE sentinel_watches (
  id            INTEGER PRIMARY KEY,
  email         TEXT    NOT NULL COLLATE NOCASE,
  address       TEXT    NOT NULL CHECK (length(address) = 42),
  token         TEXT    NOT NULL UNIQUE,
  confirmed     INTEGER NOT NULL DEFAULT 0,
  baseline_json TEXT,
  last_check_at INTEGER NOT NULL DEFAULT 0,
  ip_hash       TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (email, address)
);
CREATE INDEX sentinel_confirmed_check ON sentinel_watches (confirmed, last_check_at);
