package engine

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/lib/pq"
)

func encodeValue(kind string, value any) (any, error) {
	if value == nil || kind == "bytea" {
		return nil, nil
	}
	if timestamp, ok := value.(time.Time); ok {
		if kind == "date" {
			return timestamp.Format(time.DateOnly), nil
		}
		return timestamp.UTC().Format(time.RFC3339Nano), nil
	}
	var text string
	switch v := value.(type) {
	case []byte:
		text = string(v)
	case string:
		text = v
	case float64:
		if math.IsNaN(v) {
			return "NaN", nil
		}
		if math.IsInf(v, 1) {
			return "Infinity", nil
		}
		if math.IsInf(v, -1) {
			return "-Infinity", nil
		}
		return v, nil
	default:
		return v, nil
	}
	if strings.HasPrefix(kind, "_") {
		return decodeArray(kind[1:], text)
	}
	switch kind {
	case "json", "jsonb":
		var result any
		decoder := json.NewDecoder(strings.NewReader(text))
		decoder.UseNumber()
		if err := decoder.Decode(&result); err != nil {
			return nil, err
		}
		return result, nil
	case "int2", "int4", "int8", "oid":
		return strconv.ParseInt(text, 10, 64)
	case "float4", "float8":
		f, err := strconv.ParseFloat(text, 64)
		if err != nil {
			return nil, err
		}
		// PostgreSQL permits NaN/Infinity; JSON does not. Preserve them as text.
		if text == "NaN" || strings.Contains(text, "Infinity") {
			return text, nil
		}
		return f, nil
	case "bool":
		return strconv.ParseBool(text)
	case "timestamp", "timestamptz":
		if text == "infinity" || text == "-infinity" {
			return text, nil
		}
		timestamp, err := pq.ParseTimestamp(nil, text)
		if err != nil {
			return nil, err
		}
		return timestamp.UTC().Format(time.RFC3339Nano), nil
	default:
		// In particular numeric stays decimal text rather than losing precision.
		return text, nil
	}
}

// pq's GenericArray does not decode multidimensional arrays. This small text
// decoder handles the PostgreSQL wire representation, including NULL elements,
// quoted escapes and non-default lower bounds; indices are JSON zero-based.
func decodeArray(kind, text string) ([]any, error) {
	if strings.HasPrefix(text, "[") {
		_, rest, ok := strings.Cut(text, "=")
		if !ok {
			return nil, fmt.Errorf("invalid array dimensions")
		}
		text = rest
	}
	pos := 0
	array, err := parseArray(kind, text, &pos)
	if err == nil && pos != len(text) {
		err = fmt.Errorf("invalid array suffix")
	}
	return array, err
}

func parseArray(kind, text string, pos *int) ([]any, error) {
	if *pos >= len(text) || text[*pos] != '{' {
		return nil, fmt.Errorf("invalid array")
	}
	*pos++
	out := []any{}
	if *pos < len(text) && text[*pos] == '}' {
		*pos++
		return out, nil
	}
	for *pos < len(text) {
		var value any
		var err error
		if text[*pos] == '{' {
			value, err = parseArray(kind, text, pos)
		} else {
			quoted := text[*pos] == '"'
			if quoted {
				*pos++
			}
			var item strings.Builder
			closed := !quoted
			for *pos < len(text) {
				ch := text[*pos]
				if ch == '\\' {
					*pos++
					if *pos >= len(text) {
						return nil, fmt.Errorf("invalid array escape")
					}
					item.WriteByte(text[*pos])
					*pos++
				} else if quoted && ch == '"' {
					*pos++
					closed = true
					break
				} else if !quoted && (ch == ',' || ch == '}') {
					break
				} else {
					item.WriteByte(ch)
					*pos++
				}
			}
			if !closed {
				return nil, fmt.Errorf("unterminated array item")
			}
			if quoted || item.String() != "NULL" {
				value, err = encodeValue(kind, item.String())
			}
		}
		if err != nil {
			return nil, err
		}
		out = append(out, value)
		if *pos >= len(text) {
			break
		}
		switch text[*pos] {
		case '}':
			*pos++
			return out, nil
		case ',':
			*pos++
		default:
			return nil, fmt.Errorf("invalid array separator")
		}
	}
	return nil, fmt.Errorf("unterminated array")
}
