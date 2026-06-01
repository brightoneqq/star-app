CREATE TABLE IF NOT EXISTS user_state (code TEXT PRIMARY KEY, data_json TEXT NOT NULL, updated_at INTEGER NOT NULL, bytes INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_user_state_updated_at ON user_state (updated_at);
