-- Test table used by CI/CD to verify insert pipeline
-- Dataset: hiring_router_mcp
-- Table: test_events_logging
-- Replace PROJECT_ID with your project id before running.

CREATE TABLE IF NOT EXISTS `PROJECT_ID.hiring_router_mcp.test_events_logging` (
  schema_version INT64,
  source STRING,
  timestamp TIMESTAMP,
  level STRING,
  logger STRING,
  message STRING,
  exc_info STRING,
  extra JSON
)
PARTITION BY DATE(timestamp)
CLUSTER BY source, level;


