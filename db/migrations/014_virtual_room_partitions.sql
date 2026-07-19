WITH virtual_rooms(virtual_id, base_room_number, virtual_room_number, partition_label) AS (
  VALUES
    (9029, 'A104/105', 'A104/105-A', 'A'),
    (9030, 'A104/105', 'A104/105-B', 'B'),
    (9031, 'A208/209', 'A208/209-A', 'A'),
    (9032, 'A208/209', 'A208/209-B', 'B'),
    (9012, 'A210/211', 'A210/211-A', 'A'),
    (9013, 'A210/211', 'A210/211-B', 'B'),
    (9014, 'ANEW101', 'ANEW101-A', 'A'),
    (9015, 'ANEW101', 'ANEW101-B', 'B'),
    (9016, 'ANEW102', 'ANEW102-A', 'A'),
    (9017, 'ANEW102', 'ANEW102-B', 'B'),
    (9018, 'ANEW103', 'ANEW103-A', 'A'),
    (9019, 'ANEW103', 'ANEW103-B', 'B'),
    (9020, 'ANEW104', 'ANEW104-A', 'A'),
    (9021, 'ANEW104', 'ANEW104-B', 'B'),
    (9022, 'KSL02', 'KSL02-A', 'A'),
    (9023, 'KSL02', 'KSL02-B', 'B'),
    (9024, 'KSL03', 'KSL03-A', 'A'),
    (9025, 'KSL03', 'KSL03-B', 'B'),
    (9026, 'KS02', 'KS02-A', 'A'),
    (9027, 'KS02', 'KS02-B', 'B'),
    (9028, 'KS02', 'KS02-C', 'C')
), materialized_rooms AS (
  SELECT
    virtual.virtual_id AS id,
    virtual.virtual_room_number AS room_number,
    base.block,
    concat_ws(
      ' | ',
      nullif(trim(base.description), ''),
      format('Virtual partition %s of %s', virtual.partition_label, virtual.base_room_number)
    ) AS description,
    base.is_lab,
    base.room_type,
    least(coalesce(base.min_capacity, 0), 70) AS min_capacity,
    70 AS max_capacity,
    base.has_projector,
    base.has_ac,
    base.tech_level,
    base.maintained_by_id,
    base.green_board,
    base.lcs_available,
    base.smart_board,
    false AS allow_conflicts,
    'virtual_room_split' AS source
  FROM virtual_rooms virtual
  JOIN rooms base ON base.room_number = virtual.base_room_number
)
INSERT INTO rooms (
  id, room_number, block, description, is_lab, room_type,
  min_capacity, max_capacity, has_projector, has_ac, tech_level,
  maintained_by_id, green_board, lcs_available, smart_board,
  allow_conflicts, source
)
SELECT
  id, room_number, block, description, is_lab, room_type,
  min_capacity, max_capacity, has_projector, has_ac, tech_level,
  maintained_by_id, green_board, lcs_available, smart_board,
  allow_conflicts, source
FROM materialized_rooms
ON CONFLICT (id) DO UPDATE SET
  room_number = EXCLUDED.room_number,
  block = EXCLUDED.block,
  description = EXCLUDED.description,
  is_lab = EXCLUDED.is_lab,
  room_type = EXCLUDED.room_type,
  min_capacity = EXCLUDED.min_capacity,
  max_capacity = EXCLUDED.max_capacity,
  has_projector = EXCLUDED.has_projector,
  has_ac = EXCLUDED.has_ac,
  tech_level = EXCLUDED.tech_level,
  maintained_by_id = EXCLUDED.maintained_by_id,
  green_board = EXCLUDED.green_board,
  lcs_available = EXCLUDED.lcs_available,
  smart_board = EXCLUDED.smart_board,
  allow_conflicts = EXCLUDED.allow_conflicts,
  source = EXCLUDED.source;
