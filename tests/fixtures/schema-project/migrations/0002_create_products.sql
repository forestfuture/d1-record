CREATE TABLE products (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  rating REAL,
  available BOOLEAN NOT NULL DEFAULT 1,
  settings TEXT CHECK (json_valid(settings)),
  released_on DATE,
  created_at DATETIME,
  updated_at DATETIME
);
