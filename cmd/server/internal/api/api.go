package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"sync"
	"time"

	"github.com/appthrust/appserver-go/appserver/contract/directory"
	"github.com/appthrust/appserver-go/appserver/httpx"
	"github.com/appthrust/appserver-go/appserver/identity"
	"github.com/appthrust/appserver-go/appserver/link"
	"github.com/appthrust/appserver-go/appserver/platformclient"
	"github.com/appthrust/tool-builder/cmd/server/internal/domain"
	"github.com/appthrust/tool-builder/cmd/server/internal/store"
)

const base = "/api/tool-builder/v1"

type API struct {
	store        *store.Store
	engine       Engine
	identity     *identity.Authenticator
	platform     *platformclient.Client
	links        *link.Client
	publicURL    string
	componentsMu sync.Mutex
	components   map[componentKey]componentApplication
	upstream     string
	http         *http.Client
	mux          *http.ServeMux
}
type request struct {
	r        *http.Request
	w        http.ResponseWriter
	tx       *store.Tx
	claims   identity.Identity
	bearer   string
	admin    bool
	me       directory.MeResponse
	rollback func()
}
type endpoint func(*request) (any, int, error)
type detailedError struct {
	Status  int    `json:"-"`
	Code    string `json:"error"`
	Message string `json:"message"`
	Details any    `json:"details"`
}

func (e *detailedError) Error() string { return e.Code + ": " + e.Message }

func detail(status int, code, message string, details any) error {
	return &detailedError{Status: status, Code: code, Message: message, Details: details}
}

// The origin is explicit because platformclient intentionally exposes only
// shared team-role operations, not an arbitrary authenticated proxy.
func New(database *store.Store, eng Engine, auth *identity.Authenticator, platform *platformclient.Client, links *link.Client, origin, publicURL string) http.Handler {
	a := &API{store: database, engine: eng, identity: auth, platform: platform, links: links, upstream: origin, publicURL: publicURL, components: make(map[componentKey]componentApplication), http: &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, mux: http.NewServeMux()}
	a.handle("GET "+base+"/openapi.json", a.openapi)
	a.route("GET "+base+"/links", false, a.listLinks)
	a.route("GET "+base+"/me", false, a.me)
	a.route("GET "+base+"/groups", false, a.groups)
	a.route("GET "+base+"/project/databases", false, a.databases)
	a.route("GET "+base+"/data-sources", false, a.sources)
	a.route("POST "+base+"/data-sources", true, a.createSource)
	a.route("DELETE "+base+"/data-sources/{id}", true, a.deleteSource)
	a.route("GET "+base+"/data-sources/{id}/schema", false, a.schema)
	a.route("GET "+base+"/data-sources/{id}/operations", false, a.operations)
	a.route("GET "+base+"/tools", false, a.tools)
	a.route("POST "+base+"/tools", true, a.createTool)
	a.route("GET "+base+"/tools/{slug}", false, a.tool)
	a.route("PATCH "+base+"/tools/{slug}", true, a.patchTool)
	a.route("DELETE "+base+"/tools/{slug}", true, a.archiveTool)
	a.route("PUT "+base+"/tools/{slug}/draft", true, a.putDraft)
	a.handle("POST "+base+"/tools/{slug}/draft/queries/{id}/run", a.draftRun)
	a.handle("POST "+base+"/tools/{slug}/queries/{id}/run", a.queryRun)
	a.handle("POST "+base+"/tools/{slug}/actions/{id}/run", a.actionRun)
	a.route("GET "+base+"/tools/{slug}/releases", false, a.releases)
	a.route("GET "+base+"/tools/{slug}/releases/{n}", false, a.release)
	a.route("POST "+base+"/tools/{slug}/releases", true, a.publish)
	a.route("POST "+base+"/tools/{slug}/releases/{n}/restore", true, a.restore)
	a.route("GET "+base+"/tools/{slug}/grants", false, a.grants)
	a.route("PUT "+base+"/tools/{slug}/grants", true, a.putGrants)
	a.route("GET "+base+"/tools/{slug}/runs", false, a.runs)
	a.mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { httpx.WriteError(w, httpx.NotFound(), "tool_builder") })
	return a
}
func Unavailable() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		httpx.WriteError(w, httpx.Fail(503, "tool_builder_store_unavailable", "The tool builder database is not available"), "tool_builder")
	})
}
func (a *API) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	a.mux.ServeHTTP(w, r)
}
func (a *API) route(pattern string, mutation bool, handler endpoint) {
	a.handle(pattern, func(s *request) (body any, status int, err error) {
		err = a.store.Do(s.r.Context(), mutation, func(tx *store.Tx) error {
			s.tx = tx
			var err error
			body, status, err = handler(s)
			return err
		})
		return body, status, err
	})
}

// Run handlers own their short resolution/audit transactions; authentication
// and response handling remain identical to the other routes.
func (a *API) handle(pattern string, handler endpoint) {
	a.mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
		defer cancel()
		r = r.WithContext(ctx)
		claims, _, err := a.identity.Authenticate(ctx, r.Header.Get("Authorization"))
		if err != nil {
			if errors.Is(err, identity.ErrUnavailable) {
				err = httpx.Fail(503, "identity_unavailable", "The identity provider is temporarily unavailable")
			} else if errors.Is(err, identity.ErrRawKeyNotAccepted) {
				err = httpx.Fail(401, "raw_key_not_accepted", "Exchange the access key for an assertion before calling this API")
			} else {
				err = httpx.Fail(401, "unauthenticated", "A valid bearer token is required")
			}
			writeError(w, err)
			return
		}
		s := &request{r: r, w: w, claims: claims, bearer: r.Header.Get("Authorization")}
		access, err := a.platform.Access(ctx, claims.Principal.Subject, s.bearer)
		if err != nil {
			writeError(w, httpx.Fail(502, "upstream_unavailable", "The platform is temporarily unavailable"))
			return
		}
		s.admin = access.IsConsoleAdmin
		if r.URL.Path != base+"/openapi.json" {
			err = a.links.Do(ctx, s.bearer, directory.Me, link.Params{}, nil, &s.me)
			if err != nil && !errors.Is(err, link.ErrAbsent) {
				var denied *link.DeniedError
				if !s.admin || errors.As(err, &denied) {
					writeError(w, linkError(err))
					return
				}
				s.me = directory.MeResponse{}
			}
			if s.me.EffectiveGroupIDs == nil {
				s.me.EffectiveGroupIDs = []string{}
			}
		}
		body, status, err := handler(s)
		if err != nil {
			if s.rollback != nil {
				s.rollback()
			}
			writeError(w, err)
			return
		}
		if status == 204 {
			w.WriteHeader(status)
			return
		}
		if raw, ok := body.(json.RawMessage); ok {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(status)
			_, _ = w.Write(raw)
			return
		}
		httpx.WriteJSON(w, status, body)
	})
}
func writeError(w http.ResponseWriter, err error) {
	var denied *link.DeniedError
	if errors.As(err, &denied) {
		httpx.WriteError(w, linkError(err), "tool_builder")
		return
	}
	var d *detailedError
	if errors.As(err, &d) {
		httpx.WriteJSON(w, d.Status, d)
		return
	}
	var changed *store.DraftChangedError
	if errors.As(err, &changed) {
		httpx.WriteJSON(w, 409, map[string]any{"error": "draft_changed", "message": "The draft changed in another editor", "details": map[string]any{"draftVersion": changed.Tool.DraftVersion, "draft": changed.Tool.Draft}})
		return
	}
	var invalid *store.InvalidDocumentError
	if errors.As(err, &invalid) {
		httpx.WriteJSON(w, 400, map[string]any{"error": "invalid_document", "message": "The document has validation problems", "details": map[string]any{"problems": invalid.Problems}})
		return
	}
	var run *domain.RunError
	if errors.As(err, &run) {
		status := 400
		switch run.Code {
		case "data_source_pending", "data_source_unavailable":
			status = 503
		case "data_source_busy":
			status = 429
			w.Header().Set("Retry-After", "1")
		case "query_timeout":
			status = 504
		case "query_failed":
			status = 400
		}
		httpx.WriteError(w, httpx.Fail(status, run.Code, run.Message), "tool_builder")
		return
	}
	httpx.WriteError(w, err, "tool_builder")
}
func decode(s *request, out any) error {
	media, _, err := mime.ParseMediaType(s.r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		return httpx.Invalid("Content-Type must be application/json")
	}
	raw, err := io.ReadAll(http.MaxBytesReader(s.w, s.r.Body, 1<<20))
	if err != nil {
		return httpx.Invalid("Request body exceeds the size limit")
	}
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || raw[0] != '{' {
		return httpx.Invalid("Request body must be a JSON object")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	if err := d.Decode(out); err != nil {
		return httpx.Invalid("Request body contains invalid fields")
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return httpx.Invalid("Request body must contain one JSON object")
	}
	return nil
}
func (s *request) actor() domain.Actor {
	name := s.me.Person.DisplayName
	if name == "" {
		name = s.claims.Name
	}
	if name == "" {
		name = s.claims.Principal.Subject
	}
	return domain.Actor{Subject: s.claims.Principal.Subject, DisplayName: name}
}
func (s *request) personID() *string {
	if s.me.Person.ID == "" {
		return nil
	}
	id := s.me.Person.ID
	return &id
}
func (s *request) access(g domain.Grants) domain.Access {
	result := domain.Access{Use: s.admin, Edit: s.admin}
	for _, grant := range g.Groups {
		if s.inGroup(grant.GroupID) {
			result.Use = true
			result.Edit = result.Edit || grant.Role == domain.GrantEdit
		}
	}
	return result
}
func (s *request) inGroup(id string) bool {
	for _, group := range s.me.EffectiveGroupIDs {
		if group == id {
			return true
		}
	}
	return false
}
func (a *API) authorizedTool(s *request, edit bool) (domain.Tool, domain.Grants, domain.Access, error) {
	t, err := s.tx.Tool(s.r.PathValue("slug"))
	if err != nil {
		return t, domain.Grants{}, domain.Access{}, err
	}
	g, err := s.tx.Grants(t.ID)
	if err != nil {
		return t, g, domain.Access{}, err
	}
	access := s.access(g)
	if !access.Use || edit && !access.Edit || !access.Edit && t.LiveReleaseID == nil {
		editors := []string{}
		groups, e := a.directoryGroups(s)
		if e == nil {
			for _, grant := range g.Groups {
				if grant.Role == domain.GrantEdit {
					for _, group := range groups {
						if group.ID == grant.GroupID {
							editors = append(editors, group.Name)
							break
						}
					}
				}
			}
		}
		return t, g, access, detail(403, "tool_forbidden", "Request access from the tool's editing groups", map[string]any{"toolName": t.Name, "editors": editors})
	}
	return t, g, access, nil
}
