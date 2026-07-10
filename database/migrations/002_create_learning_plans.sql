CREATE TABLE IF NOT EXISTS learning_plans (
  id VARCHAR(64) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  title VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL,
  content_json JSON NOT NULL,
  notes MEDIUMTEXT NOT NULL,
  mastery_evidence_json JSON NOT NULL,
  legacy_quiz_history_json JSON NOT NULL,
  quiz_round INT UNSIGNED NOT NULL DEFAULT 0,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  KEY idx_learning_plans_user_created (user_id, created_at),
  KEY idx_learning_plans_user_deleted (user_id, deleted_at),
  CONSTRAINT fk_learning_plans_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_workspaces (
  user_id CHAR(36) PRIMARY KEY,
  active_plan_id VARCHAR(64) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_user_workspaces_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_workspaces_active_plan
    FOREIGN KEY (active_plan_id) REFERENCES learning_plans(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
