# Go Language Agent

**Language:** Go
**File extensions:** `.go`
**LSP server:** `gopls`

---

## Build & Test Commands

```bash
# Build
go build ./...                           # Build all packages
go build -o output ./cmd/app             # Build specific binary
go install ./...                         # Install binaries

# Testing
go test ./...                            # All tests
go test ./pkg/name                       # Single package
go test -run TestName ./pkg/name         # Single test
go test -v ./...                         # Verbose
go test -race ./...                      # Race detector
go test -cover ./...                     # Coverage
go test -bench=. ./...                   # Benchmarks

# Quality
go vet ./...                             # Static analysis
golangci-lint run                        # Comprehensive linter
gofmt -s -w .                            # Format (simplify)
goimports -w .                           # Format + fix imports

# Module management
go mod init module/name                  # Initialize module
go mod tidy                              # Clean up go.mod/go.sum
go get package@version                   # Add/update dependency
```

## LSP Setup

Install `gopls`:
```bash
go install golang.org/x/tools/gopls@latest
```

`gopls` reads `go.mod` for module boundaries. It provides completions,
diagnostics, hover, definition, references, rename, and code actions.
Set `GOPATH` and ensure `$GOPATH/bin` is in `PATH`.

## Style Rules

- **gofmt:** all code must be `gofmt`-formatted (non-negotiable in Go)
- **Error handling:** always check errors; `if err != nil { return err }`
- **Naming:** `MixedCaps` / `mixedCaps` (exported/unexported); no underscores
- **Interfaces:** small, focused; accept interfaces, return structs
- **Packages:** short, lowercase, single-word names; avoid `util`, `common`
- **Comments:** exported symbols must have doc comments starting with the name
- **Concurrency:** prefer channels over shared memory; use `sync.Mutex` when needed
- **Dependencies:** minimize external deps; prefer stdlib where possible
- **Testing:** table-driven tests with `t.Run` subtests

## Project-Specific Notes

- Go is not the primary language of this project
- May appear in external tooling, infrastructure, or third-party integrations
- Prefer Simple (`.spl`) for core project code

## When To Use This Agent

Dispatch this agent when the task involves:
- Writing or editing `.go` files
- Go-based CLI tools or services
- go.mod dependency management
- Infrastructure or DevOps tooling written in Go
- gRPC service implementations
- Container/Kubernetes tooling
