// This script initialises the Swetrix cloud edition database and tables if they're absent
const { queriesRunner, dbName, databaselessQueriesRunner } = require('./setup')

const CLICKHOUSE_DB_INIT_QUERIES = [
  `CREATE DATABASE IF NOT EXISTS ${dbName}`,
]

const CLICKHOUSE_INIT_QUERIES = [
  // The traffic data table
  `CREATE TABLE IF NOT EXISTS ${dbName}.analytics
  (
    psid Nullable(UInt64),
    sid Nullable(String),
    pid FixedString(12),
    pg Nullable(String),
    prev Nullable(String),
    dv LowCardinality(Nullable(String)),
    br LowCardinality(Nullable(String)),
    os LowCardinality(Nullable(String)),
    lc LowCardinality(Nullable(String)),
    ref Nullable(String),
    so Nullable(String),
    me Nullable(String),
    ca Nullable(String),
    cc Nullable(FixedString(2)),
    rg LowCardinality(Nullable(String)),
    ct Nullable(String),
    sdur Nullable(UInt32), 
    unique UInt8,
    created DateTime('UTC')
  )
  ENGINE = MergeTree()
  PARTITION BY toYYYYMM(created)
  ORDER BY (pid, created);`,

  // Custom events table
  `CREATE TABLE IF NOT EXISTS ${dbName}.customEV
  (
    psid Nullable(UInt64),
    pid FixedString(12),
    ev String,
    pg Nullable(String),
    dv LowCardinality(Nullable(String)),
    br LowCardinality(Nullable(String)),
    os LowCardinality(Nullable(String)),
    lc LowCardinality(Nullable(String)),
    ref Nullable(String),
    so Nullable(String),
    me Nullable(String),
    ca Nullable(String),
    cc Nullable(FixedString(2)),
    rg LowCardinality(Nullable(String)),
    ct Nullable(String),
    meta Nested
    (
      key String,
      value String
    ),
    created DateTime('UTC')
  )
  ENGINE = MergeTree()
  PARTITION BY toYYYYMM(created)
  ORDER BY (pid, created);`,

  // The performance data table
  `CREATE TABLE IF NOT EXISTS ${dbName}.performance
  (
    pid FixedString(12),
    pg Nullable(String),
    dv LowCardinality(Nullable(String)),
    br LowCardinality(Nullable(String)),
    cc Nullable(FixedString(2)),
    rg LowCardinality(Nullable(String)),
    ct Nullable(String),
    dns Nullable(UInt32),
    tls Nullable(UInt32),
    conn Nullable(UInt32),
    response Nullable(UInt32),
    render Nullable(UInt32),
    domLoad Nullable(UInt32),
    pageLoad Nullable(UInt32),
    ttfb Nullable(UInt32),
    created DateTime('UTC')
  )
  ENGINE = MergeTree()
  PARTITION BY toYYYYMM(created)
  ORDER BY (pid, created);`,

  // The CAPTCHA data table
  `CREATE TABLE IF NOT EXISTS ${dbName}.captcha
  (
    pid FixedString(12),
    dv LowCardinality(Nullable(String)),
    br LowCardinality(Nullable(String)),
    os Nullable(String),
    cc Nullable(FixedString(2)),
    manuallyPassed UInt8,
    created DateTime('UTC')
  )
  ENGINE = MergeTree()
  PARTITION BY toYYYYMM(created)
  ORDER BY (pid, created);`,

  `CREATE TABLE IF NOT EXISTS ${dbName}.hourly_projects_data (
    UniqueID String,
    projectID String,
    statisticsGathered DateTime,
    br_keys Array(String),
    br_vals Array(UInt32),
    os_keys Array(String),
    os_vals Array(UInt32),
    lc_keys Array(String),
    lc_vals Array(UInt32),
    ref_keys Array(String),
    ref_vals Array(UInt32),
    so_keys Array(String),
    so_vals Array(UInt32),
    me_keys Array(String),
    me_vals Array(UInt32),
    ca_keys Array(String),
    ca_vals Array(UInt32),
    cc_keys Array(String),
    cc_vals Array(UInt32),
    dv_keys Array(String),
    dv_vals Array(UInt32),
    rg_keys Array(String),
    rg_vals Array(UInt32),
    ct_keys Array(String),
    ct_vals Array(UInt32)
    -- Add any additional dimensions you require
  ) ENGINE = MergeTree()
  ORDER BY (projectID, statisticsGathered);`
]

const initialiseDatabase = async () => {
  try {
    await databaselessQueriesRunner(CLICKHOUSE_DB_INIT_QUERIES)
    await queriesRunner(CLICKHOUSE_INIT_QUERIES)
  } catch (reason) {
    console.error(`[ERROR] Error occured whilst initialising the database: ${reason}`)
  }
}

initialiseDatabase()

module.exports = {
  initialiseDatabase,
}
