// This script initialises the Swetrix cloud edition database and tables if they're absent
const { queriesRunner, dbName, databaselessQueriesRunner } = require('./setup')

const CLICKHOUSE_DB_INIT_QUERIES = [`CREATE DATABASE IF NOT EXISTS ${dbName}`]

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
    lt Nullable(UInt8),
    meta Nested
    (
      key String,
      value String
    ),
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
    lt Nullable(UInt8),
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

  // Error events table
  `CREATE TABLE IF NOT EXISTS ${dbName}.errors
  (
    eid FixedString(32),
    pid FixedString(12),
    pg Nullable(String),
    dv LowCardinality(Nullable(String)),
    br LowCardinality(Nullable(String)),
    os LowCardinality(Nullable(String)),
    lc LowCardinality(Nullable(String)),
    cc LowCardinality(Nullable(FixedString(2))),
    rg LowCardinality(Nullable(String)),
    ct Nullable(String),
    name String,
    message Nullable(String),
    lineno Nullable(UInt32),
    colno Nullable(UInt32),
    filename Nullable(String),
    created DateTime('UTC')
  )
  ENGINE = MergeTree()
  PARTITION BY toYYYYMM(created)
  ORDER BY (pid, created);`,

  // Error events status table
  `CREATE TABLE IF NOT EXISTS ${dbName}.error_statuses (
    eid FixedString(32),
    pid FixedString(12),
    status Enum8('active', 'regressed', 'resolved'),
    updated DateTime('UTC') DEFAULT now()
  )
  ENGINE = ReplacingMergeTree()
  PRIMARY KEY (eid, pid);`,

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
]

const initialiseDatabase = async () => {
  try {
    await databaselessQueriesRunner(CLICKHOUSE_DB_INIT_QUERIES)
    await queriesRunner(CLICKHOUSE_INIT_QUERIES)
  } catch (reason) {
    console.error(
      `[ERROR] Error occured whilst initialising the database: ${reason}`,
    )
  }
}

initialiseDatabase()

module.exports = {
  initialiseDatabase,
}
