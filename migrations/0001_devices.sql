-- Practice stats synced by sync code. Each device owns one row, so devices never overwrite each other.
-- code_hash is the SHA-256 of the sync code; the code itself is never stored.
CREATE TABLE devices (
  code_hash  TEXT    NOT NULL,
  device_id  TEXT    NOT NULL,
  name       TEXT    NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  stats      TEXT    NOT NULL,
  PRIMARY KEY (code_hash, device_id)
) WITHOUT ROWID;
