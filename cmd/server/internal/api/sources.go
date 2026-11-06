package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/appthrust/appserver-go/appserver/httpx"
	"github.com/appthrust/tool-builder/cmd/server/internal/domain"
	"github.com/appthrust/tool-builder/cmd/server/internal/store"
)

type sourceDTO struct {
	domain.DataSource
	Status        domain.DataSourceStatus `json:"status"`
	StatusMessage *string                 `json:"statusMessage"`
}

func (a *API) sourceDTO(s *request, source domain.DataSource) sourceDTO {
	state := a.engine.State(s.r.Context(), s.bearer, source)
	var message *string
	if state.Message != "" {
		message = &state.Message
	}
	return sourceDTO{source, state.Status, message}
}
func (a *API) projectPath(suffix string) string {
	return "/api/v1/projects/" + url.PathEscape(a.platform.ProjectID) + suffix
}
func (a *API) platformRequest(ctx context.Context, bearer, method, path string, input, out any) (int, error) {
	var body bytes.Buffer
	if input != nil {
		if err := json.NewEncoder(&body).Encode(input); err != nil {
			return 0, err
		}
	}
	r, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(a.upstream, "/")+path, &body)
	if err != nil {
		return 0, err
	}
	r.Header.Set("Authorization", bearer)
	r.Header.Set("Accept", "application/json")
	if method != http.MethodGet {
		// Platform write-channel operations require an idempotency key, even
		// though the built-in app API itself has no caller-supplied idempotency contract.
		r.Header.Set("Idempotency-Key", store.NewID())
	}
	if input != nil {
		r.Header.Set("Content-Type", "application/json")
	}
	res, err := a.http.Do(r)
	if err != nil {
		return 0, httpx.Fail(502, "upstream_unavailable", "The platform is temporarily unavailable")
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		var failure struct {
			Error   string         `json:"error"`
			Message string         `json:"message"`
			Details map[string]any `json:"details"`
		}
		_ = json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&failure)
		if res.StatusCode >= 400 && res.StatusCode < 500 && failure.Error != "" {
			if failure.Details != nil {
				return res.StatusCode, detail(res.StatusCode, failure.Error, failure.Message, failure.Details)
			}
			return res.StatusCode, httpx.Fail(res.StatusCode, failure.Error, failure.Message)
		}
		return res.StatusCode, httpx.Fail(502, "upstream_unavailable", "The platform could not complete the request")
	}
	if out != nil {
		if err := json.NewDecoder(io.LimitReader(res.Body, 8<<20)).Decode(out); err != nil {
			return res.StatusCode, httpx.Fail(502, "upstream_unavailable", "The platform returned an invalid response")
		}
	}
	return res.StatusCode, nil
}

type ProjectDatabase struct {
	ComponentID     string  `json:"componentId"`
	ApplicationID   string  `json:"applicationId"`
	ApplicationName string  `json:"applicationName"`
	Name            string  `json:"name"`
	Engine          string  `json:"engine"`
	Connectable     bool    `json:"connectable"`
	Reason          *string `json:"reason"`
}

func (a *API) databases(s *request) (any, int, error) {
	if !s.admin {
		return nil, 0, httpx.Forbidden()
	}
	// The Platform API enforces marketplace workload connection authority.
	// The local picker only restricts the supported database engine.
	var response struct {
		Data []struct {
			ID              string `json:"id"`
			ApplicationID   string `json:"applicationId"`
			ApplicationName string `json:"applicationName"`
			Name            string `json:"name"`
			Provider        string `json:"provider"`
			Engine          string `json:"engine"`
		} `json:"data"`
	}
	if _, err := a.platformRequest(s.r.Context(), s.bearer, "GET", a.projectPath("/databases"), nil, &response); err != nil {
		return nil, 0, err
	}
	out := []ProjectDatabase{}
	for _, db := range response.Data {
		engine := db.Provider
		if engine == "" {
			engine = db.Engine
		}
		reason := ""
		if !strings.EqualFold(engine, "CNPG") {
			reason = "engine_unsupported"
		}
		item := ProjectDatabase{ComponentID: db.ID, ApplicationID: db.ApplicationID, ApplicationName: db.ApplicationName, Name: db.Name, Engine: engine, Connectable: reason == ""}
		if reason != "" {
			item.Reason = &reason
		}
		out = append(out, item)
	}
	return httpx.Data(out), 200, nil
}
func (a *API) sources(s *request) (any, int, error) {
	if err := a.requireEditor(s); err != nil {
		return nil, 0, err
	}
	sources, err := s.tx.Sources()
	if err != nil {
		return nil, 0, err
	}
	out := []sourceDTO{}
	for _, source := range sources {
		out = append(out, a.sourceDTO(s, source))
	}
	return httpx.Data(out), 200, nil
}
func (a *API) createSource(s *request) (any, int, error) {
	if !s.admin {
		return nil, 0, httpx.Forbidden()
	}
	var input struct {
		Kind                   domain.DataSourceKind `json:"kind"`
		Name                   string                `json:"name"`
		Slug                   string                `json:"slug"`
		ConnectionName         string                `json:"connectionName"`
		DestinationComponentID string                `json:"destinationComponentId"`
		Definition             string                `json:"definition"`
	}
	if err := decode(s, &input); err != nil {
		return nil, 0, err
	}
	input.Name = strings.TrimSpace(input.Name)
	if !domain.ValidSlug(input.Slug) || input.Name == "" || input.Kind != domain.SourcePostgres && input.Kind != domain.SourceHTTP && input.Kind != domain.SourceCatalogApp {
		return nil, 0, httpx.Invalid("A name, DNS-label slug and source kind are required")
	}
	source := domain.DataSource{ID: store.NewID(), Slug: input.Slug, Name: input.Name, Kind: input.Kind, DestinationComponentID: input.DestinationComponentID, CreatedBy: s.claims.Principal.Subject, CreatedAt: time.Now().UTC()}
	if input.Kind == domain.SourceCatalogApp {
		if input.Definition == "" || input.DestinationComponentID != "" || input.ConnectionName != "" {
			return nil, 0, httpx.Invalid("A built-in app source requires only a built-in app definition")
		}
		if err := a.requireDeclaredLink(s, input.Definition); err != nil {
			return nil, 0, err
		}
		source.Definition = &input.Definition
	} else if input.DestinationComponentID == "" {
		return nil, 0, httpx.Invalid("A destination component is required")
	}
	if input.Kind == domain.SourcePostgres {
		if input.ConnectionName == "" {
			input.ConnectionName = input.Slug
		}
		if !domain.ValidSlug(input.ConnectionName) || input.ConnectionName == "database" {
			return nil, 0, httpx.Invalid("A non-reserved DNS-label connection name is required")
		}
		source.ConnectionName = &input.ConnectionName
	}
	existing, err := s.tx.Sources()
	if err != nil {
		return nil, 0, err
	}
	for _, v := range existing {
		if v.Slug == source.Slug || source.ConnectionName != nil && v.ConnectionName != nil && *source.ConnectionName == *v.ConnectionName {
			return nil, 0, httpx.Fail(409, "slug_taken", "This slug or connection name is already in use")
		}
	}
	if source.Kind == domain.SourcePostgres {
		path := a.projectPath("/component-connections")
		componentID, err := a.toolBuilderComponent(s.r.Context(), s.bearer)
		if err != nil {
			return nil, 0, err
		}
		var connection struct {
			ID string `json:"id"`
		}
		status, err := a.platformRequest(s.r.Context(), s.bearer, "POST", path, map[string]string{"sourceComponentId": componentID, "connectionName": input.ConnectionName, "destinationComponentId": input.DestinationComponentID}, &connection)
		if err != nil {
			return nil, 0, err
		}
		// Compensate only a connection this request actually created, never an
		// existing/replayed connection. The row and external intent are not a DB tx.
		if (status == http.StatusCreated || status == http.StatusAccepted) && connection.ID != "" {
			s.rollback = func() {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				_, _ = a.platformRequest(ctx, s.bearer, "DELETE", path+"/"+url.PathEscape(connection.ID), nil, nil)
			}
		}
	} else if source.Kind == domain.SourceHTTP {
		var component struct {
			InternalService *struct {
				URL string `json:"url"`
			} `json:"internalService"`
		}
		if _, err := a.platformRequest(s.r.Context(), s.bearer, "GET", a.projectPath("/components/"+url.PathEscape(input.DestinationComponentID)), nil, &component); err != nil {
			return nil, 0, err
		}
		if component.InternalService == nil || !validInternalURL(component.InternalService.URL) {
			return nil, 0, httpx.Fail(400, "internal_service_required", "Enable an internal service on the destination application")
		}
		source.BaseURL = &component.InternalService.URL
	}
	if err := s.tx.InsertSource(source); err != nil {
		return nil, 0, err
	}
	return a.sourceDTO(s, source), 201, nil
}
func validInternalURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && u.Scheme == "http" && u.User == nil && u.RawQuery == "" && !u.ForceQuery && u.Fragment == "" && (u.Path == "" || u.Path == "/") && (strings.HasSuffix(u.Hostname(), ".svc") || strings.HasSuffix(u.Hostname(), ".svc.cluster.local"))
}
func (a *API) deleteSource(s *request) (any, int, error) {
	if !s.admin {
		return nil, 0, httpx.Forbidden()
	}
	source, err := s.tx.Source(s.r.PathValue("id"))
	if err != nil {
		return nil, 0, err
	}
	if err := s.tx.CheckSourceUnused(source.ID); err != nil {
		return nil, 0, err
	}
	if source.Kind == domain.SourcePostgres && source.ConnectionName != nil {
		if err := a.deleteDatabaseConnection(s.r.Context(), s.bearer, source); err != nil {
			return nil, 0, err
		}
	}
	return nil, 204, s.tx.DeleteSource(source.ID)
}
func (a *API) schema(s *request) (any, int, error) {
	if err := a.requireEditor(s); err != nil {
		return nil, 0, err
	}
	source, err := s.tx.Source(s.r.PathValue("id"))
	if err != nil {
		return nil, 0, err
	}
	if source.Kind == domain.SourceCatalogApp {
		return a.sourceOperations(s, source)
	}
	if source.Kind != domain.SourcePostgres {
		return nil, 0, httpx.Invalid("Schema inspection is available for database sources")
	}
	result, err := a.engine.Schema(s.r.Context(), source)
	return result, 200, err
}

func (a *API) requireEditor(s *request) error {
	if s.admin {
		return nil
	}
	tools, err := s.tx.Tools()
	if err != nil {
		return err
	}
	for _, tool := range tools {
		grants, err := s.tx.Grants(tool.ID)
		if err != nil {
			return err
		}
		if s.access(grants).Edit {
			return nil
		}
	}
	return httpx.Forbidden()
}

// Resolve the current user-owned web component; adopted stacks retain their physical names.
func (a *API) toolBuilderComponent(ctx context.Context, bearer string) (string, error) {
	var installation struct {
		StackID string `json:"stackId"`
	}
	if _, err := a.platformRequest(ctx, bearer, http.MethodGet, a.projectPath("/app-installations/tool-builder"), nil, &installation); err != nil {
		return "", err
	}
	if installation.StackID == "" {
		return "", httpx.Fail(409, "installation_not_ready", "The Tool Builder installation is not ready")
	}
	var stack struct {
		WebComponentID string `json:"webComponentId"`
	}
	if _, err := a.platformRequest(ctx, bearer, http.MethodGet, a.projectPath("/application-stacks/"+url.PathEscape(installation.StackID)), nil, &stack); err != nil {
		return "", err
	}
	if stack.WebComponentID == "" {
		return "", httpx.Fail(409, "installation_not_ready", "The Tool Builder workload is not ready")
	}
	return stack.WebComponentID, nil
}

func (a *API) deleteDatabaseConnection(ctx context.Context, bearer string, source domain.DataSource) error {
	componentID, err := a.toolBuilderComponent(ctx, bearer)
	if err != nil {
		return err
	}
	var connections struct {
		Data []struct {
			ID                     string `json:"id"`
			SourceComponentID      string `json:"sourceComponentId"`
			DestinationComponentID string `json:"destinationComponentId"`
			ConnectionName         string `json:"connectionName"`
		} `json:"data"`
	}
	if _, err := a.platformRequest(ctx, bearer, http.MethodGet, a.projectPath("/component-connections"), nil, &connections); err != nil {
		return err
	}
	for _, connection := range connections.Data {
		if connection.SourceComponentID != componentID || connection.DestinationComponentID != source.DestinationComponentID || connection.ConnectionName != *source.ConnectionName {
			continue
		}
		if status, err := a.platformRequest(ctx, bearer, http.MethodDelete, a.projectPath("/component-connections/"+url.PathEscape(connection.ID)), nil, nil); err != nil && status != http.StatusNotFound {
			return err
		}
	}
	return nil
}
