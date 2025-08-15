-- BigQuery dataset and table for logging events
-- Dataset: hiring_router_mcp
-- Recommended table name: logging_events
-- Replace PROJECT_ID with your GCP project id before running.

-- Optional: Create dataset (schema)
-- CREATE SCHEMA IF NOT EXISTS `PROJECT_ID.hiring_router_mcp`;

-- Create table with stable top-level fields and flexible extra JSON
CREATE TABLE IF NOT EXISTS `PROJECT_ID.hiring_router_mcp.logging_events` (
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


