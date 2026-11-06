package engine

import (
	"database/sql/driver"
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/appthrust/tool-builder/cmd/server/internal/domain"
)

func TestFilterSQL(t *testing.T) {
	for _, tc := range []struct {
		name, op, column, clause string
		kind                     domain.ParamType
		skip                     bool
	}{
		{name: "eq", op: "eq", kind: domain.ParamText, clause: `_q."status" = $2::text`},
		{name: "neq", op: "neq", kind: domain.ParamText, clause: `_q."status" <> $2::text`},
		{name: "contains", op: "contains", kind: domain.ParamText, clause: `_q."status"::text ILIKE '%' || $2::text || '%'`},
		{name: "contains number", op: "contains", kind: domain.ParamNumber, clause: `_q."status"::text ILIKE '%' || $2::numeric::text || '%'`},
		{name: "gte", op: "gte", kind: domain.ParamNumber, clause: `_q."status" >= $2::numeric`},
		{name: "lte", op: "lte", kind: domain.ParamNumber, clause: `_q."status" <= $2::numeric`},
		{name: "in text", op: "in", kind: domain.ParamTextList, clause: `_q."status" = ANY($2::text[])`},
		{name: "in number", op: "in", kind: domain.ParamNumberList, clause: `_q."status" = ANY($2::numeric[])`},
		{name: "quoted identifier", op: "eq", column: `sta"tus`, kind: domain.ParamText, clause: `_q."sta""tus" = $2::text`},
		{name: "identifier punctuation", op: "eq", column: `a.b; --`, kind: domain.ParamText, clause: `_q."a.b; --" = $2::text`},
		{name: "skip text", op: "eq", kind: domain.ParamText, skip: true, clause: `($2::text IS NULL OR $2::text = '' OR _q."status" = $2::text)`},
		{name: "skip number", op: "gte", kind: domain.ParamNumber, skip: true, clause: `($2::numeric IS NULL OR _q."status" >= $2::numeric)`},
		{name: "skip boolean", op: "eq", kind: domain.ParamBoolean, skip: true, clause: `($2::boolean IS NULL OR _q."status" = $2::boolean)`},
		{name: "skip date", op: "gte", kind: domain.ParamDate, skip: true, clause: `($2::date IS NULL OR _q."status" >= $2::date)`},
		{name: "skip timestamp", op: "lte", kind: domain.ParamTimestamp, skip: true, clause: `($2::timestamptz IS NULL OR _q."status" <= $2::timestamptz)`},
		{name: "skip text list", op: "in", kind: domain.ParamTextList, skip: true, clause: `($2::text[] IS NULL OR cardinality($2::text[]) = 0 OR _q."status" = ANY($2::text[]))`},
		{name: "skip number list", op: "in", kind: domain.ParamNumberList, skip: true, clause: `($2::numeric[] IS NULL OR cardinality($2::numeric[]) = 0 OR _q."status" = ANY($2::numeric[]))`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			values, err := bindInputs([]domain.Param{{Name: "tenant", Type: domain.ParamNumber}, {Name: "value", Type: tc.kind}}, nil)
			if err != nil {
				t.Fatal(err)
			}
			text, _, err := bindSQL("SELECT status FROM orders WHERE tenant_id = {{tenant}}", values)
			if err != nil {
				t.Fatal(err)
			}
			column := tc.column
			if column == "" {
				column = "status"
			}
			got, err := filterSQL(text, []domain.Filter{{Column: column, Op: tc.op, Param: "value", SkipWhenEmpty: tc.skip}}, values)
			want := "SELECT * FROM (SELECT status FROM orders WHERE tenant_id = $1::numeric\n) AS _q WHERE " + tc.clause
			if err != nil || got != want {
				t.Fatalf("filter SQL = %q, %v; want %q", got, err, want)
			}
			if !returnsRows(got) {
				t.Fatal("wrapped query must return rows")
			}
		})
	}
}

func TestFilterSQLReusesBindings(t *testing.T) {
	values, err := bindInputs([]domain.Param{{Name: "search", Type: domain.ParamText}, {Name: "amount", Type: domain.ParamNumber}}, map[string]any{"search": "'; DROP TABLE orders; --_%", "amount": 7.0})
	if err != nil {
		t.Fatal(err)
	}
	text, args, err := bindSQL("SELECT status, amount FROM orders WHERE amount >= {{amount}} AND status <> {{search}} -- trailing comment", values)
	if err != nil {
		t.Fatal(err)
	}
	filters := []domain.Filter{
		{Column: "amount", Op: "lte", Param: "amount"},
		{Column: "status", Op: "contains", Param: "search"},
	}
	got, err := filterSQL(text, filters, values)
	want := "SELECT * FROM (SELECT status, amount FROM orders WHERE amount >= $2::numeric AND status <> $1::text -- trailing comment\n) AS _q WHERE _q.\"amount\" <= $2::numeric AND _q.\"status\"::text ILIKE '%' || $1::text || '%'"
	if err != nil || got != want {
		t.Fatalf("filter SQL = %q, %v; want %q", got, err, want)
	}
	if !reflect.DeepEqual(args, []any{"'; DROP TABLE orders; --_%", 7.0}) {
		t.Fatalf("args = %#v", args)
	}
	if strings.Contains(got, "DROP TABLE") {
		t.Fatal("bound input was spliced into SQL")
	}
	unchanged, err := filterSQL(text, nil, values)
	if err != nil || unchanged != text {
		t.Fatalf("no filters changed SQL: %q, %v", unchanged, err)
	}
}

func TestFilterSQLGolden(t *testing.T) {
	raw, err := os.ReadFile("../domain/testdata/documents/valid/filters.json")
	if err != nil {
		t.Fatal(err)
	}
	var doc domain.Document
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	if problems := domain.Validate(doc); len(problems) > 0 {
		t.Fatalf("fixture is invalid: %+v", problems)
	}
	query := doc.Queries[0]
	values, err := bindInputs(query.Params, map[string]any{"statuses": []any{"open", "shipped"}, "search": "ORD_%"})
	if err != nil {
		t.Fatal(err)
	}
	text, args, err := bindSQL(query.SQL.Text, values)
	if err != nil {
		t.Fatal(err)
	}
	text, err = filterSQL(text, query.Filters, values)
	if err != nil {
		t.Fatal(err)
	}
	want := "SELECT * FROM (SELECT number, status FROM orders ORDER BY number\n) AS _q WHERE ($1::text[] IS NULL OR cardinality($1::text[]) = 0 OR _q.\"status\" = ANY($1::text[])) AND ($2::text IS NULL OR $2::text = '' OR _q.\"number\"::text ILIKE '%' || $2::text || '%')"
	if text != want {
		t.Fatalf("fixture SQL = %q; want %q", text, want)
	}
	if len(args) != 2 || args[1] != "ORD_%" {
		t.Fatalf("args = %#v", args)
	}
	array, ok := args[0].(driver.Valuer)
	if !ok {
		t.Fatalf("array binding = %T", args[0])
	}
	encoded, err := array.Value()
	if err != nil || encoded != `{"open","shipped"}` {
		t.Fatalf("array = %#v, %v", encoded, err)
	}
	if !returnsRows(text) {
		t.Fatal("fixture wrapper must return rows")
	}
	t.Logf("wrapped fixture SQL:\n%s", text)
}
