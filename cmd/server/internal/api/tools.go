package api

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/appthrust/appserver-go/appserver/httpx"
	"github.com/appthrust/tool-builder/cmd/server/internal/domain"
	"github.com/appthrust/tool-builder/cmd/server/internal/store"
)

type toolSummary struct {
	domain.Tool
	Access domain.Access `json:"access"`
}
type liveDocument struct {
	ReleaseNumber int             `json:"releaseNumber"`
	Document      domain.Document `json:"document"`
}
type toolDetail struct {
	toolSummary
	Draft        *domain.Document `json:"draft"`
	DraftVersion *string          `json:"draftVersion"`
	Live         *liveDocument    `json:"live"`
}
type releaseSummary struct {
	domain.Release
	Live bool `json:"live"`
}
type releaseDetail struct {
	releaseSummary
	Document domain.Document `json:"document"`
}

func (s *request) toolDTO(t domain.Tool, access domain.Access) (toolDetail, error) {
	out := toolDetail{toolSummary: toolSummary{t, access}}
	if access.Edit {
		out.Draft = &t.Draft
		out.DraftVersion = &t.DraftVersion
	}
	live, err := s.tx.Live(t)
	if err != nil {
		return out, err
	}
	if live != nil {
		out.Live = &liveDocument{live.Number, live.Document}
	}
	return out, nil
}
func (a *API) me(s *request) (any, int, error) {
	return map[string]any{"subject": s.claims.Principal.Subject, "personId": s.personID(), "displayName": s.actor().DisplayName, "effectiveGroupIds": s.me.EffectiveGroupIDs, "roles": map[string]bool{"admin": s.admin}}, 200, nil
}
func (a *API) groups(s *request) (any, int, error) {
	groups, err := a.directoryGroups(s)
	if err != nil {
		return nil, 0, err
	}
	return httpx.Data(groups), 200, nil
}
func (a *API) tools(s *request) (any, int, error) {
	if s.r.URL.Query().Has("app") {
		return a.applicationTools(s)
	}
	tools, err := s.tx.Tools()
	if err != nil {
		return nil, 0, err
	}
	out := []toolSummary{}
	for _, t := range tools {
		g, err := s.tx.Grants(t.ID)
		if err != nil {
			return nil, 0, err
		}
		access := s.access(g)
		if access.Use && (access.Edit || t.LiveReleaseID != nil) {
			out = append(out, toolSummary{t, access})
		}
	}
	return httpx.Data(out), 200, nil
}
func (a *API) tool(s *request) (any, int, error) {
	t, _, access, err := a.authorizedTool(s, false)
	if err != nil {
		return nil, 0, err
	}
	dto, err := s.toolDTO(t, access)
	return dto, 200, err
}
func (a *API) createTool(s *request) (any, int, error) {
	if !s.admin {
		return nil, 0, httpx.Forbidden()
	}
	var input struct{ Slug, Name, Description string }
	if err := decode(s, &input); err != nil {
		return nil, 0, err
	}
	input.Name = strings.TrimSpace(input.Name)
	if !domain.ValidSlug(input.Slug) || input.Name == "" {
		return nil, 0, httpx.Invalid("A DNS-label slug and a name are required")
	}
	t, err := s.tx.CreateTool(input.Slug, input.Name, input.Description, s.claims.Principal.Subject)
	if err != nil {
		return nil, 0, err
	}
	dto, err := s.toolDTO(t, domain.Access{Use: true, Edit: true})
	return dto, 201, err
}
func (a *API) patchTool(s *request) (any, int, error) {
	t, _, access, err := a.authorizedTool(s, true)
	if err != nil {
		return nil, 0, err
	}
	var input struct{ Name, Description *string }
	if err := decode(s, &input); err != nil {
		return nil, 0, err
	}
	if input.Name != nil {
		t.Name = strings.TrimSpace(*input.Name)
		if t.Name == "" {
			return nil, 0, httpx.Invalid("A name is required")
		}
	}
	if input.Description != nil {
		t.Description = *input.Description
	}
	if err := s.tx.UpdateTool(t); err != nil {
		return nil, 0, err
	}
	dto, err := s.toolDTO(t, access)
	return dto, 200, err
}
func (a *API) archiveTool(s *request) (any, int, error) {
	if !s.admin {
		return nil, 0, httpx.Forbidden()
	}
	t, err := s.tx.Tool(s.r.PathValue("slug"))
	if err != nil {
		return nil, 0, err
	}
	return nil, 204, s.tx.ArchiveTool(t.ID)
}
func (a *API) putDraft(s *request) (any, int, error) {
	t, _, access, err := a.authorizedTool(s, true)
	if err != nil {
		return nil, 0, err
	}
	var doc domain.Document
	if err := decode(s, &doc); err != nil {
		return nil, 0, err
	}
	if problems := domain.Validate(doc); len(problems) > 0 && problems[0].Code == "schema" {
		return nil, 0, &store.InvalidDocumentError{Problems: problems}
	}
	t, err = s.tx.SaveDraft(t, s.r.Header.Get("If-Match"), doc, s.claims.Principal.Subject)
	if err != nil {
		return nil, 0, err
	}
	dto, err := s.toolDTO(t, access)
	return dto, 200, err
}
func (a *API) releases(s *request) (any, int, error) {
	t, _, _, err := a.authorizedTool(s, true)
	if err != nil {
		return nil, 0, err
	}
	rs, err := s.tx.Releases(t.ID)
	if err != nil {
		return nil, 0, err
	}
	out := []releaseSummary{}
	for _, r := range rs {
		out = append(out, releaseSummary{r, t.LiveReleaseID != nil && *t.LiveReleaseID == r.ID})
	}
	return httpx.Data(out), 200, nil
}
func releaseNumber(r *http.Request) (int, error) {
	n, err := strconv.Atoi(r.PathValue("n"))
	if err != nil || n < 1 {
		return 0, httpx.NotFound()
	}
	return n, nil
}
func (a *API) release(s *request) (any, int, error) {
	t, _, _, err := a.authorizedTool(s, true)
	if err != nil {
		return nil, 0, err
	}
	n, err := releaseNumber(s.r)
	if err != nil {
		return nil, 0, err
	}
	r, err := s.tx.Release(t.ID, n)
	if err != nil {
		return nil, 0, err
	}
	return releaseDetail{releaseSummary{r, t.LiveReleaseID != nil && *t.LiveReleaseID == r.ID}, r.Document}, 200, nil
}
func (a *API) publish(s *request) (any, int, error) { return a.publishRelease(s, false) }
func (a *API) restore(s *request) (any, int, error) { return a.publishRelease(s, true) }
func (a *API) publishRelease(s *request, restore bool) (any, int, error) {
	t, _, _, err := a.authorizedTool(s, true)
	if err != nil {
		return nil, 0, err
	}
	var input struct {
		Note string `json:"note"`
	}
	if err := decode(s, &input); err != nil {
		return nil, 0, err
	}
	if match := s.r.Header.Get("If-Match"); match != "" && match != t.DraftVersion {
		return nil, 0, &store.DraftChangedError{Tool: t}
	}
	var from *int
	if restore {
		n, err := releaseNumber(s.r)
		if err != nil {
			return nil, 0, err
		}
		from = &n
	}
	r, err := s.tx.Publish(t, input.Note, s.actor(), from)
	if err != nil {
		return nil, 0, err
	}
	return releaseSummary{r, true}, 201, nil
}
func (a *API) grants(s *request) (any, int, error) {
	_, g, _, err := a.authorizedTool(s, true)
	return g, 200, err
}
func (a *API) putGrants(s *request) (any, int, error) {
	t, _, _, err := a.authorizedTool(s, true)
	if err != nil {
		return nil, 0, err
	}
	var grants domain.Grants
	if err := decode(s, &grants); err != nil {
		return nil, 0, err
	}
	if grants.Groups == nil || grants.Actions == nil {
		return nil, 0, httpx.Invalid("groups and actions must be arrays")
	}
	groups, err := a.directoryGroups(s)
	if err != nil {
		return nil, 0, err
	}
	known := map[string]bool{}
	for _, g := range groups {
		known[g.ID] = true
	}
	seen := map[string]bool{}
	for _, g := range grants.Groups {
		if !known[g.GroupID] || seen[g.GroupID] || g.Role != domain.GrantUse && g.Role != domain.GrantEdit {
			return nil, 0, httpx.Invalid("Each grant must name a distinct Directory group and a use or edit role")
		}
		seen[g.GroupID] = true
	}
	actions := map[string]bool{}
	collect := func(doc domain.Document) {
		for _, p := range doc.Pages {
			for _, c := range p.Components {
				for _, v := range c.Actions {
					actions[v.ID] = true
				}
			}
		}
	}
	collect(t.Draft)
	live, err := s.tx.Live(t)
	if err != nil {
		return nil, 0, err
	}
	if live != nil {
		collect(live.Document)
	}
	seen = map[string]bool{}
	for _, g := range grants.Actions {
		if !actions[g.ActionID] || seen[g.ActionID] || g.GroupIDs == nil {
			return nil, 0, httpx.Invalid("Each action grant must name a distinct existing action and group array")
		}
		seen[g.ActionID] = true
		members := map[string]bool{}
		for _, id := range g.GroupIDs {
			if !known[id] || members[id] {
				return nil, 0, httpx.Invalid("Action groups must be distinct Directory groups")
			}
			members[id] = true
		}
	}
	return grants, 200, s.tx.PutGrants(t.ID, grants)
}
func (a *API) runs(s *request) (any, int, error) {
	t, _, _, err := a.authorizedTool(s, true)
	if err != nil {
		return nil, 0, err
	}
	limit := 50
	if raw := s.r.URL.Query().Get("limit"); raw != "" {
		limit, err = strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > 200 {
			return nil, 0, httpx.Invalid("limit must be between 1 and 200")
		}
	}
	runs, err := s.tx.Runs(t.ID, limit)
	if err != nil {
		return nil, 0, err
	}
	people, err := s.tx.RunPeople(runs)
	if err != nil {
		return nil, 0, err
	}
	ids := []string{}
	seen := map[string]bool{}
	for _, id := range people {
		if !seen[id] {
			ids = append(ids, id)
			seen[id] = true
		}
	}
	hydrated, err := a.directoryPeople(s, ids)
	if err != nil {
		return nil, 0, err
	}
	for i := range runs {
		if person, ok := hydrated[people[runs[i].ID]]; ok {
			runs[i].Actor.DisplayName = person.DisplayName
		}
	}
	return httpx.Data(runs), 200, nil
}
