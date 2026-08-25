# Research: Using Claude CLI as a Programmatic API Wrapper -- Legality & Policy Analysis

**Date:** 2026-03-14
**Status:** Research complete

---

## Executive Summary

**Using Claude Code CLI programmatically (via `claude -p`) is officially supported and allowed by Anthropic.** However, there are critical distinctions between authentication methods that determine what is permitted:

- **API key authentication**: Fully allowed for all programmatic/automated use, including wrapping as an API, CI/CD, scripts, daemons, cron jobs. No restrictions.
- **OAuth / subscription authentication (Pro/Max)**: Allowed for Claude Code CLI itself, but **prohibited from being used in third-party tools or the Agent SDK**. Subject to rate limits and "ordinary, individual usage" expectations.

---

## 1. Anthropic's Official Stance on Programmatic CLI Usage

### Explicitly Supported

Anthropic provides **official documentation** for running Claude Code programmatically at [code.claude.com/docs/en/headless](https://code.claude.com/docs/en/headless). This is not a hack or workaround -- it is a first-class feature:

- The `-p` (or `--print`) flag runs Claude Code in non-interactive "headless" mode
- `--output-format json` and `--output-format stream-json` provide structured output for programmatic consumption
- The official docs describe CI/CD integration, scripting, and automation as intended use cases
- Anthropic provides [claude-code-action](https://github.com/anthropics/claude-code-action) for GitHub Actions automation

### Agent SDK (Formerly Claude Code SDK)

Anthropic now provides a full **Agent SDK** in Python and TypeScript that wraps Claude Code's capabilities programmatically:

- **Python**: [github.com/anthropics/claude-agent-sdk-python](https://github.com/anthropics/claude-agent-sdk-python)
- **TypeScript/JS**: [@anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
- Official docs: [platform.claude.com/docs/en/agent-sdk/overview](https://platform.claude.com/docs/en/agent-sdk/overview)

The Agent SDK provides the same tools, agent loop, and context management that power Claude Code, but as importable libraries.

**Key distinction**: The Agent SDK **requires API key authentication** -- it explicitly prohibits using OAuth subscription billing (Pro/Max).

---

## 2. Terms of Service -- Two Distinct Legal Frameworks

### Consumer Terms (Pro/Max Plans)

The **Consumer Terms of Service** govern users on Claude Free, Pro, and Max plans. Key provisions:

- **OAuth tokens are restricted to Anthropic products only**: "Using OAuth tokens obtained through Claude Free, Pro, or Max accounts in any other product, tool, or service -- including the Agent SDK -- is not permitted and constitutes a violation of the Consumer Terms of Service."
- **Claude Code CLI itself is exempted** from the prohibition on automated access because it is Anthropic's official product.
- Running `claude -p` locally on your own machine with your subscription is allowed.
- **Data usage**: Anthropic may use data from consumer plans for training/improving models (opt-out available).

### Commercial Terms (API Keys)

The **Commercial Terms of Service** govern API key users. Key provisions:

- **No automation restrictions** -- programmatic, automated, production, always-on usage is all explicitly permitted.
- API key billing is pay-per-token at standard API rates.
- This is the **recommended path for any production or business use**.

### January 2026 Enforcement

On **January 9, 2026**, Anthropic deployed server-side checks that blocked all third-party tools from authenticating with Claude Pro and Max subscription OAuth tokens. A **February 19, 2026** documentation update then formally clarified this was a ToS violation.

Sources:
- [Anthropic clarifies ban on third-party tool access (The Register)](https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access/)
- [Anthropic Bans Claude Subscription OAuth in Third-Party Apps (WinBuzzer)](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/)
- [Legal and compliance - Claude Code Docs](https://code.claude.com/docs/en/legal-and-compliance)

---

## 3. Rate Limits and Restrictions

### Pro Plan ($20/month)
- Shared quota between Claude.ai and Claude Code
- 5-hour rolling window burst limit
- 7-day rolling cumulative cap
- Anthropic expects <5% of subscribers to hit the cap

### Max Plan ($100/month or $200/month)
- $100/month: 5x Pro usage limits
- $200/month: 20x Pro usage limits
- Same shared quota model

### API Key (Pay-per-use)
- Standard API rate limits apply (documented at [platform.claude.com/docs/en/api/rate-limits](https://platform.claude.com/docs/en/api/rate-limits))
- Rate limits scale with usage tier
- No artificial caps beyond rate limits

### Cost Benchmarks
- Average: ~$6/developer/day
- 90th percentile: <$12/developer/day
- Monthly average: ~$100-200/developer with Sonnet 4.6

Source: [Manage costs effectively - Claude Code Docs](https://code.claude.com/docs/en/costs)

---

## 4. The `--dangerously-skip-permissions` Flag

### Official Purpose

This flag is **explicitly designed for automation**. It enables fully unattended execution where Claude Code bypasses all permission prompts.

### Anthropic's Own Usage

Anthropic engineers used this flag in their **February 2026 blog post** about building a C compiler with parallel Claudes, running `claude --dangerously-skip-permissions` in a bash while-loop. Their caveat: "Run this in a container, not your actual machine."

Source: [Building a C compiler (Anthropic Engineering Blog)](https://www.anthropic.com/engineering/building-c-compiler)

### Design Philosophy

- The deliberately scary name forces conscious decision-making
- No short alias exists -- you must type the full flag every time
- Anthropic recommends running in containers/VMs, never on bare metal
- It disables: file system approval, shell command approval, network operation approval, process control approval

### Recommended Usage Contexts

- CI/CD pipelines
- Automated code review
- Batch processing in containers
- Any non-interactive automated workflow

Source: [Configure permissions - Claude Code Docs](https://code.claude.com/docs/en/permissions)

---

## 5. SDK Mode / Headless Mode

### Official "Headless Mode"

Claude Code has an official headless mode, documented at [code.claude.com/docs/en/headless](https://code.claude.com/docs/en/headless):

```bash
# Basic headless usage
claude -p "your prompt here"

# With structured JSON output
claude -p "your prompt here" --output-format json

# With streaming JSON output
claude -p "your prompt here" --output-format stream-json

# Fully autonomous (no permission prompts)
claude -p "your prompt here" --output-format json --dangerously-skip-permissions
```

### Agent SDK (Programmatic Libraries)

For deeper integration, the Agent SDK provides Python and TypeScript libraries:

```python
# Python Agent SDK
from claude_agent_sdk import query
# Requires ANTHROPIC_API_KEY environment variable
```

```typescript
// TypeScript Agent SDK
import { query } from '@anthropic-ai/claude-agent-sdk';
```

The Agent SDK wraps the Claude Code CLI -- the CLI is bundled with the package and does not need separate installation.

---

## 6. Pricing Implications

### Subscription Plans (OAuth)

| Plan | Monthly Cost | Claude Code Included | Limits |
|------|-------------|---------------------|--------|
| Pro | $20 | Yes | Shared with Claude.ai, 5h rolling + 7d cap |
| Max | $100 | Yes | 5x Pro limits |
| Max+ | $200 | Yes | 20x Pro limits |

- Usage is **included in subscription** -- no per-token charges
- Limits are shared across Claude.ai and Claude Code
- Designed for "ordinary, individual usage"

### API Key (Pay-per-use)

- Billed at standard API rates per input/output token
- No artificial caps beyond rate limits
- Recommended for production/business/automated usage
- Auto-reload available when balance runs low

**Bottom line**: If you are using Claude Code CLI as an API wrapper for a product/service, you **must** use API key authentication, not your Pro/Max subscription.

---

## 7. Community Reports of Account Restrictions

### Known Issues

1. **Third-party tool bans (Jan 2026)**: Accounts using OAuth tokens in non-Anthropic tools were automatically banned. Some were false positives that Anthropic reversed.

2. **False-positive bans from CI/CD**: GitHub issue [#641](https://github.com/anthropics/claude-code-action/issues/641) and [#10290](https://github.com/anthropics/claude-code/issues/10290) report that intensive PR review loops via Claude Code Action can trigger permanent account bans, even when the workflow is legitimate.

3. **Rate limit issues**: GitHub issue [#33120](https://github.com/anthropics/claude-code/issues/33120) reports API rate limit errors specific to certain modes.

4. **Automation regression**: GitHub issue [#11631](https://github.com/anthropics/claude-code/issues/11631) reports that Claude Code 2.0.37+ broke non-interactive automation that worked in 2.0.30.

### What Triggers Bans

- Using subscription OAuth tokens in third-party tools (confirmed policy violation)
- Extremely high volume of requests in short periods
- Patterns that look like bot/DDoS activity
- Frequent IP switching via VPNs/proxies
- Multi-account automation

### What Does NOT Trigger Bans

- Using `claude -p` with API key authentication
- Running Claude Code in CI/CD with `--dangerously-skip-permissions` and API keys
- Normal scripting/automation with the official CLI

---

## 8. Clear Summary: What Is and Is Not Allowed

### ALLOWED

| Use Case | Auth Method | Notes |
|----------|-------------|-------|
| `claude -p "prompt"` locally | Pro/Max subscription | Official feature, exempted from automation prohibition |
| `claude -p "prompt"` in CI/CD | API key | Officially documented and supported |
| `claude -p --dangerously-skip-permissions` in containers | API key | Anthropic's own engineers do this |
| Agent SDK (Python/TypeScript) | API key only | Official SDK, requires API key |
| Claude Code GitHub Action | API key | Official Action, fully supported |
| Cron jobs / daemons with Claude CLI | API key recommended | API key for production; subscription for personal |
| Wrapping CLI as internal tool | API key | Commercial terms, no restrictions |

### NOT ALLOWED

| Use Case | Why |
|----------|-----|
| Extracting OAuth token from Pro/Max and using in third-party tool | Violates Consumer ToS; server-side blocked since Jan 2026 |
| Using Agent SDK with Pro/Max subscription billing | Explicitly prohibited; SDK requires API key |
| Building a product that authenticates users via claude.ai login | Violates Consumer ToS |
| Reselling Claude Code access via subscription tokens | Violates Consumer ToS |

### GRAY AREA

| Use Case | Analysis |
|----------|----------|
| Heavy scripted `claude -p` usage on Pro/Max subscription | Technically allowed but subscription assumes "ordinary, individual usage"; heavy automation may hit rate limits |
| Running multiple parallel Claude Code sessions on subscription | Allowed on Max plan (officially supports parallel sessions) but subject to rate limits |

---

## Sources

### Official Anthropic Documentation
- [Run Claude Code programmatically (Headless Mode)](https://code.claude.com/docs/en/headless)
- [Legal and compliance - Claude Code Docs](https://code.claude.com/docs/en/legal-and-compliance)
- [Configure permissions - Claude Code Docs](https://code.claude.com/docs/en/permissions)
- [Manage costs effectively - Claude Code Docs](https://code.claude.com/docs/en/costs)
- [Agent SDK overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Rate limits - Claude API Docs](https://platform.claude.com/docs/en/api/rate-limits)
- [Using Claude Code with Pro or Max plan](https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan)
- [Enabling Claude Code to work more autonomously (Anthropic)](https://www.anthropic.com/news/enabling-claude-code-to-work-more-autonomously)
- [Building a C compiler (Anthropic Engineering)](https://www.anthropic.com/engineering/building-c-compiler)

### GitHub
- [Claude Code Repository](https://github.com/anthropics/claude-code)
- [Claude Code Action (GitHub Actions)](https://github.com/anthropics/claude-code-action)
- [Claude Agent SDK Python](https://github.com/anthropics/claude-agent-sdk-python)
- [Autonomous coding quickstart](https://github.com/anthropics/claude-quickstarts/tree/main/autonomous-coding)
- [Issue #11631: Non-interactive automation regression](https://github.com/anthropics/claude-code/issues/11631)
- [Issue #641: False-positive bans from PR review loops](https://github.com/anthropics/claude-code-action/issues/641)

### News and Analysis
- [Anthropic clarifies ban on third-party tool access (The Register)](https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access/)
- [Anthropic Bans Claude Subscription OAuth in Third-Party Apps (WinBuzzer)](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/)
- [Is This Allowed? Claude Code Terms of Service Explained (autonomee.ai)](https://autonomee.ai/blog/claude-code-terms-of-service-explained/)
- [Claude Code Pricing Guide (thecaio.ai)](https://www.thecaio.ai/blog/claude-code-pricing-guide)
- [Claude Code rate limits, pricing, and alternatives (Northflank)](https://northflank.com/blog/claude-rate-limits-claude-code-pricing-cost)
