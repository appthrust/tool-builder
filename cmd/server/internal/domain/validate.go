package domain

import (
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"sort"
	"strings"
)

type Problem struct {
	Code    string `json:"code"`
	Path    string `json:"path"`
	Message string `json:"message"`
}

// Keep the binding grammar identical to the engine and SPA. Go's \s is ASCII
// [\t\n\f\r ]; Unicode spaces (including NBSP) are not placeholder whitespace.
var placeholder = regexp.MustCompile(`\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}`)
var paramName = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
var dnsLabel = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`)

func ValidSlug(s string) bool { return len(s) <= 63 && dnsLabel.MatchString(s) }

// Validate returns deterministic, JSON-path-addressed problems. Drafts may be
// incomplete; publication and execution require a valid document.
func Validate(doc Document) (problems []Problem) {
	problems = []Problem{}
	defer func() {
		order := []string{"schema", "one_page_required", "unknown_component_type", "duplicate_id", "layout_out_of_grid", "unknown_parent", "query_source_missing", "empty_query", "timeout_out_of_range", "row_limit_out_of_range", "positional_placeholder", "multiple_statements", "placeholder_in_literal", "placeholder_without_param", "param_without_placeholder", "filter_not_supported", "filter_param_unknown", "filter_param_type", "filter_column_invalid", "unknown_query", "write_query_not_action", "unknown_action_query", "action_query_not_write", "unknown_form_component", "unknown_ref_component", "prop_not_exposed", "binding_cycle"}
		sort.SliceStable(problems, func(i, j int) bool {
			return slices.Index(order, problems[i].Code) < slices.Index(order, problems[j].Code)
		})
		for i := range problems {
			problems[i].Path = strings.ReplaceAll(strings.ReplaceAll(problems[i].Path, "[", "."), "]", "")
			if problems[i].Path == "$" {
				problems[i].Path = ""
			}
		}
		if len(problems) > 0 && problems[0].Code == "schema" {
			end := 0
			for end < len(problems) && problems[end].Code == "schema" {
				end++
			}
			problems = problems[:end]
		}
	}()
	add := func(code, path, message string) { problems = append(problems, Problem{code, path, message}) }
	if doc.SchemaVersion != 1 || doc.Pages == nil || doc.Queries == nil {
		add("schema", "$", "Expected a version 1 document with pages and queries")
		return problems
	}
	if len(doc.Pages) != 1 {
		add("one_page_required", "pages", "Exactly one page is required")
	}
	components := map[string]Component{}
	queries := map[string]Query{}
	seen := map[string]bool{}
	id := func(kind, value, path string) {
		if value == "" {
			add("schema", path, "An id is required")
			return
		}
		key := kind + ":" + value
		if seen[key] {
			add("duplicate_id", path, "Ids must be unique within their kind")
		}
		seen[key] = true
	}
	for pi, p := range doc.Pages {
		pp := fmt.Sprintf("pages[%d]", pi)
		id("page", p.ID, pp+".id")
		if p.Components == nil {
			add("schema", pp+".components", "Components must be an array")
		}
		for ci, c := range p.Components {
			cp := fmt.Sprintf("%s.components[%d]", pp, ci)
			id("component", c.ID, cp+".id")
			components[c.ID] = c
			if !slices.Contains(ComponentTypes, c.Type) {
				add("unknown_component_type", cp+".type", "Unknown component type")
			}
			if c.Layout.X < 0 || c.Layout.X > 11 || c.Layout.Y < 0 || c.Layout.W < 1 || c.Layout.W > 12 || c.Layout.H < 1 || c.Layout.X+c.Layout.W > 12 {
				add("layout_out_of_grid", cp+".layout", "Layout must fit the 12-column grid")
			}
			if c.Props == nil {
				add("schema", cp+".props", "Props must be an object")
			}
			for _, a := range c.Actions {
				id("action", a.ID, cp+".actions")
			}
		}
	}
	for qi, q := range doc.Queries {
		qp := fmt.Sprintf("queries[%d]", qi)
		id("query", q.ID, qp+".id")
		queries[q.ID] = q
		if q.Name == "" || q.SourceID == "" || q.Mode != QueryRead && q.Mode != QueryWrite || q.Params == nil {
			add("schema", qp, "A query requires a name, source, mode and params")
		}
		if (q.SQL == nil) == (q.HTTP == nil) {
			add("query_source_missing", qp, "Exactly one SQL or HTTP statement is required")
		}
		if q.TimeoutMs < 1 || q.TimeoutMs > 30000 {
			add("timeout_out_of_range", qp+".timeoutMs", "Timeout must be between 1 and 30000 ms")
		}
		if q.RowLimit < 0 || q.RowLimit > MaxRowLimit || q.Mode == QueryRead && q.RowLimit == 0 {
			add("row_limit_out_of_range", qp+".rowLimit", "Read row limit must be between 1 and 5000")
		}
	}
	graph := map[string][]string{}
	checkRef := func(ref *Ref, owner, path string) {
		if ref == nil || ref.Component == "" || ref.Prop == "" {
			add("schema", path, "A reference requires component and prop")
			return
		}
		c, ok := components[ref.Component]
		if !ok {
			add("unknown_ref_component", path, "Referenced component does not exist")
			return
		}
		head, suffix, dotted := strings.Cut(ref.Prop, ".")
		if !slices.Contains(ExposedProps[c.Type], head) || dotted && (suffix == "" || head != "selectedRow" && head != "values") {
			add("prop_not_exposed", path, "The component does not expose this property")
		}
		graph[owner] = append(graph[owner], "c:"+ref.Component)
	}
	for pi, p := range doc.Pages {
		for ci, c := range p.Components {
			cp := fmt.Sprintf("pages[%d].components[%d]", pi, ci)
			if c.ParentID != "" {
				visited := map[string]bool{c.ID: true}
				current := c.ParentID
				invalid := false
				for current != "" {
					parent, ok := components[current]
					if !ok || visited[current] || parent.Type != ComponentContainer && parent.Type != ComponentTabs {
						invalid = true
						break
					}
					visited[current] = true
					current = parent.ParentID
				}
				if invalid {
					add("unknown_parent", cp+".parentId", "Parent must be an acyclic container or tabs component")
				}
			}
			keys := make([]string, 0, len(c.Props))
			for k := range c.Props {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			for _, key := range keys {
				prop := c.Props[key]
				path := cp + ".props." + key
				switch prop.Kind {
				case "ref":
					checkRef(prop.Ref, "c:"+c.ID, path)
					if !refPropAllowed(c.Type, key) {
						add("schema", path, "This property requires a literal value")
					}
				case "value":
					if prop.Ref != nil {
						add("schema", path, "A literal property cannot also contain a reference")
					}
					if key == "query" && prop.Value != nil {
						qid, ok := prop.Value.(string)
						q, exists := queries[qid]
						if !ok {
							add("schema", path, "Query must be a literal query id")
						} else if !exists {
							add("unknown_query", path, "Referenced query does not exist")
						} else if q.Mode != QueryRead {
							add("write_query_not_action", path, "Write queries may only be referenced by actions")
						}
						graph["c:"+c.ID] = append(graph["c:"+c.ID], "q:"+qid)
					} else if !validPropValue(c.Type, key, prop.Value) {
						add("schema", path, "Invalid component property value")
					}
					if (c.Type == ComponentForm && key == "fields") || (c.Type == ComponentTabs && key == "tabs") {
						fieldKey := "name"
						if key == "tabs" {
							fieldKey = "id"
						}
						seenFields := map[string]bool{}
						if entries, ok := prop.Value.([]any); ok {
							for _, entry := range entries {
								if item, ok := entry.(map[string]any); ok {
									if value, ok := item[fieldKey].(string); ok {
										if seenFields[value] {
											add("duplicate_id", path, "Field names and tab ids must be unique")
										}
										seenFields[value] = true
									}
								}
							}
						}
					}
				default:
					add("schema", path, "Property must be a value or a reference")
				}
				if key == "query" && prop.Kind != "value" {
					add("schema", path, "Query must be a literal query id")
				}
			}
			for ai, a := range c.Actions {
				ap := fmt.Sprintf("%s.actions[%d]", cp, ai)
				if c.Type != ComponentTable && c.Type != ComponentForm && c.Type != ComponentButton {
					add("schema", ap, "Actions belong to tables, forms or buttons")
				}
				if a.Label == "" || a.QueryID == "" || a.Input != nil && a.Input.FormComponent == "" {
					add("schema", ap, "An action requires a label, query and nonempty form reference")
				}
				q, ok := queries[a.QueryID]
				if !ok {
					add("unknown_action_query", ap+".queryId", "Action query does not exist")
				} else if q.Mode != QueryWrite {
					add("action_query_not_write", ap+".queryId", "Actions must reference write queries")
				}
				if a.Input != nil {
					form, ok := components[a.Input.FormComponent]
					if !ok || form.Type != ComponentForm {
						add("unknown_form_component", ap+".input", "Action input must reference a form")
					}
				}
				if a.OnSuccess != nil {
					for _, qid := range a.OnSuccess.Refresh {
						q, ok := queries[qid]
						if !ok {
							add("unknown_query", ap+".onSuccess", "Refresh query does not exist")
						} else if q.Mode != QueryRead {
							add("write_query_not_action", ap+".onSuccess", "Refresh must reference a read query")
						}
					}
				}
			}
		}
	}
	for qi, q := range doc.Queries {
		qp := fmt.Sprintf("queries[%d]", qi)
		text := ""
		if q.SQL != nil {
			text = q.SQL.Text
			if strings.TrimSpace(text) == "" {
				add("empty_query", qp+".sql.text", "SQL cannot be empty")
			}
			if code := ValidateSQL(text); code != "" {
				add(code, qp+".sql.text", "SQL must contain one statement and named placeholders only")
			}
			if HasSQLLiteralPlaceholder(text) {
				add("placeholder_in_literal", qp+".sql.text", "Placeholders must be outside SQL literals, identifiers and comments")
			}
		}
		if q.HTTP != nil {
			h := q.HTTP
			text = h.Path + "\n" + h.Body
			if !slices.Contains([]string{"GET", "POST", "PUT", "PATCH", "DELETE"}, h.Method) || !strings.HasPrefix(h.Path, "/") || strings.HasPrefix(h.Path, "//") || strings.ContainsAny(h.Path, "\\\r\n") {
				add("schema", qp+".http", "HTTP requires an allowed method and relative absolute path")
			}
			if q.Mode == QueryRead && h.Method != http.MethodGet {
				add("schema", qp+".http.method", "Read HTTP queries must use GET")
			}
		}
		params := make(map[string]ParamType, len(q.Params))
		for pi, p := range q.Params {
			pp := fmt.Sprintf("%s.params[%d]", qp, pi)
			if !paramName.MatchString(p.Name) || !slices.Contains(ParamTypes, p.Type) || p.Bind.Ref == nil && !p.Bind.HasLiteral && p.Bind.Literal == nil || p.Bind.Ref != nil && (p.Bind.HasLiteral || p.Bind.Literal != nil) {
				add("schema", pp, "Invalid parameter name, type or binding")
			}
			if _, exists := params[p.Name]; exists {
				add("duplicate_id", pp+".name", "Parameter names must be unique")
			}
			params[p.Name] = p.Type
			if p.Bind.Ref != nil {
				checkRef(p.Bind.Ref, "q:"+q.ID, pp+".bind.ref")
			}
		}
		used := map[string]bool{}
		for _, match := range placeholder.FindAllStringSubmatch(text, -1) {
			name := match[1]
			if _, exists := params[name]; !used[name] && !exists {
				add("placeholder_without_param", qp, "Placeholder has no declared parameter: "+name)
			}
			used[name] = true
		}
		if len(q.Filters) > 0 && (q.Mode != QueryRead || q.SQL == nil) {
			add("filter_not_supported", qp+".filters", "Filters require a read SQL query")
		}
		for fi, filter := range q.Filters {
			fp := fmt.Sprintf("%s.filters[%d]", qp, fi)
			used[filter.Param] = true
			if !slices.Contains([]string{"eq", "neq", "contains", "gte", "lte", "in"}, filter.Op) {
				add("schema", fp+".op", "Unknown filter operator")
			}
			kind, exists := params[filter.Param]
			if !exists {
				add("filter_param_unknown", fp+".param", "Filter parameter is not declared")
			} else if list := kind == ParamTextList || kind == ParamNumberList; (filter.Op == "in") != list {
				add("filter_param_type", fp+".param", "Filter operator requires a matching scalar or list parameter")
			}
			if filter.Column == "" || len(filter.Column) > 63 || strings.ContainsAny(filter.Column, "\"\x00") {
				add("filter_column_invalid", fp+".column", "Filter column must be 1–63 bytes without quotes or NUL")
			}
		}
		for _, p := range q.Params {
			if !used[p.Name] {
				add("param_without_placeholder", qp, "Parameter has no placeholder or filter")
			}
		}
		if residue := placeholder.ReplaceAllString(text, ""); strings.Contains(residue, "{{") {
			add("schema", qp, "Only named placeholders are allowed")
		}
	}
	state := map[string]uint8{}
	var visit func(string) bool
	visit = func(node string) bool {
		if state[node] == 1 {
			return true
		}
		if state[node] == 2 {
			return false
		}
		state[node] = 1
		for _, edge := range graph[node] {
			if visit(edge) {
				return true
			}
		}
		state[node] = 2
		return false
	}
	keys := make([]string, 0, len(graph))
	for k := range graph {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if visit(k) {
			add("binding_cycle", "$", "Bindings and parent relationships must not contain cycles")
			break
		}
	}
	return problems
}
