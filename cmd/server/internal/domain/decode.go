package domain

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// Go zero values cannot distinguish omitted required fields from valid zeroes.
// Check presence at the JSON boundary, then let typed decoding check value types.
// Semantic checks remain in Validate and incomplete drafts can still be saved.
func decodeShape(data []byte, target any, required, optional []string) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	if fields == nil {
		return fmt.Errorf("schema: expected an object")
	}
	for _, key := range required {
		raw, ok := fields[key]
		if !ok || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
			return fmt.Errorf("schema: %s is required", key)
		}
	}
	for _, key := range optional {
		if raw, ok := fields[key]; ok && bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
			return fmt.Errorf("schema: %s cannot be null", key)
		}
		if key == "parentId" && bytes.Equal(bytes.TrimSpace(fields[key]), []byte(`""`)) {
			return fmt.Errorf("schema: parentId cannot be empty")
		}
	}
	return json.Unmarshal(data, target)
}
func (d *Document) UnmarshalJSON(data []byte) error {
	type plain Document
	return decodeShape(data, (*plain)(d), []string{"schemaVersion", "pages", "queries"}, nil)
}
func (p *Page) UnmarshalJSON(data []byte) error {
	type plain Page
	return decodeShape(data, (*plain)(p), []string{"id", "title", "components"}, nil)
}
func (c *Component) UnmarshalJSON(data []byte) error {
	type plain Component
	return decodeShape(data, (*plain)(c), []string{"id", "type", "layout", "props"}, []string{"parentId", "actions"})
}
func (l *Layout) UnmarshalJSON(data []byte) error {
	type plain Layout
	return decodeShape(data, (*plain)(l), []string{"x", "y", "w", "h"}, nil)
}
func (q *Query) UnmarshalJSON(data []byte) error {
	type plain Query
	return decodeShape(data, (*plain)(q), []string{"id", "name", "sourceId", "mode", "params", "timeoutMs", "rowLimit"}, []string{"sql", "http", "filters"})
}
func (q *SQLQuery) UnmarshalJSON(data []byte) error {
	type plain SQLQuery
	return decodeShape(data, (*plain)(q), []string{"text"}, nil)
}
func (q *HTTPQuery) UnmarshalJSON(data []byte) error {
	type plain HTTPQuery
	return decodeShape(data, (*plain)(q), []string{"method", "path"}, []string{"body", "resultPath"})
}
func (p *Param) UnmarshalJSON(data []byte) error {
	type plain Param
	return decodeShape(data, (*plain)(p), []string{"name", "type", "bind"}, nil)
}
func (f *Filter) UnmarshalJSON(data []byte) error {
	type plain Filter
	return decodeShape(data, (*plain)(f), []string{"column", "op", "param", "skipWhenEmpty"}, nil)
}
func (r *Ref) UnmarshalJSON(data []byte) error {
	type plain Ref
	return decodeShape(data, (*plain)(r), []string{"component", "prop"}, nil)
}
func (a *Action) UnmarshalJSON(data []byte) error {
	type plain Action
	return decodeShape(data, (*plain)(a), []string{"id", "label", "queryId"}, []string{"confirm", "input", "onSuccess"})
}
func (a *ActionConfirm) UnmarshalJSON(data []byte) error {
	type plain ActionConfirm
	return decodeShape(data, (*plain)(a), []string{"title", "body"}, nil)
}
func (a *ActionInput) UnmarshalJSON(data []byte) error {
	type plain ActionInput
	return decodeShape(data, (*plain)(a), []string{"formComponent"}, nil)
}
func (a *ActionSuccess) UnmarshalJSON(data []byte) error {
	type plain ActionSuccess
	return decodeShape(data, (*plain)(a), []string{"refresh"}, nil)
}
