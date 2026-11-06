package engine

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/appthrust/tool-builder/cmd/server/internal/domain"
	"github.com/lib/pq"
)

func postgresSource() domain.DataSource {
	connection := "orders-db"
	return domain.DataSource{ID: "orders", Kind: domain.SourcePostgres, ConnectionName: &connection}
}

func readRequest(text string) domain.RunRequest {
	return domain.RunRequest{Source: postgresSource(), Query: domain.Query{Mode: domain.QueryRead, SQL: &domain.SQLQuery{Text: text}, TimeoutMs: 1000, RowLimit: 10}}
}

func requireCode(t *testing.T, err error, code string) *domain.RunError {
	t.Helper()
	var runErr *domain.RunError
	if !errors.As(err, &runErr) || runErr.Code != code {
		t.Fatalf("error = %v, want %s", err, code)
	}
	return runErr
}

func TestPendingAndWriteAuthority(t *testing.T) {
	lookups := 0
	e := New(func(key string) (string, bool) {
		lookups++
		if key != "ORDERS_DB_URL" {
			t.Fatalf("env key = %q", key)
		}
		return "", false
	}, nil, nil)
	t.Cleanup(func() { _ = e.Close() })
	req := readRequest("insert into orders values (1)")
	req.Query.Mode = domain.QueryWrite
	_, err := e.Run(context.Background(), req)
	requireCode(t, err, "query_not_read_only")
	if lookups != 0 {
		t.Fatal("write without authority touched data source")
	}
	req.Query.Mode = domain.QueryRead
	_, err = e.Run(context.Background(), req)
	requireCode(t, err, "data_source_pending")
	if state := e.State(context.Background(), req.Bearer, req.Source); state.Status != domain.SourcePending {
		t.Fatalf("state = %+v", state)
	}
}

func TestConnectionFailuresAreCachedAndSanitized(t *testing.T) {
	e := New(func(string) (string, bool) {
		return "postgres://user:secret@127.0.0.1:1/orders?sslmode=disable&connect_timeout=1", true
	}, nil, nil)
	t.Cleanup(func() { _ = e.Close() })
	_, err := e.Run(context.Background(), readRequest("select 1"))
	re := requireCode(t, err, "data_source_unavailable")
	if strings.Contains(re.Message, "secret") || strings.Contains(re.Message, "postgres://") {
		t.Fatal("credential leaked")
	}
	s, err := e.source(postgresSource())
	if err != nil {
		t.Fatal(err)
	}
	before := s.state.Checked
	_, err = e.Run(context.Background(), readRequest("select 1"))
	requireCode(t, err, "data_source_unavailable")
	if !s.state.Checked.Equal(before) {
		t.Fatal("failure was not cached")
	}
	if state := e.State(context.Background(), "", postgresSource()); state.Status != domain.SourceError {
		t.Fatalf("state = %+v", state)
	}
}

func TestSQLGuardsBeforeConnection(t *testing.T) {
	e := New(func(string) (string, bool) { t.Fatal("invalid SQL reached connection"); return "", false }, nil, nil)
	t.Cleanup(func() { _ = e.Close() })
	for _, text := range []string{"", " \t\n", "select $1", "select 1; select 2", "select 1;", "select 'unclosed"} {
		t.Run(text, func(t *testing.T) {
			_, err := e.Run(context.Background(), readRequest(text))
			requireCode(t, err, "invalid_input")
		})
	}
}

func TestFilterGuardsBeforeConnection(t *testing.T) {
	e := New(func(string) (string, bool) {
		t.Fatal("invalid filter reached connection")
		return "", false
	}, nil, nil)
	t.Cleanup(func() { _ = e.Close() })
	for _, tc := range []struct {
		name, op, param, message string
		mode                     domain.QueryMode
	}{
		{"write", "eq", "status", "Filters require a read SQL query", domain.QueryWrite},
		{"unknown param", "eq", "missing", "Undeclared parameter missing", domain.QueryRead},
		{"unknown op", "unknown", "status", "Unknown filter operator unknown", domain.QueryRead},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := readRequest("SELECT status FROM orders")
			req.Query.Mode, req.Write = tc.mode, true
			req.Query.Params = []domain.Param{{Name: "status", Type: domain.ParamText}}
			req.Query.Filters = []domain.Filter{{Column: "status", Op: tc.op, Param: tc.param}}
			_, err := e.Run(context.Background(), req)
			re := requireCode(t, err, "invalid_input")
			if re.Message != tc.message {
				t.Fatalf("message = %q, want %q", re.Message, tc.message)
			}
		})
	}
}

func TestTypedBindings(t *testing.T) {
	cases := []struct {
		kind        domain.ParamType
		input, want any
	}{
		{domain.ParamText, "O'Reilly", "O'Reilly"},
		{domain.ParamNumber, "9007199254740993.25", json.Number("9007199254740993.25")},
		{domain.ParamNumber, 1.5, 1.5},
		{domain.ParamBoolean, true, true},
		{domain.ParamDate, "2026-10-14", "2026-10-14"},
		{domain.ParamTimestamp, "2026-10-14T12:30:00+09:00", "2026-10-14T12:30:00+09:00"},
		{domain.ParamTextList, []any{"paid", "new"}, []string{"paid", "new"}},
		{domain.ParamNumberList, []any{json.Number("2.5"), 4.0, "6"}, []float64{2.5, 4, 6}},
		{domain.ParamText, nil, nil},
	}
	for _, tc := range cases {
		got, err := coerce(tc.kind, tc.input)
		if err != nil || !reflect.DeepEqual(got, tc.want) {
			t.Fatalf("coerce(%s, %#v) = %#v, %v", tc.kind, tc.input, got, err)
		}
	}
	for _, tc := range []struct {
		kind  domain.ParamType
		value any
	}{
		{domain.ParamText, 1}, {domain.ParamNumber, "NaN"}, {domain.ParamNumber, math.Inf(1)},
		{domain.ParamBoolean, "true"}, {domain.ParamDate, "2026-02-30"}, {domain.ParamTimestamp, "2026-10-14"},
		{domain.ParamTextList, []any{"ok", 3}}, {domain.ParamNumberList, []any{nil}}, {domain.ParamNumberList, []float64{math.NaN()}},
	} {
		_, err := bindInputs([]domain.Param{{Name: "customer", Type: tc.kind}}, map[string]any{"customer": tc.value})
		re := requireCode(t, err, "invalid_input")
		if !strings.Contains(re.Message, "customer") {
			t.Fatal("missing parameter name")
		}
	}
}

func TestBindOrderAndRepeatedNames(t *testing.T) {
	values, err := bindInputs([]domain.Param{{Name: "second", Type: domain.ParamNumber}, {Name: "first", Type: domain.ParamText}}, map[string]any{"first": "safe", "second": 7.0})
	if err != nil {
		t.Fatal(err)
	}
	text, args, err := bindSQL("select {{ first }}, {{second}}, {{\tfirst\n}}", values)
	if err != nil || text != "select $2::text, $1::numeric, $2::text" || !reflect.DeepEqual(args, []any{7.0, "safe"}) {
		t.Fatalf("bind = %q %#v %v", text, args, err)
	}
	_, _, err = bindSQL("select {{ missing }}", values)
	requireCode(t, err, "invalid_input")
}

func TestSQLPlaceholderWhitespaceAndLiteralParity(t *testing.T) {
	values, err := bindInputs([]domain.Param{{Name: "value", Type: domain.ParamText}}, map[string]any{"value": "safe"})
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = bindSQL("select {{\u00a0value\u00a0}}", values)
	requireCode(t, err, "invalid_input")
	for _, literal := range []string{
		`'{{ value }}'`, `E'escaped\'{{ value }}'`, `"{{ value }}"`,
		`$$ {{ value }} $$`, `$tag$ {{ value }} $tag$`,
		"1 -- {{ value }}\n", `1 /* outer /* {{ value }} */ comment */`,
	} {
		t.Run(literal, func(t *testing.T) {
			text := "select {{ value }}, " + literal
			bound, args, err := bindSQL(text, values)
			if err != nil || bound != "select $1::text, "+literal || !reflect.DeepEqual(args, []any{"safe"}) {
				t.Fatalf("bind = %q %#v %v", bound, args, err)
			}
			e := New(func(string) (string, bool) {
				t.Fatal("literal placeholder reached connection")
				return "", false
			}, nil, nil)
			defer e.Close()
			_, err = e.Run(context.Background(), readRequest(text))
			requireCode(t, err, "invalid_input")
		})
	}
}

func TestSemaphoreBusyAndCancellation(t *testing.T) {
	e := New(func(string) (string, bool) { t.Fatal("busy request reached connection"); return "", false }, nil, nil)
	t.Cleanup(func() { _ = e.Close() })
	s, err := e.source(postgresSource())
	if err != nil {
		t.Fatal(err)
	}
	for range sourceConcurrency {
		s.sem <- struct{}{}
	}
	start := time.Now()
	_, err = e.Run(context.Background(), readRequest("select 1"))
	requireCode(t, err, "data_source_busy")
	if time.Since(start) < sourceWait {
		t.Fatal("busy result did not wait for a slot")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = e.Run(ctx, readRequest("select 1"))
	requireCode(t, err, "query_failed")
	for range sourceConcurrency {
		s.release()
	}
	if err := s.acquire(context.Background()); err != nil {
		t.Fatal(err)
	}
	s.release()
}

func TestReturnsRowsClassification(t *testing.T) {
	for text, want := range map[string]bool{
		"insert into t values (1)":                               false,
		"insert into t values ('RETURNING') /* RETURNING */":     false,
		"insert into t values ({{returning}})":                   false,
		"update t set my$returning = 1":                          false,
		"update t set my$returning = 1 returning id":             true,
		"update t set label = $tag$RETURNING$tag$":               false,
		"insert into t values (1) returning id":                  true,
		"with q as (select 1) update t set x = 1":                false,
		"with q as (delete from t returning id) select * from q": true,
		"select 1": true, "values (1)": true, "show work_mem": true,
	} {
		if got := returnsRows(text); got != want {
			t.Errorf("returnsRows(%q) = %v", text, got)
		}
	}
}

func TestArrayEncoding(t *testing.T) {
	for _, tc := range []struct {
		kind, text string
		want       []any
	}{
		{"text", `{"comma,quote\"",NULL,"NULL",""}`, []any{"comma,quote\"", nil, "NULL", ""}},
		{"int4", `{{1,2},{3,4}}`, []any{[]any{int64(1), int64(2)}, []any{int64(3), int64(4)}}},
		{"numeric", `[2:3]={1.20,2.30}`, []any{"1.20", "2.30"}},
		{"bytea", `{"\\x01"}`, []any{nil}},
		{"bool", `{t,f,NULL}`, []any{true, false, nil}},
		{"text", `{}`, []any{}},
	} {
		got, err := decodeArray(tc.kind, tc.text)
		if err != nil || !reflect.DeepEqual(got, tc.want) {
			t.Fatalf("decodeArray(%s, %s) = %#v, %v", tc.kind, tc.text, got, err)
		}
	}
}

func TestPostgresErrorMessages(t *testing.T) {
	err := sqlFailure(&pq.Error{Code: "42601", Message: "syntax error near bad_token"})
	if err.Code != "query_failed" || err.Message != "syntax error near bad_token" {
		t.Fatalf("error = %+v", err)
	}
	redacted := sqlFailure(&pq.Error{Message: "cannot use postgres://user:secret@host/db password='secret'\nstatement"})
	if strings.Contains(redacted.Message, "secret") || strings.Contains(redacted.Message, "\n") {
		t.Fatalf("not sanitized: %s", redacted.Message)
	}
}
