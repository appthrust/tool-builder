package engine

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/appthrust/appserver-go/appserver/link"
	"github.com/appthrust/tool-builder/cmd/server/internal/domain"
	"github.com/stretchr/testify/require"
)

type fakeBindingResolver struct {
	binding link.Binding
	err     error
	bearer  string
	name    string
}

func (r *fakeBindingResolver) Resolve(_ context.Context, bearer, definition string) (link.Binding, error) {
	r.bearer, r.name = bearer, definition
	return r.binding, r.err
}

func TestAppInstallationEndpointAndLinkState(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "bEaReR viewer", r.Header.Get("Authorization"))
		require.Empty(t, r.Header.Get("Cookie"))
		require.Equal(t, "/api/directory/v1/groups?q=sales", r.URL.RequestURI())
		_, _ = w.Write([]byte(`{"items":[{"name":"Sales"}]}`))
	}))
	defer server.Close()
	definition := "directory"
	source := domain.DataSource{ID: "directory", Kind: domain.SourceCatalogApp, Name: "Directory", Definition: &definition}
	resolver := &fakeBindingResolver{binding: link.Binding{State: link.StateReady, InternalURL: server.URL}}
	e := New(nil, server.Client(), resolver)
	t.Cleanup(func() { require.NoError(t, e.Close()) })
	req := domain.RunRequest{Source: source, Bearer: "bEaReR viewer", Query: domain.Query{Mode: domain.QueryRead, HTTP: &domain.HTTPQuery{Method: "GET", Path: "/api/directory/v1/groups?q=sales", ResultPath: "items"}}}
	result, err := e.Run(t.Context(), req)
	require.NoError(t, err)
	require.Equal(t, [][]any{{"Sales"}}, result.Rows)
	require.Equal(t, req.Bearer, resolver.bearer)
	require.Equal(t, definition, resolver.name)
	require.Equal(t, domain.SourceReady, e.State(t.Context(), req.Bearer, source).Status)

	for _, tc := range []struct {
		state   link.State
		status  domain.DataSourceStatus
		message string
	}{
		{link.StateAbsent, domain.SourceError, "Directory is not installed in this Project"},
		{link.StateUnsupported, domain.SourceError, "Directory is not installed in this Project"},
		{link.StateInstalling, domain.SourcePending, "Directory is still installing"},
	} {
		t.Run(string(tc.state), func(t *testing.T) {
			resolver.binding.State = tc.state
			_, err := e.Run(t.Context(), req)
			require.Equal(t, tc.message, requireCode(t, err, "data_source_unavailable").Message)
			state := e.State(t.Context(), req.Bearer, source)
			require.Equal(t, tc.status, state.Status)
			require.Equal(t, tc.message, state.Message)
		})
	}
	resolver.err = link.ErrUnavailable
	_, err = e.Run(t.Context(), req)
	require.Equal(t, "unreachable", requireCode(t, err, "data_source_unavailable").Message)
	resolver.err = &link.DeniedError{Status: 403}
	_, err = e.Run(t.Context(), req)
	var denied *link.DeniedError
	require.True(t, errors.As(err, &denied))
	require.Equal(t, 403, denied.Status)

	resolver.err = nil
	resolver.binding.State = link.StateReady
	req.Query.HTTP.Method = "POST"
	_, err = e.Run(t.Context(), req)
	requireCode(t, err, "query_not_read_only")
}
