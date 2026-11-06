package domain

import (
	_ "embed"
	"encoding/json"
)

//go:embed testdata/documents/valid/order-desk.json
var orderDesk []byte

func DemoDocument() (Document, error) {
	var doc Document
	err := json.Unmarshal(orderDesk, &doc)
	return doc, err
}
