import * as vscode from 'vscode';
import { UsageData } from '../dataService';
import { calculatePacing, classifyStatus, getPacingProgress, getRecommendedPercentage } from '../pacing';

export function getWebviewHtml(
  data: UsageData,
  webview: vscode.Webview,
  nonce: string
): string {
  const { totalUsage, limit, remaining, billedTotal, models, dateRange, dataSource, lastFetchedAt } = data;
  const pacing = calculatePacing(totalUsage, limit, new Date(new Date().getTime() + new Date().getTimezoneOffset() * 60000), remaining);
  const status = classifyStatus(pacing);
  const legacyPacing = getPacingProgress(totalUsage, limit);
  const pacingPercent = (legacyPacing * 100);
  const recommendedPct = getRecommendedPercentage();
  const target = (recommendedPct * limit * 100) / 100;
  const usagePercent = limit > 0 ? Math.min((totalUsage / limit) * 100, 100) : 0;

  const totalIncludedSum = models.reduce((s, m) => s + m.includedRequests, 0);

  const tableRows = models
    .map(
      (m) => {
        const pctOfTotal = totalIncludedSum > 0
          ? ((m.includedRequests / totalIncludedSum) * 100).toFixed(1)
          : '0.0';
        return `
      <tr>
        <td class="model-name">${escapeHtml(m.model)}</td>
        <td class="num">${formatNumber(m.includedRequests)}</td>
        <td class="num">${pctOfTotal}%</td>
        <td class="num">${formatNumber(m.billedRequests)}</td>
        <td class="num">${formatCurrency(m.grossAmount)}</td>
        <td class="num">${formatCurrency(m.billedAmount)}</td>
        <td class="actions">
          <button class="icon-btn edit-btn" title="Edit" data-model="${escapeAttr(m.model)}" data-included="${m.includedRequests}" data-billed="${m.billedRequests}" data-gross="${m.grossAmount}" data-billedamt="${m.billedAmount}">✏️</button>
          <button class="icon-btn remove-btn" title="Remove" data-model="${escapeAttr(m.model)}">✕</button>
        </td>
      </tr>`;
      }
    )
    .join('');

  const totalIncluded = totalIncludedSum;
  const totalBilled = models.reduce((s, m) => s + m.billedRequests, 0);
  const totalGross = models.reduce((s, m) => s + m.grossAmount, 0);
  const totalBilledAmt = models.reduce((s, m) => s + m.billedAmount, 0);

  const emptyState = models.length === 0
    ? `<div class="empty-state">
        <p>No manual model entries. Usage data is ${dataSource === 'api' ? 'fetched automatically from GitHub API' : 'not yet available - click Refresh to fetch from API'}.</p>
       </div>`
    : '';

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
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      padding: 24px 32px;
      line-height: 1.5;
    }

    .header {
      margin-bottom: 24px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }

    .header-left h1 {
      font-size: 20px;
      font-weight: 600;
      color: var(--vscode-foreground);
      margin-bottom: 4px;
    }

    .header-left .subtitle {
      font-size: 13px;
      color: var(--vscode-descriptionForeground);
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .data-source {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      text-align: right;
    }

    .data-source .source-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
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
      gap: 16px;
      margin-bottom: 24px;
      flex-wrap: wrap;
    }

    .card {
      flex: 1;
      min-width: 220px;
      background-color: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
      border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border));
      border-radius: 8px;
      padding: 20px;
    }

    .card-label {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 500;
    }

    .card-value {
      font-size: 28px;
      font-weight: 600;
      color: var(--vscode-foreground);
      margin-bottom: 4px;
    }

    .card-value.small {
      font-size: 22px;
    }

    .card-detail {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }

    .card-link {
      color: var(--vscode-textLink-foreground);
      text-decoration: none;
      font-size: 12px;
      cursor: pointer;
    }

    .card-link:hover {
      text-decoration: underline;
      color: var(--vscode-textLink-activeForeground);
    }

    .progress-container {
      margin-top: 12px;
    }

    .progress-bar-bg {
      width: 100%;
      height: 8px;
      background-color: var(--vscode-progressBar-background, rgba(128,128,128,0.2));
      border-radius: 4px;
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
      border-radius: 4px;
    }

    .progress-bar-fill {
      height: 100%;
      border-radius: 4px;
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
      margin-top: 8px;
    }

    .progress-meta span {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }

    .pacing-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
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
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 24px;
    }

    .daily-budget h2 {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 16px;
      color: var(--vscode-foreground);
    }

    .daily-budget .status-line {
      font-size: 1rem;
      margin-bottom: 12px;
    }

    .daily-budget .hero-number {
      font-size: 24px;
      font-weight: 600;
      color: var(--vscode-foreground);
      margin-bottom: 16px;
    }

    .rate-chart {
      margin: 16px 0;
      font-family: var(--vscode-editor-font-family, 'Cascadia Code', Consolas, monospace);
      font-size: 12px;
    }

    .rate-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }

    .rate-label {
      width: 80px;
      text-align: right;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
    }

    .rate-bar-bg {
      flex: 1;
      height: 16px;
      background-color: var(--vscode-input-background, rgba(128,128,128,0.15));
      border-radius: 3px;
      overflow: hidden;
    }

    .rate-bar-fill {
      height: 100%;
      border-radius: 3px;
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
      width: 90px;
      font-size: 12px;
      color: var(--vscode-foreground);
    }

    .rate-value .indicator {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
    }

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
      margin-top: 16px;
    }

    .metric-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }

    .metric-item .metric-value {
      font-weight: 600;
      color: var(--vscode-foreground);
    }

    .table-section {
      margin-top: 8px;
    }

    .table-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 12px;
    }

    .table-header h2 {
      font-size: 16px;
      font-weight: 600;
      color: var(--vscode-foreground);
    }

    .table-header .date-range {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    thead th {
      text-align: left;
      font-size: 11px;
      font-weight: 600;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 8px 12px;
      border-bottom: 2px solid var(--vscode-panel-border, var(--vscode-widget-border));
    }

    thead th.num {
      text-align: right;
    }

    tbody td {
      padding: 10px 12px;
      font-size: 13px;
      border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, rgba(128,128,128,0.2)));
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
      padding: 10px 12px;
      font-size: 13px;
      font-weight: 600;
      border-top: 2px solid var(--vscode-panel-border, var(--vscode-widget-border));
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
      padding: 2px 6px;
      font-size: 13px;
      color: var(--vscode-descriptionForeground);
      border-radius: 4px;
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
      padding: 32px 16px;
      color: var(--vscode-descriptionForeground);
      font-size: 13px;
    }

    .empty-state a {
      color: var(--vscode-textLink-foreground);
    }

    /* Add Model Form */
    .add-form {
      margin-top: 24px;
      background-color: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
      border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border));
      border-radius: 8px;
      padding: 20px;
    }

    .add-form h3 {
      font-size: 1rem;
      font-weight: 600;
      margin-bottom: 16px;
      color: var(--vscode-foreground);
    }

    .form-row {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 12px;
      align-items: end;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .form-group label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 500;
    }

    .form-group input {
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 4px;
      padding: 6px 10px;
      font-size: 13px;
      font-family: inherit;
      outline: none;
    }

    .form-group input:focus {
      border-color: var(--vscode-focusBorder);
    }

    .form-group input[type="text"] {
      min-width: 200px;
    }

    .form-group input[type="number"] {
      width: 120px;
    }

    .currency-wrapper {
      position: relative;
      display: inline-flex;
      align-items: center;
    }

    .currency-wrapper .currency-prefix {
      position: absolute;
      left: 10px;
      font-size: 13px;
      color: var(--vscode-descriptionForeground);
      pointer-events: none;
      z-index: 1;
    }

    .currency-wrapper input {
      padding-left: 22px !important;
      width: 120px;
    }

    .currency-wrapper input[readonly] {
      opacity: 0.7;
      cursor: default;
    }

    .btn {
      padding: 6px 16px;
      border-radius: 4px;
      font-size: 13px;
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
      gap: 6px;
    }

    .limit-edit input {
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 4px;
      padding: 2px 8px;
      font-size: 1rem;
      font-family: inherit;
      width: 80px;
      outline: none;
      font-weight: 600;
    }

    .limit-edit input:focus {
      border-color: var(--vscode-focusBorder);
    }

    .form-buttons {
      display: flex;
      gap: 8px;
      align-items: end;
    }

    .collapsible-toggle {
      cursor: pointer;
      user-select: none;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .collapsible-toggle .arrow {
      transition: transform 0.2s;
      font-size: 10px;
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

    @media (max-width: 600px) {
      body {
        padding: 16px;
      }
      .cards {
        flex-direction: column;
      }
      .card {
        min-width: unset;
      }
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

  <div class="table-section">
    <div class="table-header">
      <h2 class="collapsible-toggle" id="tableToggle">
        <span class="arrow" id="tableArrow">&#9656;</span> Manual usage breakdown
      </h2>
      <span class="date-range">${escapeHtml(dateRange)}</span>
    </div>
    <div class="collapsible-content" id="tableContent">
      ${emptyState}
      <table${models.length === 0 ? ' style="display:none"' : ''}>
        <thead>
          <tr>
            <th>Model</th>
            <th class="num">Included requests</th>
            <th class="num">% of Total</th>
            <th class="num">Billed requests</th>
            <th class="num">Gross amount</th>
            <th class="num">Billed amount</th>
            <th style="width: 70px;"></th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            <td class="num">${formatNumber(totalIncluded)}</td>
            <td class="num">100.0%</td>
            <td class="num">${formatNumber(totalBilled)}</td>
            <td class="num">${formatCurrency(totalGross)}</td>
            <td class="num">${formatCurrency(totalBilledAmt)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>

      <div class="add-form">
        <h3 id="formTitle">Add model usage</h3>
        <div class="form-row">
          <div class="form-group">
            <label for="modelName">Model</label>
            <input type="text" id="modelName" placeholder="e.g. Claude Sonnet 4" />
          </div>
          <div class="form-group">
            <label for="includedReq">Included requests</label>
            <input type="number" id="includedReq" value="0" min="0" step="0.01" />
          </div>
          <div class="form-group">
            <label for="billedReq">Billed requests</label>
            <input type="number" id="billedReq" value="0" min="0" step="0.01" />
          </div>
          <div class="form-group">
            <label for="grossAmt">Gross amount</label>
            <div class="currency-wrapper">
              <span class="currency-prefix">$</span>
              <input type="text" id="grossAmt" value="0.00" readonly tabindex="-1" title="Auto-calculated: $0.04 per request" />
            </div>
          </div>
          <div class="form-group">
            <label for="billedAmt">Billed amount</label>
            <div class="currency-wrapper">
              <span class="currency-prefix">$</span>
              <input type="text" id="billedAmt" value="0.00" />
            </div>
          </div>
          <div class="form-buttons">
            <button class="btn btn-primary" id="submitBtn">Add</button>
            <button class="btn btn-secondary" id="cancelBtn" style="display:none;">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    // Refresh button
    document.getElementById('refreshBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'refresh' });
    });

    // Collapsible table section
    const tableToggle = document.getElementById('tableToggle');
    const tableArrow = document.getElementById('tableArrow');
    const tableContent = document.getElementById('tableContent');
    tableToggle.addEventListener('click', () => {
      tableContent.classList.toggle('open');
      tableArrow.classList.toggle('open');
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

    // Remove buttons
    document.querySelectorAll('.remove-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.getAttribute('data-model');
        vscode.postMessage({ type: 'removeModel', modelName: name });
      });
    });

    // Edit buttons
    let editingModel = null;
    const formTitle = document.getElementById('formTitle');
    const submitBtn = document.getElementById('submitBtn');
    const cancelBtn = document.getElementById('cancelBtn');
    const modelNameInput = document.getElementById('modelName');
    const includedInput = document.getElementById('includedReq');
    const billedInput = document.getElementById('billedReq');
    const grossInput = document.getElementById('grossAmt');
    const billedAmtInput = document.getElementById('billedAmt');
    const COST_PER_REQUEST = 0.04;

    function calcGross() {
      const inc = Number(includedInput.value) || 0;
      const bil = Number(billedInput.value) || 0;
      grossInput.value = ((inc + bil) * COST_PER_REQUEST).toFixed(2);
    }

    function formatCurrencyInput(el) {
      const val = parseFloat(el.value.replace(/[^0-9.\\-]/g, ''));
      el.value = isNaN(val) ? '0.00' : val.toFixed(2);
    }

    includedInput.addEventListener('input', calcGross);
    billedInput.addEventListener('input', calcGross);
    billedAmtInput.addEventListener('blur', () => formatCurrencyInput(billedAmtInput));

    document.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        // Open the collapsible if closed
        if (!tableContent.classList.contains('open')) {
          tableContent.classList.add('open');
          tableArrow.classList.add('open');
        }
        editingModel = btn.getAttribute('data-model');
        modelNameInput.value = editingModel;
        modelNameInput.readOnly = true;
        includedInput.value = btn.getAttribute('data-included');
        billedInput.value = btn.getAttribute('data-billed');
        calcGross();
        billedAmtInput.value = parseFloat(btn.getAttribute('data-billedamt') || '0').toFixed(2);
        formTitle.textContent = 'Edit model usage';
        submitBtn.textContent = 'Save';
        cancelBtn.style.display = '';
        modelNameInput.focus();
      });
    });

    cancelBtn.addEventListener('click', () => {
      resetForm();
    });

    function resetForm() {
      editingModel = null;
      modelNameInput.value = '';
      modelNameInput.readOnly = false;
      includedInput.value = '0';
      billedInput.value = '0';
      grossInput.value = '0.00';
      billedAmtInput.value = '0.00';
      formTitle.textContent = 'Add model usage';
      submitBtn.textContent = 'Add';
      cancelBtn.style.display = 'none';
    }

    // Add / Edit submit
    submitBtn.addEventListener('click', () => {
      const name = modelNameInput.value.trim();
      if (!name) {
        modelNameInput.focus();
        return;
      }
      const model = {
        model: name,
        includedRequests: Number(includedInput.value) || 0,
        billedRequests: Number(billedInput.value) || 0,
        grossAmount: parseFloat(grossInput.value) || 0,
        billedAmount: parseFloat(billedAmtInput.value.replace(/[^0-9.\\-]/g, '')) || 0,
      };
      if (editingModel) {
        vscode.postMessage({ type: 'editModel', model });
      } else {
        vscode.postMessage({ type: 'addModel', model });
      }
      resetForm();
    });

    // Submit on Enter in any field
    document.querySelectorAll('.add-form input').forEach(input => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          submitBtn.click();
        }
      });
    });
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
