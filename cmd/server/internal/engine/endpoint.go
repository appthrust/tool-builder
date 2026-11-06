package engine

import (
	"context"
	"errors"
	"time"

	"github.com/appthrust/appserver-go/appserver/link"
	"github.com/appthrust/tool-builder/cmd/server/internal/domain"
)

// EndpointResolver returns a platform-owned origin, never a user-supplied URL.
type EndpointResolver interface {
	Endpoint(context.Context, string, domain.DataSource) (string, error)
}

// BindingResolver allows the engine to consume link bindings without owning
// transport, credentials, or the resolver's discovery cache.
type BindingResolver interface {
	Resolve(context.Context, string, string) (link.Binding, error)
}

type storedBaseURL struct{}

func (storedBaseURL) Endpoint(_ context.Context, _ string, ds domain.DataSource) (string, error) {
	if ds.BaseURL == nil {
		return "", failure("data_source_unavailable", "HTTP data source has no endpoint", nil)
	}
	return *ds.BaseURL, nil
}

type linkEndpoint struct{ resolver BindingResolver }

func (r linkEndpoint) binding(ctx context.Context, bearer string, ds domain.DataSource) (link.Binding, error) {
	if r.resolver == nil || ds.Definition == nil || *ds.Definition == "" {
		return link.Binding{}, link.ErrUnavailable
	}
	return r.resolver.Resolve(ctx, bearer, *ds.Definition)
}

func catalogAppState(ds domain.DataSource, binding link.Binding, err error) domain.SourceState {
	state := domain.SourceState{Status: domain.SourceError, Checked: time.Now().UTC()}
	switch {
	case err != nil:
		state.Message = "unreachable"
	case binding.State == link.StateReady:
		state.Status = domain.SourceReady
	case binding.State == link.StateInstalling:
		state.Status = domain.SourcePending
		state.Message = ds.Name + " is still installing"
	default:
		state.Message = ds.Name + " is not installed in this Project"
	}
	return state
}

func (r linkEndpoint) Endpoint(ctx context.Context, bearer string, ds domain.DataSource) (string, error) {
	binding, err := r.binding(ctx, bearer, ds)
	var denied *link.DeniedError
	if errors.As(err, &denied) {
		return "", err
	}
	state := catalogAppState(ds, binding, err)
	if state.Status != domain.SourceReady {
		return "", failure("data_source_unavailable", state.Message, err)
	}
	return binding.InternalURL, nil
}
