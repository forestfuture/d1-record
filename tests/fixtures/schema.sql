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

-- Columns exercising the camelCase → snake_case naming rule.
CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  is_active INTEGER,
  external_account_id TEXT,
  html_url TEXT,
  user_id INTEGER,
  sha256_hash TEXT,
  person_identifier TEXT
);

-- A table with an app-generated text primary key and timestamps.
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  scopes TEXT,
  expires_at TEXT,
  created_at TEXT,
  updated_at TEXT
);
