package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/appthrust/appserver-go/appserver/identity"
	"github.com/appthrust/appserver-go/appserver/link"
	"github.com/appthrust/appserver-go/appserver/pgstore/testutil"
	"github.com/appthrust/appserver-go/appserver/platformclient"
	"github.com/appthrust/tool-builder/cmd/server/internal/domain"
	"github.com/appthrust/tool-builder/cmd/server/internal/store"
	"github.com/stretchr/testify/require"
)

type fakeEngine struct {
	calls   []domain.RunRequest
	failure error
	state   domain.DataSourceStatus
}

func (e *fakeEngine) Run(_ context.Context, r domain.RunRequest) (domain.RunResult, error) {
	e.calls = append(e.calls, r)
	return domain.RunResult{Columns: []domain.Column{{Name: "value", Type: "text"}}, Rows: [][]any{{"ok"}}, RowCount: 2, DurationMs: 3}, e.failure
}
func (e *fakeEngine) State(context.Context, string, domain.DataSource) domain.SourceState {
	status := e.state
	if status == "" {
		status = domain.SourceReady
	}
	return domain.SourceState{Status: status}
}
func (e *fakeEngine) Schema(context.Context, domain.DataSource) (SourceSchema, error) {
	return SourceSchema{Tables: []SchemaTable{{Schema: "public", Name: "orders", Kind: "table", Columns: []SchemaColumn{}}}}, nil
}

type testAPI struct {
	handler       http.Handler
	bearer        string
	platformCalls []string
	deleteStatus  int
}

func newTestAPI(t *testing.T, db *store.Store, eng Engine, issuer *testutil.OIDCIssuer, admin bool, groups []string) *testAPI {
	t.Helper()
	fixture := &testAPI{bearer: issuer.Bearer(t)}
	platform := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, fixture.bearer, r.Header.Get("Authorization"))
		fixture.platformCalls = append(fixture.platformCalls, r.Method+" "+r.URL.Path)
		if r.Method != http.MethodGet {
			require.NotEmpty(t, r.Header.Get("Idempotency-Key"))
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/projects/pj-test":
			_ = json.NewEncoder(w).Encode(map[string]any{"teamSlug": "test"})
		case "/api/v1/teams":
			role := "Viewer"
			if admin {
				role = "Admin"
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"items": []any{map[string]any{"id": "team", "slug": "test", "role": role}}})
		case "/api/v1/projects/pj-test/app-installations/tool-builder":
			_, _ = w.Write([]byte(`{"id":"tool-builder","stackId":"adopted-tool-stack","links":[{"definitionId":"knowledge","state":"Absent"},{"definitionId":"builder-console","state":"Installing"}]}`))
		case "/api/v1/projects/pj-test/components/orders-db":
			_, _ = w.Write([]byte(`{"applicationId":"inventory-2"}`))
		case "/api/v1/projects/pj-test/databases":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{"id": "orders", "applicationId": "app", "applicationName": "Orders", "name": "Orders", "provider": "CNPG"}, map[string]any{"id": "neon", "applicationId": "app-x", "applicationName": "Analytics", "name": "Events", "provider": "Neon"}}})
		case "/api/v1/projects/pj-test/application-stacks/adopted-tool-stack":
			_, _ = w.Write([]byte(`{"webComponentId":"adopted-tool-web"}`))
		case "/api/v1/projects/pj-test/component-connections":
			if r.Method == http.MethodGet {
				_, _ = w.Write([]byte(`{"data":[{"id":"conn-extra-db","sourceComponentId":"adopted-tool-web","destinationComponentId":"orders","connectionName":"extra-db"}]}`))
				return
			}
			require.Equal(t, "POST", r.Method)
			var input map[string]string
			require.NoError(t, json.NewDecoder(r.Body).Decode(&input))
			require.Equal(t, "adopted-tool-web", input["sourceComponentId"])
			require.Equal(t, "extra-db", input["connectionName"])
			require.Equal(t, "orders", input["destinationComponentId"])
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"conn-extra-db","connectionName":"extra-db"}`))
		case "/api/v1/projects/pj-test/component-connections/conn-extra-db":
			require.Equal(t, "DELETE", r.Method)
			if fixture.deleteStatus != 0 {
				w.WriteHeader(fixture.deleteStatus)
				_, _ = w.Write([]byte(`{"error":"connection_error","message":"Connection could not be deleted"}`))
				return
			}
			_, _ = w.Write([]byte(`{"operation":{}}`))
		case "/api/v1/projects/pj-test/components/web":
			_, _ = w.Write([]byte(`{"internalService":{"url":"http://web-internal.pj-test.svc"}}`))
		case "/api/v1/projects/pj-test/components/external":
			_, _ = w.Write([]byte(`{"internalService":null}`))
		default:
			t.Errorf("unexpected platform route %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(platform.Close)
	dirServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, fixture.bearer, r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/directory/v1/me":
			_ = json.NewEncoder(w).Encode(map[string]any{"person": map[string]any{"id": "person", "subject": "subject", "displayName": "Person"}, "effectiveGroupIds": groups})
		case "/api/directory/v1/groups":
			_, _ = w.Write([]byte(`{"items":[{"id":"cs-team","path":"cs-team","name":"CS team","memberCount":1},{"id":"finance","path":"finance","name":"Finance","memberCount":1}]}`))
		case "/api/directory/v1/people":
			_, _ = w.Write([]byte(`{"items":[{"id":"person","subject":"subject","displayName":"Hydrated Person"}]}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(dirServer.Close)
	platformClient := platformclient.New(platform.URL, "pj-test")
	resolver := link.NewResolver(platformClient, "tool-builder", func(key string) (string, bool) {
		return dirServer.URL, key == "DIRECTORY_URL"
	}, map[string]link.Required{"directory": {URLEnv: "DIRECTORY_URL"}})
	links := link.NewClient(resolver, nil)
	auth, err := identity.New(identity.Trust{OIDCIssuer: issuer.Server.URL, OIDCCAPEM: issuer.CAPEM, OIDCAudiences: []string{"appthrust-platform-api"}})
	require.NoError(t, err)
	fixture.handler = New(db, eng, auth, platformClient, links, platform.URL, "https://tools.example.test")
	return fixture
}
func (f *testAPI) request(t *testing.T, method, path string, input any, match string) *httptest.ResponseRecorder {
	t.Helper()
	var data []byte
	if input != nil {
		var err error
		data, err = json.Marshal(input)
		require.NoError(t, err)
	}
	r := httptest.NewRequest(method, base+path, bytes.NewReader(data))
	r.Header.Set("Authorization", f.bearer)
	if input != nil {
		r.Header.Set("Content-Type", "application/json")
	}
	if match != "" {
		r.Header.Set("If-Match", match)
	}
	w := httptest.NewRecorder()
	f.handler.ServeHTTP(w, r)
	return w
}
func seededStore(t *testing.T) *store.Store {
	t.Helper()
	db, _ := testutil.Database(t, store.Open)
	require.NoError(t, db.SeedDev(context.Background(), []string{"cs-team", "finance"}))
	return db
}
func TestAccessAndDraftVisibility(t *testing.T) {
	db := seededStore(t)
	issuer := testutil.NewOIDCIssuer(t)
	for _, test := range []struct {
		name   string
		admin  bool
		groups []string
		status int
		edit   bool
	}{{"admin", true, []string{}, 200, true}, {"editor", false, []string{"cs-team"}, 200, true}, {"user", false, []string{"finance"}, 200, false}, {"no-grant", false, []string{}, 403, false}} {
		t.Run(test.name, func(t *testing.T) {
			api := newTestAPI(t, db, &fakeEngine{}, issuer, test.admin, test.groups)
			w := api.request(t, "GET", "/tools/order-desk", nil, "")
			require.Equal(t, test.status, w.Code, w.Body.String())
			var body map[string]any
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
			if test.status == 200 {
				require.NotNil(t, body["live"])
				if test.edit {
					require.NotNil(t, body["draft"])
					require.NotNil(t, body["draftVersion"])
				} else {
					require.Nil(t, body["draft"])
					require.Nil(t, body["draftVersion"])
				}
			} else {
				require.Equal(t, "tool_forbidden", body["error"])
				require.NotContains(t, w.Body.String(), "search_orders")
			}
			w = api.request(t, "GET", "/tools", nil, "")
			require.Equal(t, 200, w.Code)
			var list struct {
				Data []json.RawMessage `json:"data"`
			}
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &list))
			if test.status == 403 {
				require.Empty(t, list.Data)
			} else {
				require.Len(t, list.Data, 1)
			}
			w = api.request(t, "POST", "/tools", map[string]string{"slug": "new-" + test.name, "name": "New"}, "")
			if test.admin {
				require.Equal(t, 201, w.Code, w.Body.String())
			} else {
				require.Equal(t, 403, w.Code)
			}
		})
	}
}
func TestLiveDraftWriteConfirmationAndAudit(t *testing.T) {
	db := seededStore(t)
	issuer := testutil.NewOIDCIssuer(t)
	eng := &fakeEngine{}
	editor := newTestAPI(t, db, eng, issuer, false, []string{"cs-team"})
	user := newTestAPI(t, db, eng, issuer, false, []string{"finance"})
	var tool domain.Tool
	require.NoError(t, db.Do(context.Background(), false, func(tx *store.Tx) error { var err error; tool, err = tx.Tool("order-desk"); return err }))
	tool.Draft.Queries[0].SQL.Text = "select 'draft'"
	w := editor.request(t, "PUT", "/tools/order-desk/draft", tool.Draft, "stale")
	require.Equal(t, 409, w.Code, w.Body.String())
	require.Contains(t, w.Body.String(), "draft_changed")
	require.Contains(t, w.Body.String(), tool.DraftVersion)
	w = editor.request(t, "PUT", "/tools/order-desk/draft", tool.Draft, tool.DraftVersion)
	require.Equal(t, 200, w.Code, w.Body.String())
	w = user.request(t, "POST", "/tools/order-desk/queries/open_count/run", runInput{Inputs: map[string]any{}}, "")
	require.Equal(t, 200, w.Code, w.Body.String())
	require.NotEqual(t, "select 'draft'", eng.calls[len(eng.calls)-1].Query.SQL.Text)
	require.False(t, eng.calls[len(eng.calls)-1].Write)
	w = editor.request(t, "POST", "/tools/order-desk/draft/queries/open_count/run", runInput{Inputs: map[string]any{}}, "")
	require.Equal(t, 200, w.Code, w.Body.String())
	require.Equal(t, "select 'draft'", eng.calls[len(eng.calls)-1].Query.SQL.Text)
	w = user.request(t, "POST", "/tools/order-desk/queries/issue_refund/run", runInput{Inputs: map[string]any{}}, "")
	require.Equal(t, 400, w.Code)
	require.Contains(t, w.Body.String(), "query_not_read_only")
	w = editor.request(t, "POST", "/tools/order-desk/draft/queries/issue_refund/run", runInput{Inputs: map[string]any{}}, "")
	require.Equal(t, 400, w.Code)
	require.Contains(t, w.Body.String(), "write_not_confirmed")
	before := len(eng.calls)
	w = editor.request(t, "POST", "/tools/order-desk/actions/issue_refund/run", map[string]any{"inputs": map[string]any{"z": 2, "a": "secret-input"}}, "")
	require.Equal(t, 403, w.Code, w.Body.String())
	require.Equal(t, before, len(eng.calls))
	require.Contains(t, w.Body.String(), "action_denied")
	w = user.request(t, "POST", "/tools/order-desk/actions/issue_refund/run", runInput{Inputs: map[string]any{}}, "")
	require.Equal(t, 200, w.Code, w.Body.String())
	require.True(t, eng.calls[len(eng.calls)-1].Write)
	require.Equal(t, user.bearer, eng.calls[len(eng.calls)-1].Bearer)
	w = editor.request(t, "POST", "/tools/order-desk/draft/queries/issue_refund/run", runInput{Inputs: map[string]any{}, ConfirmWrite: true}, "")
	require.Equal(t, 200, w.Code, w.Body.String())
	eng.failure = &domain.RunError{Code: "query_failed", Message: "safe error"}
	w = user.request(t, "POST", "/tools/order-desk/actions/issue_refund/run", runInput{Inputs: map[string]any{}}, "")
	require.Equal(t, 400, w.Code, w.Body.String())
	require.NoError(t, db.Do(context.Background(), false, func(tx *store.Tx) error {
		runs, err := tx.Runs(tool.ID, 20)
		if err != nil {
			return err
		}
		require.Len(t, runs, 4)
		require.Equal(t, domain.RunFailed, runs[0].Status)
		require.Equal(t, "", runs[1].ActionID)
		require.Equal(t, 0, runs[1].ReleaseNumber)
		require.Equal(t, domain.RunDenied, runs[3].Status)
		canonical := []byte(`{"a":"secret-input","z":2}`)
		hash := sha256.Sum256(canonical)
		require.Equal(t, hex.EncodeToString(hash[:]), runs[3].ParamsHash)
		return nil
	}))
	w = editor.request(t, "GET", "/tools/order-desk/runs", nil, "")
	require.Equal(t, 200, w.Code, w.Body.String())
	require.NotContains(t, w.Body.String(), "secret-input")
	require.NotContains(t, w.Body.String(), "paramsHash")
	require.Contains(t, w.Body.String(), "Hydrated Person")
}
func TestSourcesPlatformProxyAndSchema(t *testing.T) {
	db := seededStore(t)
	issuer := testutil.NewOIDCIssuer(t)
	eng := &fakeEngine{state: domain.SourcePending}
	admin := newTestAPI(t, db, eng, issuer, true, []string{})
	editor := newTestAPI(t, db, eng, issuer, false, []string{"cs-team"})
	w := admin.request(t, "GET", "/project/databases", nil, "")
	require.Equal(t, 200, w.Code, w.Body.String())
	var databases struct {
		Data []ProjectDatabase `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &databases))
	require.True(t, databases.Data[0].Connectable)
	require.Equal(t, "engine_unsupported", *databases.Data[1].Reason)
	w = admin.request(t, "POST", "/data-sources", map[string]string{"kind": "postgres", "slug": "extra-db", "name": "Extra", "connectionName": "extra-db", "destinationComponentId": "orders"}, "")
	require.Equal(t, 201, w.Code, w.Body.String())
	var source sourceDTO
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &source))
	require.Equal(t, domain.SourcePending, source.Status)
	w = editor.request(t, "GET", "/data-sources/"+source.ID+"/schema", nil, "")
	require.Equal(t, 200, w.Code, w.Body.String())
	require.Contains(t, w.Body.String(), "orders")
	w = admin.request(t, "DELETE", "/data-sources/"+source.ID, nil, "")
	require.Equal(t, 204, w.Code, w.Body.String())
	require.Contains(t, admin.platformCalls, "DELETE /api/v1/projects/pj-test/component-connections/conn-extra-db")
	var original domain.DataSource
	require.NoError(t, db.Do(context.Background(), false, func(tx *store.Tx) error {
		sources, err := tx.Sources()
		if err == nil {
			original = sources[0]
		}
		return err
	}))
	w = admin.request(t, "DELETE", "/data-sources/"+original.ID, nil, "")
	require.Equal(t, 409, w.Code, w.Body.String())
	require.Contains(t, w.Body.String(), "data_source_in_use")
	for _, id := range []string{"web", "external"} {
		w = admin.request(t, "POST", "/data-sources", map[string]string{"kind": "http", "slug": id, "name": id, "destinationComponentId": id}, "")
		if id == "web" {
			require.Equal(t, 201, w.Code, w.Body.String())
			require.Contains(t, w.Body.String(), "web-internal.pj-test.svc")
		} else {
			require.Equal(t, 400, w.Code)
			require.Contains(t, w.Body.String(), "internal_service_required")
		}
	}
	w = editor.request(t, "GET", "/data-sources", nil, "")
	require.Equal(t, 200, w.Code, w.Body.String())
	user := newTestAPI(t, db, eng, issuer, false, []string{"finance"})
	w = user.request(t, "GET", "/data-sources", nil, "")
	require.Equal(t, 403, w.Code)
	w = user.request(t, "GET", "/data-sources/"+original.ID+"/schema", nil, "")
	require.Equal(t, 403, w.Code)
}
func TestPublishRestoreAPIAndValidation(t *testing.T) {
	db := seededStore(t)
	issuer := testutil.NewOIDCIssuer(t)
	api := newTestAPI(t, db, &fakeEngine{}, issuer, false, []string{"cs-team"})
	w := api.request(t, "POST", "/tools/order-desk/releases", map[string]string{"note": "v2"}, "")
	require.Equal(t, 201, w.Code, w.Body.String())
	require.Contains(t, w.Body.String(), `"number":2`)
	w = api.request(t, "POST", "/tools/order-desk/releases/1/restore", map[string]string{}, "")
	require.Equal(t, 201, w.Code, w.Body.String())
	require.Contains(t, w.Body.String(), `"number":3`)
	require.Contains(t, w.Body.String(), `"restoredFrom":1`)
	w = api.request(t, "GET", "/tools/order-desk/releases/1", nil, "")
	require.Equal(t, 200, w.Code)
	require.Contains(t, w.Body.String(), `"document"`)
	var tool domain.Tool
	require.NoError(t, db.Do(context.Background(), false, func(tx *store.Tx) error { var err error; tool, err = tx.Tool("order-desk"); return err }))
	tool.Draft.SchemaVersion = 2
	w = api.request(t, "PUT", "/tools/order-desk/draft", tool.Draft, tool.DraftVersion)
	require.Equal(t, 400, w.Code)
	require.Contains(t, w.Body.String(), "invalid_document")
	tool.Draft.SchemaVersion = 1
	tool.Draft.Pages[0].Components[2].Props["query"] = domain.Prop{Kind: "value", Value: "missing-query"}
	w = api.request(t, "PUT", "/tools/order-desk/draft", tool.Draft, tool.DraftVersion)
	require.Equal(t, 200, w.Code)
	w = api.request(t, "POST", "/tools/order-desk/releases", map[string]string{}, "")
	require.Equal(t, 400, w.Code, w.Body.String())
	require.Contains(t, w.Body.String(), "invalid_document")
	require.Contains(t, w.Body.String(), "problems")
}
func TestMissingBearerAndUnknownRoute(t *testing.T) {
	issuer := testutil.NewOIDCIssuer(t)
	auth, err := identity.New(identity.Trust{OIDCIssuer: issuer.Server.URL, OIDCCAPEM: issuer.CAPEM, OIDCAudiences: []string{"appthrust-platform-api"}})
	require.NoError(t, err)
	handler := New(nil, &fakeEngine{}, auth, nil, nil, "", "")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, base+"/me", nil))
	require.Equal(t, 401, w.Code)
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, base+"/missing", strings.NewReader("")))
	require.Equal(t, 404, w.Code)
}
