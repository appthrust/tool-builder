package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/appthrust/appserver-go/appserver/pgstore/testutil"
	"github.com/appthrust/tool-builder/cmd/server/internal/domain"
	"github.com/appthrust/tool-builder/cmd/server/internal/store"
	"github.com/stretchr/testify/require"
)

func TestApplicationToolsLiveReleaseAndUseGrant(t *testing.T) {
	db := seededStore(t)
	issuer := testutil.NewOIDCIssuer(t)
	admin := newTestAPI(t, db, &fakeEngine{}, issuer, true, nil)
	// The seeded tool remains linked through its LIVE document, not this draft.
	require.NoError(t, db.Do(context.Background(), true, func(tx *store.Tx) error {
		tool, err := tx.Tool("order-desk")
		if err != nil {
			return err
		}
		_, err = tx.SaveDraft(tool, tool.DraftVersion, domain.EmptyDocument(), "editor")
		if err != nil {
			return err
		}
		_, err = tx.CreateTool("draft-only", "Unpublished", "", "editor")
		return err
	}))
	for _, tc := range []struct {
		name   string
		groups []string
		want   int
	}{
		{"viewer", []string{"finance"}, 1},
		{"editor", []string{"cs-team"}, 1},
		{"no-grant", []string{"unrelated"}, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			api := newTestAPI(t, db, &fakeEngine{}, issuer, false, tc.groups)
			for range 2 {
				w := api.request(t, "GET", "/tools?app=inventory-2&limit=1", nil, "")
				require.Equal(t, 200, w.Code, w.Body.String())
				var list struct {
					Items []linkedTool `json:"items"`
				}
				require.NoError(t, json.Unmarshal(w.Body.Bytes(), &list))
				require.Len(t, list.Items, tc.want)
				if tc.want != 0 {
					require.Equal(t, "https://tools.example.test/t/order-desk", list.Items[0].URL)
					require.Equal(t, 1, list.Items[0].LiveReleaseNumber)
				}
			}
			calls := 0
			for _, call := range api.platformCalls {
				if call == "GET /api/v1/projects/pj-test/components/orders-db" {
					calls++
				}
			}
			require.Equal(t, tc.want, calls, "component lookup must be cached and only follow tool authorization")
			w := api.request(t, "GET", "/tools?app=another-app", nil, "")
			require.Equal(t, 200, w.Code, w.Body.String())
			require.JSONEq(t, `{"items":[]}`, w.Body.String())
		})
	}
	w := admin.request(t, "GET", "/tools?app=inventory-2", nil, "")
	require.Equal(t, 200, w.Code, w.Body.String())
	require.Contains(t, w.Body.String(), "order-desk")
	require.NotContains(t, w.Body.String(), "draft-only")
}

func TestApplicationToolsValidatesBeforeStore(t *testing.T) {
	a := &API{}
	for _, query := range []string{"app=", "app=bad/name", "app=inventory-2&limit=0", "app=inventory-2&limit=201", "app=inventory-2&limit=bad"} {
		_, _, err := a.applicationTools(&request{r: httptest.NewRequest(http.MethodGet, "/tools?"+query, nil)})
		require.Error(t, err)
	}
}
