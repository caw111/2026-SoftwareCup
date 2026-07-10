CREATE TABLE IF NOT EXISTS quiz_sessions (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  plan_id VARCHAR(64) NOT NULL,
  round_number INT UNSIGNED NOT NULL DEFAULT 0,
  generation_mode VARCHAR(50) NULL,
  summary_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_quiz_sessions_plan_created (plan_id, created_at),
  KEY idx_quiz_sessions_user_created (user_id, created_at),
  CONSTRAINT fk_quiz_sessions_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_quiz_sessions_plan
    FOREIGN KEY (plan_id) REFERENCES learning_plans(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quiz_questions (
  id CHAR(36) PRIMARY KEY,
  session_id CHAR(36) NOT NULL,
  client_question_id TEXT NOT NULL,
  question_type VARCHAR(20) NOT NULL,
  dimension VARCHAR(100) NULL,
  question_json JSON NOT NULL,
  position INT UNSIGNED NOT NULL,
  max_score DECIMAL(8,2) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_quiz_questions_session_position (session_id, position),
  CONSTRAINT fk_quiz_questions_session
    FOREIGN KEY (session_id) REFERENCES quiz_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id CHAR(36) PRIMARY KEY,
  question_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  answer_json JSON NOT NULL,
  is_correct BOOLEAN NOT NULL DEFAULT FALSE,
  score DECIMAL(8,2) NOT NULL DEFAULT 0,
  max_score DECIMAL(8,2) NOT NULL DEFAULT 0,
  feedback TEXT NULL,
  result_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_quiz_attempts_question_created (question_id, created_at),
  KEY idx_quiz_attempts_user_created (user_id, created_at),
  CONSTRAINT fk_quiz_attempts_question
    FOREIGN KEY (question_id) REFERENCES quiz_questions(id) ON DELETE CASCADE,
  CONSTRAINT fk_quiz_attempts_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
