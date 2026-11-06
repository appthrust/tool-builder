package engine

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/appthrust/tool-builder/cmd/server/internal/domain"
)

const responseLimit = 1 << 20

func (e *Engine) runHTTP(ctx context.Context, req domain.RunRequest, values map[string]boundValue, s *source) (domain.RunResult, error) {
	result := domain.RunResult{Columns: []domain.Column{}, Rows: [][]any{}}
	q := req.Query.HTTP
	if q == nil || req.Query.SQL != nil {
		return result, failure("invalid_input", "HTTP queries require an HTTP request", nil)
	}
	switch q.Method {
	case http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
	default:
		return result, failure("invalid_input", "Unsupported HTTP method", nil)
	}
	if req.Query.Mode == domain.QueryRead && q.Method != http.MethodGet {
		return result, failure("query_not_read_only", "Read HTTP queries must use GET", nil)
	}
	path, err := interpolate(q.Path, values, func(v boundValue) (string, error) {
		var text string
		if str, ok := v.value.(string); ok {
			text = str
		} else {
			encoded, err := json.Marshal(v.value)
			if err != nil {
				return "", err
			}
			text = string(encoded)
		}
		// Escape query delimiters too: path templates can include a query string.
		return strings.ReplaceAll(url.QueryEscape(text), "+", "%20"), nil
	})
	if err != nil {
		return result, err
	}
	origin, err := e.resolvers[req.Source.Kind].Endpoint(ctx, req.Bearer, req.Source)
	if err != nil {
		return result, err
	}
	endpoint, err := sourceEndpoint(origin, path)
	if err != nil {
		return result, err
	}
	body, err := interpolate(q.Body, values, func(v boundValue) (string, error) {
		encoded, err := json.Marshal(v.value)
		return string(encoded), err
	})
	if err != nil {
		return result, err
	}
	if body != "" && !json.Valid([]byte(body)) {
		return result, failure("invalid_input", "HTTP body must be valid JSON after binding", nil)
	}
	ctx, cancel := context.WithTimeout(ctx, queryTimeout(req.Query))
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, q.Method, endpoint, strings.NewReader(body))
	if err != nil {
		return result, failure("invalid_input", "Invalid HTTP request", err)
	}
	request.Header.Set("Authorization", req.Bearer)
	request.Header.Set("Accept", "application/json")
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := e.http.Do(request)
	if err != nil {
		s.setHTTPState(domain.SourceError, "Data source request failed")
		if errors.Is(err, context.DeadlineExceeded) || ctx.Err() == context.DeadlineExceeded {
			return result, failure("query_timeout", "Query exceeded its timeout", err)
		}
		return result, failure("query_failed", "HTTP request failed (redirects are not allowed)", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		s.setHTTPState(domain.SourceError, "Data source returned an HTTP error")
		return result, failure("query_failed", fmt.Sprintf("HTTP source returned status %d", response.StatusCode), nil)
	}
	s.setHTTPState(domain.SourceReady, "")
	if response.ContentLength > responseLimit {
		return result, failure("query_failed", "HTTP response exceeds 1 MiB", nil)
	}
	payload, err := io.ReadAll(io.LimitReader(response.Body, responseLimit+1))
	if err != nil {
		return result, sqlFailure(err)
	}
	if len(payload) > responseLimit {
		return result, failure("query_failed", "HTTP response exceeds 1 MiB", nil)
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return result, failure("query_failed", "HTTP response must be a JSON object or array", err)
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return result, failure("query_failed", "HTTP response must contain one JSON value", err)
	}
	if q.ResultPath != "" {
		for _, part := range strings.Split(q.ResultPath, ".") {
			object, ok := value.(map[string]any)
			if !ok || part == "" {
				return result, failure("query_failed", "HTTP resultPath does not select an array", nil)
			}
			value = object[part]
		}
		if _, ok := value.([]any); !ok {
			return result, failure("query_failed", "HTTP resultPath does not select an array", nil)
		}
	}
	var items []any
	switch v := value.(type) {
	case map[string]any:
		items = []any{v}
	case []any:
		items = v
	default:
		return result, failure("query_failed", "HTTP response must be a JSON object or array", nil)
	}
	columns := make(map[string]string)
	for i, item := range items {
		row, ok := item.(map[string]any)
		if !ok {
			return result, failure("query_failed", "HTTP result rows must be JSON objects", nil)
		}
		if i < 50 {
			for key, value := range row {
				if old, exists := columns[key]; !exists || old == "null" {
					columns[key] = jsonType(value)
				}
			}
		}
	}
	names := make([]string, 0, len(columns))
	for name := range columns {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		result.Columns = append(result.Columns, domain.Column{Name: name, Type: columns[name]})
	}
	limit := rowLimit(req.Query)
	result.Truncated = len(items) > limit
	result.RowCount = min(len(items), limit)
	if req.Query.Mode == domain.QueryWrite {
		result.RowCount = len(items)
	}
	for _, item := range items[:min(len(items), limit)] {
		object := item.(map[string]any)
		row := make([]any, len(names))
		for i, name := range names {
			row[i] = object[name]
		}
		result.Rows = append(result.Rows, row)
	}
	return result, nil
}

func sourceEndpoint(origin, path string) (string, error) {
	base, err := url.Parse(origin)
	if err != nil || (base.Scheme != "http" && base.Scheme != "https") || base.Host == "" || base.User != nil || base.RawQuery != "" || base.Fragment != "" {
		return "", failure("data_source_unavailable", "HTTP data source has an invalid endpoint", nil)
	}
	relative, err := url.Parse(path)
	if err != nil || !strings.HasPrefix(path, "/") || strings.HasPrefix(path, "//") || relative.IsAbs() || relative.Host != "" || relative.Fragment != "" {
		return "", failure("invalid_input", "HTTP path must be relative to the data source", nil)
	}
	// Do not ResolveReference: a query must never replace the platform-owned host.
	return strings.TrimRight(base.String(), "/") + path, nil
}

func (s *source) setHTTPState(status domain.DataSourceStatus, message string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state = domain.SourceState{Status: status, Message: message, Checked: time.Now().UTC()}
}

func jsonType(value any) string {
	switch value.(type) {
	case nil:
		return "null"
	case bool:
		return "boolean"
	case json.Number, float64:
		return "number"
	case string:
		return "string"
	case []any:
		return "array"
	default:
		return "object"
	}
}
