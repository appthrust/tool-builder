package domain

import "strings"

// SQLToken is an executable SQL word or named placeholder and its parentheses
// depth. Quoted values, identifiers and comments are not executable tokens.
type SQLToken struct {
	Text       string
	Depth      int
	Parameter  string
	Start, End int // Byte offsets for placeholders only.
}

func SQLTokens(text string) []SQLToken { tokens, _ := scanSQL(text, true); return tokens }

// ValidateSQL rejects positional binds and statement separators outside literals.
func ValidateSQL(text string) string { _, reason := scanSQL(text, false); return reason }

// HasSQLLiteralPlaceholder reports named placeholders hidden from the lexer by
// a quoted value, identifier or comment. Pairing still counts all placeholders.
func HasSQLLiteralPlaceholder(text string) bool {
	matches := placeholder.FindAllStringIndex(text, -1)
	if len(matches) == 0 {
		return false
	}
	executable := 0
	for _, token := range SQLTokens(text) {
		if token.Parameter != "" {
			executable++
		}
	}
	return executable != len(matches)
}

func scanSQL(text string, collect bool) ([]SQLToken, string) {
	var tokens []SQLToken
	depth := 0
	reason := ""
	for i := 0; i < len(text); {
		c := text[i]
		if c == '\'' || c == '"' {
			quote := c
			escape := quote == '\'' && i > 0 && (text[i-1] == 'e' || text[i-1] == 'E') && (i < 2 || !sqlWord(text[i-2]) && text[i-2] != '$')
			i++
			closed := false
			for i < len(text) {
				if escape && text[i] == '\\' {
					i += 2
					continue
				}
				if text[i] == quote {
					i++
					if i < len(text) && text[i] == quote {
						i++
						continue
					}
					closed = true
					break
				}
				i++
			}
			if !closed {
				return tokens, "schema"
			}
			continue
		}
		if c == '-' && i+1 < len(text) && text[i+1] == '-' {
			for i < len(text) && text[i] != '\n' {
				i++
			}
			continue
		}
		if c == '/' && i+1 < len(text) && text[i+1] == '*' {
			i += 2
			nesting := 1
			for i < len(text) && nesting > 0 {
				if i+1 < len(text) && text[i:i+2] == "/*" {
					nesting++
					i += 2
				} else if i+1 < len(text) && text[i:i+2] == "*/" {
					nesting--
					i += 2
				} else {
					i++
				}
			}
			if nesting != 0 {
				return tokens, "schema"
			}
			continue
		}
		if c == '$' {
			if i+1 < len(text) && text[i+1] >= '0' && text[i+1] <= '9' {
				reason = "positional_placeholder"
				i++
				continue
			}
			j := i + 1
			for j < len(text) && sqlWord(text[j]) {
				j++
			}
			if j < len(text) && text[j] == '$' {
				tag := text[i : j+1]
				end := strings.Index(text[j+1:], tag)
				if end < 0 {
					return tokens, "schema"
				}
				i = j + 1 + end + len(tag)
				continue
			}
		}
		if c == '{' && i+1 < len(text) && text[i+1] == '{' {
			match := placeholder.FindStringSubmatchIndex(text[i:])
			if match != nil && match[0] == 0 {
				end := i + match[1]
				if collect {
					tokens = append(tokens, SQLToken{Text: text[i:end], Depth: depth, Parameter: text[i+match[2] : i+match[3]], Start: i, End: end})
				}
				i = end
				continue
			}
		}
		if c == ';' {
			if reason == "" {
				reason = "multiple_statements"
			}
		}
		if c == '(' {
			depth++
		}
		if c == ')' {
			depth--
		}
		if sqlWord(c) && !(c >= '0' && c <= '9') {
			start := i
			for i < len(text) && (sqlWord(text[i]) || collect && text[i] == '$') {
				i++
			}
			if collect {
				tokens = append(tokens, SQLToken{Text: strings.ToUpper(text[start:i]), Depth: depth})
			}
			continue
		}
		i++
	}
	return tokens, reason
}

func sqlWord(c byte) bool {
	return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_'
}
