package api

import (
	"testing"

	"github.com/appthrust/appserver-go/appserver/link"
	"github.com/stretchr/testify/require"
)

func TestParseOperationsResolvesLocalContract(t *testing.T) {
	raw := []byte(`{
		"x-appthrust-definition":"example",
		"servers":[{"url":"/api/custom"}],
		"paths":{
			"/search/{id}":{
				"parameters":[{"name":"id","in":"path","required":true,"schema":{"type":"string"}}],
				"post":{"operationId":"search","x-appthrust-link":true,"x-appthrust-result-path":"items","summary":"Find records","requestBody":{"$ref":"#/components/requestBodies/Search"}},
				"delete":{"operationId":"notExposed"}
			}
		},
		"components":{
			"requestBodies":{"Search":{"content":{"application/json":{"schema":{"$ref":"#/components/schemas/Search"}}}}},
			"schemas":{"Search":{"type":"object","required":["query"],"properties":{"query":{"type":"string"},"topK":{"type":"integer"}}}}
		}
	}`)
	operations, err := parseOperations(raw, "example")
	require.NoError(t, err)
	require.Equal(t, []link.Operation{{Definition: "example", Base: "/api/custom", ID: "search", Method: "POST", Path: "/search/{id}", Summary: "Find records", ResultPath: "items", Params: []link.Param{{Name: "id", In: "path", Type: "string", Required: true}, {Name: "query", In: "body", Type: "string", Required: true}, {Name: "topK", In: "body", Type: "integer"}}}}, operations)
	_, err = parseOperations(raw, "another-app-installation")
	require.Error(t, err)
}

func TestParseOperationsRejectsExternalAndCyclicReferences(t *testing.T) {
	for _, ref := range []string{"https://external.invalid/schema", "#/components/parameters/cycle"} {
		raw := []byte(`{"x-appthrust-definition":"example","servers":[{"url":"/api/example"}],"paths":{"/items":{"get":{"operationId":"items","x-appthrust-link":true,"parameters":[{"$ref":"` + ref + `"}]}}},"components":{"parameters":{"cycle":{"$ref":"#/components/parameters/cycle"}}}}`)
		_, err := parseOperations(raw, "example")
		require.Error(t, err)
	}
}
