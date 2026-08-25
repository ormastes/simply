# TodoApp - SimpleWeb Framework Example

A full-featured todo list application built with the SimpleWeb framework, demonstrating authentication, CRUD operations, CSRF protection, flash messages, pagination, and modern responsive design.

## Prerequisites

- Simple compiler (`bin/simple`) installed and on your PATH

## Quick Start

1. **Configure environment**

   ```sh
   cd examples/webapp
   cp .env.example .env
   ```

   Edit `.env` and set a secret key (any random string, at least 32 characters):

   ```
   TODO_SECRET_KEY=your-random-secret-key-here-at-least-32-chars
   ```

2. **Run the application**

   ```sh
   bin/simple run main.spl
   ```

3. **Open your browser** to [http://localhost:3000](http://localhost:3000)

4. **Create an account** and start managing your todos.

## Features

- **User Authentication** -- Register, log in, log out with bcrypt password hashing
- **Todo CRUD** -- Create, read, update, delete todos with title and description
- **Toggle Completion** -- Mark todos as complete/incomplete with one click
- **Pagination** -- Browse through todos 10 per page
- **CSRF Protection** -- All forms include hidden CSRF tokens, verified on submission
- **Flash Messages** -- Success, error, warning, and info notifications after actions
- **IDOR Prevention** -- Every todo mutation verifies ownership (todo.user_id == current user)
- **Responsive Design** -- Works on desktop, tablet, and mobile
- **SQLite Database** -- Zero-configuration database, created automatically on first run

## Project Structure

```
webapp/
    main.spl                 -- Application entry point
    app.sdn                  -- Server, database, session configuration
    routes.sdn               -- URL routing table
    db/
        migrations.spl       -- Database schema (users + todos tables)
    controllers/
        home_controller.spl  -- Landing page
        auth_controller.spl  -- Login, register, logout
        todos_controller.spl -- Todo CRUD operations
    models/
        user.spl             -- User model, codec, validators, password helpers
        todo.spl             -- Todo model, codec, validators, pagination helpers
    views/
        layouts/
            application.html -- Base HTML layout (nav + flash + body + footer)
        home/
            index.html       -- Landing page with hero and feature cards
        todos/
            index.html       -- Todo list with stats, checkboxes, pagination
            new.html         -- New todo form
            edit.html        -- Edit todo form
        auth/
            login.html       -- Login form
            register.html    -- Registration form
        shared/
            _nav.html        -- Navigation bar partial
            _flash.html      -- Flash message partial
    public/
        css/
            style.css        -- Modern CSS with custom properties
    .env.example             -- Environment variable template
    .gitignore               -- Database, secrets, build exclusions
```

## Configuration (app.sdn)

| Section    | Key            | Description                           |
|------------|----------------|---------------------------------------|
| `app`      | `name`         | Application identifier                |
| `app`      | `secret_key`   | Session signing key (from env var)    |
| `server`   | `listen`       | Bind address and port                 |
| `server`   | `worker_count` | Worker threads (0 = auto-detect CPUs) |
| `database` | `path`         | SQLite database file path             |
| `session`  | `store`        | Session backend ("database")          |
| `session`  | `ttl_seconds`  | Session lifetime in seconds           |
| `assets`   | `path`         | Static file directory                 |

## Security Notes

- **Default-deny authentication**: All routes require authentication unless explicitly marked `auth: public` in `routes.sdn`.
- **IDOR prevention**: The todos controller verifies `todo.user_id == current_user_id` before any read or write operation on a specific todo.
- **CSRF tokens**: Every form includes a hidden `csrf_token` field. The server verifies this token before processing any POST request.
- **Password hashing**: Passwords are hashed with bcrypt (cost factor 12) before storage. Plain-text passwords are never stored.
- **Generic login errors**: Login failures return "Invalid username or password" to prevent username enumeration.
- **Secret key**: The `TODO_SECRET_KEY` environment variable must be set. Never commit secrets to version control.

## Framework Documentation

This example uses the following SimpleWeb framework modules:

- `std.web_framework.app` -- WebApp configuration and lifecycle
- `std.web_framework.controller` -- Request context, response rendering
- `std.web_framework.template` -- Mustache-style HTML templates
- `std.web_framework.session` -- Database-backed session management
- `std.web_framework.flash` -- Flash message system
- `std.web_framework.csrf` -- CSRF token generation and verification
- `std.web_framework.validation` -- Input validation rules
- `std.web_framework.model` -- ActiveModel pattern with repository
- `std.web_framework.pagination` -- Paginated query results
- `std.database` -- SQLite database access and migrations
- `std.crypto` -- bcrypt password hashing
