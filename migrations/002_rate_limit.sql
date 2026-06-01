CREATE TABLE IF NOT EXISTS rate_limit (ip TEXT NOT NULL, window_minute INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (ip, window_minute));
