package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/appthrust/appserver-go/appserver/contract/directory"
	"github.com/appthrust/appserver-go/appserver/httpx"
	"github.com/appthrust/appserver-go/appserver/link"
	"github.com/appthrust/appserver-go/appserver/pgstore/testutil"
	"github.com/appthrust/appserver-go/appserver/platformclient"
	"github.com/appthrust/tool-builder/cmd/server/internal/domain"
	"github.com/appthrust/tool-builder/cmd/server/internal/store"
	"github.com/stretchr/testify/require"
)

func TestDeclaredLinkGuardAndOperationsFallback(t *testing.T) {
	platform := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "bEaReR viewer", r.Header.Get("Authorization"))
		require.Equal(t, "/api/v1/projects/pj-test/app-installations/tool-builder", r.URL.Path)
		_, _ = w.Write([]byte(`{"id":"tool-builder","links":[{"definitionId":"directory","state":"Absent"},{"definitionId":"knowledge","state":"Installing"}]}`))
	}))
	defer platform.Close()
	resolver := link.NewResolver(platformclient.New(platform.URL, "pj-test"), "tool-builder", nil, nil)
	a := &API{links: link.NewClient(resolver, nil)}
	s := &request{r: httptest.NewRequest(http.MethodGet, base+"/links", nil), bearer: "bEaReR viewer", admin: true}
	require.NoError(t, a.requireDeclaredLink(s, "directory"))
	require.NoError(t, a.requireDeclaredLink(s, "knowledge"))
	err := a.requireDeclaredLink(s, "unknown")
	var failure *httpx.Error
	require.ErrorAs(t, err, &failure)
	require.Equal(t, 400, failure.Status)
	require.Equal(t, "link_not_declared", failure.Code)
	// Exercise the actual create handler before it can touch a transaction.
	s.r = httptest.NewRequest(http.MethodPost, base+"/data-sources", strings.NewReader(`{"kind":"builtin-app","definition":"unknown","name":"Unknown","slug":"unknown"}`))
	s.r.Header.Set("Content-Type", "application/json")
	s.w = httptest.NewRecorder()
	_, _, err = a.createSource(s)
	require.ErrorAs(t, err, &failure)
	require.Equal(t, "link_not_declared", failure.Code)

	body, status, err := a.listLinks(s)
	require.NoError(t, err)
	require.Equal(t, 200, status)
	require.Len(t, body.(map[string]any)["items"], 2)
	definition := "directory"
	body, status, err = a.sourceOperations(s, domain.DataSource{Kind: domain.SourceCatalogApp, Definition: &definition})
	require.NoError(t, err)
	require.Equal(t, 200, status)
	items := body.(map[string]any)["items"].([]operationDTO)
	require.Len(t, items, len(directory.Operations))
	for _, op := range items {
		require.True(t, strings.HasPrefix(op.Path, "/api/directory/v1/"))
	}
}

func TestOperationsLiveDocumentAndDenied(t *testing.T) {
	status := http.StatusOK
	callee := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/api/console/openapi.json", r.URL.Path)
		require.Equal(t, "Bearer viewer", r.Header.Get("Authorization"))
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"openapi":"3.0.3","x-appthrust-definition":"builder-console","servers":[{"url":"/api/console"}],"paths":{"/apps":{"get":{"operationId":"liveApps","x-appthrust-link":true,"x-appthrust-result-path":"items","parameters":[{"name":"q","in":"query","schema":{"type":"string"}}]}}}}`))
	}))
	defer callee.Close()
	resolver := link.NewResolver(nil, "tool-builder", func(string) (string, bool) { return callee.URL, true }, map[string]link.Required{"builder-console": {URLEnv: "CONSOLE_URL"}})
	a := &API{links: link.NewClient(resolver, nil)}
	s := &request{r: httptest.NewRequest(http.MethodGet, "/", nil), bearer: "Bearer viewer"}
	definition := "builder-console"
	source := domain.DataSource{Kind: domain.SourceCatalogApp, Definition: &definition}
	body, _, err := a.sourceOperations(s, source)
	require.NoError(t, err)
	items := body.(map[string]any)["items"].([]operationDTO)
	require.Equal(t, []operationDTO{{ID: "liveApps", Method: "GET", Path: "/api/console/apps", ResultPath: "items", Params: []operationParam{{Name: "q", In: "query", Type: "string"}}}}, items)
	status = http.StatusForbidden
	_, _, err = a.sourceOperations(s, source)
	var failure *httpx.Error
	require.ErrorAs(t, err, &failure)
	require.Equal(t, 403, failure.Status)
}

func TestAppInstallationSourcePersistenceAndSchema(t *testing.T) {
	db := seededStore(t)
	api := newTestAPI(t, db, &fakeEngine{}, testutil.NewOIDCIssuer(t), true, nil)
	for _, definition := range []string{"knowledge", "builder-console"} {
		w := api.request(t, "POST", "/data-sources", map[string]string{"kind": "builtin-app", "definition": definition, "name": definition, "slug": definition}, "")
		require.Equal(t, 201, w.Code, w.Body.String())
		require.NotContains(t, w.Body.String(), "baseUrl")
		require.NotContains(t, w.Body.String(), "destinationComponentId")
		var source sourceDTO
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &source))
		require.Equal(t, domain.DataSourceKind("builtin-app"), source.Kind)
		require.Equal(t, &definition, source.Definition)
		require.NoError(t, db.Do(context.Background(), false, func(tx *store.Tx) error {
			stored, err := tx.Source(source.ID)
			require.Equal(t, &definition, stored.Definition)
			require.Equal(t, domain.DataSourceKind("builtin-app"), stored.Kind)
			require.Nil(t, stored.BaseURL)
			require.Empty(t, stored.DestinationComponentID)
			return err
		}))
		operations := api.request(t, "GET", "/data-sources/"+source.ID+"/operations", nil, "")
		require.Equal(t, 200, operations.Code, operations.Body.String())
		schema := api.request(t, "GET", "/data-sources/"+source.ID+"/schema", nil, "")
		require.Equal(t, operations.Body.String(), schema.Body.String())
	}
}
