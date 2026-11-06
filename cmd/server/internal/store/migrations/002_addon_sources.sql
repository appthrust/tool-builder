ALTER TABLE data_sources ADD COLUMN definition text;
ALTER TABLE data_sources DROP CONSTRAINT data_sources_kind_check;
ALTER TABLE data_sources DROP CONSTRAINT data_sources_check;
ALTER TABLE data_sources ADD CONSTRAINT data_sources_kind_check CHECK (kind IN ('postgres','http','addon'));
ALTER TABLE data_sources ADD CONSTRAINT data_sources_check CHECK (
    (kind = 'postgres' AND connection_name IS NOT NULL AND base_url IS NULL AND definition IS NULL)
    OR (kind = 'http' AND connection_name IS NULL AND base_url IS NOT NULL AND definition IS NULL)
    OR (kind = 'addon' AND connection_name IS NULL AND base_url IS NULL AND definition IS NOT NULL AND definition <> '' AND destination_component_id = '')
);
