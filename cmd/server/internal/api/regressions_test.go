package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/appthrust/appserver-go/appserver/pgstore/testutil"
	"github.com/appthrust/tool-builder/cmd/server/internal/domain"
	"github.com/appthrust/tool-builder/cmd/server/internal/store"
	"github.com/stretchr/testify/require"
)

type blockedEngine struct {
	fakeEngine
	started chan struct{}
	release chan struct{}
}

func (e *blockedEngine) Run(ctx context.Context, req domain.RunRequest) (domain.RunResult, error) {
	close(e.started)
	select {
	case <-e.release:
		return e.fakeEngine.Run(ctx, req)
	case <-ctx.Done():
		return domain.RunResult{}, ctx.Err()
	}
}

func TestRunsReleaseStoreBeforeExecution(t *testing.T) {
	for _, path := range []string{
		"/actions/issue_refund/run", "/queries/open_count/run",
		"/draft/queries/issue_refund/run", "/draft/queries/open_count/run",
	} {
		t.Run(path, func(t *testing.T) {
			db := seededStore(t)
			eng := &blockedEngine{started: make(chan struct{}), release: make(chan struct{})}
			api := newTestAPI(t, db, eng, testutil.NewOIDCIssuer(t), true, []string{})
			w := api.request(t, "GET", "/tools/order-desk", nil, "")
			require.Equal(t, 200, w.Code, w.Body.String())
			var tool toolDetail
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &tool))
			done := make(chan *httptest.ResponseRecorder, 1)
			go func() {
				done <- api.request(t, "POST", "/tools/order-desk"+path, runInput{Inputs: map[string]any{}, ConfirmWrite: true}, "")
			}()
			defer func() {
				close(eng.release)
				select {
				case result := <-done:
					require.Equal(t, 200, result.Code, result.Body.String())
				case <-time.After(5 * time.Second):
					t.Error("run did not finish after releasing the engine")
				}
			}()
			select {
			case <-eng.started:
			case <-time.After(5 * time.Second):
				t.Fatal("engine did not start")
			}
			// A run waiting on its external source must not hold the global
			// writer lock. The save has a deadline, not a scheduling sleep.
			raw, err := json.Marshal(tool.Draft)
			require.NoError(t, err)
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			r := httptest.NewRequest(http.MethodPut, base+"/tools/order-desk/draft", bytes.NewReader(raw)).WithContext(ctx)
			r.Header.Set("Authorization", api.bearer)
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("If-Match", *tool.DraftVersion)
			w = httptest.NewRecorder()
			api.handler.ServeHTTP(w, r)
			require.Equal(t, 200, w.Code, w.Body.String())
		})
	}
}

func TestSourceDeleteHandlesAbsentConnectionOnly(t *testing.T) {
	for _, status := range []int{404, 403, 500} {
		t.Run(strconv.Itoa(status), func(t *testing.T) {
			db := seededStore(t)
			api := newTestAPI(t, db, &fakeEngine{}, testutil.NewOIDCIssuer(t), true, []string{})
			w := api.request(t, "POST", "/data-sources", map[string]string{"kind": "postgres", "slug": "extra-db", "name": "Extra", "connectionName": "extra-db", "destinationComponentId": "orders"}, "")
			require.Equal(t, 201, w.Code, w.Body.String())
			var source sourceDTO
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &source))
			api.deleteStatus = status
			w = api.request(t, "DELETE", "/data-sources/"+source.ID, nil, "")
			want := status
			if status == 404 {
				want = 204
			} else if status == 500 {
				want = 502
			}
			require.Equal(t, want, w.Code, w.Body.String())
			err := db.Do(context.Background(), false, func(tx *store.Tx) error {
				_, err := tx.Source(source.ID)
				return err
			})
			if status == 404 {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
		})
	}
}

func TestIncompleteSQLDraftSavesButCannotPublishOrRun(t *testing.T) {
	for _, text := range []string{"", " \t\n", "select '{{value}}'"} {
		t.Run(text, func(t *testing.T) {
			db := seededStore(t)
			eng := &fakeEngine{}
			api := newTestAPI(t, db, eng, testutil.NewOIDCIssuer(t), true, []string{})
			w := api.request(t, "GET", "/tools/order-desk", nil, "")
			require.Equal(t, 200, w.Code, w.Body.String())
			var tool toolDetail
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &tool))
			q := &tool.Draft.Queries[0]
			q.SQL.Text = text
			reason := "empty_query"
			if text == "select '{{value}}'" {
				reason = "placeholder_in_literal"
				q.Params = []domain.Param{{Name: "value", Type: domain.ParamText, Bind: domain.ParamBind{HasLiteral: true}}}
			}
			w = api.request(t, "PUT", "/tools/order-desk/draft", tool.Draft, *tool.DraftVersion)
			require.Equal(t, 200, w.Code, w.Body.String())
			w = api.request(t, "POST", "/tools/order-desk/releases", map[string]string{}, "")
			require.Equal(t, 400, w.Code, w.Body.String())
			require.Contains(t, w.Body.String(), reason)
			w = api.request(t, "POST", "/tools/order-desk/draft/queries/"+q.ID+"/run", runInput{Inputs: map[string]any{}}, "")
			require.Equal(t, 400, w.Code, w.Body.String())
			require.Contains(t, w.Body.String(), reason)
			require.Empty(t, eng.calls)
		})
	}
}

func TestPublishRestoreOptionalDraftMatch(t *testing.T) {
	for _, path := range []string{"/releases", "/releases/1/restore"} {
		t.Run(path, func(t *testing.T) {
			db := seededStore(t)
			api := newTestAPI(t, db, &fakeEngine{}, testutil.NewOIDCIssuer(t), true, []string{})
			w := api.request(t, "GET", "/tools/order-desk", nil, "")
			require.Equal(t, 200, w.Code, w.Body.String())
			var before, current toolDetail
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &before))
			before.Draft.Pages[0].Title = "New draft"
			w = api.request(t, "PUT", "/tools/order-desk/draft", before.Draft, *before.DraftVersion)
			require.Equal(t, 200, w.Code, w.Body.String())
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &current))
			w = api.request(t, "POST", "/tools/order-desk"+path, map[string]string{}, *before.DraftVersion)
			require.Equal(t, 409, w.Code, w.Body.String())
			require.Contains(t, w.Body.String(), "draft_changed")
			require.Contains(t, w.Body.String(), *current.DraftVersion)
			require.Contains(t, w.Body.String(), "New draft")
			w = api.request(t, "POST", "/tools/order-desk"+path, map[string]string{}, *current.DraftVersion)
			require.Equal(t, 201, w.Code, w.Body.String())
			require.Contains(t, w.Body.String(), `"number":2`)
			w = api.request(t, "POST", "/tools/order-desk"+path, map[string]string{}, "")
			require.Equal(t, 201, w.Code, w.Body.String())
			require.Contains(t, w.Body.String(), `"number":3`)
		})
	}
}
