package engine

import (
	"context"
	"database/sql"

	"github.com/appthrust/tool-builder/cmd/server/internal/domain"
)

// Schema mirrors the SPA SourceSchema contract; the API aliases these DTOs.
type Schema struct {
	Tables []SchemaTable `json:"tables"`
}

type SchemaTable struct {
	Schema  string         `json:"schema"`
	Name    string         `json:"name"`
	Kind    string         `json:"kind"`
	Columns []SchemaColumn `json:"columns"`
}

type SchemaColumn struct {
	Name       string `json:"name"`
	Type       string `json:"type"`
	Nullable   bool   `json:"nullable"`
	PrimaryKey bool   `json:"primaryKey"`
}

func (e *Engine) Schema(ctx context.Context, ds domain.DataSource) (Schema, error) {
	result := Schema{Tables: []SchemaTable{}}
	if ds.Kind != domain.SourcePostgres {
		return result, failure("invalid_input", "Schema is only available for PostgreSQL sources", nil)
	}
	s, err := e.source(ds)
	if err != nil {
		return result, err
	}
	if err := s.acquire(ctx); err != nil {
		return result, err
	}
	defer s.release()
	ctx, cancel := context.WithTimeout(ctx, domain.DefaultQueryTimeout)
	defer cancel()
	db, err := e.database(ctx, ds, s)
	if err != nil {
		return result, err
	}
	tx, err := begin(ctx, db, true, domain.DefaultQueryTimeout)
	if err != nil {
		return result, sqlFailure(err)
	}
	defer func() { _ = tx.Rollback() }()
	rows, err := tx.QueryContext(ctx, schemaSQL)
	if err != nil {
		return result, sqlFailure(err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var schema, table, kind string
		var name, dataType sql.NullString
		var nullable sql.NullBool
		var primary bool
		if err := rows.Scan(&schema, &table, &kind, &name, &dataType, &nullable, &primary); err != nil {
			return result, sqlFailure(err)
		}
		if len(result.Tables) == 0 || result.Tables[len(result.Tables)-1].Schema != schema || result.Tables[len(result.Tables)-1].Name != table {
			result.Tables = append(result.Tables, SchemaTable{Schema: schema, Name: table, Kind: kind, Columns: []SchemaColumn{}})
		}
		if name.Valid {
			i := len(result.Tables) - 1
			result.Tables[i].Columns = append(result.Tables[i].Columns, SchemaColumn{Name: name.String, Type: dataType.String, Nullable: nullable.Bool, PrimaryKey: primary})
		}
	}
	if err := rows.Err(); err != nil {
		return result, sqlFailure(err)
	}
	if err := rows.Close(); err != nil {
		return result, sqlFailure(err)
	}
	if err := tx.Rollback(); err != nil {
		return result, sqlFailure(err)
	}
	return result, nil
}

const schemaSQL = `
WITH tables AS (
  SELECT table_schema, table_name, table_type
  FROM information_schema.tables
  WHERE table_schema <> 'information_schema' AND table_schema !~ '^pg_'
  ORDER BY table_schema, table_name
  LIMIT 500
)
SELECT t.table_schema, t.table_name,
       CASE WHEN t.table_type = 'VIEW' THEN 'view' ELSE 'table' END,
       c.column_name,
       CASE WHEN c.data_type = 'ARRAY' THEN substring(c.udt_name from 2) || '[]'
            WHEN c.data_type = 'USER-DEFINED' THEN c.udt_name ELSE c.data_type END,
       c.is_nullable = 'YES',
       EXISTS (
         SELECT 1
         FROM pg_catalog.pg_namespace n
         JOIN pg_catalog.pg_class r ON r.relnamespace = n.oid
         JOIN pg_catalog.pg_attribute a ON a.attrelid = r.oid
         JOIN pg_catalog.pg_index i ON i.indrelid = r.oid AND i.indisprimary
         CROSS JOIN LATERAL generate_series(0, i.indnkeyatts - 1) AS key(position)
         WHERE n.nspname = t.table_schema AND r.relname = t.table_name
           AND a.attname = c.column_name AND a.attnum = i.indkey[key.position]
       )
FROM tables t
LEFT JOIN information_schema.columns c
  ON c.table_schema = t.table_schema AND c.table_name = t.table_name
ORDER BY t.table_schema, t.table_name, c.ordinal_position`
