package store

import (
	"github.com/appthrust/tool-builder/cmd/server/internal/domain"
	"github.com/lib/pq"
)

func (t *Tx) RunPeople(runs []domain.ActionRun) (map[string]string, error) {
	out := map[string]string{}
	if len(runs) == 0 {
		return out, nil
	}
	ids := make([]string, len(runs))
	for i, run := range runs {
		ids[i] = run.ID
	}
	rows, err := t.SQL.QueryContext(t.Context, `SELECT id,person_id FROM action_runs WHERE id=ANY($1) AND person_id IS NOT NULL`, pq.Array(ids))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, person string
		if err := rows.Scan(&id, &person); err != nil {
			return nil, err
		}
		out[id] = person
	}
	return out, rows.Err()
}
