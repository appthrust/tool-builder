package domain

import "slices"

// Property shapes mirror the renderer registry; unknown props remain an
// extension point. Unset literal values are accepted while building a draft.
var propKinds = map[ComponentType]map[string]string{
	ComponentTable:       {"query": "string", "columns": "columns"},
	ComponentDetail:      {"query": "string", "columns": "columns"},
	ComponentForm:        {"fields": "fields", "submitLabel": "string"},
	ComponentChart:       {"query": "string", "kind": "bar|line|area", "x": "string", "y": "string", "title": "string"},
	ComponentStat:        {"label": "string", "query": "string", "column": "string", "format": "number|money", "delta": "string"},
	ComponentText:        {"heading": "string", "body": "string"},
	ComponentSelect:      {"label": "string", "placeholder": "string", "options": "options", "multiple": "bool", "query": "string", "valueColumn": "string", "labelColumn": "string"},
	ComponentDate:        {"label": "string"},
	ComponentSearchInput: {"label": "string", "placeholder": "string"},
	ComponentButton:      {"label": "string", "variant": "primary|secondary|destructive"},
	ComponentContainer:   {"title": "string"},
	ComponentTabs:        {"tabs": "tabs"},
	ComponentDivider:     {"label": "string"},
}

func refPropAllowed(t ComponentType, key string) bool {
	if key == "query" || key == "tab" {
		return false
	}
	if propKinds[t][key] == "" {
		return true
	}
	return t == ComponentText && (key == "heading" || key == "body") || t == ComponentStat && key == "delta"
}

func validPropValue(t ComponentType, key string, value any) bool {
	if value == nil {
		return true
	}
	kind := propKinds[t][key]
	if key == "tab" {
		kind = "string"
	}
	if kind == "" {
		return true
	}
	if kind == "string" {
		_, ok := value.(string)
		return ok
	}
	if kind == "bool" {
		_, ok := value.(bool)
		return ok
	}
	if kind == "bar|line|area" {
		return stringIn(value, "bar", "line", "area")
	}
	if kind == "number|money" {
		return stringIn(value, "number", "money")
	}
	if kind == "primary|secondary|destructive" {
		return stringIn(value, "primary", "secondary", "destructive")
	}
	items, ok := value.([]any)
	if !ok {
		return false
	}
	for _, item := range items {
		m, ok := item.(map[string]any)
		if !ok {
			return false
		}
		if !optionalString(m, "label") {
			return false
		}
		switch kind {
		case "columns":
			if !nonemptyString(m["name"]) {
				return false
			}
			if f, ok := m["format"]; ok && !stringIn(f, "money", "date", "datetime", "number", "badge") {
				return false
			}
		case "fields":
			name, ok := m["name"].(string)
			if !ok || !paramName.MatchString(name) || !stringIn(m["type"], "text", "number", "boolean", "date", "select", "textarea") || !optionalString(m, "placeholder") {
				return false
			}
			if v, ok := m["required"]; ok {
				if _, ok := v.(bool); !ok {
					return false
				}
			}
			if v, ok := m["options"]; ok && !validPropValue(ComponentSelect, "options", v) {
				return false
			}
		case "options":
			if _, ok := m["value"].(string); !ok {
				return false
			}
			if _, ok := m["label"].(string); !ok {
				return false
			}
		case "tabs":
			if !nonemptyString(m["id"]) {
				return false
			}
			if _, ok := m["label"].(string); !ok {
				return false
			}
		}
	}
	return true
}

func optionalString(m map[string]any, key string) bool {
	v, ok := m[key]
	if !ok {
		return true
	}
	_, ok = v.(string)
	return ok
}
func nonemptyString(v any) bool { s, ok := v.(string); return ok && s != "" }
func stringIn(v any, choices ...string) bool {
	s, ok := v.(string)
	return ok && slices.Contains(choices, s)
}
