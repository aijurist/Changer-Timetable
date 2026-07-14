DO $$
DECLARE
  existing_room TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM rooms WHERE upper(room_number) = 'KSL02') THEN
    UPDATE rooms SET allow_conflicts = true WHERE upper(room_number) = 'KSL02';
    RETURN;
  END IF;

  SELECT room_number INTO existing_room FROM rooms WHERE id = 189;
  IF existing_room IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot add KSL02: room id 189 already belongs to %', existing_room;
  END IF;

  INSERT INTO rooms (
    id, room_number, block, description, is_lab, room_type,
    min_capacity, max_capacity, allow_conflicts, source
  ) VALUES (
    189, 'KSL02', 'K Block', 'Computer Lab (KSL02)', true, 'Computer-Lab',
    140, 140, true, 'rooms_new.csv'
  );
END;
$$;
