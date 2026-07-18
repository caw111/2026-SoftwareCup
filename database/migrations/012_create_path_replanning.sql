CREATE TABLE IF NOT EXISTS learning_activity_events (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  plan_id VARCHAR(64) NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  event_key VARCHAR(160) NULL,
  payload_json JSON NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_learning_event_idempotency (user_id, plan_id, event_key),
  KEY idx_learning_events_plan_created (plan_id, created_at),
  KEY idx_learning_events_user_type (user_id, event_type, created_at),
  CONSTRAINT fk_replanning_events_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_replanning_events_plan
    FOREIGN KEY (plan_id) REFERENCES learning_plans(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS path_revisions (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  plan_id VARCHAR(64) NOT NULL,
  base_plan_version INT UNSIGNED NOT NULL,
  status ENUM('proposed', 'accepted', 'rejected', 'applied', 'undone', 'expired') NOT NULL DEFAULT 'proposed',
  trigger_type VARCHAR(80) NOT NULL,
  trigger_event_ids_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  summary VARCHAR(1000) NOT NULL,
  before_snapshot_json JSON NOT NULL,
  after_snapshot_json JSON NOT NULL,
  diff_json JSON NOT NULL,
  actions_json JSON NOT NULL,
  confidence DECIMAL(5,2) NOT NULL DEFAULT 0,
  created_by_agent VARCHAR(100) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  decided_at DATETIME(3) NULL,
  applied_at DATETIME(3) NULL,
  undone_at DATETIME(3) NULL,
  KEY idx_path_revisions_plan_status (plan_id, status, created_at),
  KEY idx_path_revisions_user_created (user_id, created_at),
  CONSTRAINT fk_replanning_revisions_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_replanning_revisions_plan
    FOREIGN KEY (plan_id) REFERENCES learning_plans(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @add_plan_tasks_task_uid = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plan_tasks' AND COLUMN_NAME = 'task_uid') = 0,
  'ALTER TABLE plan_tasks ADD COLUMN task_uid CHAR(36) NULL AFTER id',
  'SELECT 1'
);
PREPARE stmt FROM @add_plan_tasks_task_uid;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_plan_tasks_concept_id = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plan_tasks' AND COLUMN_NAME = 'concept_id') = 0,
  'ALTER TABLE plan_tasks ADD COLUMN concept_id VARCHAR(120) NULL AFTER content',
  'SELECT 1'
);
PREPARE stmt FROM @add_plan_tasks_concept_id;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_plan_tasks_revision_id = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plan_tasks' AND COLUMN_NAME = 'revision_id') = 0,
  'ALTER TABLE plan_tasks ADD COLUMN revision_id CHAR(36) NULL AFTER concept_id',
  'SELECT 1'
);
PREPARE stmt FROM @add_plan_tasks_revision_id;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_plan_tasks_status = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plan_tasks' AND COLUMN_NAME = 'status') = 0,
  'ALTER TABLE plan_tasks ADD COLUMN status ENUM(''active'', ''deprecated'') NOT NULL DEFAULT ''active'' AFTER revision_id',
  'SELECT 1'
);
PREPARE stmt FROM @add_plan_tasks_status;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_plan_tasks_locked = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plan_tasks' AND COLUMN_NAME = 'locked') = 0,
  'ALTER TABLE plan_tasks ADD COLUMN locked BOOLEAN NOT NULL DEFAULT FALSE AFTER status',
  'SELECT 1'
);
PREPARE stmt FROM @add_plan_tasks_locked;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE plan_tasks
   SET task_uid = UUID()
 WHERE task_uid IS NULL;
