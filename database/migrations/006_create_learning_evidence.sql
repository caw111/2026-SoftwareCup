CREATE TABLE IF NOT EXISTS concept_mastery (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  plan_id VARCHAR(64) NOT NULL,
  concept_id VARCHAR(120) NOT NULL,
  concept_name VARCHAR(255) NOT NULL,
  dimension VARCHAR(100) NOT NULL,
  mastery_score DECIMAL(5,2) NOT NULL DEFAULT 0,
  evidence_json JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_concept_mastery_plan_concept (plan_id, concept_id),
  KEY idx_concept_mastery_user_dimension (user_id, dimension),
  CONSTRAINT fk_concept_mastery_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_concept_mastery_plan
    FOREIGN KEY (plan_id) REFERENCES learning_plans(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS content_reviews (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  plan_id VARCHAR(64) NOT NULL,
  reviewer_agent VARCHAR(100) NOT NULL,
  risk_level VARCHAR(20) NOT NULL,
  quality_score DECIMAL(5,2) NOT NULL DEFAULT 0,
  checks_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_content_reviews_plan_created (plan_id, created_at),
  KEY idx_content_reviews_user_created (user_id, created_at),
  CONSTRAINT fk_content_reviews_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_content_reviews_plan
    FOREIGN KEY (plan_id) REFERENCES learning_plans(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS teacher_reports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  plan_id VARCHAR(64) NOT NULL,
  report_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_teacher_reports_plan_created (plan_id, created_at),
  KEY idx_teacher_reports_user_created (user_id, created_at),
  CONSTRAINT fk_teacher_reports_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_teacher_reports_plan
    FOREIGN KEY (plan_id) REFERENCES learning_plans(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
