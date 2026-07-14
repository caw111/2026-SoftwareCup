CREATE TABLE IF NOT EXISTS api_usage_daily (
  user_id CHAR(36) NOT NULL,
  usage_date DATE NOT NULL,
  endpoint VARCHAR(50) NOT NULL,
  request_count INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, usage_date, endpoint),
  CONSTRAINT fk_api_usage_daily_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
