const { queriesRunner, dbName } = require('./setup');

const queries = [
  `DROP TABLE IF EXISTS ${dbName}.hourly_projects_data`,
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

];

queriesRunner(queries);
