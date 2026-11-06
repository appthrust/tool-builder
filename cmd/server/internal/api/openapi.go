package api

import (
	_ "embed"
	"encoding/json"
)

//go:embed openapi.json
var document []byte

func (a *API) openapi(_ *request) (any, int, error) {
	return json.RawMessage(document), 200, nil
}
