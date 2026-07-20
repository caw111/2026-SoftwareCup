PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  user_type TEXT NOT NULL DEFAULT 'anonymous' CHECK (user_type IN ('anonymous', 'registered')),
  display_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);

CREATE TABLE IF NOT EXISTS learning_plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  content_json TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  mastery_evidence_json TEXT NOT NULL DEFAULT '[]',
  legacy_quiz_history_json TEXT NOT NULL DEFAULT '[]',
  quiz_round INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_learning_plans_user_created ON learning_plans(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_learning_plans_user_deleted ON learning_plans(user_id, deleted_at);

CREATE TABLE IF NOT EXISTS user_workspaces (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  active_plan_id TEXT REFERENCES learning_plans(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_states (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  state_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS plan_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id TEXT NOT NULL REFERENCES learning_plans(id) ON DELETE CASCADE,
  task_uid TEXT NOT NULL,
  task_key TEXT NOT NULL,
  day_number INTEGER NOT NULL,
  task_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  concept_id TEXT,
  revision_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deprecated')),
  locked INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(plan_id, task_uid),
  UNIQUE(plan_id, task_key)
);
CREATE INDEX IF NOT EXISTS idx_plan_tasks_plan_day ON plan_tasks(plan_id, day_number, task_index);

CREATE TABLE IF NOT EXISTS quiz_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES learning_plans(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL DEFAULT 0,
  generation_mode TEXT,
  summary_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_plan_created ON quiz_sessions(plan_id, created_at);
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_user_created ON quiz_sessions(user_id, created_at);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  client_question_id TEXT NOT NULL,
  question_type TEXT NOT NULL,
  dimension TEXT,
  question_json TEXT NOT NULL,
  position INTEGER NOT NULL,
  max_score REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_session_position ON quiz_questions(session_id, position);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answer_json TEXT NOT NULL,
  is_correct INTEGER NOT NULL DEFAULT 0,
  score REAL NOT NULL DEFAULT 0,
  max_score REAL NOT NULL DEFAULT 0,
  feedback TEXT,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_question_created ON quiz_attempts(question_id, created_at);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_created ON quiz_attempts(user_id, created_at);

CREATE TABLE IF NOT EXISTS legacy_imports (
  source_key TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_legacy_imports_user_id ON legacy_imports(user_id);

CREATE TABLE IF NOT EXISTS concept_mastery (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES learning_plans(id) ON DELETE CASCADE,
  concept_id TEXT NOT NULL,
  concept_name TEXT NOT NULL,
  dimension TEXT NOT NULL,
  mastery_score REAL NOT NULL DEFAULT 0,
  evidence_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(plan_id, concept_id)
);
CREATE INDEX IF NOT EXISTS idx_concept_mastery_user_dimension ON concept_mastery(user_id, dimension);

CREATE TABLE IF NOT EXISTS content_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES learning_plans(id) ON DELETE CASCADE,
  reviewer_agent TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  quality_score REAL NOT NULL DEFAULT 0,
  checks_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS teacher_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES learning_plans(id) ON DELETE CASCADE,
  report_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS course_sources (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  extension TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  char_count INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  checksum TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'failed')),
  error_message TEXT,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_course_sources_user_created ON course_sources(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_course_sources_user_status ON course_sources(user_id, status, deleted_at);
CREATE INDEX IF NOT EXISTS idx_course_sources_checksum ON course_sources(user_id, checksum);

CREATE TABLE IF NOT EXISTS course_source_chunks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES course_sources(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  locator TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  keywords_json TEXT NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS idx_source_chunks_source ON course_source_chunks(source_id);

CREATE TABLE IF NOT EXISTS plan_sources (
  plan_id TEXT NOT NULL REFERENCES learning_plans(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES course_sources(id) ON DELETE CASCADE,
  linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (plan_id, source_id)
);
CREATE INDEX IF NOT EXISTS idx_plan_sources_source ON plan_sources(source_id);

CREATE TABLE IF NOT EXISTS learning_activity_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES learning_plans(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_key TEXT,
  payload_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, plan_id, event_key)
);
CREATE INDEX IF NOT EXISTS idx_learning_events_plan_created ON learning_activity_events(plan_id, created_at);
CREATE INDEX IF NOT EXISTS idx_learning_events_user_type ON learning_activity_events(user_id, event_type, created_at);

CREATE TABLE IF NOT EXISTS path_revisions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES learning_plans(id) ON DELETE CASCADE,
  base_plan_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'rejected', 'applied', 'undone', 'expired')),
  trigger_type TEXT NOT NULL,
  trigger_event_ids_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  summary TEXT NOT NULL,
  before_snapshot_json TEXT NOT NULL,
  after_snapshot_json TEXT NOT NULL,
  diff_json TEXT NOT NULL,
  actions_json TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  created_by_agent TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at TEXT,
  applied_at TEXT,
  undone_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_path_revisions_plan_status ON path_revisions(plan_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_path_revisions_user_created ON path_revisions(user_id, created_at);

CREATE TABLE IF NOT EXISTS knowledge_graph_versions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES learning_plans(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  model TEXT,
  coverage_json TEXT NOT NULL,
  graph_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_knowledge_graph_versions_plan_created ON knowledge_graph_versions(plan_id, created_at);
CREATE INDEX IF NOT EXISTS idx_knowledge_graph_versions_user_created ON knowledge_graph_versions(user_id, created_at);

CREATE TABLE IF NOT EXISTS knowledge_graph_layouts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES learning_plans(id) ON DELETE CASCADE,
  graph_version_id TEXT REFERENCES knowledge_graph_versions(id) ON DELETE SET NULL,
  layout_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, plan_id)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_graph_layouts_version ON knowledge_graph_layouts(graph_version_id);

CREATE TABLE IF NOT EXISTS mind_maps (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES learning_plans(id) ON DELETE CASCADE,
  source_graph_version_id TEXT REFERENCES knowledge_graph_versions(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  model TEXT,
  coverage_score REAL NOT NULL DEFAULT 0,
  map_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mind_maps_plan_created ON mind_maps(plan_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mind_maps_user_created ON mind_maps(user_id, created_at);

CREATE TABLE IF NOT EXISTS mind_map_versions (
  id TEXT PRIMARY KEY,
  mind_map_id TEXT NOT NULL REFERENCES mind_maps(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  map_json TEXT NOT NULL,
  change_summary TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(mind_map_id, version_number)
);

CREATE TABLE IF NOT EXISTS review_schedule_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES learning_plans(id) ON DELETE CASCADE,
  concept_id TEXT NOT NULL,
  title TEXT NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'skipped')),
  evidence_json TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_review_schedule_user_due ON review_schedule_items(user_id, due_date, status);
CREATE INDEX IF NOT EXISTS idx_review_schedule_plan_due ON review_schedule_items(plan_id, due_date, status);

CREATE TABLE IF NOT EXISTS badge_catalog (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  rule_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_badges (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id TEXT NOT NULL REFERENCES badge_catalog(id) ON DELETE CASCADE,
  unlocked_at TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  PRIMARY KEY (user_id, badge_id)
);

PRAGMA user_version = 1;
