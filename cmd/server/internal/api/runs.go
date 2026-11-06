package api

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/appthrust/appserver-go/appserver/httpx"
	"github.com/appthrust/tool-builder/cmd/server/internal/domain"
	"github.com/appthrust/tool-builder/cmd/server/internal/store"
)

type runInput struct {
	Inputs       map[string]any `json:"inputs"`
	ConfirmWrite bool           `json:"confirmWrite"`
}

func queryByID(doc domain.Document, id string) (domain.Query, error) {
	for _, q := range doc.Queries {
		if q.ID == id {
			return q, nil
		}
	}
	return domain.Query{}, httpx.NotFound()
}
func actionByID(doc domain.Document, id string) (domain.Action, error) {
	for _, p := range doc.Pages {
		for _, c := range p.Components {
			for _, a := range c.Actions {
				if a.ID == id {
					return a, nil
				}
			}
		}
	}
	return domain.Action{}, httpx.NotFound()
}
func inputFor(s *request) (runInput, error) {
	var input runInput
	if err := decode(s, &input); err != nil {
		return input, err
	}
	if input.Inputs == nil {
		return input, httpx.Invalid("inputs must be an object")
	}
	return input, nil
}

type preparedRun struct {
	tool      domain.Tool
	grants    domain.Grants
	release   *domain.Release
	action    domain.Action
	query     domain.Query
	source    domain.DataSource
	sourceErr error
}

// Resolve one immutable execution snapshot, including grants and the source,
// then release the built-in app connection before touching the external data source.
func (a *API) prepareRun(s *request, draft, action bool) (p preparedRun, err error) {
	err = a.store.Do(s.r.Context(), false, func(tx *store.Tx) error {
		s.tx = tx
		defer func() { s.tx = nil }()
		var err error
		p.tool, p.grants, _, err = a.authorizedTool(s, draft)
		if err != nil {
			return err
		}
		doc := p.tool.Draft
		if !draft {
			p.release, err = tx.Live(p.tool)
			if err != nil {
				return err
			}
			if p.release == nil {
				return httpx.NotFound()
			}
			doc = p.release.Document
		}
		id := s.r.PathValue("id")
		if action {
			p.action, err = actionByID(doc, id)
			if err != nil {
				return err
			}
			id = p.action.QueryID
		}
		p.query, err = queryByID(doc, id)
		if err != nil {
			return err
		}
		// A draft can contain unfinished queries, but the selected query must
		// pass validation before execution, including empty SQL and bindings.
		if draft {
			for i, q := range doc.Queries {
				if q.ID != id {
					continue
				}
				path := "queries." + strconv.Itoa(i)
				problems := []domain.Problem{}
				for _, problem := range domain.Validate(doc) {
					if problem.Path == path || strings.HasPrefix(problem.Path, path+".") {
						problems = append(problems, problem)
					}
				}
				if len(problems) > 0 {
					return &store.InvalidDocumentError{Problems: problems}
				}
				break
			}
		}
		p.source, p.sourceErr = tx.Source(p.query.SourceID)
		if errors.Is(p.sourceErr, sql.ErrNoRows) {
			p.sourceErr = httpx.NotFound()
		}
		if p.sourceErr == nil && (p.source.Kind == domain.SourcePostgres && p.query.SQL == nil || (p.source.Kind == domain.SourceHTTP || p.source.Kind == domain.SourceCatalogApp) && p.query.HTTP == nil) {
			p.sourceErr = httpx.Invalid("Query and data source kinds do not match")
		}
		return nil
	})
	return p, err
}

func (a *API) run(s *request, p preparedRun, inputs map[string]any, write bool) (domain.RunResult, error) {
	if p.sourceErr != nil {
		return domain.RunResult{}, p.sourceErr
	}
	return a.engine.Run(s.r.Context(), domain.RunRequest{Source: p.source, Query: p.query, Inputs: inputs, Write: write, Bearer: s.bearer})
}

func (a *API) recordRun(s *request, run domain.ActionRun) error {
	return a.store.Do(s.r.Context(), true, func(tx *store.Tx) error {
		return tx.RecordRun(run, s.personID())
	})
}

func (a *API) queryRun(s *request) (any, int, error) {
	p, err := a.prepareRun(s, false, false)
	if err != nil {
		return nil, 0, err
	}
	if p.query.Mode != domain.QueryRead {
		return nil, 0, httpx.Fail(400, "query_not_read_only", "Write queries must run through an action")
	}
	input, err := inputFor(s)
	if err != nil {
		return nil, 0, err
	}
	result, err := a.run(s, p, input.Inputs, false)
	return result, 200, err
}

func (a *API) draftRun(s *request) (any, int, error) {
	p, err := a.prepareRun(s, true, false)
	if err != nil {
		return nil, 0, err
	}
	input, err := inputFor(s)
	if err != nil {
		return nil, 0, err
	}
	if p.query.Mode != domain.QueryWrite {
		result, err := a.run(s, p, input.Inputs, false)
		return result, 200, err
	}
	if !input.ConfirmWrite {
		return nil, 0, httpx.Fail(400, "write_not_confirmed", "Confirm running this write query")
	}
	run, err := newRun(s, p.tool, nil, domain.Action{}, p.query, input.Inputs)
	if err != nil {
		return nil, 0, err
	}
	result, runErr := a.run(s, p, input.Inputs, true)
	finishRun(&run, result, runErr)
	if err := a.recordRun(s, run); err != nil {
		return nil, 0, err
	}
	return result, 200, runErr
}

func (a *API) actionRun(s *request) (any, int, error) {
	p, err := a.prepareRun(s, false, true)
	if err != nil {
		return nil, 0, err
	}
	if p.query.Mode != domain.QueryWrite {
		return nil, 0, httpx.Invalid("An action must reference a write query")
	}
	input, err := inputFor(s)
	if err != nil {
		return nil, 0, err
	}
	run, err := newRun(s, p.tool, p.release, p.action, p.query, input.Inputs)
	if err != nil {
		return nil, 0, err
	}
	allowed := true
	if !s.admin {
		for _, grant := range p.grants.Actions {
			if grant.ActionID == p.action.ID {
				allowed = false
				for _, id := range grant.GroupIDs {
					allowed = allowed || s.inGroup(id)
				}
				break
			}
		}
	}
	if !allowed {
		run.Status = domain.RunDenied
		reason := "action_denied"
		run.Error = &reason
		run.FinishedAt = time.Now().UTC()
		if err := a.recordRun(s, run); err != nil {
			return nil, 0, err
		}
		return nil, 0, httpx.Fail(403, "action_denied", "This action is limited to other groups")
	}
	result, runErr := a.run(s, p, input.Inputs, true)
	finishRun(&run, result, runErr)
	if err := a.recordRun(s, run); err != nil {
		return nil, 0, err
	}
	refresh := []string{}
	if p.action.OnSuccess != nil && p.action.OnSuccess.Refresh != nil {
		refresh = p.action.OnSuccess.Refresh
	}
	return map[string]any{"runId": run.ID, "rowCount": result.RowCount, "refresh": refresh, "durationMs": result.DurationMs}, 200, runErr
}
func newRun(s *request, t domain.Tool, release *domain.Release, action domain.Action, q domain.Query, inputs map[string]any) (domain.ActionRun, error) {
	// encoding/json sorts object keys recursively. Inputs were decoded to JSON
	// values, so equivalent object key orders hash identically; values never persist.
	canonical, err := json.Marshal(inputs)
	if err != nil {
		return domain.ActionRun{}, err
	}
	sum := sha256.Sum256(canonical)
	run := domain.ActionRun{ID: store.NewID(), ToolID: t.ID, ActionID: action.ID, ActionLabel: action.Label, QueryID: q.ID, Actor: s.actor(), ParamsHash: hex.EncodeToString(sum[:]), StartedAt: time.Now().UTC()}
	if release != nil {
		run.ReleaseID = release.ID
		run.ReleaseNumber = release.Number
	}
	return run, nil
}
func finishRun(run *domain.ActionRun, result domain.RunResult, err error) {
	run.FinishedAt = time.Now().UTC()
	run.Status = domain.RunOK
	if err == nil {
		run.RowCount = &result.RowCount
		return
	}
	run.Status = domain.RunFailed
	code := "query_failed"
	var failure *domain.RunError
	if errors.As(err, &failure) {
		code = failure.Code
	}
	run.Error = &code
}
