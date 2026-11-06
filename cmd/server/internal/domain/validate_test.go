package domain

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestGoldenDocuments(t *testing.T) {
	for _, kind := range []string{"valid", "invalid"} {
		files, err := filepath.Glob("testdata/documents/" + kind + "/*.json")
		require.NoError(t, err)
		require.NotEmpty(t, files)
		for _, file := range files {
			t.Run(kind+"/"+filepath.Base(file), func(t *testing.T) {
				raw, err := os.ReadFile(file)
				require.NoError(t, err)
				var doc Document
				reason := ""
				if kind == "invalid" {
					var fixture struct {
						Reason   string          `json:"reason"`
						Document json.RawMessage `json:"document"`
					}
					require.NoError(t, json.Unmarshal(raw, &fixture))
					reason = fixture.Reason
					raw = fixture.Document
				}
				err = json.Unmarshal(raw, &doc)
				if err != nil {
					require.Equal(t, "schema", reason)
					return
				}
				problems := Validate(doc)
				if reason == "" {
					require.Empty(t, problems)
					roundtrip, err := json.Marshal(doc)
					require.NoError(t, err)
					var before, after any
					require.NoError(t, json.Unmarshal(raw, &before))
					require.NoError(t, json.Unmarshal(roundtrip, &after))
					require.Equal(t, before, after)
				} else {
					require.NotEmpty(t, problems)
					require.Equal(t, reason, problems[0].Code)
					for _, p := range problems {
						require.False(t, strings.Contains(p.Path, "["))
					}
				}
			})
		}
	}
}
func TestChangesStableEntities(t *testing.T) {
	prev, err := DemoDocument()
	require.NoError(t, err)
	raw, err := json.Marshal(prev)
	require.NoError(t, err)
	var next Document
	require.NoError(t, json.Unmarshal(raw, &next))
	next.Pages[0].Title = "Renamed"
	next.Pages[0].Components[0].Layout.W = 5
	next.Pages[0].Components[3].Actions[0].Label = "Refund now"
	next.Queries[0].SQL.Text = "select 2"
	changes := Changes(prev, next)
	require.Len(t, changes, 4)
	for i, kind := range []string{"page", "component", "action", "query"} {
		require.Equal(t, kind, changes[i].Kind)
		require.Equal(t, "changed", changes[i].Op)
	}
	require.Empty(t, Changes(prev, prev))
	require.Equal(t, "Refund now", changes[2].Label)
}
func TestExplicitLiteralNullRoundtrip(t *testing.T) {
	var bind ParamBind
	require.NoError(t, json.Unmarshal([]byte(`{"literal":null}`), &bind))
	require.True(t, bind.HasLiteral)
	raw, err := json.Marshal(bind)
	require.NoError(t, err)
	require.JSONEq(t, `{"literal":null}`, string(raw))
}
func TestSQLLexicalTokens(t *testing.T) {
	require.Equal(t, "", ValidateSQL(`WITH q AS (SELECT 'returning') UPDATE t SET x=1 RETURNING x`))
	tokens := SQLTokens(`WITH q AS (SELECT 'returning') UPDATE t SET x=1 RETURNING x`)
	require.Contains(t, tokens, SQLToken{Text: "SELECT", Depth: 1})
	require.Contains(t, tokens, SQLToken{Text: "UPDATE", Depth: 0})
	require.Contains(t, tokens, SQLToken{Text: "RETURNING", Depth: 0})
}

func TestEmptySQLIsAnIncompleteDraft(t *testing.T) {
	for _, text := range []string{"", " \t\r\n", "\u00a0"} {
		doc := EmptyDocument()
		doc.Queries = []Query{{ID: "q", Name: "q", SourceID: "ds", Mode: QueryRead, SQL: &SQLQuery{Text: text}, Params: []Param{}, TimeoutMs: 1000, RowLimit: 10}}
		require.Equal(t, []Problem{{Code: "empty_query", Path: "queries.0.sql.text", Message: "SQL cannot be empty"}}, Validate(doc))
	}
}

func TestPlaceholderWhitespaceAndLiteralValidation(t *testing.T) {
	doc := EmptyDocument()
	doc.Queries = []Query{{ID: "q", Name: "q", SourceID: "ds", Mode: QueryRead, SQL: &SQLQuery{Text: "select {{\u00a0value\u00a0}}"}, Params: []Param{{Name: "value", Type: ParamText, Bind: ParamBind{HasLiteral: true}}}, TimeoutMs: 1000, RowLimit: 10}}
	require.Equal(t, "schema", Validate(doc)[0].Code)
	doc.Queries[0].SQL.Text = "select {{\tvalue\n}}"
	require.Empty(t, Validate(doc))
	for _, text := range []string{
		`select '{{ value }}'`, `select E'escaped\'{{ value }}'`,
		`select "{{ value }}"`, `select $$ {{ value }} $$`,
		`select $tag$ {{ value }} $tag$`, "select 1 -- {{ value }}\n",
		`select 1 /* outer /* {{ value }} */ comment */`,
		`select '{{ value }}', '{{ value }}'`,
	} {
		doc.Queries[0].SQL.Text = text
		problems := Validate(doc)
		require.Len(t, problems, 1, text)
		require.Equal(t, "placeholder_in_literal", problems[0].Code, text)
		require.Equal(t, "queries.0.sql.text", problems[0].Path, text)
	}
	doc.Queries[0].Params = []Param{}
	problems := Validate(doc)
	require.Len(t, problems, 2)
	require.Equal(t, "placeholder_in_literal", problems[0].Code)
	require.Equal(t, "placeholder_without_param", problems[1].Code)
}

func TestFilterParameterTypes(t *testing.T) {
	for _, op := range []string{"eq", "neq", "contains", "gte", "lte", "in"} {
		for _, kind := range ParamTypes {
			t.Run(op+"/"+string(kind), func(t *testing.T) {
				doc := EmptyDocument()
				doc.Queries = []Query{{
					ID: "q", Name: "Query", SourceID: "ds", Mode: QueryRead,
					SQL:       &SQLQuery{Text: "SELECT status FROM orders"},
					Params:    []Param{{Name: "status", Type: kind, Bind: ParamBind{HasLiteral: true}}},
					Filters:   []Filter{{Column: "status", Op: op, Param: "status", SkipWhenEmpty: true}},
					TimeoutMs: 1000, RowLimit: 10,
				}}
				problems := Validate(doc)
				list := kind == ParamTextList || kind == ParamNumberList
				if (op == "in") == list {
					require.Empty(t, problems)
				} else {
					require.Equal(t, []Problem{{
						Code: "filter_param_type", Path: "queries.0.filters.0.param",
						Message: "Filter operator requires a matching scalar or list parameter",
					}}, problems)
				}
			})
		}
	}
}

func TestFilterValidationPathsAndOrder(t *testing.T) {
	doc := EmptyDocument()
	doc.Queries = []Query{{
		ID: "q", Name: "Query", SourceID: "ds", Mode: QueryWrite,
		SQL: &SQLQuery{Text: "UPDATE orders SET status = {{ missing }}"},
		Params: []Param{
			{Name: "unused", Type: ParamText, Bind: ParamBind{HasLiteral: true}},
			{Name: "status", Type: ParamText, Bind: ParamBind{HasLiteral: true}},
		},
		Filters: []Filter{
			{Column: "", Op: "in", Param: "status"},
			{Column: "status", Op: "eq", Param: "unknown"},
		},
		TimeoutMs: 1000, RowLimit: 10,
	}}
	problems := Validate(doc)
	require.Len(t, problems, 6)
	var codes, paths []string
	for _, problem := range problems {
		codes = append(codes, problem.Code)
		paths = append(paths, problem.Path)
	}
	require.Equal(t, []string{"placeholder_without_param", "param_without_placeholder", "filter_not_supported", "filter_param_unknown", "filter_param_type", "filter_column_invalid"}, codes)
	require.Equal(t, []string{"queries.0", "queries.0", "queries.0.filters", "queries.0.filters.1.param", "queries.0.filters.0.param", "queries.0.filters.0.column"}, paths)
	require.Equal(t, "Parameter has no placeholder or filter", problems[1].Message)

	doc.Queries[0].Filters[0].Op = "unknown"
	problems = Validate(doc)
	require.Equal(t, []Problem{{Code: "schema", Path: "queries.0.filters.0.op", Message: "Unknown filter operator"}}, problems)
}

func TestFilterColumnValidation(t *testing.T) {
	for _, tc := range []struct {
		column string
		valid  bool
	}{
		{"status", true}, {"", false}, {`sta"tus`, false}, {"sta\x00tus", false},
		{strings.Repeat("x", 63), true}, {strings.Repeat("x", 64), false},
		{strings.Repeat("界", 21), true}, {strings.Repeat("界", 22), false},
	} {
		t.Run(tc.column, func(t *testing.T) {
			doc := EmptyDocument()
			doc.Queries = []Query{{
				ID: "q", Name: "Query", SourceID: "ds", Mode: QueryRead,
				SQL:       &SQLQuery{Text: "SELECT status FROM orders"},
				Params:    []Param{{Name: "status", Type: ParamText, Bind: ParamBind{HasLiteral: true}}},
				Filters:   []Filter{{Column: tc.column, Op: "eq", Param: "status"}},
				TimeoutMs: 1000, RowLimit: 10,
			}}
			problems := Validate(doc)
			if tc.valid {
				require.Empty(t, problems)
			} else {
				require.Len(t, problems, 1)
				require.Equal(t, "filter_column_invalid", problems[0].Code)
				require.Equal(t, "queries.0.filters.0.column", problems[0].Path)
			}
		})
	}
}

func TestFilterJSONShape(t *testing.T) {
	for _, raw := range []string{
		`null`, `[]`, `{}`,
		`{"op":"eq","param":"status","skipWhenEmpty":false}`,
		`{"column":"status","param":"status","skipWhenEmpty":false}`,
		`{"column":"status","op":"eq","skipWhenEmpty":false}`,
		`{"column":"status","op":"eq","param":"status"}`,
		`{"column":null,"op":"eq","param":"status","skipWhenEmpty":false}`,
		`{"column":"status","op":null,"param":"status","skipWhenEmpty":false}`,
		`{"column":"status","op":"eq","param":null,"skipWhenEmpty":false}`,
		`{"column":"status","op":"eq","param":"status","skipWhenEmpty":null}`,
		`{"column":1,"op":"eq","param":"status","skipWhenEmpty":false}`,
		`{"column":"status","op":"eq","param":"status","skipWhenEmpty":"true"}`,
	} {
		t.Run(raw, func(t *testing.T) {
			var filter Filter
			require.Error(t, json.Unmarshal([]byte(raw), &filter))
		})
	}
	// Match decodeShape's existing policy: unknown fields are ignored.
	var filter Filter
	require.NoError(t, json.Unmarshal([]byte(`{"column":"status","op":"eq","param":"status","skipWhenEmpty":false,"unknown":true}`), &filter))
	require.Equal(t, Filter{Column: "status", Op: "eq", Param: "status"}, filter)

	for _, filters := range []string{"null", "{}", "[null]"} {
		var query Query
		raw := `{"id":"q","name":"Query","sourceId":"ds","mode":"read","sql":{"text":"SELECT 1"},"params":[],"timeoutMs":1000,"rowLimit":10,"filters":` + filters + `}`
		require.Error(t, json.Unmarshal([]byte(raw), &query))
	}
}

func TestFilterAndPlaceholderShareParameter(t *testing.T) {
	doc := EmptyDocument()
	doc.Queries = []Query{{
		ID: "q", Name: "Query", SourceID: "ds", Mode: QueryRead,
		SQL:       &SQLQuery{Text: "SELECT {{ status }} AS status"},
		Params:    []Param{{Name: "status", Type: ParamText, Bind: ParamBind{HasLiteral: true}}},
		Filters:   []Filter{{Column: "status", Op: "eq", Param: "status"}},
		TimeoutMs: 1000, RowLimit: 10,
	}}
	require.Empty(t, Validate(doc))
	doc.Queries[0].Params = []Param{}
	problems := Validate(doc)
	require.Len(t, problems, 2)
	require.Equal(t, "placeholder_without_param", problems[0].Code)
	require.Equal(t, "filter_param_unknown", problems[1].Code)
}
