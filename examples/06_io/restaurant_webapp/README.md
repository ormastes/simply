# Simple Restaurant/Store Web App

**Simple web infra test vehicle** — exercises web_framework, http_server, database/sql,
template SSR, sessions, CSRF, form validation, and pagination.

## Quick Start

```bash
cd examples/06_io/restaurant_webapp
bin/simple run main.spl
# Visit http://localhost:3001
# Admin: http://localhost:3001/admin/login (admin / admin123)
```

## What This Tests

| Layer | Feature |
|-------|---------|
| http_server | Routing, GET/POST, param extraction |
| web_framework | Controllers, ControllerContext, render_page/json/redirect |
| database/sql | Migrations, Repository, DbCodec, query_builder |
| template | Handlebars SSR with loops, conditionals, partials, layouts |
| sessions | Admin auth via session_set/get |
| CSRF | csrf_token_for_session + verify_csrf_token |
| form_validation | Validator rules on menu items |
| pagination | Order listing |

## Features

- **Templates**: Default restaurant (appetizers/mains/desserts/drinks) and store (featured/regular/sale)
- **Groups**: Menu categories with sort order
- **Items**: Name, price (cents), description, availability toggle
- **Conditions**: Time-based, day-of-week, seasonal availability rules
- **Additional menus**: Extras tied to main items
- **Orders**: Create, list, filter by status, send to cook, print sticker
- **Payment**: Mock gateway (desk-pay / gate-pay / store checkout) — Phase 4

## Spec

```bash
bin/simple test test/02_integration/app/restaurant_webapp_spec.spl
```
