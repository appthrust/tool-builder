package domain

import "time"

type DataSourceKind string

const (
	SourcePostgres   DataSourceKind = "postgres"
	SourceHTTP       DataSourceKind = "http"
	SourceCatalogApp DataSourceKind = "builtin-app"
)

type DataSourceStatus string

const (
	SourcePending DataSourceStatus = "pending"
	SourceReady   DataSourceStatus = "ready"
	SourceError   DataSourceStatus = "error"
)

// DataSource is one connected Project database, app, or built-in app. PostgreSQL
// credentials arrive through the connection environment; built-in app origins are
// resolved at runtime from Definition. Neither is persisted in the row.
type DataSource struct {
	ID                     string         `json:"id"`
	Slug                   string         `json:"slug"`
	Kind                   DataSourceKind `json:"kind"`
	Name                   string         `json:"name"`
	ConnectionName         *string        `json:"connectionName"`
	DestinationComponentID string         `json:"destinationComponentId,omitempty"`
	BaseURL                *string        `json:"baseUrl,omitempty"`
	Definition             *string        `json:"definition,omitempty"`
	CreatedBy              string         `json:"createdBy"`
	CreatedAt              time.Time      `json:"createdAt"`
}

type Access struct {
	Use  bool `json:"use"`
	Edit bool `json:"edit"`
}

type Tool struct {
	ID                string     `json:"id"`
	Slug              string     `json:"slug"`
	Name              string     `json:"name"`
	Description       string     `json:"description"`
	Draft             Document   `json:"-"`
	DraftVersion      string     `json:"-"` // opaque, changes on every draft write
	DraftUpdatedAt    time.Time  `json:"draftUpdatedAt"`
	DraftUpdatedBy    string     `json:"-"`
	LiveReleaseID     *string    `json:"-"`
	LiveReleaseNumber *int       `json:"liveReleaseNumber"`
	CreatedBy         string     `json:"-"`
	CreatedAt         time.Time  `json:"createdAt"`
	ArchivedAt        *time.Time `json:"archivedAt"`
}

type ReleaseChange struct {
	Kind  string `json:"kind"` // component | query | action | page
	Op    string `json:"op"`   // added | removed | changed
	ID    string `json:"id"`
	Label string `json:"label"`
}

type Actor struct {
	Subject     string `json:"subject"`
	DisplayName string `json:"displayName"`
}

type Release struct {
	ID           string          `json:"id"`
	ToolID       string          `json:"-"`
	Number       int             `json:"number"`
	Document     Document        `json:"-"`
	Note         string          `json:"note"`
	Changes      []ReleaseChange `json:"changes"`
	PublishedBy  Actor           `json:"publishedBy"`
	PublishedAt  time.Time       `json:"publishedAt"`
	RestoredFrom *int            `json:"restoredFrom"`
}

type GrantRole string

const (
	GrantUse  GrantRole = "use"
	GrantEdit GrantRole = "edit"
)

type GroupGrant struct {
	GroupID string    `json:"groupId"`
	Role    GrantRole `json:"role"`
}

type ActionGrant struct {
	ActionID string   `json:"actionId"`
	GroupIDs []string `json:"groupIds"`
}

type Grants struct {
	Groups  []GroupGrant  `json:"groups"`
	Actions []ActionGrant `json:"actions"`
}

type ActionRunStatus string

const (
	RunOK     ActionRunStatus = "ok"
	RunFailed ActionRunStatus = "failed"
	RunDenied ActionRunStatus = "denied"
)

// ActionRun records one action execution; parameters are hashed, never stored.
type ActionRun struct {
	ID            string          `json:"id"`
	ToolID        string          `json:"-"`
	ReleaseID     string          `json:"-"`
	ReleaseNumber int             `json:"releaseNumber"`
	ActionID      string          `json:"actionId"`
	ActionLabel   string          `json:"actionLabel"`
	QueryID       string          `json:"queryId"`
	Actor         Actor           `json:"actor"`
	ParamsHash    string          `json:"-"`
	Status        ActionRunStatus `json:"status"`
	RowCount      *int            `json:"rowCount"`
	Error         *string         `json:"error"`
	StartedAt     time.Time       `json:"startedAt"`
	FinishedAt    time.Time       `json:"finishedAt"`
}
