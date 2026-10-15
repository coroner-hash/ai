-- Short-lived cache of contract facts so repeat checks do not spend RPC credits.
CREATE TABLE IF NOT EXISTS verdict_cache (
  address    TEXT PRIMARY KEY,
  facts_json TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
