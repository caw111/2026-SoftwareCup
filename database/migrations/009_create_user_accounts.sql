CREATE TABLE IF NOT EXISTS user_accounts (
  user_id CHAR(36) PRIMARY KEY,
  username VARCHAR(64) NOT NULL,
  password_salt CHAR(32) NOT NULL,
  password_hash CHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_user_accounts_username (username),
  CONSTRAINT fk_user_accounts_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
