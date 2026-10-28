-- Orders: indexed columns + the full order as JSON in `data`
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  ticket INTEGER NOT NULL,
  status TEXT NOT NULL,
  payment_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_payment ON orders(payment_id);

-- Settings, menu edits and the ticket counter
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Per-IP rate limiting + PIN brute-force lockout
CREATE TABLE IF NOT EXISTS rate_limits (
  k TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  t INTEGER NOT NULL
);
