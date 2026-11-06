package domain

import "encoding/json"

// Preserve explicit null literals across draft saves and immutable releases.
func (b *ParamBind) UnmarshalJSON(data []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	*b = ParamBind{}
	if raw, ok := fields["ref"]; ok {
		if err := json.Unmarshal(raw, &b.Ref); err != nil {
			return err
		}
	}
	if raw, ok := fields["literal"]; ok {
		b.HasLiteral = true
		if err := json.Unmarshal(raw, &b.Literal); err != nil {
			return err
		}
	}
	return nil
}

func (b ParamBind) MarshalJSON() ([]byte, error) {
	if b.Ref != nil && !b.HasLiteral {
		return json.Marshal(struct {
			Ref *Ref `json:"ref"`
		}{b.Ref})
	}
	if b.Ref != nil {
		return json.Marshal(map[string]any{"ref": b.Ref, "literal": b.Literal})
	}
	if !b.HasLiteral && b.Literal == nil {
		return []byte("{}"), nil
	}
	return json.Marshal(struct {
		Literal any `json:"literal"`
	}{b.Literal})
}

func EmptyDocument() Document {
	return Document{SchemaVersion: 1, Pages: []Page{{ID: "main", Components: []Component{}}}, Queries: []Query{}}
}
