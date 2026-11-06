// Package domain defines the tool document, data sources, releases and grants
// of the Internal Tool Builder built-in app. The JSON shapes here are the contract
// shared with the SPA (web/src/model/document.ts and
// src/api/types.ts); the golden fixtures under testdata/documents are accepted
// or rejected identically by both sides.
// Design: https://github.com/appthrust/platform/blob/main/design/platform/marketplace-apps/README.md "Document".
package domain

import "time"

const DocumentSchemaVersion = 1

type ComponentType string

const (
	ComponentTable       ComponentType = "table"
	ComponentDetail      ComponentType = "detail"
	ComponentForm        ComponentType = "form"
	ComponentChart       ComponentType = "chart"
	ComponentStat        ComponentType = "stat"
	ComponentText        ComponentType = "text"
	ComponentSelect      ComponentType = "select"
	ComponentDate        ComponentType = "date"
	ComponentSearchInput ComponentType = "searchInput"
	ComponentButton      ComponentType = "button"
	ComponentContainer   ComponentType = "container"
	ComponentTabs        ComponentType = "tabs"
	ComponentDivider     ComponentType = "divider"
)

// ComponentTypes lists every type in palette order.
var ComponentTypes = []ComponentType{
	ComponentTable, ComponentDetail, ComponentForm, ComponentChart, ComponentStat,
	ComponentText, ComponentSelect, ComponentDate, ComponentSearchInput,
	ComponentButton, ComponentContainer, ComponentTabs, ComponentDivider,
}

// ExposedProps names the prop heads each type exposes to references
// (`selectedRow.id` is exposed when `selectedRow` is).
var ExposedProps = map[ComponentType][]string{
	ComponentTable:       {"selectedRow"},
	ComponentForm:        {"values"},
	ComponentSelect:      {"value"},
	ComponentDate:        {"value"},
	ComponentSearchInput: {"value"},
	ComponentTabs:        {"active"},
}

// Layout is in 12-column grid units; H is rows of 40px.
type Layout struct {
	X int `json:"x"`
	Y int `json:"y"`
	W int `json:"w"`
	H int `json:"h"`
}

// Ref points at a prop another component exposes.
type Ref struct {
	Component string `json:"component"`
	Prop      string `json:"prop"`
}

// Prop is either a literal value or a reference. Exactly one of Value/Ref is
// set according to Kind ("value" | "ref").
type Prop struct {
	Kind  string `json:"kind"`
	Value any    `json:"value,omitempty"`
	Ref   *Ref   `json:"ref,omitempty"`
}

type ParamType string

const (
	ParamText       ParamType = "text"
	ParamNumber     ParamType = "number"
	ParamBoolean    ParamType = "boolean"
	ParamDate       ParamType = "date"
	ParamTimestamp  ParamType = "timestamp"
	ParamTextList   ParamType = "textList"
	ParamNumberList ParamType = "numberList"
)

var ParamTypes = []ParamType{ParamText, ParamNumber, ParamBoolean, ParamDate, ParamTimestamp, ParamTextList, ParamNumberList}

// ParamBind is `{ref}` or `{literal}`; Literal may be JSON null, so HasLiteral
// distinguishes "literal null" from "ref".
type ParamBind struct {
	Ref        *Ref `json:"ref,omitempty"`
	Literal    any  `json:"literal,omitempty"`
	HasLiteral bool `json:"-"`
}

// Param supplies a named placeholder or structured filter of a query.
type Param struct {
	Name string    `json:"name"`
	Type ParamType `json:"type"`
	Bind ParamBind `json:"bind"`
}

// Filter narrows a read SQL query using a declared parameter, never spliced values.
type Filter struct {
	Column        string `json:"column"`
	Op            string `json:"op"` // eq | neq | contains | gte | lte | in
	Param         string `json:"param"`
	SkipWhenEmpty bool   `json:"skipWhenEmpty"`
}

type QueryMode string

const (
	QueryRead  QueryMode = "read"
	QueryWrite QueryMode = "write"
)

type SQLQuery struct {
	Text string `json:"text"`
}

type HTTPQuery struct {
	Method     string `json:"method"`
	Path       string `json:"path"`
	Body       string `json:"body,omitempty"`
	ResultPath string `json:"resultPath,omitempty"`
}

const (
	DefaultQueryTimeout = 10 * time.Second
	MaxQueryTimeout     = 30 * time.Second
	DefaultRowLimit     = 500
	MaxRowLimit         = 5000
)

type Query struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	SourceID  string     `json:"sourceId"`
	Mode      QueryMode  `json:"mode"`
	SQL       *SQLQuery  `json:"sql,omitempty"`
	HTTP      *HTTPQuery `json:"http,omitempty"`
	Params    []Param    `json:"params"`
	Filters   []Filter   `json:"filters,omitempty"`
	TimeoutMs int        `json:"timeoutMs"`
	RowLimit  int        `json:"rowLimit"`
}

type ActionConfirm struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

type Action struct {
	ID        string         `json:"id"`
	Label     string         `json:"label"`
	QueryID   string         `json:"queryId"`
	Confirm   *ActionConfirm `json:"confirm,omitempty"`
	Input     *ActionInput   `json:"input,omitempty"`
	OnSuccess *ActionSuccess `json:"onSuccess,omitempty"`
}

type ActionInput struct {
	FormComponent string `json:"formComponent"`
}

type ActionSuccess struct {
	Refresh []string `json:"refresh"`
}

type Component struct {
	ID       string          `json:"id"`
	Type     ComponentType   `json:"type"`
	Layout   Layout          `json:"layout"`
	ParentID string          `json:"parentId,omitempty"`
	Props    map[string]Prop `json:"props"`
	Actions  []Action        `json:"actions,omitempty"`
}

type Page struct {
	ID         string      `json:"id"`
	Title      string      `json:"title"`
	Components []Component `json:"components"`
}

// Document is the whole tool. v1 has exactly one page.
type Document struct {
	SchemaVersion int     `json:"schemaVersion"`
	Pages         []Page  `json:"pages"`
	Queries       []Query `json:"queries"`
}
