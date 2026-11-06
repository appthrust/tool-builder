package engine

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/appthrust/appserver-go/appserver/pgstore/testutil"
	"github.com/appthrust/tool-builder/cmd/server/internal/domain"
)

func testDatabase(t *testing.T) (*Engine, *sql.DB) {
	t.Helper()
	db, dsn := testutil.Database(t, func(ctx context.Context, dsn string) (*sql.DB, error) {
		db, err := sql.Open("postgres", dsn)
		if err != nil {
			return nil, err
		}
		if err := db.PingContext(ctx); err != nil {
			_ = db.Close()
			return nil, err
		}
		return db, nil
	})
	e := New(func(key string) (string, bool) { return dsn, key == "ORDERS_DB_URL" }, nil, nil)
	t.Cleanup(func() {
		if err := e.Close(); err != nil {
			t.Error(err)
		}
	})
	return e, db
}

func execFixture(t *testing.T, db *sql.DB, text string) {
	t.Helper()
	if _, err := db.ExecContext(context.Background(), text); err != nil {
		t.Fatal(err)
	}
}

func runSQL(t *testing.T, e *Engine, req domain.RunRequest) domain.RunResult {
	t.Helper()
	result, err := e.Run(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestPostgresReadOnlyAndWrite(t *testing.T) {
	e, db := testDatabase(t)
	execFixture(t, db, `CREATE TABLE orders (id integer PRIMARY KEY, status text NOT NULL)`)
	for _, text := range []string{
		`INSERT INTO orders VALUES (1, 'new')`,
		`WITH changed AS (INSERT INTO orders VALUES (1, 'new') RETURNING *) SELECT * FROM changed`,
	} {
		_, err := e.Run(context.Background(), readRequest(text))
		requireCode(t, err, "query_not_read_only")
	}
	req := readRequest(`INSERT INTO orders VALUES (1, 'new'), (2, 'paid'), (3, 'new')`)
	req.Query.Mode, req.Write = domain.QueryWrite, true
	result := runSQL(t, e, req)
	if result.RowCount != 3 || len(result.Rows) != 0 {
		t.Fatalf("insert = %+v", result)
	}
	req.Query.SQL.Text = `WITH old AS (SELECT id FROM orders) UPDATE orders SET status = 'paid' WHERE id IN (SELECT id FROM old) RETURNING id`
	req.Query.RowLimit = 1
	result = runSQL(t, e, req)
	if result.RowCount != 3 || len(result.Rows) != 1 || !result.Truncated {
		t.Fatalf("returning = %+v", result)
	}
	result = runSQL(t, e, readRequest(`SELECT count(*) FROM orders WHERE status = 'paid'`))
	if result.Rows[0][0] != int64(3) {
		t.Fatalf("write not committed: %+v", result)
	}
	execFixture(t, db, `ALTER TABLE orders ADD COLUMN my$returning integer`)
	req.Query.SQL.Text = `UPDATE orders SET my$returning = 1`
	result = runSQL(t, e, req)
	if result.RowCount != 3 || len(result.Rows) != 0 {
		t.Fatalf("dollar identifier affected count = %+v", result)
	}
	read := readRequest(`SELECT current_setting('transaction_read_only'), current_setting('statement_timeout'), current_setting('idle_in_transaction_session_timeout')`)
	read.Write = true // Authority cannot turn a declared read into a write transaction.
	result = runSQL(t, e, read)
	if !reflect.DeepEqual(result.Rows[0], []any{"on", "1s", "1s"}) {
		t.Fatalf("transaction settings = %+v", result)
	}
	if state := e.State(context.Background(), "", postgresSource()); state.Status != domain.SourceReady {
		t.Fatalf("state = %+v", state)
	}
	s, err := e.source(postgresSource())
	if err != nil {
		t.Fatal(err)
	}
	if s.db.Stats().MaxOpenConnections != 4 {
		t.Fatal("source connection limit is not 4")
	}
}

func TestPostgresTimeoutAndTruncation(t *testing.T) {
	e, _ := testDatabase(t)
	req := readRequest(`SELECT pg_sleep(1)`)
	req.Query.TimeoutMs = 30
	_, err := e.Run(context.Background(), req)
	requireCode(t, err, "query_timeout")
	req = readRequest(`SELECT generate_series(1, 5) AS n`)
	req.Query.RowLimit = 2
	result := runSQL(t, e, req)
	if !result.Truncated || result.RowCount != 2 || len(result.Rows) != 2 {
		t.Fatalf("truncated result = %+v", result)
	}
	req.Query.SQL.Text = `SELECT generate_series(1, 2) AS n`
	result = runSQL(t, e, req)
	if result.Truncated {
		t.Fatal("exact row limit marked truncated")
	}
}

func TestPostgresTruncationCancelsUnreadRows(t *testing.T) {
	e, _ := testDatabase(t)
	req := readRequest(`SELECT generate_series(1, 1000000000) AS n`)
	req.Query.RowLimit = 2
	req.Query.TimeoutMs = 10000
	start := time.Now()
	result := runSQL(t, e, req)
	if elapsed := time.Since(start); elapsed > 3*time.Second {
		t.Fatalf("row cap drained the query for %s", elapsed)
	}
	if !result.Truncated || result.RowCount != 2 || len(result.Rows) != 2 {
		t.Fatalf("truncated result = %+v", result)
	}
	// The cancelled connection must not poison subsequent executions.
	runSQL(t, e, readRequest(`SELECT 1`))
}

func TestPostgresTypedParameters(t *testing.T) {
	e, _ := testDatabase(t)
	req := readRequest(`SELECT {{n}} + {{n}}, {{text}}, 2 = ANY({{numbers}}), 'paid' = ANY({{statuses}}), {{missing}} IS NULL, {{enabled}}, {{day}}, {{instant}}`)
	req.Query.Params = []domain.Param{
		{Name: "statuses", Type: domain.ParamTextList}, {Name: "n", Type: domain.ParamNumber},
		{Name: "numbers", Type: domain.ParamNumberList}, {Name: "text", Type: domain.ParamText},
		{Name: "missing", Type: domain.ParamText}, {Name: "enabled", Type: domain.ParamBoolean},
		{Name: "day", Type: domain.ParamDate}, {Name: "instant", Type: domain.ParamTimestamp},
	}
	req.Inputs = map[string]any{"n": "9007199254740993.25", "text": "'; DELETE FROM orders; --", "numbers": []any{1.0, 2.0}, "statuses": []any{"paid", "new"}, "enabled": true, "day": "2026-10-14", "instant": "2026-10-14T12:30:00+09:00"}
	result := runSQL(t, e, req)
	want := []any{"18014398509481986.50", "'; DELETE FROM orders; --", true, true, true, true, "2026-10-14", "2026-10-14T03:30:00Z"}
	if !reflect.DeepEqual(result.Rows[0], want) {
		t.Fatalf("params = %#v, want %#v", result.Rows[0], want)
	}
}

func TestPostgresGoldenSearchOrders(t *testing.T) {
	data, err := os.ReadFile("../domain/testdata/documents/valid/order-desk.json")
	if err != nil {
		t.Fatal(err)
	}
	var document domain.Document
	if err := json.Unmarshal(data, &document); err != nil {
		t.Fatal(err)
	}
	var query domain.Query
	for _, candidate := range document.Queries {
		if candidate.ID == "search_orders" {
			query = candidate
			break
		}
	}
	if query.SQL == nil {
		t.Fatal("golden search_orders SQL query is missing")
	}

	e, db := testDatabase(t)
	execFixture(t, db, `CREATE TABLE customers (id integer PRIMARY KEY, name text NOT NULL, email text NOT NULL);
		CREATE TABLE orders (number text PRIMARY KEY, customer_id integer REFERENCES customers(id), total numeric NOT NULL, status text NOT NULL, created_at timestamptz NOT NULL);
		INSERT INTO customers VALUES (1, 'Aki', 'aki@example.test'), (2, 'Mika', 'ORD-203-match@example.test');
		INSERT INTO orders VALUES
			('ORD-2031', 1, 12.50, 'open', '2026-10-14T03:00:00Z'),
			('ORD-2032', 1, 25.00, 'shipped', '2026-10-14T02:00:00Z'),
			('ORD-OTHER', 2, 7.00, 'open', '2026-10-14T01:00:00Z'),
			('ORD-2033', 1, 99.00, 'cancelled', '2026-10-14T00:00:00Z'),
			('ORD-9999', 1, 42.00, 'open', '2026-10-13T00:00:00Z')`)
	var inputs map[string]any
	if err := json.Unmarshal([]byte(`{"search":"ORD-203","statuses":["open","shipped"]}`), &inputs); err != nil {
		t.Fatal(err)
	}
	source := postgresSource()
	source.ID = query.SourceID
	result := runSQL(t, e, domain.RunRequest{Source: source, Query: query, Inputs: inputs})
	want := [][]any{
		{"ORD-2031", "Aki", "12.50", "open", "2026-10-14T03:00:00Z"},
		{"ORD-2032", "Aki", "25.00", "shipped", "2026-10-14T02:00:00Z"},
		{"ORD-OTHER", "Mika", "7.00", "open", "2026-10-14T01:00:00Z"},
	}
	if result.RowCount != len(want) || result.Truncated || !reflect.DeepEqual(result.Rows, want) {
		t.Fatalf("golden search_orders result = %#v, want rows %#v", result, want)
	}
}

func TestPostgresResultEncoding(t *testing.T) {
	e, _ := testDatabase(t)
	result := runSQL(t, e, readRequest(`SELECT 12345678901234567890.123400::numeric AS amount,
		'2026-10-14 12:30:00.123456+09'::timestamptz AS instant,
		'2026-10-14 03:30:00'::timestamp AS local_time,
		decode('deadbeef', 'hex') AS bytes,
		ARRAY[1,2,NULL]::integer[] AS numbers,
		ARRAY['a,b','NULL',NULL]::text[] AS labels,
		'{"nested":[1,true]}'::jsonb AS object,
		'["x",null]'::json AS array,
		ARRAY[1.20,2.30]::numeric[] AS amounts,
		ARRAY[ARRAY[1,2],ARRAY[3,4]] AS matrix`))
	want := []any{
		"12345678901234567890.123400", "2026-10-14T03:30:00.123456Z", "2026-10-14T03:30:00Z", nil,
		[]any{int64(1), int64(2), nil}, []any{"a,b", "NULL", nil},
		map[string]any{"nested": []any{json.Number("1"), true}}, []any{"x", nil},
		[]any{"1.20", "2.30"}, []any{[]any{int64(1), int64(2)}, []any{int64(3), int64(4)}},
	}
	if !reflect.DeepEqual(result.Rows[0], want) {
		t.Fatalf("encoding = %#v, want %#v", result.Rows[0], want)
	}
	for i, kind := range []string{"numeric", "timestamptz", "timestamp", "bytea", "_int4", "_text", "jsonb", "json", "_numeric", "_int4"} {
		if result.Columns[i].Type != kind {
			t.Errorf("column %d type = %s, want %s", i, result.Columns[i].Type, kind)
		}
	}
	if _, err := json.Marshal(result); err != nil {
		t.Fatal(err)
	}
}

func TestPostgresSchema(t *testing.T) {
	e, db := testDatabase(t)
	execFixture(t, db, `CREATE TABLE orders (id integer PRIMARY KEY, note text, amount numeric NOT NULL)`)
	execFixture(t, db, `CREATE VIEW order_view AS SELECT id, note FROM orders`)
	var ownSchema string
	if err := db.QueryRowContext(context.Background(), `SELECT current_schema()`).Scan(&ownSchema); err != nil {
		t.Fatal(err)
	}
	result, err := e.Schema(context.Background(), postgresSource())
	if err != nil {
		t.Fatal(err)
	}
	found := make(map[string]SchemaTable)
	for _, table := range result.Tables {
		if table.Schema == "information_schema" || strings.HasPrefix(table.Schema, "pg_") {
			t.Fatalf("system schema returned: %s", table.Schema)
		}
		if table.Schema == ownSchema {
			found[table.Name] = table
		}
	}
	orders, ok := found["orders"]
	if !ok || orders.Kind != "table" || len(orders.Columns) != 3 {
		t.Fatalf("tables = %+v", found)
	}
	if !orders.Columns[0].PrimaryKey || orders.Columns[0].Nullable || !orders.Columns[1].Nullable || orders.Columns[1].PrimaryKey {
		t.Fatalf("columns = %+v", orders.Columns)
	}
	if found["order_view"].Kind != "view" {
		t.Fatalf("view = %+v", found["order_view"])
	}
	// The limit is applied to tables, not to joined column rows.
	execFixture(t, db, `DO $$ BEGIN FOR i IN 1..505 LOOP
		EXECUTE format('CREATE TABLE cap_%s (id integer)', i);
	END LOOP; END $$`)
	result, err = e.Schema(context.Background(), postgresSource())
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Tables) != 500 {
		t.Fatalf("schema returned %d tables, want 500", len(result.Tables))
	}
}

func TestPostgresNonFiniteNumbersRemainJSON(t *testing.T) {
	e, _ := testDatabase(t)
	result := runSQL(t, e, readRequest(`SELECT 'NaN'::float8, 'Infinity'::float8, '-Infinity'::float8, ARRAY['NaN'::float8]`))
	want := []any{"NaN", "Infinity", "-Infinity", []any{"NaN"}}
	if !reflect.DeepEqual(result.Rows[0], want) {
		t.Fatalf("non-finite values = %#v", result.Rows[0])
	}
	if _, err := json.Marshal(result); err != nil {
		t.Fatal(err)
	}
}
