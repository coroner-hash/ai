-- Sign-In with Ethereum: one-time nonces bound to the address that asked for them.
CREATE TABLE auth_nonces (
  nonce      TEXT    PRIMARY KEY,
  address    TEXT    NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX auth_nonces_expires_at ON auth_nonces (expires_at);

-- Sessions store only a hash of the cookie value, so a database leak
-- cannot be replayed as a login.
CREATE TABLE sessions (
  id_hash    TEXT    PRIMARY KEY,
  address    TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_address ON sessions (address);
CREATE INDEX sessions_expires_at ON sessions (expires_at);
