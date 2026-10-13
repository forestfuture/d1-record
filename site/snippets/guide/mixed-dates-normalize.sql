UPDATE reminders
SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
WHERE strftime('%Y-%m-%dT%H:%M:%fZ', created_at) <> created_at;
