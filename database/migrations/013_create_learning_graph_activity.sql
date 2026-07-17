CREATE TABLE IF NOT EXISTS knowledge_graph_versions (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  plan_id VARCHAR(64) NOT NULL,
  source VARCHAR(60) NOT NULL,
  model VARCHAR(120) NULL,
  coverage_json JSON NOT NULL,
  graph_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_knowledge_graph_versions_plan_created (plan_id, created_at),
  KEY idx_knowledge_graph_versions_user_created (user_id, created_at),
  CONSTRAINT fk_knowledge_graph_versions_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_knowledge_graph_versions_plan
    FOREIGN KEY (plan_id) REFERENCES learning_plans(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS knowledge_graph_layouts (
  user_id CHAR(36) NOT NULL,
  plan_id VARCHAR(64) NOT NULL,
  graph_version_id CHAR(36) NULL,
  layout_json JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, plan_id),
  KEY idx_knowledge_graph_layouts_graph_version (graph_version_id),
  CONSTRAINT fk_knowledge_graph_layouts_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_knowledge_graph_layouts_plan
    FOREIGN KEY (plan_id) REFERENCES learning_plans(id) ON DELETE CASCADE,
  CONSTRAINT fk_knowledge_graph_layouts_version
    FOREIGN KEY (graph_version_id) REFERENCES knowledge_graph_versions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mind_maps (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  plan_id VARCHAR(64) NOT NULL,
  source_graph_version_id CHAR(36) NULL,
  title VARCHAR(255) NOT NULL,
  source VARCHAR(60) NOT NULL,
  model VARCHAR(120) NULL,
  coverage_score DECIMAL(5,2) NOT NULL DEFAULT 0,
  map_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_mind_maps_plan_created (plan_id, created_at),
  KEY idx_mind_maps_user_created (user_id, created_at),
  KEY idx_mind_maps_graph_version (source_graph_version_id),
  CONSTRAINT fk_mind_maps_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_mind_maps_plan
    FOREIGN KEY (plan_id) REFERENCES learning_plans(id) ON DELETE CASCADE,
  CONSTRAINT fk_mind_maps_graph_version
    FOREIGN KEY (source_graph_version_id) REFERENCES knowledge_graph_versions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mind_map_versions (
  id CHAR(36) PRIMARY KEY,
  mind_map_id CHAR(36) NOT NULL,
  version_number INT UNSIGNED NOT NULL,
  map_json JSON NOT NULL,
  change_summary VARCHAR(500) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_mind_map_versions_number (mind_map_id, version_number),
  CONSTRAINT fk_mind_map_versions_map
    FOREIGN KEY (mind_map_id) REFERENCES mind_maps(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS review_schedule_items (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  plan_id VARCHAR(64) NOT NULL,
  concept_id VARCHAR(120) NOT NULL,
  title VARCHAR(255) NOT NULL,
  due_date DATE NOT NULL,
  status ENUM('pending', 'completed', 'skipped') NOT NULL DEFAULT 'pending',
  evidence_json JSON NOT NULL,
  completed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_review_schedule_user_due (user_id, due_date, status),
  KEY idx_review_schedule_plan_due (plan_id, due_date, status),
  CONSTRAINT fk_review_schedule_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_review_schedule_plan
    FOREIGN KEY (plan_id) REFERENCES learning_plans(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS badge_catalog (
  id VARCHAR(80) PRIMARY KEY,
  title VARCHAR(120) NOT NULL,
  description VARCHAR(500) NOT NULL,
  rule_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_badges (
  user_id CHAR(36) NOT NULL,
  badge_id VARCHAR(80) NOT NULL,
  unlocked_at DATETIME(3) NOT NULL,
  evidence_json JSON NOT NULL,
  PRIMARY KEY (user_id, badge_id),
  CONSTRAINT fk_user_badges_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_badges_catalog
    FOREIGN KEY (badge_id) REFERENCES badge_catalog(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
