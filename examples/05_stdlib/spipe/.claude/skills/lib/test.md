# Test Writing Skill

## Critical Rules

- NEVER ignore/skip/comment-out failing tests without user approval
- ALWAYS fix root cause or ask user

## Running Tests

```bash
bin/simple test                          # All tests
bin/simple test path/to/spec.spl         # Single file
bin/simple test --list                   # List tests
bin/simple test --only-slow              # Slow tests
bin/simple test --tag=integration        # Filter by tag
```

## Container Testing

```bash
# Build image
docker build -t simple-test-isolation:latest -f tools/docker/Dockerfile.test-isolation .

# Run in container
docker run --rm -v $(pwd):/workspace:ro --memory=512m simple-test-isolation:latest test

# Docker Compose
docker-compose -f config/docker-compose.yml up unit-tests
docker-compose -f config/docker-compose.yml up all-tests

# Helper scripts
scripts/local-container-test.shs unit                       # Unit tests
scripts/local-container-test.shs quick path/to/spec.spl    # Single test
scripts/ci-test.sh                                         # CI-style
```

**Troubleshooting:** See `doc/07_guide/testing/container_testing.md`

## Coverage Target Annotations

System tests (`test/03_system/`) **MUST** have `# @cover` at the top. See `/spipe` skill for format.
Bypass temporarily: `--no-cover-check`

## Writing BDD Tests

Tests in `test/` directory, use `*_spec.spl` naming. Use docstring markdown, NOT println().

```simple
describe "Feature":
    """
    # Feature Module -- overview, usage examples.
    """
    context "when initialized":
        """Tests default initialization."""
        it "should have default value":
            """Default constructor -> value = 0."""
            val f = Feature(value: 0)
            expect(f.value).to_equal(0)
```

## Test Types

| Type | Syntax | Behavior |
|------|--------|----------|
| Regular | `it "..."` | Runs by default |
| Slow | `slow_it "..."` | Run with `--only-slow` |
| Skipped | `skip("name", "reason")` | Not yet implemented |

## Matchers (built-in only)

`to_equal(val)`, `to_be(val)`, `to_be_nil()`, `to_contain(item)`, `to_start_with(s)`, `to_end_with(s)`, `to_be_greater_than(n)`, `to_be_less_than(n)`

Use `to_equal(true)` NOT `to_be_true()`.

## Run Tracking

Results auto-tracked in `doc/08_tracking/test/test_db.sdn`.
```bash
bin/simple test --list-runs              # View history
bin/simple test --prune-runs=50          # Keep 50 most recent
```

## UI System Testing

Test TUI/Web UI via `UITestClient` over HTTP test API.

```simple
use std.nogc_sync_mut.ui_test.client.{UITestClient}
val client = UITestClient.connect("127.0.0.1", port)?
client.wait_ready(5000)?
client.click("action_btn")?
client.check_text("status_label", "Saved")?
```

Start servers: `bin/simple ui web app.ui.sdn --port 9001`

Key files: `src/lib/nogc_sync_mut/ui_test/client.spl`, `src/app/ui.test_api/handler.spl`, `test/03_system/ui/helpers/ui_test_helpers.spl`

## See Also

- `/spipe` skill, `.claude/templates/spipe_template.spl`
- `doc/07_guide/testing/testing.md`
