package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/appthrust/tool-builder/cmd/server/internal/domain"
)

func httpRequest(base string) domain.RunRequest {
	return domain.RunRequest{
		Source: domain.DataSource{ID: "app", Kind: domain.SourceHTTP, BaseURL: &base},
		Query:  domain.Query{Mode: domain.QueryRead, HTTP: &domain.HTTPQuery{Method: "GET", Path: "/orders"}, TimeoutMs: 1000, RowLimit: 10},
		Bearer: "Bearer original-user-token",
	}
}

func TestHTTPBindingsAndBearer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer original-user-token" {
			t.Errorf("authorization = %q", got)
		}
		if r.Method != http.MethodPost || r.URL.EscapedPath() != "/orders/a%2Fb%20%26%3F%23%2B" || r.URL.Query().Get("q") != "a/b &?#+" || r.URL.Query().Get("evil") != "" {
			t.Errorf("request = %s %s", r.Method, r.RequestURI)
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Error("missing JSON content type")
		}
		var body map[string]any
		decoder := json.NewDecoder(r.Body)
		decoder.UseNumber()
		if err := decoder.Decode(&body); err != nil {
			t.Error(err)
		}
		want := map[string]any{"name": "a/b &?#+", "amount": json.Number("9007199254740993.25"), "enabled": true, "missing": nil, "labels": []any{"x", "y"}}
		if !reflect.DeepEqual(body, want) {
			t.Errorf("body = %#v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"data":{"items":[{"id":1,"status":"new"},{"id":2,"note":"ok"}]}}`)
	}))
	defer server.Close()
	e := New(nil, server.Client(), nil)
	defer func() { _ = e.Close() }()
	req := httpRequest(server.URL)
	req.Query.Mode, req.Write = domain.QueryWrite, true
	req.Query.HTTP = &domain.HTTPQuery{Method: "POST", Path: "/orders/{{ name }}?q={{name}}", Body: `{"name":{{name}},"amount":{{amount}},"enabled":{{enabled}},"missing":{{missing}},"labels":{{labels}}}`, ResultPath: "data.items"}
	req.Query.Params = []domain.Param{{Name: "name", Type: domain.ParamText}, {Name: "amount", Type: domain.ParamNumber}, {Name: "enabled", Type: domain.ParamBoolean}, {Name: "missing", Type: domain.ParamText}, {Name: "labels", Type: domain.ParamTextList}}
	req.Inputs = map[string]any{"name": "a/b &?#+", "amount": "9007199254740993.25", "enabled": true, "labels": []any{"x", "y"}}
	result, err := e.Run(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if result.RowCount != 2 || !reflect.DeepEqual(result.Columns, []domain.Column{{Name: "id", Type: "number"}, {Name: "note", Type: "string"}, {Name: "status", Type: "string"}}) {
		t.Fatalf("result = %+v", result)
	}
	if !reflect.DeepEqual(result.Rows, [][]any{{json.Number("1"), nil, "new"}, {json.Number("2"), "ok", nil}}) {
		t.Fatalf("rows = %#v", result.Rows)
	}
}

func TestHTTPRefusesRedirect(t *testing.T) {
	var calls atomic.Int64
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); _, _ = io.WriteString(w, `[]`) }))
	defer target.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, http.StatusFound) }))
	defer server.Close()
	client := server.Client()
	e := New(nil, client, nil)
	defer func() { _ = e.Close() }()
	_, err := e.Run(context.Background(), httpRequest(server.URL))
	requireCode(t, err, "query_failed")
	if calls.Load() != 0 {
		t.Fatal("redirect target received the user's bearer")
	}
	if client.CheckRedirect != nil {
		t.Fatal("mutated caller's HTTP client")
	}
}

func TestHTTPResponseContract(t *testing.T) {
	cases := []struct {
		name, body, path string
		status           int
		code             string
	}{
		{"not JSON", "hello", "", 200, "query_failed"},
		{"scalar", "true", "", 200, "query_failed"},
		{"null", "null", "", 200, "query_failed"},
		{"trailing", "[] {}", "", 200, "query_failed"},
		{"array scalar", "[1,2]", "", 200, "query_failed"},
		{"missing path", `{"data":{}}`, "data.items", 200, "query_failed"},
		{"object path", `{"data":{"items":{}}}`, "data.items", 200, "query_failed"},
		{"bad status", `{"error":"secret internal failure"}`, "", 500, "query_failed"},
		{"too large", `{"text":"` + strings.Repeat("x", responseLimit) + `"}`, "", 200, "query_failed"},
		{"one object", `{"id":1}`, "", 200, ""},
		{"empty array", `[]`, "", 200, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.status)
				_, _ = io.WriteString(w, tc.body)
			}))
			defer server.Close()
			e := New(nil, server.Client(), nil)
			defer func() { _ = e.Close() }()
			req := httpRequest(server.URL)
			req.Query.HTTP.ResultPath = tc.path
			result, err := e.Run(context.Background(), req)
			if tc.code != "" {
				requireCode(t, err, tc.code)
			} else if err != nil {
				t.Fatal(err)
			} else if result.Columns == nil || result.Rows == nil {
				t.Fatal("empty results must encode as arrays, not null")
			}
		})
	}
}

func TestHTTPTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
	defer server.Close()
	e := New(nil, server.Client(), nil)
	defer func() { _ = e.Close() }()
	req := httpRequest(server.URL)
	req.Query.TimeoutMs = 20
	_, err := e.Run(context.Background(), req)
	requireCode(t, err, "query_timeout")
	if state := e.State(context.Background(), req.Bearer, req.Source); state.Status != domain.SourceError {
		t.Fatalf("state = %+v", state)
	}
}

func TestHTTPHostAndMethodBoundary(t *testing.T) {
	var calls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); _, _ = io.WriteString(w, `[]`) }))
	defer server.Close()
	e := New(nil, server.Client(), nil)
	defer func() { _ = e.Close() }()
	for _, path := range []string{"https://external.invalid/data", "//external.invalid/data", "/data#fragment"} {
		req := httpRequest(server.URL)
		req.Query.HTTP.Path = path
		_, err := e.Run(context.Background(), req)
		requireCode(t, err, "invalid_input")
	}
	req := httpRequest(server.URL)
	req.Query.HTTP.Method = "DELETE"
	_, err := e.Run(context.Background(), req)
	requireCode(t, err, "query_not_read_only")
	if calls.Load() != 0 {
		t.Fatal("invalid request reached HTTP source")
	}
}

func TestHTTPColumnsAndTruncation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		items := make([]map[string]any, 51)
		for i := range items {
			items[i] = map[string]any{"id": i}
		}
		items[49]["last_sample"] = true
		items[50]["outside_sample"] = true
		_ = json.NewEncoder(w).Encode(items)
	}))
	defer server.Close()
	e := New(nil, server.Client(), nil)
	defer func() { _ = e.Close() }()
	req := httpRequest(server.URL)
	req.Query.RowLimit = 2
	result, err := e.Run(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Columns) != 2 || result.Columns[1].Name != "last_sample" || result.RowCount != 2 || len(result.Rows) != 2 || !result.Truncated {
		t.Fatalf("result = %+v", result)
	}
}

func TestHTTPChunkedResponseLimit(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.(http.Flusher).Flush()
		_, _ = fmt.Fprintf(w, `{"text":"%s"}`, strings.Repeat("x", responseLimit))
	}))
	defer server.Close()
	e := New(nil, server.Client(), nil)
	defer func() { _ = e.Close() }()
	_, err := e.Run(context.Background(), httpRequest(server.URL))
	requireCode(t, err, "query_failed")
}
