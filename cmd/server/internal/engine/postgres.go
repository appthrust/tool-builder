package engine

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode"

	"github.com/appthrust/tool-builder/cmd/server/internal/domain"
	"github.com/lib/pq"
)

func (e *Engine) runPostgres(ctx context.Context, req domain.RunRequest, values map[string]boundValue, s *source) (domain.RunResult, error) {
	result := domain.RunResult{Columns: []domain.Column{}, Rows: [][]any{}}
	if req.Query.SQL == nil || req.Query.HTTP != nil {
		return result, failure("invalid_input", "PostgreSQL queries require SQL", nil)
	}
	if domain.HasSQLLiteralPlaceholder(req.Query.SQL.Text) {
		return result, failure("invalid_input", "Invalid SQL: placeholder_in_literal", nil)
	}
	if len(req.Query.Filters) > 0 && req.Query.Mode != domain.QueryRead {
		return result, failure("invalid_input", "Filters require a read SQL query", nil)
	}
	text, args, err := bindSQL(req.Query.SQL.Text, values)
	if err != nil {
		return result, err
	}
	if len(req.Query.Filters) > 0 {
		text, err = filterSQL(text, req.Query.Filters, values)
		if err != nil {
			return result, err
		}
	}
	timeout := queryTimeout(req.Query)
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	db, err := e.database(ctx, req.Source, s)
	if err != nil {
		return result, err
	}
	write := req.Query.Mode == domain.QueryWrite && req.Write
	tx, err := begin(ctx, db, !write, timeout)
	if err != nil {
		return result, sqlFailure(err)
	}
	defer func() { _ = tx.Rollback() }()
	if !write || returnsRows(text) {
		queryCtx, cancelQuery := context.WithCancel(ctx)
		defer cancelQuery()
		rows, err := tx.QueryContext(queryCtx, text, args...)
		if err != nil {
			return result, sqlFailure(err)
		}
		result, err = readRows(rows, rowLimit(req.Query), write, cancelQuery)
		if err != nil {
			return result, sqlFailure(err)
		}
		if !write && result.Truncated {
			// Cancellation may discard the connection. The deferred rollback
			// releases the transaction; cancellation here is a successful cap.
			return result, nil
		}
	} else {
		outcome, err := tx.ExecContext(ctx, text, args...)
		if err != nil {
			return result, sqlFailure(err)
		}
		count, err := outcome.RowsAffected()
		if err != nil {
			return result, sqlFailure(err)
		}
		result.RowCount = int(count)
	}
	if write {
		if err := tx.Commit(); err != nil {
			return result, sqlFailure(err)
		}
	} else {
		if err := tx.Rollback(); err != nil {
			return result, sqlFailure(err)
		}
	}
	return result, nil
}

func begin(ctx context.Context, db *sql.DB, readOnly bool, timeout time.Duration) (*sql.Tx, error) {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: readOnly})
	if err != nil {
		return nil, err
	}
	for _, setting := range []string{"statement_timeout", "idle_in_transaction_session_timeout"} {
		if _, err := tx.ExecContext(ctx, fmt.Sprintf("SET LOCAL %s = %d", setting, timeout.Milliseconds())); err != nil {
			_ = tx.Rollback()
			return nil, err
		}
	}
	return tx, nil
}

// Classification selects the result API only; PostgreSQL READ ONLY is the
// authority boundary. CTEs and literals are tokenized by the domain validator.
func returnsRows(text string) bool {
	tokens := domain.SQLTokens(placeholder.ReplaceAllString(text, "NULL"))
	command := ""
	with := len(tokens) > 0 && tokens[0].Text == "WITH"
	for _, token := range tokens {
		if token.Depth != 0 {
			continue
		}
		if token.Text == "RETURNING" {
			return true
		}
		if command != "" {
			continue
		}
		if !with {
			command = token.Text
		} else {
			switch token.Text {
			case "SELECT", "TABLE", "VALUES", "INSERT", "UPDATE", "DELETE", "MERGE":
				command = token.Text
			}
		}
	}
	switch command {
	case "SELECT", "TABLE", "VALUES", "SHOW", "EXPLAIN":
		return true
	default:
		return false
	}
}

func readRows(rows *sql.Rows, limit int, write bool, cancel context.CancelFunc) (result domain.RunResult, err error) {
	result = domain.RunResult{Columns: []domain.Column{}, Rows: [][]any{}}
	defer func() {
		if !write && result.Truncated && err == nil {
			// lib/pq drains unread results on Close unless the query is
			// cancelled first. Writes must drain RETURNING before commit.
			cancel()
			_ = rows.Close()
			return
		}
		err = errors.Join(err, rows.Close())
	}()
	types, err := rows.ColumnTypes()
	if err != nil {
		return result, err
	}
	result.Columns = make([]domain.Column, len(types))
	for i, col := range types {
		result.Columns[i] = domain.Column{Name: col.Name(), Type: strings.ToLower(col.DatabaseTypeName())}
	}
	values := make([]any, len(types))
	dest := make([]any, len(types))
	for i := range values {
		dest[i] = &values[i]
	}
	for rows.Next() {
		if err := rows.Scan(dest...); err != nil {
			return result, err
		}
		result.RowCount++
		if len(result.Rows) >= limit {
			result.Truncated = true
			if !write {
				result.RowCount-- // The sentinel is not a returned row.
				break
			}
			// Drain RETURNING rows to obtain the affected count before commit,
			// but retain only the bounded result preview in memory.
			continue
		}
		row := make([]any, len(types))
		for i, value := range values {
			row[i], err = encodeValue(result.Columns[i].Type, value)
			if err != nil {
				return result, err
			}
		}
		result.Rows = append(result.Rows, row)
	}
	return result, rows.Err()
}

var postgresURL = regexp.MustCompile(`(?i)postgres(?:ql)?://[^\s"'<>]+`)
var passwordSetting = regexp.MustCompile(`(?i)(?:password|passfile|sslkey)\s*=\s*(?:'[^']*'|"[^"]*"|[^\s,;]+)`)

func sqlFailure(err error) *domain.RunError {
	var runErr *domain.RunError
	if errors.As(err, &runErr) {
		return runErr
	}
	var pgErr *pq.Error
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "25006":
			return failure("query_not_read_only", "Query attempted a write in a read-only transaction", err)
		case "57014":
			return failure("query_timeout", "Query exceeded its timeout", err)
		}
		return failure("query_failed", sanitizeMessage(pgErr.Message), err)
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return failure("query_timeout", "Query exceeded its timeout", err)
	}
	return failure("query_failed", "Query failed", err)
}

func sanitizeMessage(message string) string {
	message = postgresURL.ReplaceAllString(message, "[redacted]")
	message = passwordSetting.ReplaceAllString(message, "[redacted]")
	message = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, message)
	if len(message) > 1024 {
		message = strings.ToValidUTF8(message[:1024], "")
	}
	if message == "" {
		return "Query failed"
	}
	return message
}
