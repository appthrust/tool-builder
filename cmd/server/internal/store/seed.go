package store

import (
	"context"
	"strings"
	"time"

	"github.com/appthrust/tool-builder/cmd/server/internal/domain"
)

// SeedDev uses the golden order-desk document. Business tables are provisioned
// separately; the workload consumes their connection through ORDERS_DB_URL.
func (s *Store) SeedDev(ctx context.Context, groupIDs []string) error {
	return s.Do(ctx, true, func(tx *Tx) error {
		var empty bool
		if err := tx.SQL.QueryRowContext(ctx, `SELECT NOT EXISTS(SELECT 1 FROM tools) AND NOT EXISTS(SELECT 1 FROM data_sources)`).Scan(&empty); err != nil {
			return err
		}
		if !empty {
			return nil
		}
		doc, err := domain.DemoDocument()
		if err != nil {
			return err
		}
		connection := "orders-db"
		source := domain.DataSource{ID: NewID(), Slug: connection, Kind: domain.SourcePostgres, Name: "Orders database", ConnectionName: &connection, DestinationComponentID: "orders-db", CreatedBy: "dev-seed", CreatedAt: time.Now().UTC()}
		if err := tx.InsertSource(source); err != nil {
			return err
		}
		for i := range doc.Queries {
			doc.Queries[i].SourceID = source.ID
		}
		tool, err := tx.CreateTool("order-desk", "Order desk", "Search orders and issue refunds", "dev-seed")
		if err != nil {
			return err
		}
		tool, err = tx.SaveDraft(tool, tool.DraftVersion, doc, "dev-seed")
		if err != nil {
			return err
		}
		grants := domain.Grants{Groups: []domain.GroupGrant{}, Actions: []domain.ActionGrant{}}
		seen := map[string]bool{}
		for _, id := range groupIDs {
			id = strings.TrimSpace(id)
			if id == "" || seen[id] {
				continue
			}
			seen[id] = true
			role := domain.GrantUse
			if len(grants.Groups) == 0 {
				role = domain.GrantEdit
			}
			grants.Groups = append(grants.Groups, domain.GroupGrant{GroupID: id, Role: role})
		}
		if len(grants.Groups) > 1 {
			grants.Actions = append(grants.Actions, domain.ActionGrant{ActionID: "issue_refund", GroupIDs: []string{grants.Groups[1].GroupID}})
		}
		if err := tx.PutGrants(tool.ID, grants); err != nil {
			return err
		}
		_, err = tx.Publish(tool, "Order desk demo", domain.Actor{Subject: "dev-seed", DisplayName: "Demo"}, nil)
		return err
	})
}
