package engine

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/appthrust/tool-builder/cmd/server/internal/domain"
	"github.com/lib/pq"
)

// Keep the grammar identical to domain validation and the SPA. Go's \s is
// ASCII [\t\n\f\r ]; Unicode spaces (including NBSP) are not accepted.
var placeholder = regexp.MustCompile(`\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}`)
var numberLiteral = regexp.MustCompile(`^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$`)

type boundValue struct {
	value    any
	position int
	kind     domain.ParamType
}

func bindInputs(params []domain.Param, inputs map[string]any) (map[string]boundValue, error) {
	values := make(map[string]boundValue, len(params))
	for i, param := range params {
		if _, exists := values[param.Name]; exists {
			return nil, failure("invalid_input", "Duplicate parameter "+param.Name, nil)
		}
		value, err := coerce(param.Type, inputs[param.Name])
		if err != nil {
			return nil, failure("invalid_input", fmt.Sprintf("Parameter %s must be %s", param.Name, param.Type), err)
		}
		values[param.Name] = boundValue{value: value, position: i + 1, kind: param.Type}
	}
	return values, nil
}

func coerce(kind domain.ParamType, value any) (any, error) {
	if value == nil {
		return nil, nil
	}
	switch kind {
	case domain.ParamText:
		if v, ok := value.(string); ok {
			return v, nil
		}
	case domain.ParamNumber:
		return number(value)
	case domain.ParamBoolean:
		if v, ok := value.(bool); ok {
			return v, nil
		}
	case domain.ParamDate, domain.ParamTimestamp:
		if v, ok := value.(string); ok {
			layout := time.DateOnly
			if kind == domain.ParamTimestamp {
				layout = time.RFC3339Nano
			}
			if _, err := time.Parse(layout, v); err == nil {
				return v, nil
			}
		}
	case domain.ParamTextList:
		switch v := value.(type) {
		case []string:
			if v == nil {
				return nil, nil
			}
			return v, nil
		case []any:
			if v == nil {
				return nil, nil
			}
			out := make([]string, len(v))
			for i, item := range v {
				text, ok := item.(string)
				if !ok {
					return nil, fmt.Errorf("element %d is not text", i)
				}
				out[i] = text
			}
			return out, nil
		}
	case domain.ParamNumberList:
		switch v := value.(type) {
		case []float64:
			if v == nil {
				return nil, nil
			}
			for _, n := range v {
				if math.IsNaN(n) || math.IsInf(n, 0) {
					return nil, fmt.Errorf("non-finite number")
				}
			}
			return v, nil
		case []any:
			if v == nil {
				return nil, nil
			}
			out := make([]float64, len(v))
			for i, item := range v {
				n, err := number(item)
				if err != nil {
					return nil, err
				}
				switch n := n.(type) {
				case float64:
					out[i] = n
				case json.Number:
					out[i], err = n.Float64()
					if err != nil || math.IsInf(out[i], 0) {
						return nil, fmt.Errorf("number list element out of range")
					}
				}
			}
			return out, nil
		}
	}
	return nil, fmt.Errorf("invalid %s value", kind)
}

func number(value any) (any, error) {
	switch v := value.(type) {
	case float64:
		if !math.IsNaN(v) && !math.IsInf(v, 0) {
			return v, nil
		}
	case float32:
		return number(float64(v))
	case json.Number:
		if numberLiteral.MatchString(string(v)) {
			return v, nil
		}
	case string:
		if numberLiteral.MatchString(v) {
			return json.Number(v), nil
		}
	case int:
		return json.Number(strconv.Itoa(v)), nil
	case int64:
		return json.Number(strconv.FormatInt(v, 10)), nil
	case int32:
		return json.Number(strconv.FormatInt(int64(v), 10)), nil
	case uint64:
		return json.Number(strconv.FormatUint(v, 10)), nil
	}
	return nil, fmt.Errorf("invalid number")
}

func interpolate(text string, values map[string]boundValue, encode func(boundValue) (string, error)) (string, error) {
	matches := placeholder.FindAllStringSubmatchIndex(text, -1)
	var out strings.Builder
	out.Grow(len(text))
	end := 0
	for _, m := range matches {
		name := text[m[2]:m[3]]
		v, ok := values[name]
		if !ok {
			return "", failure("invalid_input", "Undeclared parameter "+name, nil)
		}
		encoded, err := encode(v)
		if err != nil {
			return "", failure("invalid_input", "Cannot encode parameter "+name, err)
		}
		out.WriteString(text[end:m[0]])
		out.WriteString(encoded)
		end = m[1]
	}
	out.WriteString(text[end:])
	return out.String(), nil
}

func bindSQL(text string, values map[string]boundValue) (string, []any, error) {
	if strings.TrimSpace(text) == "" {
		return "", nil, failure("invalid_input", "Invalid SQL: empty_query", nil)
	}
	if strings.Contains(placeholder.ReplaceAllString(text, ""), "{{") {
		return "", nil, failure("invalid_input", "Only named placeholders are allowed", nil)
	}
	if reason := domain.ValidateSQL(text); reason != "" {
		return "", nil, failure("invalid_input", "Invalid SQL: "+reason, nil)
	}
	var bound strings.Builder
	bound.Grow(len(text))
	end := 0
	for _, token := range domain.SQLTokens(text) {
		if token.Parameter == "" {
			continue
		}
		v, ok := values[token.Parameter]
		if !ok {
			return "", nil, failure("invalid_input", "Undeclared parameter "+token.Parameter, nil)
		}
		// The declaration supplies a type even for NULL and polymorphic calls.
		cast, err := sqlParamCast(v.kind)
		if err != nil {
			return "", nil, err
		}
		bound.WriteString(text[end:token.Start])
		bound.WriteByte('$')
		bound.WriteString(strconv.Itoa(v.position))
		bound.WriteString("::")
		bound.WriteString(cast)
		end = token.End
	}
	bound.WriteString(text[end:])
	args := make([]any, len(values))
	for _, v := range values {
		switch value := v.value.(type) {
		case []string:
			args[v.position-1] = pq.Array(value)
		case []float64:
			args[v.position-1] = pq.Array(value)
		case json.Number:
			args[v.position-1] = string(value)
		default:
			args[v.position-1] = value
		}
	}
	return bound.String(), args, nil
}

func sqlParamCast(kind domain.ParamType) (string, error) {
	switch kind {
	case domain.ParamText:
		return "text", nil
	case domain.ParamNumber:
		return "numeric", nil
	case domain.ParamBoolean:
		return "boolean", nil
	case domain.ParamDate:
		return "date", nil
	case domain.ParamTimestamp:
		return "timestamptz", nil
	case domain.ParamTextList:
		return "text[]", nil
	case domain.ParamNumberList:
		return "numeric[]", nil
	default:
		return "", failure("invalid_input", "Unsupported parameter type "+string(kind), nil)
	}
}

// filterSQL only adds identifiers and operators; values retain their declared
// bind positions and types, including parameters used only by filters.
func filterSQL(text string, filters []domain.Filter, values map[string]boundValue) (string, error) {
	if len(filters) == 0 {
		return text, nil
	}
	var out strings.Builder
	out.Grow(len(text) + len(filters)*128)
	out.WriteString("SELECT * FROM (")
	out.WriteString(text)
	// A newline terminates a trailing SQL line comment before the closing paren.
	// PostgreSQL preserves an inner ORDER BY in practice, not by the SQL standard.
	out.WriteString("\n) AS _q WHERE ")
	for i, filter := range filters {
		v, ok := values[filter.Param]
		if !ok {
			return "", failure("invalid_input", "Undeclared parameter "+filter.Param, nil)
		}
		cast, err := sqlParamCast(v.kind)
		if err != nil {
			return "", err
		}
		param := "$" + strconv.Itoa(v.position) + "::" + cast
		if i > 0 {
			out.WriteString(" AND ")
		}
		if filter.SkipWhenEmpty {
			out.WriteByte('(')
			out.WriteString(param)
			out.WriteString(" IS NULL OR ")
			switch v.kind {
			case domain.ParamText:
				out.WriteString(param)
				out.WriteString(" = '' OR ")
			case domain.ParamTextList, domain.ParamNumberList:
				out.WriteString("cardinality(")
				out.WriteString(param)
				out.WriteString(") = 0 OR ")
			}
		}
		out.WriteString(`_q."`)
		out.WriteString(strings.ReplaceAll(filter.Column, `"`, `""`))
		out.WriteByte('"')
		switch filter.Op {
		case "eq":
			out.WriteString(" = ")
		case "neq":
			out.WriteString(" <> ")
		case "contains":
			// LIKE wildcards (% and _) in the bound value are not escaped.
			out.WriteString("::text ILIKE '%' || ")
		case "gte":
			out.WriteString(" >= ")
		case "lte":
			out.WriteString(" <= ")
		case "in":
			out.WriteString(" = ANY(")
		default:
			return "", failure("invalid_input", "Unknown filter operator "+filter.Op, nil)
		}
		out.WriteString(param)
		switch filter.Op {
		case "contains":
			if v.kind != domain.ParamText {
				out.WriteString("::text")
			}
			out.WriteString(" || '%'")
		case "in":
			out.WriteByte(')')
		}
		if filter.SkipWhenEmpty {
			out.WriteByte(')')
		}
	}
	return out.String(), nil
}
