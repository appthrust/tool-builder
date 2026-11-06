package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strings"

	"github.com/appthrust/appserver-go/appserver/contract/console"
	"github.com/appthrust/appserver-go/appserver/contract/directory"
	"github.com/appthrust/appserver-go/appserver/contract/knowledge"
	"github.com/appthrust/appserver-go/appserver/httpx"
	"github.com/appthrust/appserver-go/appserver/link"
	"github.com/appthrust/tool-builder/cmd/server/internal/domain"
)

type operationParam struct {
	Name     string `json:"name"`
	In       string `json:"in"`
	Type     string `json:"type"`
	Required bool   `json:"required"`
}

type operationDTO struct {
	ID         string           `json:"id"`
	Method     string           `json:"method"`
	Path       string           `json:"path"`
	Summary    string           `json:"summary"`
	ResultPath string           `json:"resultPath"`
	Params     []operationParam `json:"params"`
}

func compiledOperations(definition string) []link.Operation {
	switch definition {
	case "directory":
		return directory.Operations
	case "knowledge":
		return knowledge.Operations
	case "builder-console":
		return console.Operations
	default:
		return nil
	}
}

func (a *API) operations(s *request) (any, int, error) {
	if err := a.requireEditor(s); err != nil {
		return nil, 0, err
	}
	source, err := s.tx.Source(s.r.PathValue("id"))
	if err != nil {
		return nil, 0, err
	}
	return a.sourceOperations(s, source)
}

func (a *API) sourceOperations(s *request, source domain.DataSource) (any, int, error) {
	if source.Kind != domain.SourceCatalogApp || source.Definition == nil {
		return nil, 0, httpx.Invalid("Operations are available for built-in app sources")
	}
	definition := *source.Definition
	operations := compiledOperations(definition)
	base := ""
	if len(operations) > 0 {
		base = operations[0].Base
	}
	document, err := a.links.Document(s.r.Context(), s.bearer, definition, base)
	if err == nil {
		var live []link.Operation
		live, err = parseOperations(document, definition)
		if err == nil {
			operations = live
		}
	}
	var denied *link.DeniedError
	if errors.As(err, &denied) || err != nil && operations == nil {
		return nil, 0, linkError(err)
	}
	items := make([]operationDTO, 0, len(operations))
	for _, op := range operations {
		params := make([]operationParam, 0, len(op.Params))
		for _, param := range op.Params {
			params = append(params, operationParam{Name: param.Name, In: param.In, Type: param.Type, Required: param.Required})
		}
		items = append(items, operationDTO{ID: op.ID, Method: op.Method, Path: strings.TrimRight(op.Base, "/") + op.Path, Summary: op.Summary, ResultPath: op.ResultPath, Params: params})
	}
	return map[string]any{"items": items}, 200, nil
}

// The live picker consumes only link operations and local OpenAPI references.
// Remote references must never cause a second authenticated network request.
func parseOperations(raw []byte, definition string) ([]link.Operation, error) {
	var doc struct {
		Definition string `json:"x-appthrust-definition"`
		Servers    []struct {
			URL string `json:"url"`
		} `json:"servers"`
		Paths map[string]map[string]json.RawMessage `json:"paths"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, err
	}
	if doc.Definition != definition || len(doc.Servers) == 0 || !relativeAPIPath(doc.Servers[0].URL) {
		return nil, errors.New("invalid built-in app contract origin")
	}
	var root map[string]json.RawMessage
	if err := json.Unmarshal(raw, &root); err != nil {
		return nil, err
	}
	resolve := func(raw json.RawMessage, out any) error { return decodeOpenAPI(root, raw, out) }
	operations := []link.Operation{}
	for path, methods := range doc.Paths {
		if !relativeAPIPath(path) {
			return nil, errors.New("invalid built-in app operation path")
		}
		var shared []json.RawMessage
		if raw := methods["parameters"]; raw != nil {
			if err := json.Unmarshal(raw, &shared); err != nil {
				return nil, err
			}
		}
		for _, method := range []string{"get", "post", "put", "patch", "delete", "head", "options"} {
			operation := methods[method]
			if operation == nil {
				continue
			}
			var spec struct {
				Link       bool              `json:"x-appthrust-link"`
				ID         string            `json:"operationId"`
				Summary    string            `json:"summary"`
				ResultPath string            `json:"x-appthrust-result-path"`
				Params     []json.RawMessage `json:"parameters"`
				Body       json.RawMessage   `json:"requestBody"`
			}
			if err := json.Unmarshal(operation, &spec); err != nil {
				return nil, err
			}
			if !spec.Link {
				continue
			}
			if spec.ID == "" {
				return nil, errors.New("link operation has no ID")
			}
			op := link.Operation{Definition: definition, Base: doc.Servers[0].URL, ID: spec.ID, Method: strings.ToUpper(method), Path: path, Summary: spec.Summary, ResultPath: spec.ResultPath}
			for _, raw := range append(shared[:len(shared):len(shared)], spec.Params...) {
				var param struct {
					Name     string          `json:"name"`
					In       string          `json:"in"`
					Required bool            `json:"required"`
					Schema   json.RawMessage `json:"schema"`
				}
				if err := resolve(raw, &param); err != nil {
					return nil, err
				}
				if param.In != "path" && param.In != "query" {
					continue
				}
				var schema struct {
					Type string `json:"type"`
				}
				if err := resolve(param.Schema, &schema); err != nil {
					return nil, err
				}
				value := link.Param{Name: param.Name, In: param.In, Type: schema.Type, Required: param.Required}
				replaced := false
				for i, prior := range op.Params {
					if prior.Name == value.Name && prior.In == value.In {
						op.Params[i], replaced = value, true
						break
					}
				}
				if !replaced {
					op.Params = append(op.Params, value)
				}
			}
			if len(spec.Body) > 0 {
				var body struct {
					Content map[string]struct {
						Schema json.RawMessage `json:"schema"`
					} `json:"content"`
				}
				if err := resolve(spec.Body, &body); err != nil {
					return nil, err
				}
				if media, ok := body.Content["application/json"]; ok {
					var schema struct {
						Properties map[string]json.RawMessage `json:"properties"`
						Required   []string                   `json:"required"`
					}
					if err := resolve(media.Schema, &schema); err != nil {
						return nil, err
					}
					names := make([]string, 0, len(schema.Properties))
					for name := range schema.Properties {
						names = append(names, name)
					}
					sort.Strings(names)
					for _, name := range names {
						var property struct {
							Type string `json:"type"`
						}
						if err := resolve(schema.Properties[name], &property); err != nil {
							return nil, err
						}
						required := false
						for _, field := range schema.Required {
							if field == name {
								required = true
								break
							}
						}
						op.Params = append(op.Params, link.Param{Name: name, In: "body", Type: property.Type, Required: required})
					}
				}
			}
			operations = append(operations, op)
		}
	}
	sort.Slice(operations, func(i, j int) bool { return operations[i].ID < operations[j].ID })
	return operations, nil
}

func relativeAPIPath(path string) bool {
	u, err := url.Parse(path)
	return err == nil && strings.HasPrefix(path, "/") && !strings.HasPrefix(path, "//") && !u.IsAbs() && u.Host == "" && u.RawQuery == "" && !u.ForceQuery && u.Fragment == ""
}

func decodeOpenAPI(root map[string]json.RawMessage, raw json.RawMessage, out any) error {
	for range 32 {
		var reference struct {
			Ref string `json:"$ref"`
		}
		if err := json.Unmarshal(raw, &reference); err != nil {
			return err
		}
		if reference.Ref == "" {
			return json.Unmarshal(raw, out)
		}
		if !strings.HasPrefix(reference.Ref, "#/") {
			return errors.New("only local OpenAPI references are supported")
		}
		object := root
		parts := strings.Split(strings.TrimPrefix(reference.Ref, "#/"), "/")
		for i, part := range parts {
			part = strings.ReplaceAll(strings.ReplaceAll(part, "~1", "/"), "~0", "~")
			raw = object[part]
			if len(raw) == 0 {
				return fmt.Errorf("unknown OpenAPI reference %q", reference.Ref)
			}
			if i < len(parts)-1 {
				object = nil
				if err := json.Unmarshal(raw, &object); err != nil {
					return err
				}
			}
		}
	}
	return errors.New("cyclic OpenAPI reference")
}
