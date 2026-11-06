package api

import (
	"crypto/sha256"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/appthrust/appserver-go/appserver/httpx"
	"github.com/appthrust/tool-builder/cmd/server/internal/domain"
)

type componentKey struct {
	id     string
	bearer [32]byte
}

type componentApplication struct {
	name    string
	expires time.Time
}

type linkedTool struct {
	Slug              string `json:"slug"`
	Name              string `json:"name"`
	Description       string `json:"description"`
	URL               string `json:"url"`
	LiveReleaseNumber int    `json:"liveReleaseNumber"`
}

func (a *API) componentApplication(s *request, id string) (string, error) {
	key := componentKey{id: id, bearer: sha256.Sum256([]byte(s.bearer))}
	a.componentsMu.Lock()
	cached, ok := a.components[key]
	a.componentsMu.Unlock()
	if ok && time.Now().Before(cached.expires) {
		return cached.name, nil
	}
	var component struct {
		ApplicationID string `json:"applicationId"`
	}
	status, err := a.platformRequest(s.r.Context(), s.bearer, http.MethodGet, a.projectPath("/components/"+url.PathEscape(id)), nil, &component)
	if err != nil && status != http.StatusNotFound {
		return "", err
	}
	a.componentsMu.Lock()
	defer a.componentsMu.Unlock()
	for key, entry := range a.components {
		if !time.Now().Before(entry.expires) {
			delete(a.components, key)
		}
	}
	a.components[key] = componentApplication{name: component.ApplicationID, expires: time.Now().Add(time.Minute)}
	return component.ApplicationID, nil
}

func (a *API) applicationTools(s *request) (any, int, error) {
	app := s.r.URL.Query().Get("app")
	if !domain.ValidSlug(app) {
		return nil, 0, httpx.Invalid("app must be an Application name")
	}
	limit := 50
	if raw := s.r.URL.Query().Get("limit"); raw != "" {
		var err error
		limit, err = strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > 200 {
			return nil, 0, httpx.Invalid("limit must be between 1 and 200")
		}
	}
	tools, err := s.tx.Tools()
	if err != nil {
		return nil, 0, err
	}
	sources, err := s.tx.Sources()
	if err != nil {
		return nil, 0, err
	}
	byID := make(map[string]domain.DataSource, len(sources))
	for _, source := range sources {
		byID[source.ID] = source
	}
	items := make([]linkedTool, 0)
	for _, tool := range tools {
		if tool.LiveReleaseID == nil {
			continue
		}
		grants, err := s.tx.Grants(tool.ID)
		if err != nil {
			return nil, 0, err
		}
		if !s.access(grants).Use {
			continue
		}
		live, err := s.tx.Live(tool)
		if err != nil {
			return nil, 0, err
		}
		if live == nil {
			continue
		}
		for _, query := range live.Document.Queries {
			source, ok := byID[query.SourceID]
			if !ok || source.DestinationComponentID == "" || source.Kind != domain.SourcePostgres && source.Kind != domain.SourceHTTP {
				continue
			}
			name, err := a.componentApplication(s, source.DestinationComponentID)
			if err != nil {
				return nil, 0, err
			}
			if name == app {
				items = append(items, linkedTool{Slug: tool.Slug, Name: tool.Name, Description: tool.Description, URL: strings.TrimRight(a.publicURL, "/") + "/t/" + url.PathEscape(tool.Slug), LiveReleaseNumber: live.Number})
				break
			}
		}
		if len(items) == limit {
			break
		}
	}
	return map[string]any{"items": items}, 200, nil
}
