# Python Language Agent

**Language:** Python
**File extensions:** `.py`, `.pyi`
**LSP server:** `pylsp` (python-lsp-server) or `pyright`

---

## Build & Test Commands

```bash
# Run scripts
python3 script.py
python3 -m module_name

# Testing
pytest                                   # Run all tests
pytest test_file.py                      # Single file
pytest test_file.py::test_name           # Single test
pytest -v                                # Verbose output
pytest --tb=short                        # Short tracebacks
pytest -x                                # Stop on first failure

# Quality
python3 -m mypy .                        # Type checking
python3 -m ruff check .                  # Fast linter
python3 -m ruff format .                 # Formatter
python3 -m black .                       # Alternative formatter

# Virtual environment
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## LSP Setup

Install one of:
```bash
pip install python-lsp-server            # pylsp
pip install pyright                       # pyright (faster, stricter)
```

Configure via `pyproject.toml` or `pyrightconfig.json`. The LSP provides
completions, hover, diagnostics, go-to-definition, and rename refactoring.

## Style Rules

- **PEP 8:** follow standard Python style guidelines
- **Type hints:** add type annotations to all function signatures
- **Docstrings:** use Google or NumPy style docstrings for public APIs
- **Imports:** group as stdlib, third-party, local; use `isort` ordering
- **Naming:** `snake_case` functions/variables, `PascalCase` classes, `UPPER_CASE` constants
- **f-strings:** prefer over `.format()` or `%` formatting
- **Context managers:** use `with` for file handles, locks, connections
- **Dependencies:** pin versions in `requirements.txt` or use `pyproject.toml`

## Project-Specific Notes

- The Simple project generally avoids Python (all code in `.spl`/`.shs`)
- Python may appear in external tooling, CI scripts, or third-party integrations
- Prefer Simple or shell scripts (`.shs`) for project-internal automation

## When To Use This Agent

Dispatch this agent when the task involves:
- Writing or editing `.py` files
- Python-based tooling or scripts
- pytest test suites
- Machine learning / data science code (alongside `/deeplearning` skill)
- Third-party Python library integration
