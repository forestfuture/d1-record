-- A column an app has filled in two ways: SQLite's own date text (the DEFAULT) and ISO text.
CREATE TABLE reminders (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
