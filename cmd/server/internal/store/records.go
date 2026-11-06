package store

import (
	"encoding/json"
	"strconv"

	"github.com/appthrust/appserver-go/appserver/httpx"
	"github.com/appthrust/tool-builder/cmd/server/internal/domain"
)

func fmtQuerySource(i int) string { return "queries." + strconv.Itoa(i) + ".sourceId" }

const sourceColumns = `id,slug,kind,name,connection_name,destination_component_id,base_url,definition,created_by,created_at`

func scanSource(row scanner) (domain.DataSource, error) {
	var s domain.DataSource
	err := row.Scan(&s.ID, &s.Slug, &s.Kind, &s.Name, &s.ConnectionName, &s.DestinationComponentID, &s.BaseURL, &s.Definition, &s.CreatedBy, &s.CreatedAt)
	return s, err
}
func (t *Tx) Sources() ([]domain.DataSource, error) {
	rows, err := t.SQL.QueryContext(t.Context, `SELECT `+sourceColumns+` FROM data_sources ORDER BY created_at,id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.DataSource{}
	for rows.Next() {
		s, err := scanSource(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}
func (t *Tx) Source(id string) (domain.DataSource, error) {
	return scanSource(t.SQL.QueryRowContext(t.Context, `SELECT `+sourceColumns+` FROM data_sources WHERE id=$1`, id))
}
func (t *Tx) InsertSource(s domain.DataSource) error {
	return t.Exec(`INSERT INTO data_sources(id,slug,kind,name,connection_name,destination_component_id,base_url,definition,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, s.ID, s.Slug, s.Kind, s.Name, s.ConnectionName, s.DestinationComponentID, s.BaseURL, s.Definition, s.CreatedBy, s.CreatedAt)
}
func (t *Tx) CheckSourceUnused(id string) error {
	var used bool
	err := t.SQL.QueryRowContext(t.Context, `SELECT EXISTS (SELECT 1 FROM tools t LEFT JOIN releases r ON r.id=t.live_release_id WHERE t.archived_at IS NULL AND (EXISTS (SELECT 1 FROM jsonb_array_elements(t.draft->'queries') q WHERE q->>'sourceId'=$1) OR EXISTS (SELECT 1 FROM jsonb_array_elements(r.document->'queries') q WHERE q->>'sourceId'=$1)))`, id).Scan(&used)
	if err != nil {
		return err
	}
	if used {
		return httpx.Fail(409, "data_source_in_use", "A draft or live query still uses this data source")
	}
	return nil
}
func (t *Tx) DeleteSource(id string) error {
	if _, err := t.Source(id); err != nil {
		return err
	}
	if err := t.CheckSourceUnused(id); err != nil {
		return err
	}
	return t.Exec(`DELETE FROM data_sources WHERE id=$1`, id)
}
func (t *Tx) Grants(toolID string) (domain.Grants, error) {
	out := domain.Grants{Groups: []domain.GroupGrant{}, Actions: []domain.ActionGrant{}}
	rows, err := t.SQL.QueryContext(t.Context, `SELECT group_id,role FROM group_grants WHERE tool_id=$1 ORDER BY group_id`, toolID)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var g domain.GroupGrant
		if err := rows.Scan(&g.GroupID, &g.Role); err != nil {
			rows.Close()
			return out, err
		}
		out.Groups = append(out.Groups, g)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	rows, err = t.SQL.QueryContext(t.Context, `SELECT action_id,group_ids FROM action_grants WHERE tool_id=$1 ORDER BY action_id`, toolID)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var g domain.ActionGrant
		var raw []byte
		if err := rows.Scan(&g.ActionID, &raw); err != nil {
			return out, err
		}
		if err := json.Unmarshal(raw, &g.GroupIDs); err != nil {
			return out, err
		}
		out.Actions = append(out.Actions, g)
	}
	return out, rows.Err()
}
func (t *Tx) PutGrants(toolID string, g domain.Grants) error {
	if err := t.Exec(`DELETE FROM group_grants WHERE tool_id=$1`, toolID); err != nil {
		return err
	}
	if err := t.Exec(`DELETE FROM action_grants WHERE tool_id=$1`, toolID); err != nil {
		return err
	}
	for _, v := range g.Groups {
		if err := t.Exec(`INSERT INTO group_grants(tool_id,group_id,role) VALUES($1,$2,$3)`, toolID, v.GroupID, v.Role); err != nil {
			return err
		}
	}
	for _, v := range g.Actions {
		groups := v.GroupIDs
		if groups == nil {
			groups = []string{}
		}
		raw, err := json.Marshal(groups)
		if err != nil {
			return err
		}
		if err := t.Exec(`INSERT INTO action_grants(tool_id,action_id,group_ids) VALUES($1,$2,$3)`, toolID, v.ActionID, string(raw)); err != nil {
			return err
		}
	}
	return nil
}
func (t *Tx) RecordRun(r domain.ActionRun, personID *string) error {
	var releaseID *string
	if r.ReleaseID != "" {
		releaseID = &r.ReleaseID
	}
	return t.Exec(`INSERT INTO action_runs(id,tool_id,release_id,release_number,action_id,action_label,query_id,subject,display_name,person_id,params_hash,status,row_count,error,started_at,finished_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, r.ID, r.ToolID, releaseID, r.ReleaseNumber, r.ActionID, r.ActionLabel, r.QueryID, r.Actor.Subject, r.Actor.DisplayName, personID, r.ParamsHash, r.Status, r.RowCount, r.Error, r.StartedAt, r.FinishedAt)
}
func (t *Tx) Runs(toolID string, limit int) ([]domain.ActionRun, error) {
	rows, err := t.SQL.QueryContext(t.Context, `SELECT id,tool_id,COALESCE(release_id,''),release_number,action_id,action_label,query_id,subject,display_name,params_hash,status,row_count,error,started_at,finished_at FROM action_runs WHERE tool_id=$1 ORDER BY started_at DESC,id DESC LIMIT $2`, toolID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.ActionRun{}
	for rows.Next() {
		var r domain.ActionRun
		if err := rows.Scan(&r.ID, &r.ToolID, &r.ReleaseID, &r.ReleaseNumber, &r.ActionID, &r.ActionLabel, &r.QueryID, &r.Actor.Subject, &r.Actor.DisplayName, &r.ParamsHash, &r.Status, &r.RowCount, &r.Error, &r.StartedAt, &r.FinishedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
