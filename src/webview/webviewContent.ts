import * as vscode from 'vscode';
import { UsageData } from '../dataService';
import { BillingUsageItem } from '../api';
import { calculatePacing, classifyStatus, getPacingProgress, getRecommendedPercentage } from '../pacing';

export function getWebviewHtml(
  data: UsageData,
  webview: vscode.Webview,
  nonce: string
): string {
  const { totalUsage, limit, remaining, billedTotal, models, dateRange, dataSource, lastFetchedAt, billingItems } = data;
  const pacing = calculatePacing(totalUsage, limit, new Date(new Date().getTime() + new Date().getTimezoneOffset() * 60000), remaining);
  const status = classifyStatus(pacing);
  const legacyPacing = getPacingProgress(totalUsage, limit);
  const pacingPercent = (legacyPacing * 100);
  const recommendedPct = getRecommendedPercentage();
  const target = (recommendedPct * limit * 100) / 100;
  const usagePercent = limit > 0 ? Math.min((totalUsage / limit) * 100, 100) : 0;

  // Enhanced pacing metrics
  const allowance = pacing.dailyAllowance;
  const formattedPacingBanked = pacing.banked.toFixed(1);
  const bankedStr = pacing.banked >= 0
    ? `+${formattedPacingBanked} saved`
    : `${formattedPacingBanked} overspent`;
  const bankedClass = pacing.banked >= 0 ? 'ok' : 'danger';
  const statusEmoji = status === 'ahead' ? '🚀' : status === 'on-track' ? '✓' : status === 'over-budget' ? '🔥' : '💀';
  const statusLabel = status === 'ahead' ? 'Ahead of schedule' : status === 'on-track' ? 'On track' : status === 'over-budget' ? 'Over budget' : 'Exhausted';

  // Bar chart widths (scaled to 20 chars width, mapped to %)
  const maxRate = Math.max(pacing.baseDailyBudget, pacing.avgDailyUsage, pacing.dailyAllowance, 1);
  const budgetBarPct = Math.min(100, (pacing.baseDailyBudget / maxRate) * 100);
  const avgBarPct = Math.min(100, (pacing.avgDailyUsage / maxRate) * 100);
  const allowanceBarPct = Math.min(100, (pacing.dailyAllowance / maxRate) * 100);

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
      background-color: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
      border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border));
      border-radius: 0.5rem;
      padding: 1.25rem;
      margin-bottom: 1.5rem;
    }

    .daily-budget h2 {
      font-size: 1rem;
      font-weight: 600;
      margin-bottom: 1rem;
      color: var(--vscode-foreground);
    }

    .daily-budget .status-line {
      font-size: 1rem;
      margin-bottom: 0.75rem;
    }

    .daily-budget .hero-number {
      font-size: 1.5rem;
      font-weight: 600;
      color: var(--vscode-foreground);
      margin-bottom: 1rem;
    }

    .rate-chart {
      margin: 1rem 0;
      font-family: var(--vscode-editor-font-family, 'Cascadia Code', Consolas, monospace);
      font-size: 0.75rem;
    }

    .rate-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.375rem;
    }

    .rate-label {
      width: 5rem;
      text-align: right;
      color: var(--vscode-descriptionForeground);
      font-size: 0.6875rem;
    }

    .rate-bar-bg {
      flex: 1;
      height: 1rem;
      background-color: var(--vscode-input-background, rgba(128,128,128,0.15));
      border-radius: 0.1875rem;
      overflow: hidden;
    }

    .rate-bar-fill {
      height: 100%;
      border-radius: 0.1875rem;
      transition: width 0.3s ease;
    }

    .rate-bar-fill.base {
      background-color: var(--vscode-terminal-ansiBlue, #58a6ff);
    }

    .rate-bar-fill.avg {
      background-color: var(--vscode-terminal-ansiYellow, #d29922);
    }

    .rate-bar-fill.allowance {
      background-color: var(--vscode-terminal-ansiGreen, #3fb950);
    }

    .rate-value {
      width: 5.625rem;
      font-size: 0.75rem;
      color: var(--vscode-foreground);
    }

    .rate-value .indicator {
      font-size: 0.625rem;
      color: var(--vscode-descriptionForeground);
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

    .billing-summary table {
      width: 100%;
      border-collapse: collapse;
    }

    .billing-summary thead th {
      text-align: left;
      font-size: 0.6875rem;
      font-weight: 600;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      letter-spacing: 0.03125rem;
      padding: 0.5rem 0.75rem;
      border-bottom: 0.125rem solid var(--vscode-panel-border, var(--vscode-widget-border));
    }

    .billing-summary thead th.num {
      text-align: right;
    }

    .billing-summary tbody td {
      padding: 0.625rem 0.75rem;
      font-size: 0.8125rem;
      border-bottom: 0.0625rem solid var(--vscode-panel-border, var(--vscode-widget-border, rgba(128,128,128,0.2)));
    }

    .billing-summary tbody td.num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      color: var(--vscode-foreground);
    }

    .billing-summary tbody td.sku-name {
      font-weight: 500;
      color: var(--vscode-foreground);
    }

    .billing-summary tfoot td {
      padding: 0.625rem 0.75rem;
      font-size: 0.8125rem;
      font-weight: 600;
      border-top: 0.125rem solid var(--vscode-panel-border, var(--vscode-widget-border));
      color: var(--vscode-foreground);
    }

    .billing-summary tfoot td.num {
      text-align: right;
      font-variant-numeric: tabular-nums;
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
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <h1>Premium request analytics</h1>
      <p class="subtitle">${dataSource === 'api'
        ? 'Live usage data from GitHub Copilot API.'
        : 'Manual data mode. Click Refresh to fetch from GitHub API.'}</p>
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
        ${formatNumber(totalUsage)}
        <span style="font-size: 1rem; font-weight: 400; color: var(--vscode-descriptionForeground);">of
          <span class="limit-edit">
            <input type="number" id="limitInput" value="${limit}" min="1" step="1" title="Edit monthly limit" />
          </span>
          included
        </span>
      </div>
      <div class="progress-container">
        <div class="progress-bar-bg">
          <div class="progress-bar-fill ${getProgressClass(legacyPacing)}" style="width: ${usagePercent.toFixed(1)}%;"></div>
        </div>
        <div class="progress-meta">
          <span>Target for today: ${formatNumber(target)} (${(recommendedPct * 100).toFixed(1)}% of month)</span>
          <span class="pacing-badge ${getProgressClass(legacyPacing)}">Pacing: ${pacingPercent.toFixed(1)}%</span>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-label">Remaining</div>
      <div class="card-value small">${formatNumber(pacing.remaining)}</div>
      <div class="card-detail">${pacing.daysRemaining} days left &middot; Day ${pacing.dayOfMonth}/${pacing.daysInMonth}</div>
    </div>
  </div>

  <div class="daily-budget">
    <h2>Daily budget report</h2>
    <div class="rate-chart">
      <div class="rate-row">
        <span class="rate-label">base rate</span>
        <div class="rate-bar-bg"><div class="rate-bar-fill base" style="width: ${budgetBarPct.toFixed(1)}%;"></div></div>
        <span class="rate-value">${pacing.baseDailyBudget.toFixed(1)}/day</span>
      </div>
      <div class="rate-row">
        <span class="rate-label">past avg</span>
        <div class="rate-bar-bg"><div class="rate-bar-fill avg" style="width: ${avgBarPct.toFixed(1)}%;"></div></div>
        <span class="rate-value">${pacing.avgDailyUsage.toFixed(1)}/day</span>
      </div>
      <div class="rate-row">
        <span class="rate-label">allowance</span>
        <div class="rate-bar-bg"><div class="rate-bar-fill allowance" style="width: ${allowanceBarPct.toFixed(1)}%;"></div></div>
        <span class="rate-value">${pacing.dailyAllowance.toFixed(1)}/day</span>
      </div>
    </div>
    <div class="metrics-grid">
      <div class="metric-item"><span class="metric-value ${bankedClass}">${bankedStr}</span> vs expected</div>
      <div class="metric-item">Projected: <span class="metric-value">~${pacing.projectedEnd.toFixed(1)} / ${limit}</span> by month end${pacing.projectedEnd <= limit ? ' &#x2714;' : ' &#x26A0;'}</div>
      <div class="metric-item">Day ${pacing.dayOfMonth}/${pacing.daysInMonth} &middot; ${pacing.daysRemaining} days left &middot; ${formatNumber(pacing.remaining)} remaining</div>
      <div class="metric-item">${(pacing.timeOfDayProgress * 100).toFixed(1)}% through the day</div>
      ${pacing.overageCost > 0 ? `<div class="metric-item">Overage: ${pacing.overageRequests} requests ($${pacing.overageCost.toFixed(2)})</div>` : ''}
      ${billedTotal > 0 ? `<div class="metric-item">Billed total: ${formatCurrency(billedTotal)}</div>` : ''}
    </div>
  </div>

  ${buildBillingSummarySection(billingItems)}

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
      if (val > 0) {
        clearTimeout(limitDebounce);
        limitDebounce = setTimeout(() => {
          vscode.postMessage({ type: 'setLimit', limit: val });
        }, 300);
      }
    });

    // Billing date range fetch
    const fetchBillingBtn = document.getElementById('fetchBillingBtn');
    const billingStartInput = document.getElementById('billingStart');
    const billingEndInput = document.getElementById('billingEnd');
    const billingTableBody = document.getElementById('billingTableBody');
    const billingTotalRow = document.getElementById('billingTotalRow');
    const billingTable = document.getElementById('billingTable');
    const billingLoading = document.getElementById('billingLoading');
    const billingError = document.getElementById('billingError');

    fetchBillingBtn.addEventListener('click', () => {
      const start = billingStartInput.value;
      const end = billingEndInput.value;
      if (!start || !end) return;
      fetchBillingBtn.disabled = true;
      fetchBillingBtn.textContent = 'Fetching...';
      billingLoading.style.display = '';
      billingError.style.display = 'none';
      billingTable.style.display = 'none';
      vscode.postMessage({ type: 'fetchBillingRange', startDate: start, endDate: end });
    });

    // Listen for messages from extension
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'billingRangeResult') {
        fetchBillingBtn.disabled = false;
        fetchBillingBtn.textContent = 'Fetch';
        billingLoading.style.display = 'none';
        const items = msg.items || [];
        if (msg.error) {
          billingError.textContent = msg.error;
          billingError.style.display = '';
          return;
        }
        if (items.length === 0) {
          billingError.textContent = 'No billing data found for the selected date range.';
          billingError.style.display = '';
          return;
        }
        billingTableBody.innerHTML = '';
        let totGrossQty = 0, totGrossAmt = 0, totDiscQty = 0, totDiscAmt = 0, totNetQty = 0, totNetAmt = 0;
        items.forEach(item => {
          totGrossQty += item.grossQuantity || 0;
          totGrossAmt += item.grossAmount || 0;
          totDiscQty += item.discountQuantity || 0;
          totDiscAmt += item.discountAmount || 0;
          totNetQty += item.netQuantity || 0;
          totNetAmt += item.netAmount || 0;
          const tr = document.createElement('tr');
          tr.innerHTML =
            '<td class="sku-name">' + escapeH(item.model || item.sku) + '</td>' +
            '<td class="num">' + fmtNum(item.grossQuantity) + '</td>' +
            '<td class="num">' + fmtCur(item.grossAmount) + '</td>' +
            '<td class="num">' + fmtNum(item.discountQuantity) + '</td>' +
            '<td class="num">' + fmtCur(item.discountAmount) + '</td>' +
            '<td class="num">' + fmtNum(item.netQuantity) + '</td>' +
            '<td class="num">' + fmtCur(item.netAmount) + '</td>';
          billingTableBody.appendChild(tr);
        });
        billingTotalRow.innerHTML =
          '<td>Total</td>' +
          '<td class="num">' + fmtNum(totGrossQty) + '</td>' +
          '<td class="num">' + fmtCur(totGrossAmt) + '</td>' +
          '<td class="num">' + fmtNum(totDiscQty) + '</td>' +
          '<td class="num">' + fmtCur(totDiscAmt) + '</td>' +
          '<td class="num">' + fmtNum(totNetQty) + '</td>' +
          '<td class="num">' + fmtCur(totNetAmt) + '</td>';
        billingTable.style.display = '';
      }
    });

    function escapeH(s) {
      const d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }
    function fmtNum(n) { return n % 1 === 0 ? n.toFixed(0) : n.toFixed(2); }
    function fmtCur(n) { return '$' + n.toFixed(2); }
  </script>
</body>
</html>`;
}
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatNumber(n: number): string {
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(2);
}

function formatCurrency(n: number): string {
  return `$${n.toFixed(2)}`;
}

function getProgressClass(pacing: number): string {
  if (pacing > 1.0) { return 'danger'; }
  if (pacing > 0.8) { return 'warning'; }
  return 'ok';
}

function humanizeSku(sku: string): string {
  return sku
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildBillingSummarySection(items: BillingUsageItem[]): string {
  // Default date range: 1st of current month to today
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const defaultStart = `${y}-${m}-01`;
  const defaultEnd = `${y}-${m}-${d}`;

  // Build static billing summary rows from the old endpoint data (if available)
  let staticRows = '';
  if (items && items.length > 0) {
    staticRows = items.map((item) => {
      const cost = (item.grossQuantity ?? 0) * (item.pricePerUnit ?? 0);
      return `
        <tr>
          <td class="sku-name">${escapeHtml(humanizeSku(item.sku))}</td>
          <td class="num">${formatNumber(item.grossQuantity)}</td>
          <td class="num">${formatCurrency(cost)}</td>
          <td class="num">${item.netQuantity !== undefined ? formatNumber(item.netQuantity) : '\u2014'}</td>
          <td class="num">\u2014</td>
          <td class="num">\u2014</td>
          <td class="num">\u2014</td>
        </tr>`;
    }).join('');
  }

  return `
  <div class="billing-summary">
    <h2>Billing summary <span class="source-badge api" style="font-size:0.625rem;">API</span></h2>
    <div class="form-row" style="margin-bottom: 1rem; align-items: flex-end;">
      <div class="form-group">
        <label for="billingStart">Start date</label>
        <input type="date" id="billingStart" value="${defaultStart}" />
      </div>
      <div class="form-group">
        <label for="billingEnd">End date</label>
        <input type="date" id="billingEnd" value="${defaultEnd}" />
      </div>
      <div class="form-buttons">
        <button class="btn btn-primary" id="fetchBillingBtn">Fetch</button>
      </div>
    </div>
    <div id="billingLoading" style="display:none; padding: 1rem; text-align: center; color: var(--vscode-descriptionForeground);">Fetching billing data...</div>
    <div id="billingError" style="display:none; padding: 0.75rem; text-align: center; color: var(--vscode-terminal-ansiRed, #f85149); font-size: 0.8125rem;"></div>
    <table id="billingTable"${items && items.length > 0 ? '' : ' style="display:none"'}>
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
      <tbody id="billingTableBody">
        ${staticRows}
      </tbody>
      <tfoot>
        <tr id="billingTotalRow">
          ${items && items.length > 0 ? `
            <td>Total</td>
            <td class="num">${formatNumber(items.reduce((s, i) => s + (i.grossQuantity ?? 0), 0))}</td>
            <td class="num">${formatCurrency(items.reduce((s, i) => s + (i.grossQuantity ?? 0) * (i.pricePerUnit ?? 0), 0))}</td>
            <td class="num">\u2014</td>
            <td class="num">\u2014</td>
            <td class="num">${formatNumber(items.reduce((s, i) => s + (i.netQuantity ?? 0), 0))}</td>
            <td class="num">\u2014</td>
          ` : '<td colspan="7"></td>'}
        </tr>
      </tfoot>
    </table>
    ${!items || items.length === 0 ? `
    <div class="empty-state" id="billingEmptyState">
      <p>Select a date range and click "Fetch" to load billing data from the GitHub API.</p>
      <p><a href="#" onclick="document.getElementById('fetchBillingBtn').click(); return false;">Or click here to load current month &rarr;</a></p>
    </div>` : ''}
  </div>`;
}
