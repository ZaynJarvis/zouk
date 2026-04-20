-- Run once, manually, before deploying the refactor that drops config_json.
-- Promotes three fields out of the JSON blob into real columns, then drops
-- config_json. Idempotent: re-running after the column is gone is a no-op.

ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS instructions         TEXT;
ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS visibility           TEXT;
ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS max_concurrent_tasks INTEGER;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'agent_configs' AND column_name = 'config_json'
  ) THEN
    UPDATE agent_configs
       SET instructions         = COALESCE(instructions,         config_json->>'instructions'),
           visibility           = COALESCE(visibility,           config_json->>'visibility'),
           max_concurrent_tasks = COALESCE(max_concurrent_tasks, NULLIF(config_json->>'maxConcurrentTasks','')::INTEGER);
    ALTER TABLE agent_configs DROP COLUMN config_json;
  END IF;
END $$;
