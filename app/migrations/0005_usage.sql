-- Daily usage counters (aggregate only: no addresses, IPs or emails).
CREATE TABLE usage_daily (
  day  TEXT    NOT NULL,
  kind TEXT    NOT NULL,
  n    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind)
);
