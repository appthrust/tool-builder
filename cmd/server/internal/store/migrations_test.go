package store

import (
	"context"
	"embed"
	"io/fs"
	"testing"
	"time"

	"github.com/appthrust/appserver-go/appserver/pgstore"
	"github.com/appthrust/appserver-go/appserver/pgstore/testutil"
	"github.com/appthrust/tool-builder/cmd/server/internal/domain"
	"github.com/lib/pq"
	"github.com/stretchr/testify/require"
)

//go:embed migrations/001_tool_builder.sql migrations/002_addon_sources.sql
var legacySourceMigrations embed.FS

func TestSourceMigrationOrder(t *testing.T) {
	names, err := fs.Glob(migrations, "migrations/*.sql")
	require.NoError(t, err)
	require.Equal(t, []string{
		"migrations/001_tool_builder.sql",
		"migrations/002_addon_sources.sql",
		"migrations/003_builtin_app_sources.sql",
	}, names)
	for _, name := range names {
		source, err := fs.ReadFile(migrations, name)
		require.NoError(t, err)
		require.NotEmpty(t, source)
	}
}

func TestAppInstallationSourceMigration(t *testing.T) {
	ctx := context.Background()
	legacy, dsn := testutil.Database(t, func(ctx context.Context, dsn string) (*pgstore.Store, error) {
		return pgstore.Open(ctx, dsn, legacySourceMigrations, "tool_builder_schema_migrations")
	})
	const legacyKind domain.DataSourceKind = "addon"
	definition, connection, baseURL := "directory", "orders", "http://orders.project.svc"
	created := time.Date(2026, 10, 17, 1, 2, 3, 0, time.UTC)
	want := []domain.DataSource{
		{ID: "builtin", Slug: "people", Kind: legacyKind, Name: "People", Definition: &definition, CreatedBy: "admin", CreatedAt: created},
		{ID: "http", Slug: "orders-http", Kind: domain.SourceHTTP, Name: "Orders HTTP", DestinationComponentID: "orders-web", BaseURL: &baseURL, CreatedBy: "admin", CreatedAt: created},
		{ID: "postgres", Slug: "orders-db", Kind: domain.SourcePostgres, Name: "Orders DB", ConnectionName: &connection, DestinationComponentID: "orders-db", CreatedBy: "admin", CreatedAt: created},
	}
	require.NoError(t, legacy.Do(ctx, true, func(tx *pgstore.Tx) error {
		for _, source := range want {
			if err := (&Tx{Tx: tx}).InsertSource(source); err != nil {
				return err
			}
		}
		return nil
	}))

	db, err := Open(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	want[0].Kind = "builtin-app"
	assertSources := func(database *Store) {
		t.Helper()
		require.NoError(t, database.Do(ctx, false, func(tx *Tx) error {
			got, err := tx.Sources()
			require.NoError(t, err)
			require.Equal(t, want, got, "only the legacy kind changes; other fields and source kinds are preserved")
			var count int
			require.NoError(t, tx.SQL.QueryRowContext(ctx, `SELECT count(*) FROM tool_builder_schema_migrations`).Scan(&count))
			require.Equal(t, 3, count)
			return nil
		}))
	}
	assertSources(db)

	// Reopening uses the migration ledger; replaying the SQL itself is safe too.
	reopened, err := Open(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, reopened.Close()) })
	assertSources(reopened)
	migration, err := fs.ReadFile(migrations, "migrations/003_builtin_app_sources.sql")
	require.NoError(t, err)
	for range 2 {
		require.NoError(t, db.Do(ctx, true, func(tx *Tx) error { return tx.Exec(string(migration)) }))
		assertSources(db)
	}

	// Both constraints still fence invalid kinds and invalid per-kind shapes.
	for _, tc := range []struct {
		name   string
		change func(*domain.DataSource)
	}{
		{"legacy kind", func(s *domain.DataSource) { s.Kind = legacyKind }},
		{"unknown kind", func(s *domain.DataSource) { s.Kind = "unknown" }},
		{"missing definition", func(s *domain.DataSource) { s.Definition = nil }},
		{"empty definition", func(s *domain.DataSource) { empty := ""; s.Definition = &empty }},
		{"connection", func(s *domain.DataSource) { s.ConnectionName = &connection }},
		{"base URL", func(s *domain.DataSource) { s.BaseURL = &baseURL }},
		{"destination", func(s *domain.DataSource) { s.DestinationComponentID = "orders-web" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := want[0]
			source.ID, source.Slug = "invalid", "invalid"
			tc.change(&source)
			err := legacy.Do(ctx, true, func(tx *pgstore.Tx) error { return (&Tx{Tx: tx}).InsertSource(source) })
			var constraint *pq.Error
			require.ErrorAs(t, err, &constraint)
			require.Equal(t, pq.ErrorCode("23514"), constraint.Code)
		})
	}
	require.NoError(t, db.Do(ctx, true, func(tx *Tx) error {
		source := want[0]
		source.ID, source.Slug, source.Kind = "new", "new", domain.SourceCatalogApp
		return tx.InsertSource(source)
	}))
}
