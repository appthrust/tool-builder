package store

import (
	"context"
	"database/sql"
	"embed"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/appthrust/appserver-go/appserver/httpx"
	"github.com/appthrust/appserver-go/appserver/pgstore"
	"github.com/appthrust/tool-builder/cmd/server/internal/domain"
	"github.com/lib/pq"
	"github.com/oklog/ulid/v2"
)

//go:embed migrations/*.sql
var migrations embed.FS

type Store struct {
	*pgstore.Store
	liveMu sync.Mutex
	live   map[string]*domain.Release
}
type Tx struct {
	*pgstore.Tx
	store *Store
}

type DraftChangedError struct{ Tool domain.Tool }

func (e *DraftChangedError) Error() string { return "draft_changed" }

type InvalidDocumentError struct{ Problems []domain.Problem }

func (e *InvalidDocumentError) Error() string { return "invalid_document" }

func NewID() string { return ulid.Make().String() }
func Open(ctx context.Context, dsn string) (*Store, error) {
	s, err := pgstore.Open(ctx, dsn, migrations, "tool_builder_schema_migrations")
	if err != nil {
		return nil, err
	}
	return &Store{Store: s, live: map[string]*domain.Release{}}, nil
}
func (s *Store) Do(ctx context.Context, write bool, fn func(*Tx) error) error {
	err := s.Store.Do(ctx, write, func(tx *pgstore.Tx) error { return fn(&Tx{Tx: tx, store: s}) })
	if errors.Is(err, sql.ErrNoRows) {
		return httpx.NotFound()
	}
	var pg *pq.Error
	if errors.As(err, &pg) {
		if pg.Code == "23505" {
			return httpx.Fail(409, "slug_taken", "This slug or connection name is already in use")
		}
		if pg.Code == "23503" || pg.Code == "23514" {
			return httpx.Invalid("A referenced resource or value is invalid")
		}
	}
	return err
}
func (s *Store) Prune(ctx context.Context) error {
	return s.Do(ctx, true, func(tx *Tx) error {
		return tx.Exec(`DELETE FROM action_runs WHERE started_at < now() - interval '90 days'`)
	})
}

type scanner interface{ Scan(...any) error }

const toolColumns = `t.id,t.slug,t.name,t.description,t.draft,t.draft_version,t.draft_updated_at,t.draft_updated_by,t.live_release_id,r.number,t.created_by,t.created_at,t.archived_at`

func scanTool(row scanner) (domain.Tool, error) {
	var t domain.Tool
	var raw []byte
	err := row.Scan(&t.ID, &t.Slug, &t.Name, &t.Description, &raw, &t.DraftVersion, &t.DraftUpdatedAt, &t.DraftUpdatedBy, &t.LiveReleaseID, &t.LiveReleaseNumber, &t.CreatedBy, &t.CreatedAt, &t.ArchivedAt)
	if err == nil {
		err = json.Unmarshal(raw, &t.Draft)
	}
	return t, err
}
func (t *Tx) Tools() ([]domain.Tool, error) {
	rows, err := t.SQL.QueryContext(t.Context, `SELECT `+toolColumns+` FROM tools t LEFT JOIN releases r ON r.id=t.live_release_id WHERE t.archived_at IS NULL ORDER BY t.created_at,t.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Tool{}
	for rows.Next() {
		v, err := scanTool(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (t *Tx) Tool(slug string) (domain.Tool, error) {
	return scanTool(t.SQL.QueryRowContext(t.Context, `SELECT `+toolColumns+` FROM tools t LEFT JOIN releases r ON r.id=t.live_release_id WHERE t.slug=$1 AND t.archived_at IS NULL`, slug))
}
func (t *Tx) CreateTool(slug, name, description, subject string) (domain.Tool, error) {
	v := domain.Tool{ID: NewID(), Slug: slug, Name: name, Description: description, Draft: domain.EmptyDocument(), DraftVersion: NewID(), DraftUpdatedAt: time.Now().UTC(), DraftUpdatedBy: subject, CreatedBy: subject, CreatedAt: time.Now().UTC()}
	raw, err := json.Marshal(v.Draft)
	if err != nil {
		return v, err
	}
	err = t.Exec(`INSERT INTO tools(id,slug,name,description,draft,draft_version,draft_updated_at,draft_updated_by,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, v.ID, v.Slug, v.Name, v.Description, string(raw), v.DraftVersion, v.DraftUpdatedAt, v.DraftUpdatedBy, v.CreatedBy, v.CreatedAt)
	return v, err
}
func (t *Tx) UpdateTool(v domain.Tool) error {
	return t.Exec(`UPDATE tools SET name=$2,description=$3 WHERE id=$1`, v.ID, v.Name, v.Description)
}
func (t *Tx) ArchiveTool(id string) error {
	return t.Exec(`UPDATE tools SET archived_at=now() WHERE id=$1`, id)
}
func (t *Tx) SaveDraft(v domain.Tool, match string, doc domain.Document, subject string) (domain.Tool, error) {
	raw, err := json.Marshal(doc)
	if err != nil {
		return v, err
	}
	v.Draft = doc
	v.DraftVersion = NewID()
	v.DraftUpdatedAt = time.Now().UTC()
	v.DraftUpdatedBy = subject
	result, err := t.SQL.ExecContext(t.Context, `UPDATE tools SET draft=$2,draft_version=$3,draft_updated_at=$4,draft_updated_by=$5 WHERE id=$1 AND draft_version=$6`, v.ID, string(raw), v.DraftVersion, v.DraftUpdatedAt, subject, match)
	if err != nil {
		return v, err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return v, err
	}
	if changed == 0 {
		current, err := t.Tool(v.Slug)
		if err != nil {
			return current, err
		}
		return current, &DraftChangedError{current}
	}
	return v, nil
}

const releaseColumns = `id,tool_id,number,document,note,changes,published_subject,published_name,published_at,restored_from`

func scanRelease(row scanner) (domain.Release, error) {
	var v domain.Release
	var doc, changes []byte
	err := row.Scan(&v.ID, &v.ToolID, &v.Number, &doc, &v.Note, &changes, &v.PublishedBy.Subject, &v.PublishedBy.DisplayName, &v.PublishedAt, &v.RestoredFrom)
	if err == nil {
		err = json.Unmarshal(doc, &v.Document)
	}
	if err == nil {
		err = json.Unmarshal(changes, &v.Changes)
	}
	return v, err
}
func (t *Tx) Release(toolID string, n int) (domain.Release, error) {
	return scanRelease(t.SQL.QueryRowContext(t.Context, `SELECT `+releaseColumns+` FROM releases WHERE tool_id=$1 AND number=$2`, toolID, n))
}
func (t *Tx) Live(v domain.Tool) (*domain.Release, error) {
	if v.LiveReleaseID == nil {
		return nil, nil
	}
	// Cached documents are immutable. The freshly read tool pointer is the key,
	// so another replica's publication is observed without a cache invalidation bus.
	t.store.liveMu.Lock()
	cached := t.store.live[v.ID]
	t.store.liveMu.Unlock()
	if cached != nil && cached.ID == *v.LiveReleaseID {
		return cached, nil
	}
	r, err := scanRelease(t.SQL.QueryRowContext(t.Context, `SELECT `+releaseColumns+` FROM releases WHERE tool_id=$1 AND id=$2`, v.ID, *v.LiveReleaseID))
	if err == nil {
		t.store.liveMu.Lock()
		t.store.live[v.ID] = &r
		t.store.liveMu.Unlock()
	}
	return &r, err
}
func (t *Tx) Releases(toolID string) ([]domain.Release, error) {
	rows, err := t.SQL.QueryContext(t.Context, `SELECT `+releaseColumns+` FROM releases WHERE tool_id=$1 ORDER BY number DESC`, toolID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Release{}
	for rows.Next() {
		r, err := scanRelease(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
func (t *Tx) Publish(v domain.Tool, note string, actor domain.Actor, restore *int) (domain.Release, error) {
	doc := v.Draft
	if restore != nil {
		old, err := t.Release(v.ID, *restore)
		if err != nil {
			return domain.Release{}, err
		}
		doc = old.Document
	}
	if problems := domain.Validate(doc); len(problems) > 0 {
		return domain.Release{}, &InvalidDocumentError{problems}
	}
	for i, q := range doc.Queries {
		source, err := t.Source(q.SourceID)
		if errors.Is(err, sql.ErrNoRows) {
			return domain.Release{}, &InvalidDocumentError{[]domain.Problem{{Code: "query_source_missing", Path: fmtQuerySource(i), Message: "Data source does not exist"}}}
		}
		if err != nil {
			return domain.Release{}, err
		}
		if (source.Kind == domain.SourcePostgres) != (q.SQL != nil) {
			return domain.Release{}, &InvalidDocumentError{[]domain.Problem{{Code: "query_source_missing", Path: fmtQuerySource(i), Message: "Query and data source kinds do not match"}}}
		}
	}
	live, err := t.Live(v)
	if err != nil {
		return domain.Release{}, err
	}
	var prev domain.Document
	if live != nil {
		prev = live.Document
	}
	r := domain.Release{ID: NewID(), ToolID: v.ID, Document: doc, Note: note, Changes: domain.Changes(prev, doc), PublishedBy: actor, PublishedAt: time.Now().UTC(), RestoredFrom: restore}
	if err := t.SQL.QueryRowContext(t.Context, `SELECT COALESCE(MAX(number),0)+1 FROM releases WHERE tool_id=$1`, v.ID).Scan(&r.Number); err != nil {
		return r, err
	}
	document, err := json.Marshal(doc)
	if err != nil {
		return r, err
	}
	changes, err := json.Marshal(r.Changes)
	if err != nil {
		return r, err
	}
	if err := t.Exec(`INSERT INTO releases(id,tool_id,number,document,note,changes,published_subject,published_name,published_at,restored_from) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, r.ID, r.ToolID, r.Number, string(document), r.Note, string(changes), r.PublishedBy.Subject, r.PublishedBy.DisplayName, r.PublishedAt, r.RestoredFrom); err != nil {
		return r, err
	}
	if err := t.Exec(`UPDATE tools SET live_release_id=$2 WHERE id=$1`, v.ID, r.ID); err != nil {
		return r, err
	}
	t.store.liveMu.Lock()
	delete(t.store.live, v.ID)
	t.store.liveMu.Unlock()
	return r, nil
}
