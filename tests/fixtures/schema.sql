CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  role TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  suspended INTEGER NOT NULL DEFAULT 0,
  age INTEGER,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE posts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id),
  title TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

-- One column per attribute type, for conversion tests.
CREATE TABLE samples (
  id INTEGER PRIMARY KEY,
  label TEXT,
  quantity INTEGER,
  ratio REAL,
  enabled INTEGER,
  stamp TEXT,
  settings TEXT
);
