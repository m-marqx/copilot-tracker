# Copilot Premium Request Tracker

Track your GitHub Copilot premium request usage directly from VS Code — with real-time pacing in the status bar and a full analytics dashboard.

![VS Code](https://img.shields.io/badge/VS%20Code-^1.85.0-blue)
![Version](https://img.shields.io/badge/version-0.0.9-green)

## Features

### Status Bar Pacing

A live progress bar in the status bar shows your current usage against the daily pacing target:

```
$(copilot) [██████░░░░] 58.3% / 52%
```

- **Green** — on track or ahead of schedule
- **Yellow** — over daily budget
- **Red** — quota exhausted or incurring overage charges

Click the status bar item to open the full dashboard.

### Analytics Dashboard

A webview panel with:

- **Usage cards** — total used, remaining, daily allowance, and overage cost
- **Daily budget chart** — base budget vs. average usage vs. adjusted allowance
- **Pacing metrics** — banked/overspent requests, projected end-of-month usage, multiplier
- **Model breakdown table** — per-model included/billed requests and costs
- **Inline editing** — add, edit, or remove model entries directly from the dashboard

### Automatic API Fetching

The extension tries multiple GitHub API endpoints automatically:

1. **Individual plan** — `GET /copilot_internal/v2/token` (premium interaction quotas)
2. **Business/Enterprise plan** — `GET /copilot_internal/user` (quota snapshots)
3. **Billing API fallback** — `GET /users/{user}/settings/billing/usage/summary`

Authentication uses VS Code's built-in GitHub session — no manual PAT configuration required.

Data refreshes every 10 minutes in the background, with a minimum 5-minute cache to avoid rate limits.

## Commands

All commands are available via the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command | Description |
|---|---|
| `Copilot Tracker: Show Copilot Premium Request Dashboard` | Open the analytics dashboard |
| `Copilot Tracker: Refresh Usage Data from GitHub API` | Force-refresh data from the API |
| `Copilot Tracker: Add Model Usage Entry` | Manually add a model usage entry |
| `Copilot Tracker: Set Monthly Premium Request Limit` | Override the monthly quota limit |
| `Copilot Tracker: Reset All Usage Data` | Clear all stored data and reset to defaults |

## Pacing Algorithm

The extension calculates daily pacing metrics to help you stay within your monthly quota:

- **Base daily budget** = monthly limit / days in month
- **Daily allowance** = remaining requests / days remaining (adapts as the month progresses)
- **Banked requests** = expected usage by now − actual usage (positive = saved, negative = overspent)
- **Multiplier** = daily allowance / base budget (>1 means you can spend more per day)
- **Projected end-of-month** = average daily usage × days in month
- **Overage cost** = requests beyond quota × $0.04/request

## Installation

### From Source

```bash
git clone https://github.com/m-marqx/copilot-tracker.git
cd copilot-tracker
pnpm install
pnpm run compile
```

Then press `F5` in VS Code to launch the Extension Development Host.

To run the test suite:

```bash
npm test
```

## Requirements

- VS Code 1.85.0 or later
- A GitHub account signed into VS Code (for automatic API fetching)
- A GitHub Copilot subscription (Individual, Business, or Enterprise)
