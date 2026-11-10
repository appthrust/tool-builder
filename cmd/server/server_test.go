package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	toolbuildercontract "github.com/appthrust/appserver-go/appserver/contract/toolbuilder"
	"github.com/appthrust/appserver-go/appserver/identity"
	"github.com/appthrust/appserver-go/appserver/pgstore/testutil"
	"github.com/appthrust/appserver-go/appserver/platformclient"
	"github.com/appthrust/appserver-go/appserver/platformenv"
	"github.com/appthrust/tool-builder/cmd/server/internal/api"
	"github.com/appthrust/tool-builder/cmd/server/internal/store"
	"github.com/stretchr/testify/require"
)

func clearRuntimeEnv(t *testing.T) {
	t.Helper()
	for _, key := range []string{"TOOL_BUILDER_DATABASE_URL", "DATABASE_URL", "PLATFORM_OIDC_ISSUER", "PLATFORM_OIDC_ISSUER_CA_PEM", "TOOL_BUILDER_PUBLIC_URL", "TOOL_BUILDER_DIRECTORY_URL", "TOOL_BUILDER_DEV_SEED"} {
		t.Setenv(key, "")
	}
}
func TestUnavailableStoreKeepsProbesAndSPA(t *testing.T) {
	clearRuntimeEnv(t)
	pending, closeDB, err := toolBuilderHandler("http://127.0.0.1:1", "pj-test")
	require.NoError(t, err)
	defer closeDB()
	static := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(static, "index.html"), []byte("<html>Tool Builder</html>"), 0600))
	handler, err := newHandler(static, "http://127.0.0.1:1", "pj-test", pending, pending.Ready)
	require.NoError(t, err)
	for path, status := range map[string]int{"/healthz": 200, "/readyz": 503, "/config": 200, "/t/order-desk": 200, "/edit/order-desk/queries": 200, "/api/tool-builder/v1/me": 503, "/api/unknown": 404, "/assets/missing.js": 404} {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		require.Equal(t, status, w.Code, path)
		if path == "/api/tool-builder/v1/me" {
			require.Contains(t, w.Body.String(), "tool_builder_store_unavailable")
		}
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/t/order-desk", nil))
	require.Equal(t, 405, w.Code)
}
func TestIdentityOutageAndReleaseMetadata(t *testing.T) {
	issuer := testutil.NewOIDCIssuer(t)
	issuer.Available.Store(false)
	auth, err := identity.New(identity.Trust{OIDCIssuer: issuer.Server.URL, OIDCCAPEM: issuer.CAPEM, OIDCAudiences: []string{"appthrust-platform-api"}})
	require.NoError(t, err)
	for key, value := range map[string]string{"TOOL_BUILDER_RELEASE_VERSION": "release", "TOOL_BUILDER_SOURCE_REVISION": "", "TOOL_BUILDER_ARTIFACT_DIGEST": "digest"} {
		t.Setenv(key, value)
	}
	handler, err := newHandler(t.TempDir(), "http://127.0.0.1:1", "pj-test", api.New(nil, nil, auth, nil, nil, "", ""), nil)
	require.NoError(t, err)
	w := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/tool-builder/v1/me", nil)
	request.Header.Set("Authorization", issuer.Bearer(t))
	handler.ServeHTTP(w, request)
	require.Equal(t, 503, w.Code)
	require.Contains(t, w.Body.String(), "identity_unavailable")
	for _, path := range []string{"/healthz", "/readyz", "/releasez"} {
		w = httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		require.Equal(t, 200, w.Code)
	}
	var release map[string]string
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &release))
	require.Equal(t, map[string]string{"releaseVersion": "release", "artifactDigest": "digest"}, release)
}
func TestDatabaseFallbackAndSeed(t *testing.T) {
	db, dsn := testutil.Database(t, store.Open)
	clearRuntimeEnv(t)
	t.Setenv("DATABASE_URL", dsn)
	t.Setenv("TOOL_BUILDER_DEV_SEED", "1")
	t.Setenv("TOOL_BUILDER_DEV_SEED_GROUPS", "cs-team,finance")
	pending, cleanup, err := toolBuilderHandler("http://127.0.0.1:1", "pj-test")
	require.NoError(t, err)
	defer cleanup()
	require.True(t, pending.Ready())
	require.NoError(t, db.Do(context.Background(), false, func(tx *store.Tx) error {
		tool, err := tx.Tool("order-desk")
		if err != nil {
			return err
		}
		require.Equal(t, 1, *tool.LiveReleaseNumber)
		g, err := tx.Grants(tool.ID)
		require.Len(t, g.Groups, 2)
		require.Equal(t, []string{"finance"}, g.Actions[0].GroupIDs)
		return err
	}))
}
func TestUnreachableDatabaseRemainsUnready(t *testing.T) {
	clearRuntimeEnv(t)
	t.Setenv("TOOL_BUILDER_DATABASE_URL", "postgres://postgres@127.0.0.1:1/test?sslmode=disable&connect_timeout=1")
	pending, cleanup, err := toolBuilderHandler("http://127.0.0.1:1", "pj-test")
	require.NoError(t, err)
	defer cleanup()
	require.False(t, pending.Ready())
	handler, err := newHandler(t.TempDir(), "http://127.0.0.1:1", "pj-test", pending, pending.Ready)
	require.NoError(t, err)
	for path, status := range map[string]int{"/healthz": 200, "/readyz": 503} {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		require.Equal(t, status, w.Code)
	}
}
func TestConfigurationValidation(t *testing.T) {
	for _, origin := range []string{"https://platform.example.test", "http://127.0.0.1:8080", "http://[::1]:8080", "http://localhost:8080"} {
		_, err := platformenv.Validate(origin, "pj-test")
		require.NoError(t, err)
	}
	for _, origin := range []string{"http://example.test", "https://example.test/path", "https://user:pass@example.test", "https://example.test?x=1", "file:///tmp"} {
		_, err := platformenv.Validate(origin, "pj-test")
		require.Error(t, err)
	}
	_, err := newHandler(t.TempDir(), "https://platform.example.test", "Bad_ID", nil, nil)
	require.Error(t, err)
	clearRuntimeEnv(t)
	t.Setenv("TOOL_BUILDER_DIRECTORY_URL", "https://directory.example.test/path")
	_, _, err = toolBuilderHandler("https://platform.example.test", "pj-test")
	require.Error(t, err)
}
func TestReleaseFileFallback(t *testing.T) {
	for _, key := range []string{"TOOL_BUILDER_RELEASE_VERSION", "TOOL_BUILDER_SOURCE_REVISION", "TOOL_BUILDER_ARTIFACT_DIGEST"} {
		t.Setenv(key, "")
	}
	file := filepath.Join(t.TempDir(), "release.json")
	require.NoError(t, os.WriteFile(file, []byte(`{"sourceRevision":"file-revision"}`), 0600))
	t.Setenv("TOOL_BUILDER_RELEASE_FILE", file)
	handler, err := newHandler(t.TempDir(), "https://platform.example.test", "pj-test", nil, nil)
	require.NoError(t, err)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/releasez", nil))
	require.Equal(t, 200, w.Code)
	require.Contains(t, w.Body.String(), "file-revision")
}

func TestLauncherAuthenticationAndCurrentAppInstallation(t *testing.T) {
	clearRuntimeEnv(t)
	const bearer = "Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJkZXYtYWRtaW4iLCJlbWFpbCI6ImFkbWluQGV4YW1wbGUudGVzdCIsIm5hbWUiOiJBZG1pbiJ9."
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.Header.Get("Authorization") != bearer {
			t.Errorf("unexpected launcher request: method=%s authorization=%q", r.Method, r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/projects/pj-test":
			_, _ = w.Write([]byte(`{"id":"pj-test","name":"開発チーム"}`))
		case "/api/v1/projects/pj-test/app-installations":
			_, _ = w.Write([]byte(`{"data":[{"id":"tool-builder","definitionId":"tool-builder","phase":"Ready","url":"https://tools.example.test","display":{"icon":"wrench"}}],"meta":{"total":1}}`))
		case "/api/v1/application-stack-definitions":
			_, _ = w.Write([]byte(`{"data":[{"id":"tool-builder","title":"Tool Builder","description":"Project tools"}],"meta":{"total":1}}`))
		default:
			t.Errorf("unexpected launcher upstream path: %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()
	handler, err := newHandler(t.TempDir(), upstream.URL, "pj-test", nil, nil)
	require.NoError(t, err)

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/launcher", nil))
	require.Equal(t, http.StatusUnauthorized, response.Code)
	require.Equal(t, "application/json", response.Header().Get("Content-Type"))
	require.Equal(t, "no-store", response.Header().Get("Cache-Control"))
	var failure map[string]string
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &failure))
	require.Equal(t, "unauthenticated", failure["error"])

	request := httptest.NewRequest(http.MethodGet, "/launcher", nil)
	request.Header.Set("Authorization", bearer)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.Equal(t, "application/json", response.Header().Get("Content-Type"))
	require.Equal(t, "no-store", response.Header().Get("Cache-Control"))
	var result struct {
		Project struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"project"`
		Entries []struct {
			DefinitionID string `json:"definitionId"`
			Current      bool   `json:"current"`
		} `json:"entries"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &result))
	require.Equal(t, "pj-test", result.Project.ID)
	require.Equal(t, "開発チーム", result.Project.Name)
	require.Len(t, result.Entries, 1)
	require.Equal(t, "tool-builder", result.Entries[0].DefinitionID)
	require.True(t, result.Entries[0].Current)
}

func TestLauncherRejectsInvalidIdentityCA(t *testing.T) {
	clearRuntimeEnv(t)
	t.Setenv("PLATFORM_OIDC_ISSUER", "https://issuer.example.test")
	t.Setenv("PLATFORM_OIDC_ISSUER_CA_PEM", "invalid PEM")
	handler, err := newHandler(t.TempDir(), "https://platform.example.test", "pj-test", nil, nil)
	require.ErrorContains(t, err, "PEM")
	require.Nil(t, handler)
}

func TestServedOpenAPIEqualsCommittedContract(t *testing.T) {
	issuer := testutil.NewOIDCIssuer(t)
	auth, err := identity.New(identity.Trust{OIDCIssuer: issuer.Server.URL, OIDCCAPEM: issuer.CAPEM, OIDCAudiences: []string{"appthrust-platform-api"}})
	require.NoError(t, err)
	bearer := issuer.Bearer(t)
	platform := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, bearer, r.Header.Get("Authorization"))
		switch r.URL.Path {
		case "/api/v1/projects/pj-test/access":
			_, _ = w.Write([]byte(`{"member":true,"roles":["Viewer"],"actions":[]}`))
		default:
			t.Errorf("unexpected platform route %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer platform.Close()
	// Contract discovery requires membership, not a Directory binding or DB.
	apiHandler := api.New(nil, nil, auth, platformclient.New(platform.URL, "pj-test"), nil, platform.URL, "")
	handler, err := newHandler(t.TempDir(), platform.URL, "pj-test", apiHandler, nil)
	require.NoError(t, err)
	r := httptest.NewRequest(http.MethodGet, "/api/tool-builder/v1/openapi.json", nil)
	r.Header.Set("Authorization", bearer)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	require.Equal(t, 200, w.Code, w.Body.String())
	require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
	committed := toolbuildercontract.Document
	require.Equal(t, committed, w.Body.Bytes())
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/tool-builder/v1/openapi.json", nil))
	require.Equal(t, 401, w.Code)
}
