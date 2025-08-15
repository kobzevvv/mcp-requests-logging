## BigQuery SQL: Dataset and Tables (US)

Run these in BigQuery Console (replace project id if needed):

```sql
-- Create dataset (schema)
CREATE SCHEMA IF NOT EXISTS `qalearn.hiring_router_mcp`
OPTIONS (location = 'US');
```

```sql
-- Main table for production events
CREATE TABLE IF NOT EXISTS `qalearn.hiring_router_mcp.logging_events` (
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
```

```sql
-- Test table for CI/dev verification events
CREATE TABLE IF NOT EXISTS `qalearn.hiring_router_mcp.test_events_logging` (
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
```


