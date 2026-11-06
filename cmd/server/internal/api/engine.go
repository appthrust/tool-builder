package api

import (
	"context"

	"github.com/appthrust/tool-builder/cmd/server/internal/domain"
	"github.com/appthrust/tool-builder/cmd/server/internal/engine"
)

// Engine executes queries using source credentials delivered to the workload.
// The API owns authorization; the engine enforces the read/write boundary.
type Engine interface {
	Run(context.Context, domain.RunRequest) (domain.RunResult, error)
	State(context.Context, string, domain.DataSource) domain.SourceState
	Schema(context.Context, domain.DataSource) (SourceSchema, error)
}

type SourceSchema = engine.Schema
type SchemaTable = engine.SchemaTable
type SchemaColumn = engine.SchemaColumn
