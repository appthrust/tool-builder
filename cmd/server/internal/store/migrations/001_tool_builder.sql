CREATE TABLE data_sources (
    id text PRIMARY KEY,
    slug text NOT NULL UNIQUE,
    kind text NOT NULL CHECK (kind IN ('postgres','http')),
    name text NOT NULL,
    connection_name text UNIQUE,
    destination_component_id text NOT NULL,
    base_url text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL,
    CHECK ((kind = 'postgres' AND connection_name IS NOT NULL AND base_url IS NULL)
        OR (kind = 'http' AND connection_name IS NULL AND base_url IS NOT NULL))
);
CREATE TABLE tools (
    id text PRIMARY KEY,
    slug text NOT NULL UNIQUE,
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    draft jsonb NOT NULL,
    draft_version text NOT NULL,
    draft_updated_at timestamptz NOT NULL,
    draft_updated_by text NOT NULL,
    live_release_id text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL,
    archived_at timestamptz
);
CREATE TABLE releases (
    id text PRIMARY KEY,
    tool_id text NOT NULL REFERENCES tools(id),
    number integer NOT NULL CHECK (number > 0),
    document jsonb NOT NULL,
    note text NOT NULL,
    changes jsonb NOT NULL,
    published_subject text NOT NULL,
    published_name text NOT NULL,
    published_at timestamptz NOT NULL,
    restored_from integer,
    UNIQUE (tool_id, number),
    UNIQUE (tool_id, id)
);
ALTER TABLE tools ADD CONSTRAINT tools_live_release_fk FOREIGN KEY (id,live_release_id) REFERENCES releases(tool_id,id);
CREATE TABLE group_grants (
    tool_id text NOT NULL REFERENCES tools(id),
    group_id text NOT NULL,
    role text NOT NULL CHECK (role IN ('use','edit')),
    PRIMARY KEY (tool_id,group_id)
);
-- One row per constrained action preserves the meaning of an empty group set:
-- present and empty denies everybody; absent permits every tool user.
CREATE TABLE action_grants (
    tool_id text NOT NULL REFERENCES tools(id),
    action_id text NOT NULL,
    group_ids jsonb NOT NULL,
    PRIMARY KEY (tool_id,action_id)
);
CREATE TABLE action_runs (
    id text PRIMARY KEY,
    tool_id text NOT NULL REFERENCES tools(id),
    release_id text REFERENCES releases(id),
    release_number integer NOT NULL,
    action_id text NOT NULL,
    action_label text NOT NULL,
    query_id text NOT NULL,
    subject text NOT NULL,
    display_name text NOT NULL,
    person_id text,
    params_hash text NOT NULL,
    status text NOT NULL CHECK (status IN ('ok','failed','denied')),
    row_count integer,
    error text,
    started_at timestamptz NOT NULL,
    finished_at timestamptz NOT NULL
);
CREATE INDEX action_runs_tool_started ON action_runs(tool_id,started_at DESC);
CREATE INDEX action_runs_retention ON action_runs(started_at);
