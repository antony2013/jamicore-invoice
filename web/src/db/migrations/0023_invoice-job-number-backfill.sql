-- Every invoice now gets a job number (JC-YYYYMMDD-NNNN) when it is uploaded,
-- so the same short id identifies it from upload to completion. Backfill the
-- rows created before that change, keeping the daily sequence continuous with
-- any number already allocated for that day. Day = business timezone
-- (Asia/Colombo, same default as JOB_NUMBER_TZ), ordered by creation.
WITH existing AS (
  SELECT substring("job_number" from '^JC-(\d{8})-') AS day,
         MAX((regexp_replace("job_number", '^.*-', ''))::int) AS max_seq
  FROM "invoices"
  WHERE "job_number" IS NOT NULL
  GROUP BY 1
),
missing AS (
  SELECT "id",
         to_char("created_at" AT TIME ZONE 'Asia/Colombo', 'YYYYMMDD') AS day,
         row_number() OVER (
           PARTITION BY to_char("created_at" AT TIME ZONE 'Asia/Colombo', 'YYYYMMDD')
           ORDER BY "created_at", "id"
         ) AS rn
  FROM "invoices"
  WHERE "job_number" IS NULL
)
UPDATE "invoices" i
SET "job_number" = 'JC-' || m.day || '-' ||
  lpad((COALESCE(e.max_seq, 0) + m.rn)::text, 4, '0')
FROM missing m
LEFT JOIN existing e ON e.day = m.day
WHERE i."id" = m.id;
