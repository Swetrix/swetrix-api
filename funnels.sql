-- My 'analytics' table has the following columns: pg and prev.
-- pg is the page name, and prev is the previous page name.
-- I need to calculate a funnel (amount of users that went from page A to page B and after that to page C (i.e. A -> B -> C...))
-- My database is Clickhouse.

-- The analytics table also have pid (project ID column) - in the query it has to be set to 'STEzHcB1rALV'
-- and created column which is a string date, it has to be set to BETWEEN '2023-05-13' AND '2023-07-13'

  -- count(t0), count(t1), count(t2)
-- SELECT
--   count(t0), count(t1), count(t2)
-- FROM analytics as t0
-- INNER JOIN analytics as t1 ON t0.pg = t1.prev AND t0.pid = t1.pid
-- INNER JOIN analytics as t2 ON t1.pg = t2.prev AND t1.pid = t2.pid
-- WHERE t0.pid = 'STEzHcB1rALV'
--   AND t0.created BETWEEN '2023-05-13' AND '2023-07-13'
--   AND t0.pg = 'page1'
--   AND t1.pg = 'page2'
--   AND t2.pg = 'page3';

SELECT
  count(t1.pg), count(t2.pg), count(t3.pg)
FROM analytics as t1
LEFT JOIN analytics as t2 ON t2.prev = t1.pg AND t2.pid = 'STEzHcB1rALV' AND t2.pg = '/dashboard'
LEFT JOIN analytics as t3 ON t3.prev = t2.pg AND t3.pid = 'STEzHcB1rALV' AND t3.pg = '/'
WHERE t1.pid = 'STEzHcB1rALV'
  AND t1.created BETWEEN '2023-05-13' AND '2023-07-13'
  AND t1.pg = '/settings';


SELECT
  count(t1.pg) AS settings_count,
  count(t2.pg) AS dashboard_count,
  count(t3.pg) AS root_count
FROM
(
  SELECT pg, prev
  FROM analytics
  WHERE pid = 'STEzHcB1rALV'
    AND created BETWEEN '2023-05-13' AND '2023-07-13'
    AND pg = '/settings'
) AS t1
INNER JOIN
(
  SELECT pg, prev
  FROM analytics
  WHERE pid = 'STEzHcB1rALV'
    AND created BETWEEN '2023-05-13' AND '2023-07-13'
    AND pg = '/dashboard'
) AS t2 ON t2.prev = t1.pg
INNER JOIN
(
  SELECT pg, prev
  FROM analytics
  WHERE pid = 'STEzHcB1rALV'
    AND created BETWEEN '2023-05-13' AND '2023-07-13'
    AND pg = '/'
) AS t3 ON t3.prev = t2.pg;


WITH t1 AS (
  SELECT pg, prev, pid, created
  FROM analytics
  WHERE pid = 'STEzHcB1rALV'
    AND created BETWEEN '2023-05-13' AND '2023-07-13'
    AND pg = '/settings'
),
t2 AS (
  SELECT pg, prev, pid, created
  FROM t1
  WHERE pid = 'STEzHcB1rALV'
    AND created BETWEEN '2023-05-13' AND '2023-07-13'
    AND pg = '/dashboard'
    AND prev IN (SELECT pg FROM t1)
),
t3 AS (
  SELECT pg, prev, pid, created
  FROM t2
  WHERE pid = 'STEzHcB1rALV'
    AND created BETWEEN '2023-05-13' AND '2023-07-13'
    AND pg = '/'
    AND prev IN (SELECT pg FROM t2)
)
SELECT
  count(t1.pg) AS settings_count,
  count(t2.pg) AS dashboard_count,
  count(t3.pg) AS root_count
FROM t1
INNER JOIN t2 ON t2.prev = t1.pg
INNER JOIN t3 ON t3.prev = t2.pg;
