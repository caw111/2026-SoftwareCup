CREATE TABLE IF NOT EXISTS legacy_imports (
  source_key VARCHAR(100) PRIMARY KEY,
  user_id CHAR(36) NULL,
  imported_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_legacy_imports_user_id (user_id),
  CONSTRAINT fk_legacy_imports_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
