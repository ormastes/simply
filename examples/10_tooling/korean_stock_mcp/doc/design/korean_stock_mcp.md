# Korean Stock MCP Server - Architecture Design

## Overview

The Korean Stock MCP Server is a Model Context Protocol (MCP) server written entirely in Simple that provides real-time Korean stock market data to LLM clients. It exposes 12 tools for querying stock prices, market indices, company financials, and news from three data sources: KRX (Korea Exchange), DART (Financial Supervisory Service), and Google News RSS.

The server communicates over stdio using the JSON-RPC 2.0 protocol with auto-detection of Content-Length framing vs JSON Lines mode.

## Module Breakdown

| File | Lines | Responsibility |
|------|-------|----------------|
| `main.spl` | 86 | Entry point, extern fn declarations, server loop, method dispatch |
| `json_helpers.spl` | 237 | JSON construction (`js`, `jp`, `jo1`-`jo5`), field extraction, string escaping, MCP result/error builders, safe substring/charAt workarounds |
| `protocol.spl` | 150 | Stdio message read/write (Content-Length + JSON Lines), `initialize` response, `tools/list` with all 12 tool schemas |
| `tools.spl` | 189 | Tool dispatch (`dispatch_tool`), parameter extraction, handler functions for all 12 tools |
| `sources/krx_source.spl` | 531 | KRX HTTP POST API client: stock price, OHLCV, search, stock list, market index, market cap, sector performance |
| `sources/dart_source.spl` | 148 | DART REST API client: company info, financial statements (requires `DART_API_KEY`) |
| `sources/news_source.spl` | 180 | Google News RSS feed parser: market news, stock-specific news, XML tag extraction, HTML entity cleaning |
| `utils/cache.spl` | 60 | TTL-based in-memory key-value cache with parallel arrays and Unix epoch expiry |
| `utils/config.spl` | 10 | Environment variable access for `DART_API_KEY` and `KRX_API_KEY` |
| `utils/formatting.spl` | 53 | Korean Won comma formatting, percentage formatting, volume abbreviation (K/M) |

## Data Flow Diagram

```
                          stdio (JSON-RPC 2.0)
                     Content-Length or JSON Lines
                                |
                                v
                    +---------------------+
                    |     main.spl        |
                    |  start_server()     |
                    |  method dispatch    |
                    +---------------------+
                       |        |       |
            initialize |  tools/|  ping |
                       |   call |       |
                       v        v       v
                 +-----------+  +----------+
                 |protocol.spl| |json_helpers|
                 |make_init   | |make_result |
                 |make_tools  | |make_error  |
                 |_list       | |extract_*   |
                 +-----------+  +----------+
                                    |
                            dispatch_tool()
                                    |
                    +---------------+---------------+
                    |               |               |
                    v               v               v
          +----------------+ +-------------+ +--------------+
          | krx_source.spl | | dart_source | | news_source  |
          |                | |   .spl      | |   .spl       |
          | KRX POST API   | | DART REST   | | Google News  |
          | data.krx.co.kr | | opendart.   | | RSS XML      |
          |                | | fss.or.kr   | |              |
          +----------------+ +-------------+ +--------------+
                    |               |               |
                    v               v               v
              rt_http_request  rt_http_request  rt_http_request
              (extern fn)      (extern fn)      (extern fn)
                    |               |               |
                    +-------+-------+-------+-------+
                            |               |
                      +----------+    +-----------+
                      |  cache   |    | formatting|
                      |  .spl    |    |   .spl    |
                      +----------+    +-----------+
                            |
                      rt_process_run
                      (date +%s for TTL)
```

## Key Design Decisions

### 1. Zero stdlib imports

All modules use `#![allow(unnamed_duplicate_typed_args)]` and declare no `use std.*` imports. Every utility -- JSON building, string manipulation, field extraction -- is hand-rolled in `json_helpers.spl`. This makes the server completely self-contained with no dependency on the Simple standard library beyond built-in primitives (`text`, `i64`, `[text]`).

### 2. Direct HTTP via extern fn

The server bypasses any HTTP library and calls runtime extern functions directly:
- `rt_http_get(url)` -- simple GET
- `rt_http_post(url, body, content_type)` -- form POST
- `rt_http_request(method, url, headers, body)` -- full control with custom headers

This avoids dependency on `std.net` or `std.http` modules.

### 3. Stdio JSON-RPC with protocol auto-detection

The server auto-detects whether the client uses:
- **Content-Length framing** (standard MCP/LSP): reads `Content-Length:` header, blank line, then body
- **JSON Lines**: detects when input starts with `{`, switches to line-per-message mode

A global `USE_JSON_LINES` flag persists the detected mode for the session.

### 4. Manual JSON parsing

Rather than using a JSON parser, all extraction uses string searching:
- `extract_field(json, key)` -- finds `"key":` and reads the value
- `find_ticker_field(json, ticker, field)` -- locates a ticker's JSON object by scanning for `"ISU_SRT_CD":"ticker"`, then extracts a field within that object's `{...}` boundaries
- `extract_xml_tag(xml, tag)` -- basic `<tag>...</tag>` extraction for RSS

### 5. In-memory TTL cache

Cache uses three parallel arrays (`CACHE_KEYS`, `CACHE_VALUES`, `CACHE_EXPIRY`) with TTL constants:
- 60s for live prices and indices
- 300s for news
- 86400s (24h) for stock lists

Note: The cache infrastructure is defined but not yet wired into the data source functions.

### 6. Safe string operations

Due to an interpreter-mode `.substring()` mutation bug, custom `mcp_substr()` and `mcp_char_at()` functions iterate character-by-character instead of using built-in substring operations.

## MCP Tools Provided

### Stock Price Tools (4)
| Tool | Description |
|------|-------------|
| `stock_price` | Current price for a ticker (e.g., 005930 for Samsung) |
| `stock_ohlcv` | Open/High/Low/Close/Volume history (configurable days) |
| `stock_search` | Search stocks by name or partial ticker |
| `stock_list` | List all stocks on KOSPI/KOSDAQ/ALL |

### Market Tools (4)
| Tool | Description |
|------|-------------|
| `market_index` | KOSPI, KOSDAQ, or KPI200 index value |
| `market_cap` | Market cap ranking (configurable top N) |
| `sector_performance` | Sector-level index performance |
| `stock_compare` | Side-by-side comparison of multiple tickers |

### Company Info Tools (2) -- requires DART_API_KEY
| Tool | Description |
|------|-------------|
| `company_info` | Company details from DART (name, CEO, address, industry) |
| `financial_statements` | Balance sheet / income statement (annual, semi, quarterly) |

### News Tools (2)
| Tool | Description |
|------|-------------|
| `market_news` | Latest Korean stock market news from Google News RSS |
| `stock_news` | Stock-specific news search via Google News RSS |
