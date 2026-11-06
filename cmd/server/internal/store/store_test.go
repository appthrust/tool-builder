package store

import (
	"context"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/appthrust/appserver-go/appserver/httpx"
	"github.com/appthrust/appserver-go/appserver/pgstore/testutil"
	"github.com/appthrust/tool-builder/cmd/server/internal/domain"
	"github.com/stretchr/testify/require"
)

func TestDraftPublishRestoreAndSourceReferences(t *testing.T) {
	db, _ := testutil.Database(t, Open)
	ctx := context.Background()
	require.NoError(t, db.SeedDev(ctx, []string{"cs-team", "finance"}))
	var original domain.Tool
	var source domain.DataSource
	require.NoError(t, db.Do(ctx, false, func(tx *Tx) error {
		var err error
		original, err = tx.Tool("order-desk")
		if err != nil {
			return err
		}
		sources, err := tx.Sources()
		if err == nil {
			source = sources[0]
		}
		return err
	}))
	require.Equal(t, 1, *original.LiveReleaseNumber)
	err := db.Do(ctx, true, func(tx *Tx) error {
		v, err := tx.Tool(original.Slug)
		if err != nil {
			return err
		}
		_, err = tx.SaveDraft(v, "stale", domain.EmptyDocument(), "editor")
		return err
	})
	var conflict *DraftChangedError
	require.ErrorAs(t, err, &conflict)
	require.Equal(t, original.DraftVersion, conflict.Tool.DraftVersion)
	require.NoError(t, db.Do(ctx, true, func(tx *Tx) error {
		v, err := tx.Tool(original.Slug)
		if err != nil {
			return err
		}
		_, err = tx.SaveDraft(v, v.DraftVersion, domain.EmptyDocument(), "editor")
		return err
	}))
	err = db.Do(ctx, true, func(tx *Tx) error { return tx.DeleteSource(source.ID) })
	var failure *httpx.Error
	require.ErrorAs(t, err, &failure)
	require.Equal(t, "data_source_in_use", failure.Code)
	require.NoError(t, db.Do(ctx, true, func(tx *Tx) error {
		v, err := tx.Tool(original.Slug)
		if err != nil {
			return err
		}
		r, err := tx.Publish(v, "empty", domain.Actor{Subject: "editor"}, nil)
		require.Equal(t, 2, r.Number)
		return err
	}))
	require.NoError(t, db.Do(ctx, true, func(tx *Tx) error {
		v, err := tx.Tool(original.Slug)
		if err != nil {
			return err
		}
		n := 1
		r, err := tx.Publish(v, "restore", domain.Actor{Subject: "editor"}, &n)
		require.Equal(t, 3, r.Number)
		require.Equal(t, 1, *r.RestoredFrom)
		require.Equal(t, original.Draft, r.Document)
		return err
	}))
	require.NoError(t, db.Do(ctx, false, func(tx *Tx) error {
		v, err := tx.Tool(original.Slug)
		if err != nil {
			return err
		}
		require.Equal(t, domain.EmptyDocument(), v.Draft)
		require.Equal(t, 3, *v.LiveReleaseNumber)
		return nil
	}))
	// Failed validation cannot advance either release history or live pointer.
	err = db.Do(ctx, true, func(tx *Tx) error {
		v, err := tx.Tool(original.Slug)
		if err != nil {
			return err
		}
		v.Draft.SchemaVersion = 2
		_, err = tx.Publish(v, "invalid", domain.Actor{}, nil)
		return err
	})
	var invalid *InvalidDocumentError
	require.ErrorAs(t, err, &invalid)
}
func TestConcurrentPublishNumbersAndRetention(t *testing.T) {
	db, _ := testutil.Database(t, Open)
	ctx := context.Background()
	require.NoError(t, db.Do(ctx, true, func(tx *Tx) error { _, err := tx.CreateTool("test", "Test", "", "admin"); return err }))
	var mu sync.Mutex
	var wg sync.WaitGroup
	numbers := []int{}
	errs := []error{}
	for range 6 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			err := db.Do(ctx, true, func(tx *Tx) error {
				v, err := tx.Tool("test")
				if err != nil {
					return err
				}
				r, err := tx.Publish(v, "", domain.Actor{}, nil)
				if err == nil {
					mu.Lock()
					numbers = append(numbers, r.Number)
					mu.Unlock()
				}
				return err
			})
			if err != nil {
				mu.Lock()
				errs = append(errs, err)
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	require.Empty(t, errs)
	sort.Ints(numbers)
	require.Equal(t, []int{1, 2, 3, 4, 5, 6}, numbers)
	require.NoError(t, db.Do(ctx, true, func(tx *Tx) error {
		v, err := tx.Tool("test")
		if err != nil {
			return err
		}
		for _, days := range []int{91, 89} {
			r := domain.ActionRun{ID: NewID(), ToolID: v.ID, Status: domain.RunDenied, ParamsHash: "hash", StartedAt: time.Now().Add(-time.Duration(days) * 24 * time.Hour), FinishedAt: time.Now()}
			if err := tx.RecordRun(r, nil); err != nil {
				return err
			}
		}
		return nil
	}))
	require.NoError(t, db.Prune(ctx))
	require.NoError(t, db.Do(ctx, false, func(tx *Tx) error {
		v, err := tx.Tool("test")
		if err != nil {
			return err
		}
		runs, err := tx.Runs(v.ID, 10)
		require.Len(t, runs, 1)
		return err
	}))
}
func TestSeedIdempotentAndEmptyActionConstraint(t *testing.T) {
	db, _ := testutil.Database(t, Open)
	ctx := context.Background()
	require.NoError(t, db.SeedDev(ctx, []string{"cs-team", "finance"}))
	require.NoError(t, db.SeedDev(ctx, []string{"other"}))
	require.NoError(t, db.Do(ctx, true, func(tx *Tx) error {
		v, err := tx.Tool("order-desk")
		if err != nil {
			return err
		}
		g, err := tx.Grants(v.ID)
		if err != nil {
			return err
		}
		require.Equal(t, "cs-team", g.Groups[0].GroupID)
		g.Actions = []domain.ActionGrant{{ActionID: "issue_refund", GroupIDs: []string{}}}
		if err := tx.PutGrants(v.ID, g); err != nil {
			return err
		}
		g, err = tx.Grants(v.ID)
		require.Len(t, g.Actions, 1)
		require.Empty(t, g.Actions[0].GroupIDs)
		return err
	}))
}

func TestAuthoritativeDraftVersionAndCrossReplicaLiveCache(t *testing.T) {
	db, dsn := testutil.Database(t, Open)
	ctx := context.Background()
	require.NoError(t, db.SeedDev(ctx, []string{"cs-team", "finance"}))
	var stale domain.Tool
	var cached *domain.Release
	require.NoError(t, db.Do(ctx, false, func(tx *Tx) error {
		var err error
		stale, err = tx.Tool("order-desk")
		if err != nil {
			return err
		}
		cached, err = tx.Live(stale)
		return err
	}))
	other, err := Open(ctx, dsn)
	require.NoError(t, err)
	defer other.Close()
	require.NoError(t, other.Do(ctx, true, func(tx *Tx) error {
		current, err := tx.Tool(stale.Slug)
		if err != nil {
			return err
		}
		current, err = tx.SaveDraft(current, current.DraftVersion, domain.EmptyDocument(), "other")
		if err != nil {
			return err
		}
		_, err = tx.Publish(current, "other replica", domain.Actor{Subject: "other"}, nil)
		return err
	}))
	err = db.Do(ctx, true, func(tx *Tx) error {
		_, err := tx.SaveDraft(stale, stale.DraftVersion, stale.Draft, "stale")
		return err
	})
	var changed *DraftChangedError
	require.ErrorAs(t, err, &changed)
	require.NotEqual(t, stale.DraftVersion, changed.Tool.DraftVersion)
	require.Equal(t, domain.EmptyDocument(), changed.Tool.Draft)
	require.NoError(t, db.Do(ctx, false, func(tx *Tx) error {
		current, err := tx.Tool(stale.Slug)
		if err != nil {
			return err
		}
		live, err := tx.Live(current)
		if err != nil {
			return err
		}
		require.Equal(t, 2, live.Number)
		require.Equal(t, domain.EmptyDocument(), live.Document)
		require.Equal(t, 1, cached.Number)
		return nil
	}))
}

func TestArchivedToolsDoNotKeepSourcesInUse(t *testing.T) {
	db, _ := testutil.Database(t, Open)
	ctx := context.Background()
	require.NoError(t, db.SeedDev(ctx, []string{"cs-team", "finance"}))
	var tool domain.Tool
	var sourceID string
	require.NoError(t, db.Do(ctx, false, func(tx *Tx) error {
		var err error
		tool, err = tx.Tool("order-desk")
		if err == nil {
			sourceID = tool.Draft.Queries[0].SourceID
		}
		return err
	}))
	err := db.Do(ctx, true, func(tx *Tx) error { return tx.DeleteSource(sourceID) })
	var failure *httpx.Error
	require.ErrorAs(t, err, &failure)
	require.Equal(t, "data_source_in_use", failure.Code)
	require.NoError(t, db.Do(ctx, true, func(tx *Tx) error {
		if err := tx.ArchiveTool(tool.ID); err != nil {
			return err
		}
		// Both the archived draft and its live release still reference it.
		return tx.DeleteSource(sourceID)
	}))
	require.NoError(t, db.Do(ctx, false, func(tx *Tx) error {
		sources, err := tx.Sources()
		require.Empty(t, sources)
		return err
	}))
}
