import * as vscode from 'vscode';
import { UsageData } from '../dataService';
import { calculatePacing, classifyStatus } from '../pacing';

export function getWebviewHtml(
  data: UsageData,
  webview: vscode.Webview,
  nonce: string
): string {
  const { totalUsage, limit, remaining, billedTotal, models, dateRange, dataSource, lastFetchedAt, resetAt } = data;
  const now = new Date();
  const pacing = calculatePacing(totalUsage, limit, now, remaining);
  const status = classifyStatus(pacing);
  const recommendedPct = pacing.dayOfMonth / pacing.daysInMonth;
  const pacingPercent = pacing.expectedByNow > 0 ? (totalUsage / pacing.expectedByNow) * 100 : 0;
  const legacyPacing = pacing.expectedByNow > 0 ? totalUsage / pacing.expectedByNow : 0;
  const target = parseFloat((recommendedPct * limit).toFixed(2));
  const usagePercent = limit > 0 ? Math.min((totalUsage / limit) * 100, 100) : 0;

  // Pre-compute formatted strings (avoids duplicate formatNumber/formatCurrency in inline JS)
  const fmtN = (n: number) => n % 1 === 0 ? n.toFixed(0) : n.toFixed(2);
  const totalUsageStr = fmtN(totalUsage);
  const targetStr = fmtN(target);
  const remainingStr = fmtN(pacing.remaining);
  const billedTotalStr = `$${billedTotal.toFixed(2)}`;
  const resetAtLabel = resetAt ? new Date(resetAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';

  // Enhanced pacing metrics
  const allowance = pacing.dailyAllowance.toFixed(2);
  const formattedPacingBanked = pacing.banked.toFixed(1);
  const bankedStr = pacing.banked >= 0
    ? `+${formattedPacingBanked} saved`
    : `${formattedPacingBanked} overspent`;
  const bankedClass = pacing.banked >= 0 ? 'ok' : 'danger';
  const statusEmoji = status === 'ahead' ? '🚀' : status === 'on-track' ? '✓' : status === 'over-budget' ? '🔥' : '💀';
  const statusLabel = status === 'ahead' ? 'Ahead of schedule' : status === 'on-track' ? 'On track' : status === 'over-budget' ? 'Over budget' : 'Exhausted';

  const sourceLabel = dataSource === 'api' ? 'Auto-fetched from GitHub API' : 'Manual data';
  const lastFetchedLabel = lastFetchedAt
    ? new Date(lastFetchedAt).toLocaleTimeString()
    : 'Never';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <title>Premium Request Analytics</title>
  <style nonce="${nonce}">
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      font-size: var(--vscode-font-size, 0.8125rem);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      padding: 1.5rem 2rem;
      line-height: 1.5;
    }

    .header {
      margin-bottom: 1.5rem;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }

    .header-left h1 {
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--vscode-foreground);
      margin-bottom: 0.25rem;
    }

    .header-left .subtitle {
      font-size: 0.8125rem;
      color: var(--vscode-descriptionForeground);
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .data-source {
      font-size: 0.6875rem;
      color: var(--vscode-descriptionForeground);
      text-align: right;
    }

    .data-source .source-badge {
      display: inline-block;
      padding: 0.125rem 0.5rem;
      border-radius: 0.75rem;
      font-size: 0.625rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03125rem;
    }

    .source-badge.api {
      background-color: rgba(63, 185, 80, 0.15);
      color: var(--vscode-terminal-ansiGreen, #3fb950);
    }

    .source-badge.manual {
      background-color: rgba(210, 153, 34, 0.15);
      color: var(--vscode-terminal-ansiYellow, #d29922);
    }

    .cards {
      display: flex;
      gap: 1rem;
      margin-bottom: 1.5rem;
      flex-wrap: wrap;
    }

    .card {
      flex: 1;
      min-width: 13.75rem;
      background-color: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
      border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border));
      border-radius: 0.5rem;
      padding: 1.25rem;
    }

    .card-label {
      font-size: 0.75rem;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 0.5rem;
      text-transform: uppercase;
      letter-spacing: 0.03125rem;
      font-weight: 500;
    }

    .card-value {
      font-size: 1.75rem;
      font-weight: 600;
      color: var(--vscode-foreground);
      margin-bottom: 0.25rem;
    }

    .card-value.small {
      font-size: 1.375rem;
    }

    .card-detail {
      font-size: 0.75rem;
      color: var(--vscode-descriptionForeground);
    }

    .card-link {
      color: var(--vscode-textLink-foreground);
      text-decoration: none;
      font-size: 0.75rem;
      cursor: pointer;
    }

    .card-link:hover {
      text-decoration: underline;
      color: var(--vscode-textLink-activeForeground);
    }

    .progress-container {
      margin-top: 0.75rem;
    }

    .progress-bar-bg {
      width: 100%;
      height: 0.5rem;
      background-color: var(--vscode-progressBar-background, rgba(128,128,128,0.2));
      border-radius: 0.25rem;
      overflow: hidden;
      position: relative;
    }

    .progress-bar-bg::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: var(--vscode-input-background, rgba(128,128,128,0.15));
      border-radius: 0.25rem;
    }

    .progress-bar-fill {
      height: 100%;
      border-radius: 0.25rem;
      position: relative;
      z-index: 1;
      transition: width 0.3s ease;
    }

    .progress-bar-fill.ok {
      background-color: var(--vscode-terminal-ansiGreen, #3fb950);
    }

    .progress-bar-fill.warning {
      background-color: var(--vscode-terminal-ansiYellow, #d29922);
    }

    .progress-bar-fill.danger {
      background-color: var(--vscode-terminal-ansiRed, #f85149);
    }

    .progress-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 0.5rem;
    }

    .progress-meta span {
      font-size: 0.75rem;
      color: var(--vscode-descriptionForeground);
    }

    .pacing-badge {
      display: inline-block;
      padding: 0.125rem 0.5rem;
      border-radius: 0.75rem;
      font-size: 0.6875rem;
      font-weight: 600;
    }

    .pacing-badge.ok {
      background-color: rgba(63, 185, 80, 0.15);
      color: var(--vscode-terminal-ansiGreen, #3fb950);
    }

    .pacing-badge.warning {
      background-color: rgba(210, 153, 34, 0.15);
      color: var(--vscode-terminal-ansiYellow, #d29922);
    }

    .pacing-badge.danger {
      background-color: rgba(248, 81, 73, 0.15);
      color: var(--vscode-terminal-ansiRed, #f85149);
    }

    /* Daily Budget Section */
    .daily-budget {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
      margin-bottom: 1.5rem;
    }

    .daily-budget .budget-card {
      background-color: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
      border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border));
      border-radius: 0.5rem;
      padding: 1.25rem;
    }

    .daily-budget .budget-card h2 {
      font-size: 1rem;
      font-weight: 600;
      margin-bottom: 1rem;
      color: var(--vscode-foreground);
    }

    .budget-stat {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      padding: 0.375rem 0;
      border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, rgba(128,128,128,0.15)));
    }

    .budget-stat:last-child {
      border-bottom: none;
    }

    .budget-stat-label {
      font-size: 0.75rem;
      color: var(--vscode-descriptionForeground);
    }

    .budget-stat-value {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--vscode-foreground);
      font-variant-numeric: tabular-nums;
    }

    @media (max-width: 37.5rem) {
      .daily-budget {
        grid-template-columns: 1fr;
      }
    }

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(12.5rem, 1fr));
      gap: 0.75rem;
      margin-top: 1rem;
    }

    .metric-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.75rem;
      color: var(--vscode-descriptionForeground);
    }

    .metric-item .metric-value {
      font-weight: 600;
      color: var(--vscode-foreground);
    }

    .table-section {
      margin-top: 0.5rem;
    }

    .table-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 0.75rem;
      gap: 0.5rem;
    }

    .table-header h2 {
      font-size: 1rem;
      font-weight: 600;
      color: var(--vscode-foreground);
    }

    .table-header .date-range {
      font-size: 0.75rem;
      color: var(--vscode-descriptionForeground);
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    thead th {
      text-align: left;
      font-size: 0.6875rem;
      font-weight: 600;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      letter-spacing: 0.03125rem;
      padding: 0.5rem 0.75rem;
      border-bottom: 0.125rem solid var(--vscode-panel-border, var(--vscode-widget-border));
    }

    thead th.num {
      text-align: right;
    }

    tbody td {
      padding: 0.625rem 0.75rem;
      font-size: 0.8125rem;
      border-bottom: 0.0625rem solid var(--vscode-panel-border, var(--vscode-widget-border, rgba(128,128,128,0.2)));
    }

    tbody td.model-name {
      font-weight: 500;
      color: var(--vscode-foreground);
    }

    tbody td.num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      color: var(--vscode-foreground);
    }

    tbody td.actions {
      text-align: center;
      white-space: nowrap;
    }

    tfoot td {
      padding: 0.625rem 0.75rem;
      font-size: 0.8125rem;
      font-weight: 600;
      border-top: 0.125rem solid var(--vscode-panel-border, var(--vscode-widget-border));
      color: var(--vscode-foreground);
    }

    tfoot td.num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    tbody tr:hover {
      background-color: var(--vscode-list-hoverBackground, rgba(128,128,128,0.07));
    }

    .icon-btn {
      background: none;
      border: none;
      cursor: pointer;
      padding: 0.125rem 0.375rem;
      font-size: 0.8125rem;
      color: var(--vscode-descriptionForeground);
      border-radius: 0.25rem;
      line-height: 1;
    }

    .icon-btn:hover {
      background-color: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.15));
      color: var(--vscode-foreground);
    }

    .remove-btn:hover {
      color: var(--vscode-terminal-ansiRed, #f85149);
    }

    .empty-state {
      text-align: center;
      padding: 2rem 1rem;
      color: var(--vscode-descriptionForeground);
      font-size: 0.8125rem;
    }

    .empty-state a {
      color: var(--vscode-textLink-foreground);
    }

    /* Add Model Form */
    .add-form {
      margin-top: 1.5rem;
      background-color: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
      border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border));
      border-radius: 0.5rem;
      padding: 1.25rem;
    }

    .add-form h3 {
      font-size: 1rem;
      font-weight: 600;
      margin-bottom: 1rem;
      color: var(--vscode-foreground);
    }

    .form-row {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
      margin-bottom: 0.75rem;
      align-items: end;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .form-group label {
      font-size: 0.6875rem;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      letter-spacing: 0.03125rem;
      font-weight: 500;
    }

    .form-group input {
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 0.25rem;
      padding: 0.375rem 0.625rem;
      font-size: 0.8125rem;
      font-family: inherit;
      outline: none;
    }

    .form-group input:focus {
      border-color: var(--vscode-focusBorder);
    }

    .form-group input[type=\"text\"] {
      min-width: 12.5rem;
    }

    .form-group input[type=\"number\"] {
      width: 7.5rem;
    }

    .currency-wrapper {
      position: relative;
      display: inline-flex;
      align-items: center;
    }

    .currency-wrapper .currency-prefix {
      position: absolute;
      left: 0.625rem;
      font-size: 0.8125rem;
      color: var(--vscode-descriptionForeground);
      pointer-events: none;
      z-index: 1;
    }

    .currency-wrapper input {
      padding-left: 1.375rem !important;
      width: 7.5rem;
    }

    .currency-wrapper input[readonly] {
      opacity: 0.7;
      cursor: default;
    }

    .btn {
      padding: 0.375rem 1rem;
      border-radius: 0.25rem;
      font-size: 0.8125rem;
      font-family: inherit;
      cursor: pointer;
      border: none;
      font-weight: 500;
    }

    .btn-primary {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    .btn-primary:hover {
      background-color: var(--vscode-button-hoverBackground);
    }

    .btn-secondary {
      background-color: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    .btn-secondary:hover {
      background-color: var(--vscode-button-secondaryHoverBackground);
    }

    .action-btn {
      padding: 0.375rem 1rem;
      border-radius: 0.25rem;
      font-size: 0.8125rem;
      font-family: inherit;
      cursor: pointer;
      border: none;
      font-weight: 500;
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      text-decoration: none;
    }

    .action-btn:hover {
      background-color: var(--vscode-button-hoverBackground);
    }

    .action-btn-secondary {
      padding: 0.375rem 1rem;
      border-radius: 0.25rem;
      font-size: 0.8125rem;
      font-family: inherit;
      cursor: pointer;
      border: 1px solid var(--vscode-button-background);
      font-weight: 500;
      background-color: transparent;
      color: var(--vscode-button-background);
      text-decoration: none;
    }

    .action-btn-secondary:hover {
      background-color: var(--vscode-button-secondaryHoverBackground);
    }

    .limit-edit {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
    }

    .limit-edit input {
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 0.25rem;
      padding: 0.125rem 0.5rem;
      font-size: 1rem;
      font-family: inherit;
      width: 5rem;
      outline: none;
      font-weight: 600;
    }

    .limit-edit input:focus {
      border-color: var(--vscode-focusBorder);
    }

    .form-buttons {
      display: flex;
      gap: 0.5rem;
      align-items: end;
    }

    .collapsible-toggle {
      cursor: pointer;
      user-select: none;
      display: flex;
      align-items: center;
      gap: 0.375rem;
    }

    .collapsible-toggle .arrow {
      transition: transform 0.2s;
      font-size: 0.625rem;
    }

    .collapsible-toggle .arrow.open {
      transform: rotate(90deg);
    }

    .collapsible-content {
      overflow: hidden;
      max-height: 0;
      transition: max-height 0.3s ease;
    }

    .collapsible-content.open {
      max-height: 2000px;
    }

    @media (max-width: 37.5rem) {
      body {
        padding: 1rem;
      }
      .cards {
        flex-direction: column;
      }
      .card {
        min-width: unset;
      }
    }

    /* Billing Summary Section */
    .billing-summary {
      background-color: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
      border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border));
      border-radius: 0.5rem;
      padding: 1.25rem;
      margin-bottom: 1.5rem;
    }

    .billing-summary h2 {
      font-size: 1rem;
      font-weight: 600;
      margin-bottom: 1rem;
      color: var(--vscode-foreground);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .billing-summary tbody td.sku-name {
      font-weight: 500;
      color: var(--vscode-foreground);
    }

    .billing-summary .empty-state {
      text-align: center;
      padding: 1.5rem 1rem;
      color: var(--vscode-descriptionForeground);
      font-size: 0.8125rem;
    }

    .billing-summary .empty-state a {
      color: var(--vscode-textLink-foreground);
      text-decoration: none;
    }

    .billing-summary .empty-state a:hover {
      text-decoration: underline;
    }

    .token-guide {
      max-width: 42rem;
      margin: 0 auto;
      text-align: left;
      border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border));
      border-radius: 0.625rem;
      background: var(--vscode-editorWidget-background, rgba(127,127,127,0.06));
      padding: 1rem;
    }

    .token-guide-title {
      margin-bottom: 0.375rem;
      font-size: 0.9375rem;
      font-weight: 700;
      color: var(--vscode-foreground);
    }

    .token-guide-subtitle {
      margin-bottom: 0.875rem;
      color: var(--vscode-descriptionForeground);
      line-height: 1.5;
    }

    .token-guide-panel {
      margin-bottom: 0.75rem;
      border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border));
      border-radius: 0.5rem;
      padding: 0.75rem;
      background: var(--vscode-editor-inactiveSelectionBackground, rgba(255,255,255,0.04));
    }

    .token-guide-panel h3 {
      font-size: 0.8125rem;
      margin-bottom: 0.375rem;
      color: var(--vscode-foreground);
    }

    .token-guide-panel p {
      margin-bottom: 0.625rem;
      color: var(--vscode-descriptionForeground);
      line-height: 1.5;
    }

    .token-guide ol {
      margin: 0 0 0.625rem 1.25rem;
      line-height: 1.8;
    }

    .token-guide-actions {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      margin-top: 0.5rem;
    }

    .token-guide details {
      margin-top: 0.5rem;
    }

    .token-guide summary {
      cursor: pointer;
      font-weight: 600;
      color: var(--vscode-foreground);
      padding: 0.25rem 0;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <h1>Premium request analytics</h1>
      <p class="subtitle">${dataSource === 'api'
        ? 'Live usage data from GitHub Copilot API.'
        : 'Manual data mode. Click Refresh to fetch from GitHub API.'}${resetAtLabel ? ` Quota resets ${resetAtLabel}.` : ''}</p>
    </div>
    <div class="header-right">
      <div class="data-source">
        <span class="source-badge ${dataSource}">${dataSource === 'api' ? 'Live' : 'Manual'}</span>
        <br><span style="font-size: 10px;">Last: ${lastFetchedLabel}</span>
      </div>
      <button class="btn btn-primary" id="refreshBtn" title="Fetch latest data from GitHub API">Refresh</button>
    </div>
  </div>

  <div class="cards">
    <div class="card">
      <div class="card-label">Daily Allowance</div>
      <div class="card-value">${allowance}<span style="font-size: 1rem; font-weight: 400; color: var(--vscode-descriptionForeground);"> /day</span></div>
      <div class="card-detail">${statusEmoji} ${statusLabel}${pacing.multiplier !== 1 ? ` &middot; ${pacing.multiplier.toFixed(1)}x base rate` : ''}</div>
    </div>
    <div class="card">
      <div class="card-label">Included premium requests consumed</div>
      <div class="card-value small">
        ${totalUsageStr}
        <span style="font-size: 1rem; font-weight: 400; color: var(--vscode-descriptionForeground);">of
          <span class="limit-edit">
            <input type="number" id="limitInput" value="${limit}" min="1" max="100000" step="1" title="Edit monthly limit" />
          </span>
          included
        </span>
      </div>
      <div class="progress-container">
        <div class="progress-bar-bg">
          <div class="progress-bar-fill ${getProgressClass(legacyPacing)}" style="width: ${usagePercent.toFixed(1)}%;"></div>
        </div>
        <div class="progress-meta">
          <span>Target for today: ${targetStr} (${(recommendedPct * 100).toFixed(1)}% of month)</span>
          <span class="pacing-badge ${getProgressClass(legacyPacing)}">Pacing: ${pacingPercent.toFixed(1)}%</span>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-label">Remaining</div>
      <div class="card-value small">${remainingStr}</div>
      <div class="card-detail">${pacing.daysRemaining} days left &middot; Day ${pacing.dayOfMonth}/${pacing.daysInMonth}</div>
    </div>
  </div>

  <div class="daily-budget">
    <div class="budget-card">
      <h2>Daily rates</h2>
      <div class="budget-stat">
        <span class="budget-stat-label">Base rate</span>
        <span class="budget-stat-value">${pacing.baseDailyBudget.toFixed(2)}/day</span>
      </div>
      <div class="budget-stat">
        <span class="budget-stat-label">Past average</span>
        <span class="budget-stat-value">${pacing.avgDailyUsage.toFixed(2)}/day</span>
      </div>
      <div class="budget-stat">
        <span class="budget-stat-label">Today's allowance</span>
        <span class="budget-stat-value">${pacing.dailyAllowance.toFixed(2)}/day</span>
      </div>
      <div class="budget-stat">
        <span class="budget-stat-label">Multiplier</span>
        <span class="budget-stat-value">${pacing.multiplier.toFixed(2)}x</span>
      </div>
    </div>
    <div class="budget-card">
      <h2>Forecast</h2>
      <div class="budget-stat">
        <span class="budget-stat-label">Banked vs expected</span>
        <span class="budget-stat-value ${bankedClass}">${bankedStr}</span>
      </div>
      <div class="budget-stat">
        <span class="budget-stat-label">Projected month end</span>
        <span class="budget-stat-value">~${pacing.projectedEnd.toFixed(1)} / ${limit}${pacing.projectedEnd <= limit ? ' &#x2714;' : ' &#x26A0;'}</span>
      </div>
      <div class="budget-stat">
        <span class="budget-stat-label">Progress</span>
        <span class="budget-stat-value">Day ${pacing.dayOfMonth}/${pacing.daysInMonth} &middot; ${pacing.daysRemaining} left</span>
      </div>
      <div class="budget-stat">
        <span class="budget-stat-label">Time of day</span>
        <span class="budget-stat-value">${(pacing.timeOfDayProgress * 100).toFixed(1)}%</span>
      </div>
      ${pacing.overageCost > 0 ? `<div class="budget-stat">
        <span class="budget-stat-label">Overage</span>
        <span class="budget-stat-value danger">${pacing.overageRequests} reqs ($${pacing.overageCost.toFixed(2)})</span>
      </div>` : ''}
      ${billedTotal > 0 ? `<div class="budget-stat">
        <span class="budget-stat-label">Billed total</span>
        <span class="budget-stat-value">${billedTotalStr}</span>
      </div>` : ''}
    </div>
  </div>

  ${buildBillingSummarySection()}

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    // Refresh button
    const refreshBtn = document.getElementById('refreshBtn');
    refreshBtn.addEventListener('click', () => {
      refreshBtn.disabled = true;
      refreshBtn.textContent = 'Refreshing...';
      vscode.postMessage({ type: 'refresh' });
    });

    // Limit editing
    const limitInput = document.getElementById('limitInput');
    let limitDebounce;
    limitInput.addEventListener('change', () => {
      const val = Number(limitInput.value);
      if (val > 0 && Number.isFinite(val)) {
        clearTimeout(limitDebounce);
        limitDebounce = setTimeout(() => {
          vscode.postMessage({ type: 'setLimit', limit: val });
        }, 300);
      }
    });

    // Billing data elements
    const billingTableBody = document.getElementById('billingTableBody');
    const billingTotalRow = document.getElementById('billingTotalRow');
    const billingTable = document.getElementById('billingTable');
    const billingLoading = document.getElementById('billingLoading');
    const billingError = document.getElementById('billingError');
    const billingEmptyState = document.getElementById('billingEmptyState');
    const tokenGuide = document.getElementById('tokenGuide');
    const tokenGuideTitle = document.getElementById('tokenGuideTitle');
    const tokenGuideSubtitle = document.getElementById('tokenGuideSubtitle');

    // Token guide event handlers (attached once at init on pre-rendered elements)
    document.getElementById('quickSetupBtn').addEventListener('click', function() {
      vscode.postMessage({ type: 'openExternalThenSetToken', url: 'https://github.com/settings/personal-access-tokens/new?name=Copilot+Tracker&description=Used+by+the+Copilot+Premium+Tracker+VS+Code+extension+to+read+billing+data&expires_in=90&plan=read' });
    });
    document.getElementById('setBillingTokenBtn').addEventListener('click', function() {
      vscode.postMessage({ type: 'runCommand', command: 'copilot-premium-tracker.setBillingToken' });
    });
    document.querySelectorAll('.token-link').forEach(function(el) {
      el.addEventListener('click', function(e) {
        e.preventDefault();
        vscode.postMessage({ type: 'openExternal', url: el.getAttribute('data-url') });
      });
    });

    // DOM helpers — avoid innerHTML for XSS safety
    function addCell(row, text, cls) {
      var td = document.createElement('td');
      if (cls) { td.className = cls; }
      td.textContent = text;
      row.appendChild(td);
    }
    function fmtNum(n) { return n % 1 === 0 ? n.toFixed(0) : n.toFixed(2); }
    function fmtCur(n) { return '$' + n.toFixed(2); }

    // Listen for messages from extension
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'billingRangeResult') {
        billingLoading.style.display = 'none';
        const items = msg.items || [];
        if (msg.error) {
          if (msg.tokenNeeded || msg.noToken) {
            billingTable.style.display = 'none';
            if (billingEmptyState) { billingEmptyState.style.display = 'none'; }
            billingError.style.display = 'none';
            tokenGuideTitle.textContent = msg.noToken
              ? '\u26A0 Billing API needs a GitHub token'
              : '\u26A0 Billing API needs extra token permissions';
            tokenGuideSubtitle.textContent = msg.noToken
              ? 'No GitHub token is currently available. Add a fine-grained personal access token so Copilot Tracker can read billing usage.'
              : 'The API returned "resource not found". Your current token likely does not include the Plan permission required for billing endpoints.';
            tokenGuide.style.display = '';
          } else {
            tokenGuide.style.display = 'none';
            billingError.textContent = msg.error;
            billingError.style.display = '';
          }
          return;
        }
        tokenGuide.style.display = 'none';
        if (items.length === 0) {
          billingTable.style.display = 'none';
          if (billingEmptyState) { billingEmptyState.style.display = ''; }
          billingError.textContent = 'No billing data found for the selected date range.';
          billingError.style.display = '';
          return;
        }
        if (billingEmptyState) { billingEmptyState.style.display = 'none'; }
        billingError.style.display = 'none';
        while (billingTableBody.firstChild) { billingTableBody.removeChild(billingTableBody.firstChild); }
        var totGrossQty = 0, totGrossAmt = 0, totDiscQty = 0, totDiscAmt = 0, totNetQty = 0, totNetAmt = 0;
        items.forEach(function(item) {
          totGrossQty += item.grossQuantity || 0;
          totGrossAmt += item.grossAmount || 0;
          totDiscQty += item.discountQuantity || 0;
          totDiscAmt += item.discountAmount || 0;
          totNetQty += item.netQuantity || 0;
          totNetAmt += item.netAmount || 0;
          var tr = document.createElement('tr');
          addCell(tr, item.model || item.sku, 'sku-name');
          addCell(tr, fmtNum(item.grossQuantity), 'num');
          addCell(tr, fmtCur(item.grossAmount), 'num');
          addCell(tr, fmtNum(item.discountQuantity), 'num');
          addCell(tr, fmtCur(item.discountAmount), 'num');
          addCell(tr, fmtNum(item.netQuantity), 'num');
          addCell(tr, fmtCur(item.netAmount), 'num');
          billingTableBody.appendChild(tr);
        });
        while (billingTotalRow.firstChild) { billingTotalRow.removeChild(billingTotalRow.firstChild); }
        addCell(billingTotalRow, 'Total', '');
        addCell(billingTotalRow, fmtNum(totGrossQty), 'num');
        addCell(billingTotalRow, fmtCur(totGrossAmt), 'num');
        addCell(billingTotalRow, fmtNum(totDiscQty), 'num');
        addCell(billingTotalRow, fmtCur(totDiscAmt), 'num');
        addCell(billingTotalRow, fmtNum(totNetQty), 'num');
        addCell(billingTotalRow, fmtCur(totNetAmt), 'num');
        billingTable.style.display = '';
      }
    });
  </script>
</body>
</html>`;
}

function getProgressClass(pacing: number): string {
  if (pacing > 1.0) { return 'danger'; }
  if (pacing > 0.8) { return 'warning'; }
  return 'ok';
}

function buildBillingSummarySection(): string {
  // Static rows removed — the JS message handler populates the table dynamically
  // from the premium billing API response (billingRangeResult message).
  return `
  <div class="billing-summary">
    <h2>Billing summary <span class="source-badge api" style="font-size:0.625rem;">API</span></h2>
    <div id="billingLoading" style="padding: 1rem; text-align: center; color: var(--vscode-descriptionForeground);">Loading billing data...</div>
    <div id="billingError" style="display:none; padding: 0.75rem; text-align: center; color: var(--vscode-terminal-ansiRed, #f85149); font-size: 0.8125rem;"></div>
    <div id="tokenGuide" class="token-guide" style="display:none">
      <p class="token-guide-title" id="tokenGuideTitle"></p>
      <p class="token-guide-subtitle" id="tokenGuideSubtitle"></p>
      <div class="token-guide-panel">
        <h3>Quick setup (recommended)</h3>
        <p>Use the guided button to open GitHub with token details pre-filled (name, description, expiration, and <strong>Plan: Read-only</strong>).</p>
        <ol>
          <li>Click <strong>Generate token</strong> on the GitHub page</li>
          <li>Copy the token that starts with <code>github_pat_</code> <strong>immediately</strong> (GitHub shows it only once)</li>
          <li>Come back here and paste it when prompted</li>
        </ol>
        <div class="token-guide-actions">
          <button class="action-btn" id="quickSetupBtn">Create Token and Set It Up</button>
          <button class="action-btn-secondary" id="setBillingTokenBtn">Paste Existing Token</button>
        </div>
      </div>
      <details>
        <summary>Manual setup</summary>
        <div>
          <ol>
            <li>Go to <a href="#" class="token-link" data-url="https://github.com/settings/personal-access-tokens/new">GitHub \u2192 Fine-grained personal access tokens</a></li>
            <li>Set a <strong>Token name</strong> (e.g. <em>Copilot Tracker</em>)</li>
            <li>Set <strong>Expiration</strong> to your preference (or <em>No expiration</em>)</li>
            <li>Under <strong>Account permissions</strong>, click <strong>+ Add permissions</strong></li>
            <li>Find <strong>Plan</strong> and set it to <strong>Read-only</strong></li>
            <li>Click <strong>Generate token</strong></li>
            <li>Copy the token starting with <code>github_pat_</code> <strong>before leaving the page</strong></li>
            <li>Open the Command Palette (<code>Ctrl+Shift+P</code>) and run <code>Copilot Tracker: Set Billing Token</code>, then paste it</li>
          </ol>
        </div>
      </details>
    </div>
    <table id="billingTable" style="display:none">
      <thead>
        <tr>
          <th>Model</th>
          <th class="num">Gross qty</th>
          <th class="num">Gross amount</th>
          <th class="num">Discount qty</th>
          <th class="num">Discount amount</th>
          <th class="num">Net qty</th>
          <th class="num">Net amount</th>
        </tr>
      </thead>
      <tbody id="billingTableBody"></tbody>
      <tfoot>
        <tr id="billingTotalRow">
          <td colspan="7"></td>
        </tr>
      </tfoot>
    </table>
    <div class="empty-state" id="billingEmptyState" style="display:none">
      <p>Billing data will load automatically when available.</p>
    </div>
  </div>`;
}
