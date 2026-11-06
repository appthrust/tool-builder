package domain

import "time"

// RunRequest is what the API hands the engine: one query of a document, the
// data source it names, and the caller-supplied inputs keyed by param name.
// Inputs are already the values bound from the screen (the SPA resolves refs);
// the engine validates and coerces them to Param.Type and binds them as
// parameters. The engine never sees a bearer except for HTTP sources, where
// Bearer is forwarded verbatim.
type RunRequest struct {
	Source DataSource
	Query  Query
	Inputs map[string]any
	// Write permits a write query. The API sets it only on the action path and
	// the confirmed editor path; the engine refuses a write query otherwise.
	Write  bool
	Bearer string
}

type Column struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

type RunResult struct {
	Columns    []Column `json:"columns"`
	Rows       [][]any  `json:"rows"`
	RowCount   int      `json:"rowCount"`
	Truncated  bool     `json:"truncated"`
	DurationMs int64    `json:"durationMs"`
}

// RunError is the typed failure of a run; Code is the API error code
// (query_not_read_only, query_timeout, query_failed, data_source_pending,
// data_source_busy, data_source_unavailable, invalid_input).
type RunError struct {
	Code    string
	Message string
	Cause   error
}

func (e *RunError) Error() string { return e.Code + ": " + e.Message }
func (e *RunError) Unwrap() error { return e.Cause }

// SourceState is what the engine reports about a data source at runtime.
type SourceState struct {
	Status  DataSourceStatus
	Message string
	Checked time.Time
}
