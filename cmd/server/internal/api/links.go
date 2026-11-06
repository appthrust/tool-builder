package api

import (
	"errors"
	"net/url"
	"strings"

	"github.com/appthrust/appserver-go/appserver/contract/directory"
	"github.com/appthrust/appserver-go/appserver/httpx"
	"github.com/appthrust/appserver-go/appserver/link"
)

func linkError(err error) error {
	var denied *link.DeniedError
	if errors.As(err, &denied) {
		return httpx.Fail(denied.Status, "link_denied", "The built-in app denied this request")
	}
	var rejected *link.RejectedError
	if errors.As(err, &rejected) {
		return httpx.Fail(rejected.Status, rejected.Code, rejected.Message)
	}
	return httpx.Fail(503, "tool_builder_link_unavailable", "The built-in app link is temporarily unavailable")
}

func (a *API) directoryGroups(s *request) ([]directory.Group, error) {
	var result directory.GroupList
	err := a.links.Do(s.r.Context(), s.bearer, directory.ListGroups, link.Params{}, nil, &result)
	if err != nil && !errors.Is(err, link.ErrAbsent) {
		return nil, linkError(err)
	}
	if result.Items == nil {
		result.Items = []directory.Group{}
	}
	return result.Items, nil
}

func (a *API) directoryPeople(s *request, ids []string) (map[string]directory.Person, error) {
	out := make(map[string]directory.Person, len(ids))
	for start := 0; start < len(ids); start += 100 {
		var result directory.PersonList
		params := link.Params{Query: url.Values{"ids": {strings.Join(ids[start:min(start+100, len(ids))], ",")}, "limit": {"100"}}}
		if err := a.links.Do(s.r.Context(), s.bearer, directory.ListPeople, params, nil, &result); err != nil {
			if errors.Is(err, link.ErrAbsent) {
				return out, nil
			}
			return nil, linkError(err)
		}
		for _, person := range result.Items {
			out[person.ID] = person
		}
	}
	return out, nil
}

type linkDTO struct {
	Definition string     `json:"definition"`
	State      link.State `json:"state"`
	PublicURL  string     `json:"publicUrl,omitempty"`
}

func (a *API) listLinks(s *request) (any, int, error) {
	if err := a.requireEditor(s); err != nil {
		return nil, 0, err
	}
	bindings, err := a.links.Resolver().List(s.r.Context(), s.bearer)
	if err != nil {
		return nil, 0, linkError(err)
	}
	items := make([]linkDTO, 0, len(bindings))
	for _, binding := range bindings {
		items = append(items, linkDTO{Definition: binding.Definition, State: binding.State, PublicURL: binding.PublicURL})
	}
	return map[string]any{"items": items}, 200, nil
}

func (a *API) requireDeclaredLink(s *request, definition string) error {
	bindings, err := a.links.Resolver().List(s.r.Context(), s.bearer)
	if err != nil {
		return linkError(err)
	}
	for _, binding := range bindings {
		if binding.Definition == definition {
			return nil
		}
	}
	return httpx.Fail(400, "link_not_declared", "This built-in app is not a declared link")
}
