// Package engine executes tool queries against platform-resolved data sources.
// Read authority is enforced by PostgreSQL transactions, never SQL classification.
//
// A PostgreSQL source orders-db consumes ORDERS_DB_URL, never the built-in app's own
// DATABASE_URL. Missing keys remain pending until platform rollout supplies
// them. Pools allow four connections; sixteen admitted requests share each
// source, waiting at most 500 ms for admission. Failed connectivity is cached
// for five seconds. Call Close after draining server requests.
//
// SQL reads roll back READ ONLY transactions. Confirmed writes commit, retain
// a row-limited RETURNING preview and count every affected row. HTTP sources
// use only platform-resolved hosts and the caller's verbatim Authorization;
// no redirects, shared cookies or static credentials are permitted.
package engine

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/appthrust/tool-builder/cmd/server/internal/domain"
)

const (
	sourceConcurrency = 16
	sourceWait        = 500 * time.Millisecond
	stateTTL          = 5 * time.Second
)

type Engine struct {
	env       func(string) (string, bool)
	http      *http.Client
	mu        sync.Mutex
	sources   map[string]*source
	closed    bool
	resolvers map[domain.DataSourceKind]EndpointResolver
	links     linkEndpoint
}

type source struct {
	sem   chan struct{}
	mu    sync.Mutex
	db    *sql.DB
	state domain.SourceState
}

// New owns its database pools, but not the supplied HTTP transport. A private
// client copy prevents callers from accidentally re-enabling redirects.
func New(env func(string) (string, bool), client *http.Client, resolver BindingResolver) *Engine {
	if env == nil {
		env = os.LookupEnv
	}
	if client == nil {
		client = http.DefaultClient
	}
	c := *client
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return errors.New("redirects are not allowed") }
	// Cookie jars are not shared between tool users; the bearer is their authority.
	c.Jar = nil
	links := linkEndpoint{resolver: resolver}
	return &Engine{env: env, http: &c, sources: make(map[string]*source), links: links, resolvers: map[domain.DataSourceKind]EndpointResolver{domain.SourceHTTP: storedBaseURL{}, domain.SourceCatalogApp: links}}
}

func (e *Engine) source(ds domain.DataSource) (*source, error) {
	key := string(ds.Kind) + ":" + ds.ID
	if ds.ID == "" {
		key += ds.Slug
		if ds.ConnectionName != nil {
			key += ":" + *ds.ConnectionName
		}
		if ds.BaseURL != nil {
			key += ":" + *ds.BaseURL
		}
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.closed {
		return nil, failure("data_source_unavailable", "Data source engine is closed", nil)
	}
	s := e.sources[key]
	if s == nil {
		s = &source{sem: make(chan struct{}, sourceConcurrency)}
		e.sources[key] = s
	}
	return s, nil
}

func (s *source) acquire(ctx context.Context) error {
	select {
	case s.sem <- struct{}{}:
		return nil
	default:
	}
	timer := time.NewTimer(sourceWait)
	defer timer.Stop()
	select {
	case s.sem <- struct{}{}:
		return nil
	case <-ctx.Done():
		return sqlFailure(ctx.Err())
	case <-timer.C:
		return failure("data_source_busy", "Data source has too many running queries", nil)
	}
}

func (s *source) release() { <-s.sem }

func (e *Engine) database(ctx context.Context, ds domain.DataSource, s *source) (*sql.DB, error) {
	if ds.ConnectionName == nil || *ds.ConnectionName == "" {
		return nil, failure("data_source_pending", "Data source is waiting for its connection", nil)
	}
	key := strings.ToUpper(strings.ReplaceAll(*ds.ConnectionName, "-", "_")) + "_URL"
	dsn, ok := e.env(key)
	if !ok || strings.TrimSpace(dsn) == "" {
		return nil, failure("data_source_pending", "Data source is waiting for its connection", nil)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state.Status == domain.SourceError && time.Since(s.state.Checked) < stateTTL {
		return nil, failure("data_source_unavailable", s.state.Message, nil)
	}
	var err error
	if s.db == nil {
		s.db, err = sql.Open("postgres", dsn)
		if err == nil {
			s.db.SetMaxOpenConns(4)
			s.db.SetConnMaxLifetime(30 * time.Minute)
		}
	}
	if err == nil && (s.state.Status != domain.SourceReady || time.Since(s.state.Checked) >= stateTTL) {
		err = s.db.PingContext(ctx)
		if err == nil {
			s.state = domain.SourceState{Status: domain.SourceReady, Checked: time.Now().UTC()}
		}
	}
	if err != nil {
		// Connection errors may contain credentials. Never return their text.
		s.state = domain.SourceState{Status: domain.SourceError, Message: "Data source is unavailable", Checked: time.Now().UTC()}
		return nil, failure("data_source_unavailable", s.state.Message, err)
	}
	return s.db, nil
}

// State checks PostgreSQL lazily and caches connectivity failures for five
// seconds. HTTP state reflects the last request (there is no safe probe path).
func (e *Engine) State(ctx context.Context, bearer string, ds domain.DataSource) domain.SourceState {
	s, err := e.source(ds)
	if err != nil {
		return domain.SourceState{Status: domain.SourceError, Message: "Data source engine is closed", Checked: time.Now().UTC()}
	}
	if ds.Kind == domain.SourceCatalogApp {
		binding, err := e.links.binding(ctx, bearer, ds)
		return catalogAppState(ds, binding, err)
	}
	if ds.Kind == domain.SourcePostgres {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if _, err := e.database(ctx, ds, s); err != nil {
			runErr := sqlFailure(err)
			status := domain.SourceError
			if runErr.Code == "data_source_pending" {
				status = domain.SourcePending
			}
			return domain.SourceState{Status: status, Message: runErr.Message, Checked: time.Now().UTC()}
		}
	} else if ds.Kind != domain.SourceHTTP || ds.BaseURL == nil || *ds.BaseURL == "" {
		return domain.SourceState{Status: domain.SourceError, Message: "Data source has no endpoint", Checked: time.Now().UTC()}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state.Status == "" {
		return domain.SourceState{Status: domain.SourceReady, Checked: time.Now().UTC()}
	}
	return s.state
}

// Run binds declared parameters and executes one query. Write authority never
// upgrades a read query. Failures are *domain.RunError; data_source_busy callers
// should receive HTTP 429 with Retry-After from the API.
func (e *Engine) Run(ctx context.Context, req domain.RunRequest) (result domain.RunResult, err error) {
	start := time.Now()
	defer func() { result.DurationMs = time.Since(start).Milliseconds() }()
	if req.Query.Mode == domain.QueryWrite && !req.Write {
		return result, failure("query_not_read_only", "Write queries require action authority", nil)
	}
	if req.Query.Mode != domain.QueryRead && req.Query.Mode != domain.QueryWrite {
		return result, failure("invalid_input", "Query mode must be read or write", nil)
	}
	values, err := bindInputs(req.Query.Params, req.Inputs)
	if err != nil {
		return result, err
	}
	s, err := e.source(req.Source)
	if err != nil {
		return result, err
	}
	if err := s.acquire(ctx); err != nil {
		return result, err
	}
	defer s.release()
	switch req.Source.Kind {
	case domain.SourcePostgres:
		return e.runPostgres(ctx, req, values, s)
	case domain.SourceHTTP, domain.SourceCatalogApp:
		return e.runHTTP(ctx, req, values, s)
	default:
		return result, failure("invalid_input", "Unsupported data source kind", nil)
	}
}

// Close releases all source pools after the server has drained requests.
func (e *Engine) Close() error {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.closed = true
	var errs []error
	for _, s := range e.sources {
		s.mu.Lock()
		if s.db != nil {
			errs = append(errs, s.db.Close())
		}
		s.mu.Unlock()
	}
	return errors.Join(errs...)
}

func queryTimeout(q domain.Query) time.Duration {
	if q.TimeoutMs <= 0 {
		return domain.DefaultQueryTimeout
	}
	d := time.Duration(q.TimeoutMs) * time.Millisecond
	if d > domain.MaxQueryTimeout {
		return domain.MaxQueryTimeout
	}
	return d
}

func rowLimit(q domain.Query) int {
	if q.RowLimit <= 0 {
		return domain.DefaultRowLimit
	}
	if q.RowLimit > domain.MaxRowLimit {
		return domain.MaxRowLimit
	}
	return q.RowLimit
}

func failure(code, message string, cause error) *domain.RunError {
	return &domain.RunError{Code: code, Message: message, Cause: cause}
}
