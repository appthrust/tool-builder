package domain

import (
	"encoding/json"
	"reflect"
)

type changeItem struct {
	id, label string
	value     any
}

// Changes summarizes stable ids, independent of JSON object key ordering.
// Page children and component actions are diffed separately, not double-counted.
func Changes(prev, next Document) []ReleaseChange {
	out := []ReleaseChange{}
	before, after := changeItems(prev), changeItems(next)
	for _, kind := range []string{"page", "component", "action", "query"} {
		old := map[string]changeItem{}
		current := map[string]bool{}
		for _, item := range before[kind] {
			old[item.id] = item
		}
		for _, item := range after[kind] {
			current[item.id] = true
			op := "added"
			if prior, ok := old[item.id]; ok {
				if sameJSON(prior.value, item.value) {
					continue
				}
				op = "changed"
			}
			out = append(out, ReleaseChange{Kind: kind, Op: op, ID: item.id, Label: item.label})
		}
		for _, item := range before[kind] {
			if !current[item.id] {
				out = append(out, ReleaseChange{Kind: kind, Op: "removed", ID: item.id, Label: item.label})
			}
		}
	}
	return out
}

func sameJSON(a, b any) bool {
	left, _ := json.Marshal(a)
	right, _ := json.Marshal(b)
	var l, r any
	_ = json.Unmarshal(left, &l)
	_ = json.Unmarshal(right, &r)
	return reflect.DeepEqual(l, r)
}

func changeItems(doc Document) map[string][]changeItem {
	out := map[string][]changeItem{}
	add := func(kind, id, label string, value any) {
		if label == "" {
			label = id
		}
		out[kind] = append(out[kind], changeItem{id, label, value})
	}
	for _, page := range doc.Pages {
		add("page", page.ID, page.Title, page.Title)
		for _, component := range page.Components {
			label := ""
			for _, key := range []string{"label", "title"} {
				if prop, ok := component.Props[key]; ok && prop.Kind == "value" {
					if value, ok := prop.Value.(string); ok && value != "" {
						label = value
						break
					}
				}
			}
			value := component
			value.Actions = nil
			add("component", component.ID, label, value)
			for _, action := range component.Actions {
				add("action", action.ID, action.Label, action)
			}
		}
	}
	for _, query := range doc.Queries {
		add("query", query.ID, query.Name, query)
	}
	return out
}
