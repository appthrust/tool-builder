-- The migration runner holds a transaction and writer lock across this cutover.
-- Drop both checks before rewriting populated rows; validate the new shape below.
ALTER TABLE data_sources DROP CONSTRAINT IF EXISTS data_sources_kind_check;
ALTER TABLE data_sources DROP CONSTRAINT IF EXISTS data_sources_check;

UPDATE data_sources SET kind = 'builtin-app' WHERE kind = 'addon';

ALTER TABLE data_sources ADD CONSTRAINT data_sources_kind_check CHECK (kind IN ('postgres','http','builtin-app'));
ALTER TABLE data_sources ADD CONSTRAINT data_sources_check CHECK (
    (kind = 'postgres' AND connection_name IS NOT NULL AND base_url IS NULL AND definition IS NULL)
    OR (kind = 'http' AND connection_name IS NULL AND base_url IS NOT NULL AND definition IS NULL)
    OR (kind = 'builtin-app' AND connection_name IS NULL AND base_url IS NULL AND definition IS NOT NULL AND definition <> '' AND destination_component_id = '')
);
