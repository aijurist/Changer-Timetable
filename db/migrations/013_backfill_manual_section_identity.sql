WITH unambiguous_group_sections AS (
  SELECT department, group_name, min(section_index) AS section_index
  FROM sessions
  WHERE semester = 3
    AND section_index IS NOT NULL
    AND group_name IS NOT NULL
  GROUP BY department, group_name
  HAVING count(DISTINCT section_index) = 1
)
UPDATE sessions AS target
SET section_index = mapping.section_index,
    updated_at = now()
FROM unambiguous_group_sections AS mapping
WHERE target.semester = 3
  AND target.section_index IS NULL
  AND target.department = mapping.department
  AND target.group_name = mapping.group_name;
