import * as vscode from 'vscode';
import { UsageData } from '../dataService';
import { calculatePacing, classifyStatus, PacingResult, UsageStatus } from '../pacing';

/**
 * HTML-escape a string for safe interpolation into the webview template.
 * The CSP nonce mitigates inline-script execution but does not prevent
 * HTML injection; route any untrusted string (API-sourced model names,
 * error messages, etc.) through this helper.
 */
function escapeHtml(input: unknown): string {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Serializable view-model posted to the webview. Every field the HTML
 * template renders is pre-formatted here so the first-open HTML render and
 * subsequent `updateData` message patches share one source of truth. See
 * CODE_REVIEW H3 / PERFORMANCE_REVIEW M1.
 */
export interface DashboardViewModel {
  dataSource: 'api' | 'manual';
  dataSourceLabel: string;
  subtitle: string;
  lastFetchedLabel: string;
  allowance: string;
  cardDetail: string;
  totalUsageStr: string;
  limit: number;
  pacingClass: 'ok' | 'warning' | 'danger';
  usagePercentStr: string;
  targetText: string;
  pacingBadgeText: string;
  remainingStr: string;
  remainingDetail: string;
  baseRate: string;
  pastAvg: string;
  todayAllowance: string;
  multiplier: string;
  dailyUsage: string | null;
  banked: { text: string; className: 'ok' | 'danger' };
  projected: string;
  progress: string;
  timeOfDay: string;
  overage: string | null;
  billedTotal: string | null;
}

function fmtN(n: number): string {
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(2);
}

function getProgressClass(pacing: number): 'ok' | 'warning' | 'danger' {
  if (pacing > 1.0) { return 'danger'; }
  if (pacing > 0.8) { return 'warning'; }
  return 'ok';
}

/**
 * Pure data-shape transformation for the dashboard. Accepts an optional `now`
 * so callers can thread a single wall-clock timestamp through pacing,
 * status-bar, and webview render (PERFORMANCE_REVIEW L2).
 */
export function buildDashboardViewModel(data: UsageData, now: Date = new Date()): DashboardViewModel {
  const { totalUsage, limit, remaining, billedTotal, dataSource, lastFetchedAt, resetAt, dailyUsage } = data;
  const pacing: PacingResult = calculatePacing(totalUsage, limit, now, remaining);
  const status: UsageStatus = classifyStatus(pacing);

  const recommendedPct = pacing.dayOfMonth / pacing.daysInMonth;
  const pacingRatio = pacing.expectedByNow > 0 ? totalUsage / pacing.expectedByNow : 0;
  const pacingPercent = pacingRatio * 100;
  const target = parseFloat((recommendedPct * limit).toFixed(2));
  const usagePercent = limit > 0 ? Math.min((totalUsage / limit) * 100, 100) : 0;
  const pacingClass = getProgressClass(pacingRatio);

  const resetAtLabel = resetAt
    ? new Date(resetAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    : '';

  const formattedPacingBanked = pacing.banked.toFixed(1);
  const bankedText = pacing.banked >= 0
    ? `+${formattedPacingBanked} saved`
    : `${formattedPacingBanked} overspent`;
  const bankedClass: 'ok' | 'danger' = pacing.banked >= 0 ? 'ok' : 'danger';

  const statusEmoji = status === 'ahead' ? '\u{1F680}' : status === 'on-track' ? '\u2713' : status === 'over-budget' ? '\u{1F525}' : '\u{1F480}';
  const statusLabel = status === 'ahead' ? 'Ahead of schedule' : status === 'on-track' ? 'On track' : status === 'over-budget' ? 'Over budget' : 'Exhausted';
  const cardDetail = `${statusEmoji} ${statusLabel}${pacing.multiplier !== 1 ? ` \u00b7 ${pacing.multiplier.toFixed(1)}x base rate` : ''}`;

  const subtitleBase = dataSource === 'api'
    ? 'Live usage data from GitHub Copilot API.'
    : 'Manual data mode. Click Refresh to fetch from GitHub API.';
  const subtitle = resetAtLabel ? `${subtitleBase} Quota resets ${resetAtLabel}.` : subtitleBase;

  const lastFetchedLabel = lastFetchedAt ? new Date(lastFetchedAt).toLocaleTimeString() : 'Never';

  const projectedCheck = pacing.projectedEnd <= limit ? ' \u2714' : ' \u26A0';

  return {
    dataSource,
    dataSourceLabel: dataSource === 'api' ? 'Live' : 'Manual',
    subtitle,
    lastFetchedLabel,
    allowance: pacing.dailyAllowance.toFixed(2),
    cardDetail,
    totalUsageStr: fmtN(totalUsage),
    limit,
    pacingClass,
    usagePercentStr: usagePercent.toFixed(1),
    targetText: `Target for today: ${fmtN(target)} (${(recommendedPct * 100).toFixed(1)}% of month)`,
    pacingBadgeText: `Pacing: ${pacingPercent.toFixed(1)}%`,
    remainingStr: fmtN(pacing.remaining),
    remainingDetail: `${pacing.daysRemaining} days left \u00b7 Day ${pacing.dayOfMonth}/${pacing.daysInMonth}`,
    baseRate: `${pacing.baseDailyBudget.toFixed(2)}/day`,
    pastAvg: `${pacing.avgDailyUsage.toFixed(2)}/day`,
    todayAllowance: `${pacing.dailyAllowance.toFixed(2)}/day`,
    multiplier: `${pacing.multiplier.toFixed(2)}x`,
    dailyUsage: dailyUsage !== undefined ? fmtN(dailyUsage) : null,
    banked: { text: bankedText, className: bankedClass },
    projected: `~${pacing.projectedEnd.toFixed(1)} / ${limit}${projectedCheck}`,
    progress: `Day ${pacing.dayOfMonth}/${pacing.daysInMonth} \u00b7 ${pacing.daysRemaining} left`,
    timeOfDay: `${(pacing.timeOfDayProgress * 100).toFixed(1)}%`,
    overage: pacing.overageCost > 0
      ? `${pacing.overageRequests} reqs ($${pacing.overageCost.toFixed(2)})`
      : null,
    billedTotal: billedTotal > 0 ? `$${billedTotal.toFixed(2)}` : null,
  };
}

export function getWebviewHtml(
  data: UsageData,
  webview: vscode.Webview,
  nonce: string,
  extensionUri?: vscode.Uri,
  now: Date = new Date(),
): string {
  const vm = buildDashboardViewModel(data, now);
  // extensionUri is optional so unit tests can render the HTML without a real
  // extension host. When absent, the stylesheet link is omitted — callers in
  // production always pass a real Uri via webviewProvider.
  const stylesheetUri = extensionUri
    ? webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'dashboard.css'))
    : undefined;
  const stylesheetLink = stylesheetUri ? `<link rel="stylesheet" href="${stylesheetUri}">` : '';

  // Embed the view-model so the client can bootstrap from the same payload
  // shape it receives on updates. The initial markup is also pre-rendered so
  // there's no flash on first open.
  const bootstrapJson = JSON.stringify(vm).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <title>Premium Request Analytics</title>
  ${stylesheetLink}
</head>
<body>
  <div class="header">
    <div class="header-left">
      <h1>Premium request analytics</h1>
      <p class="subtitle" id="subtitleText">${escapeHtml(vm.subtitle)}</p>
    </div>
    <div class="header-right">
      <div class="data-source">
        <span class="source-badge ${vm.dataSource}" id="sourceBadge">${vm.dataSourceLabel}</span>
        <br><span style="font-size: 10px;">Last: <span id="lastFetchedLabel">${escapeHtml(vm.lastFetchedLabel)}</span></span>
      </div>
      <button class="btn btn-primary" id="refreshBtn" title="Fetch latest data from GitHub API">Refresh</button>
    </div>
  </div>

  <div class="cards">
    <div class="card">
      <div class="card-label">Daily Allowance</div>
      <div class="card-value"><span id="allowanceValue">${vm.allowance}</span><span style="font-size: 1rem; font-weight: 400; color: var(--vscode-descriptionForeground);"> /day</span></div>
      <div class="card-detail" id="allowanceDetail">${escapeHtml(vm.cardDetail)}</div>
    </div>
    <div class="card">
      <div class="card-label">Included premium requests consumed</div>
      <div class="card-value small">
        <span id="totalUsageValue">${vm.totalUsageStr}</span>
        <span style="font-size: 1rem; font-weight: 400; color: var(--vscode-descriptionForeground);">of
          <span class="limit-edit">
            <input type="number" id="limitInput" value="${vm.limit}" min="1" max="100000" step="1" title="Edit monthly limit" />
          </span>
          included
        </span>
      </div>
      <div class="progress-container">
        <div class="progress-bar-bg">
          <div class="progress-bar-fill ${vm.pacingClass}" id="progressBarFill" style="width: ${vm.usagePercentStr}%;"></div>
        </div>
        <div class="progress-meta">
          <span id="targetText">${escapeHtml(vm.targetText)}</span>
          <span class="pacing-badge ${vm.pacingClass}" id="pacingBadge">${escapeHtml(vm.pacingBadgeText)}</span>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-label">Remaining</div>
      <div class="card-value small" id="remainingValue">${vm.remainingStr}</div>
      <div class="card-detail" id="remainingDetail">${escapeHtml(vm.remainingDetail)}</div>
    </div>
  </div>

  <div class="daily-budget">
    <div class="budget-card">
      <h2>Daily rates</h2>
      <div class="budget-stat">
        <span class="budget-stat-label">Base rate</span>
        <span class="budget-stat-value" id="baseRateVal">${vm.baseRate}</span>
      </div>
      <div class="budget-stat">
        <span class="budget-stat-label">Past average</span>
        <span class="budget-stat-value" id="pastAvgVal">${vm.pastAvg}</span>
      </div>
      <div class="budget-stat">
        <span class="budget-stat-label">Today's allowance</span>
        <span class="budget-stat-value" id="todayAllowanceVal">${vm.todayAllowance}</span>
      </div>
      <div class="budget-stat">
        <span class="budget-stat-label">Multiplier</span>
        <span class="budget-stat-value" id="multiplierVal">${vm.multiplier}</span>
      </div>
      <div class="budget-stat" id="dailyUsageRow" style="${vm.dailyUsage === null ? 'display:none' : ''}">
        <span class="budget-stat-label">Today's usage (API)</span>
        <span class="budget-stat-value" id="dailyUsageVal">${vm.dailyUsage ?? ''}</span>
      </div>
    </div>
    <div class="budget-card">
      <h2>Forecast</h2>
      <div class="budget-stat">
        <span class="budget-stat-label">Banked vs expected</span>
        <span class="budget-stat-value ${vm.banked.className}" id="bankedVal">${escapeHtml(vm.banked.text)}</span>
      </div>
      <div class="budget-stat">
        <span class="budget-stat-label">Projected month end</span>
        <span class="budget-stat-value" id="projectedVal">${vm.projected}</span>
      </div>
      <div class="budget-stat">
        <span class="budget-stat-label">Progress</span>
        <span class="budget-stat-value" id="progressVal">${escapeHtml(vm.progress)}</span>
      </div>
      <div class="budget-stat">
        <span class="budget-stat-label">Time of day</span>
        <span class="budget-stat-value" id="timeOfDayVal">${vm.timeOfDay}</span>
      </div>
      <div class="budget-stat" id="overageRow" style="${vm.overage === null ? 'display:none' : ''}">
        <span class="budget-stat-label">Overage</span>
        <span class="budget-stat-value danger" id="overageVal">${vm.overage ?? ''}</span>
      </div>
      <div class="budget-stat" id="billedTotalRow" style="${vm.billedTotal === null ? 'display:none' : ''}">
        <span class="budget-stat-label">Billed total</span>
        <span class="budget-stat-value" id="billedTotalVal">${vm.billedTotal ?? ''}</span>
      </div>
    </div>
  </div>

  ${buildBillingSummarySection()}

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const INITIAL_VM = ${bootstrapJson};

    const refreshBtn = document.getElementById('refreshBtn');
    refreshBtn.addEventListener('click', () => {
      refreshBtn.disabled = true;
      refreshBtn.textContent = 'Refreshing...';
      vscode.postMessage({ type: 'refresh' });
    });

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

    // --- View-model patching (no full HTML rebuild; see CODE_REVIEW H3) ---
    function setText(id, text) {
      const el = document.getElementById(id);
      if (el && el.textContent !== text) { el.textContent = text; }
    }
    function setClass(id, base, modifier) {
      const el = document.getElementById(id);
      if (!el) { return; }
      el.className = base + ' ' + modifier;
    }
    function setRow(id, shouldShow, textId, text) {
      const row = document.getElementById(id);
      if (!row) { return; }
      row.style.display = shouldShow ? '' : 'none';
      if (shouldShow && textId) { setText(textId, text); }
    }
    function patchViewModel(vm) {
      setText('subtitleText', vm.subtitle);
      setText('lastFetchedLabel', vm.lastFetchedLabel);
      const badge = document.getElementById('sourceBadge');
      if (badge) {
        badge.className = 'source-badge ' + vm.dataSource;
        badge.textContent = vm.dataSourceLabel;
      }
      setText('allowanceValue', vm.allowance);
      setText('allowanceDetail', vm.cardDetail);
      setText('totalUsageValue', vm.totalUsageStr);
      if (document.activeElement !== limitInput) {
        if (String(vm.limit) !== limitInput.value) { limitInput.value = String(vm.limit); }
      }
      const fill = document.getElementById('progressBarFill');
      if (fill) {
        fill.className = 'progress-bar-fill ' + vm.pacingClass;
        fill.style.width = vm.usagePercentStr + '%';
      }
      setText('targetText', vm.targetText);
      setClass('pacingBadge', 'pacing-badge', vm.pacingClass);
      setText('pacingBadge', vm.pacingBadgeText);
      setText('remainingValue', vm.remainingStr);
      setText('remainingDetail', vm.remainingDetail);
      setText('baseRateVal', vm.baseRate);
      setText('pastAvgVal', vm.pastAvg);
      setText('todayAllowanceVal', vm.todayAllowance);
      setText('multiplierVal', vm.multiplier);
      setRow('dailyUsageRow', vm.dailyUsage !== null, 'dailyUsageVal', vm.dailyUsage || '');
      setClass('bankedVal', 'budget-stat-value', vm.banked.className);
      setText('bankedVal', vm.banked.text);
      setText('projectedVal', vm.projected);
      setText('progressVal', vm.progress);
      setText('timeOfDayVal', vm.timeOfDay);
      setRow('overageRow', vm.overage !== null, 'overageVal', vm.overage || '');
      setRow('billedTotalRow', vm.billedTotal !== null, 'billedTotalVal', vm.billedTotal || '');
      refreshBtn.disabled = false;
      refreshBtn.textContent = 'Refresh';
    }

    const billingTableBody = document.getElementById('billingTableBody');
    const billingTotalRow = document.getElementById('billingTotalRow');
    const billingTable = document.getElementById('billingTable');
    const billingLoading = document.getElementById('billingLoading');
    const billingError = document.getElementById('billingError');
    const billingEmptyState = document.getElementById('billingEmptyState');
    const tokenGuide = document.getElementById('tokenGuide');
    const tokenGuideTitle = document.getElementById('tokenGuideTitle');
    const tokenGuideSubtitle = document.getElementById('tokenGuideSubtitle');

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

    function addCell(row, text, cls) {
      var td = document.createElement('td');
      if (cls) { td.className = cls; }
      td.textContent = text;
      row.appendChild(td);
    }
    function fmtNum(n) { return n % 1 === 0 ? n.toFixed(0) : n.toFixed(2); }
    function fmtCur(n) { return '$' + n.toFixed(2); }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'updateData') {
        patchViewModel(msg.viewModel);
        return;
      }
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

    void INITIAL_VM;
  </script>
</body>
</html>`;
}

function buildBillingSummarySection(): string {
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
