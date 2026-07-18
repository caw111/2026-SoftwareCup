CREATE TABLE IF NOT EXISTS course_sources (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(150) NOT NULL,
  extension VARCHAR(20) NOT NULL,
  byte_size INT UNSIGNED NOT NULL,
  char_count INT UNSIGNED NOT NULL DEFAULT 0,
  chunk_count INT UNSIGNED NOT NULL DEFAULT 0,
  checksum CHAR(64) NOT NULL,
  status ENUM('processing', 'ready', 'failed') NOT NULL DEFAULT 'processing',
  error_message VARCHAR(1000) NULL,
  metadata_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  KEY idx_course_sources_user_created (user_id, created_at),
  KEY idx_course_sources_user_status (user_id, status, deleted_at),
  KEY idx_course_sources_checksum (user_id, checksum),
  CONSTRAINT fk_course_sources_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS course_source_chunks (
  id CHAR(36) PRIMARY KEY,
  source_id CHAR(36) NOT NULL,
  chunk_index INT UNSIGNED NOT NULL,
  locator VARCHAR(255) NOT NULL,
  title VARCHAR(500) NOT NULL,
  content MEDIUMTEXT NOT NULL,
  keywords_json JSON NOT NULL,
  token_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_source_chunk_index (source_id, chunk_index),
  KEY idx_source_chunks_source (source_id),
  CONSTRAINT fk_source_chunks_source
    FOREIGN KEY (source_id) REFERENCES course_sources(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS plan_sources (
  plan_id VARCHAR(64) NOT NULL,
  source_id CHAR(36) NOT NULL,
  linked_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (plan_id, source_id),
  KEY idx_plan_sources_source (source_id),
  CONSTRAINT fk_plan_sources_plan
    FOREIGN KEY (plan_id) REFERENCES learning_plans(id) ON DELETE CASCADE,
  CONSTRAINT fk_plan_sources_source
    FOREIGN KEY (source_id) REFERENCES course_sources(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
