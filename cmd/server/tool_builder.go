package main

import (
	"context"
	"errors"
	"io"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/appthrust/appserver-go/appserver/identity"
	"github.com/appthrust/appserver-go/appserver/link"
	"github.com/appthrust/appserver-go/appserver/pending"
	"github.com/appthrust/appserver-go/appserver/platformclient"
	"github.com/appthrust/tool-builder/cmd/server/internal/api"
	"github.com/appthrust/tool-builder/cmd/server/internal/engine"
	"github.com/appthrust/tool-builder/cmd/server/internal/store"
)

const storeOpenTimeout = 30 * time.Second

var storeRetryInitial = time.Second

func toolBuilderHandler(upstreamURL, projectID string) (*pending.Handler, func(), error) {
	auth, err := identity.New(identity.FromEnv("TOOL_BUILDER"))
	if err != nil {
		return nil, nil, err
	}
	publicURL := os.Getenv("TOOL_BUILDER_PUBLIC_URL")
	if publicURL != "" {
		origin, err := parseOrigin(publicURL)
		if err != nil || origin.Scheme != "https" || origin.Path != "" || strings.Contains(publicURL, "#") {
			return nil, nil, errors.New("TOOL_BUILDER_PUBLIC_URL must be an HTTPS origin without a path, query, or fragment")
		}
	}
	if raw := os.Getenv("TOOL_BUILDER_DIRECTORY_URL"); raw != "" {
		if origin, err := parseOrigin(raw); err != nil || origin.Scheme != "http" && origin.Scheme != "https" {
			return nil, nil, errors.New("TOOL_BUILDER_DIRECTORY_URL must be an HTTP or HTTPS origin")
		}
	}
	platform := platformclient.New(upstreamURL, projectID, platformclient.WithHTTPClient(auth.HTTPClient()))
	resolver := link.NewResolver(platform, "tool-builder", os.LookupEnv, map[string]link.Required{
		"directory": {URLEnv: "TOOL_BUILDER_DIRECTORY_URL", PublicURLEnv: "TOOL_BUILDER_DIRECTORY_PUBLIC_URL"},
	})
	links := link.NewClient(resolver, nil)
	handler := pending.Serve(api.Unavailable())
	dsn := os.Getenv("TOOL_BUILDER_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		return handler, func() {}, nil
	}
	seed := os.Getenv("TOOL_BUILDER_DEV_SEED") == "1"
	groups := strings.Split(os.Getenv("TOOL_BUILDER_DEV_SEED_GROUPS"), ",")
	stop := pending.Connect("tool builder database", storeRetryInitial, func(ctx context.Context) (io.Closer, error) {
		opening, cancel := context.WithTimeout(ctx, storeOpenTimeout)
		defer cancel()
		database, err := store.Open(opening, dsn)
		if err != nil {
			return nil, err
		}
		if seed {
			if err := database.SeedDev(opening, groups); err != nil {
				_ = database.Close()
				return nil, err
			}
		}
		eng := engine.New(nil, nil, resolver)
		runtime := &toolBuilderRuntime{database: database, engine: eng, done: make(chan struct{})}
		pruning, cancelPruning := context.WithCancel(ctx)
		runtime.cancel = cancelPruning
		go func() {
			defer close(runtime.done)
			ticker := time.NewTicker(time.Hour)
			defer ticker.Stop()
			for {
				select {
				case <-pruning.Done():
					return
				case <-ticker.C:
					ctx, cancel := context.WithTimeout(pruning, 30*time.Second)
					err := database.Prune(ctx)
					cancel()
					if err != nil && pruning.Err() == nil {
						log.Printf("tool builder retention failed: %v", err)
					}
				}
			}
		}()
		handler.Swap(api.New(database, eng, auth, platform, links, upstreamURL, publicURL))
		return runtime, nil
	})
	return handler, stop, nil
}

type toolBuilderRuntime struct {
	database *store.Store
	engine   *engine.Engine
	cancel   context.CancelFunc
	done     chan struct{}
	once     sync.Once
	err      error
}

func (r *toolBuilderRuntime) Close() error {
	r.once.Do(func() { r.cancel(); <-r.done; r.err = errors.Join(r.engine.Close(), r.database.Close()) })
	return r.err
}
