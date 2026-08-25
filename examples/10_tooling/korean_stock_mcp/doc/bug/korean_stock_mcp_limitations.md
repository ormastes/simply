# Korean Stock MCP Server - Known Limitations and Workarounds

## Hardcoded Values

### KRX API Endpoint
- **Location:** `sources/krx_source.spl` line 11
- **Value:** `http://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd`
- **Risk:** If KRX changes their internal API endpoint, all stock/market tools break with no fallback.
- **Workaround:** Would need to update the constant manually. Consider making this configurable via environment variable.

### Market Index Codes
- **Location:** `sources/krx_source.spl` lines 371-375
- **Values:** KOSPI=1001, KOSDAQ=2001, KPI200=1028
- **Risk:** Only 3 indices are supported. Other KRX indices (KOSPI200 sectors, KRX300, etc.) are not accessible.

### Stock List Limit
- **Location:** `sources/krx_source.spl` line 322
- **Value:** `count < 200` hard cap on stock list results
- **Impact:** KOSPI has ~800 stocks and KOSDAQ ~1600. The `stock_list` tool will only return the first 200.

### Search Result Limit
- **Location:** `sources/krx_source.spl` line 249
- **Value:** `count < 50` hard cap on search results

### Financial Statement Entry Limit
- **Location:** `sources/dart_source.spl` line 106
- **Value:** `count < 30` cap on financial statement line items

## Missing Error Handling

### No HTTP Timeout
- The `rt_http_request` extern functions have no configurable timeout. If KRX or DART is slow/unreachable, the server will block indefinitely on that tool call.

### No Retry Logic
- All HTTP calls are fire-once. Network transient failures immediately return errors.

### Incomplete OHLCV Parsing
- `krx_get_ohlcv()` uses the same single-day endpoint (`MDCSTAT01501`) as `stock_price`. It fetches data for a date range but the KRX endpoint may not return multi-day OHLCV in a single response. The parsing loop may find only one entry for the ticker per response, yielding sparse history.

### text_byte_len Inaccuracy
- **Location:** `json_helpers.spl` line 192-193
- `text_byte_len()` returns `s.len()` which counts characters, not UTF-8 bytes. For Korean text in responses, the Content-Length header will undercount bytes, potentially causing framing errors with Content-Length mode clients.

### No Input Validation on Ticker Format
- Tickers are passed directly to KRX without format validation. Non-numeric or malformed tickers silently produce "No data found" rather than a helpful error.

## API Limitations

### KRX API
- **Unofficial API:** The `data.krx.co.kr` endpoint is the same internal API used by pykrx. It is not an officially documented public API and may change without notice.
- **Rate Limiting:** KRX may rate-limit or block requests from the same IP. No rate limiting is implemented in the server.
- **Market Hours:** Price data is only updated during market hours (09:00-15:30 KST). Outside hours, the API returns previous day's closing data without indicating staleness.
- **Referer Header Required:** The KRX POST requests include a hardcoded `Referer` header. If KRX changes their CORS/referer policy, requests may be rejected.

### DART API
- **API Key Required:** `company_info` and `financial_statements` require `DART_API_KEY` environment variable. Without it, both tools return an error.
- **Daily Limit:** DART free API keys have a 10,000 requests/day limit (not enforced in code).
- **Corp Code vs Ticker:** The `corp_code` parameter is documented as accepting either DART corporation code or stock ticker, but the DART API actually requires the DART-specific corp code. Using a ticker directly may fail.

### News Sources
- **Google News RSS:** May be blocked in some regions or rate-limited. The fallback is a static "check these websites" message.
- **No Naver Finance:** The news_source header comment mentions Naver Finance, but only Google News RSS is actually implemented.

## Runtime Dependencies

### Required Extern Functions
All of these must be provided by the Simple runtime:

| Function | Used By |
|----------|---------|
| `rt_http_request(method, url, headers, body)` | All data sources |
| `rt_http_get(url)` | Declared but not directly used (sources use rt_http_request) |
| `rt_http_post(url, body, content_type)` | Declared but not directly used |
| `rt_http_url_encode(input)` | news_source.spl for Korean query encoding |
| `rt_process_run(cmd, args)` | cache.spl (date +%s), krx_source.spl (date +%Y%m%d) |
| `rt_env_get(name)` | config.spl for DART_API_KEY |
| `rt_file_read_text(path)` | Declared but not used |
| `rt_file_write_text(path, content)` | Declared but not used |
| `rt_file_exists(path)` | Declared but not used |

### System Tool Dependencies
- `/bin/sh` -- required for date commands
- `date` command with GNU extensions (`date -d '30 days ago'`) -- Linux-specific, will not work on macOS (`date -v-30d` syntax) or Windows

## Not Yet Implemented

### Cache Not Wired
- The `utils/cache.spl` module defines `cache_get`, `cache_set`, and TTL constants but none of the data source functions (`krx_get_stock_price`, `dart_get_company_info`, etc.) actually call the cache. Every tool invocation makes fresh HTTP requests.

### KRX_API_KEY Unused
- `config.spl` declares `get_krx_api_key()` but no code references it. KRX data API currently does not require authentication.

### File-based Extern Functions Unused
- `rt_file_read_text`, `rt_file_write_text`, `rt_file_exists` are declared in `main.spl` but never called. Likely intended for future persistent cache or configuration file support.

### No Graceful Shutdown
- The `shutdown` method returns a result but does not actually terminate the loop. The server only exits when stdin returns empty string (EOF).

### No Logging or Diagnostics
- No stderr logging for debugging. HTTP errors are returned to the client but not logged server-side.

### No Windows Support
- Date commands use `/bin/sh` and GNU `date`. The server will not run on Windows without modifications.
