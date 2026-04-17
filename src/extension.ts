import * as vscode from 'vscode';
import { DataService, UsageModel } from './dataService';
import { TokenExpiredError, RateLimitError } from './api';
import { createStatusBarItem, updateStatusBar, initStatusBarMode } from './statusBar';
import { showDashboard, disposeDashboard, setMessageHandler, hasDashboard, postMessageToWebview } from './webview/webviewProvider';

// Module-level singletons for the refresh scheduler. Acceptable for an
// extension's single-activation lifetime; encapsulating in a RefreshScheduler
// class would improve unit-testability. See CODE_REVIEW L1.
let statusBarItem: vscode.StatusBarItem;
let dataService: DataService;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let rateLimitedUntil = 0;
let consecutiveFailures = 0;
let disposed = false;

const GITHUB_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new?name=Copilot+Tracker&description=Used+by+the+Copilot+Premium+Tracker+VS+Code+extension+to+read+billing+data&expires_in=90&plan=read';
const BASE_REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 60 minutes
// Hard floor to prevent tight-loop scheduling if timers fire early (clock jumps,
// wake-from-sleep, Retry-After edge cases). See CODE_REVIEW C4/C5.
const MIN_REFRESH_DELAY_MS = 30 * 1000; // 30 seconds

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  dataService = new DataService(context.globalState, context.secrets);
  statusBarItem = createStatusBarItem();

  // Read status-bar mode from config before first render.
  initStatusBarMode();

  // Show status bar immediately with cached/default data
  refreshUI();

  // Initial fetch from API (silent, no prompt) — non-blocking
  refreshFromApi(false).catch(() => {});

  // Adaptive auto-refresh timer (backs off on persistent failures)
  scheduleNextRefresh();

  const showCmd = vscode.commands.registerCommand(
    'copilot-premium-tracker.showDashboard',
    () => refreshDashboard(context),
  );

  const refreshCmd = vscode.commands.registerCommand(
    'copilot-premium-tracker.refresh',
    async () => {
      dataService.forceRefresh();
      consecutiveFailures = 0;
      await refreshFromApi(true);
      scheduleNextRefresh();
      if (hasDashboard()) {
        refreshDashboard(context);
      }
    },
  );

  const addModelCmd = vscode.commands.registerCommand(
    'copilot-premium-tracker.addModel',
    () => promptAddModel(context),
  );

  const setLimitCmd = vscode.commands.registerCommand(
    'copilot-premium-tracker.setLimit',
    () => promptSetLimit(context),
  );

  const resetCmd = vscode.commands.registerCommand(
    'copilot-premium-tracker.resetData',
    async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Reset all usage data?',
        { modal: true },
        'Reset',
      );
      if (confirm === 'Reset') {
        await dataService.resetData();
        refreshUI();
        refreshDashboard(context);
      }
    },
  );

  const setBillingTokenCmd = vscode.commands.registerCommand(
    'copilot-premium-tracker.setBillingToken',
    async () => {
      const token = await vscode.window.showInputBox({
        prompt: 'Enter a fine-grained PAT with the "Plan" account permission (read)',
        placeHolder: 'github_pat_...',
        password: true,
        ignoreFocusOut: true,
      });
      if (token) {
        await dataService.setBillingToken(token);
        vscode.window.showInformationMessage('Copilot Tracker: Billing token saved. Refreshing...');
        dataService.forceRefresh();
        await refreshFromApi(true);
        if (hasDashboard()) { refreshDashboard(context); }
      }
    },
  );

  const clearBillingTokenCmd = vscode.commands.registerCommand(
    'copilot-premium-tracker.clearBillingToken',
    async () => {
      await dataService.clearBillingToken();
      vscode.window.showInformationMessage('Copilot Tracker: Billing token cleared.');
    },
  );

  context.subscriptions.push(
    statusBarItem, showCmd, refreshCmd, addModelCmd, setLimitCmd, resetCmd,
    setBillingTokenCmd, clearBillingTokenCmd,
    { dispose: () => { disposed = true; disposeDashboard(); if (refreshTimer) { clearTimeout(refreshTimer); } } },
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('copilot-premium-tracker.statusBarMode')) {
        initStatusBarMode();
        refreshUI();
      }
      if (e.affectsConfiguration('copilot-premium-tracker')) {
        // Any config change is a good time to drop backoff state so the user
        // isn't surprised by stale rate-limit/backoff after changing settings.
        // See PERFORMANCE_REVIEW L3.
        consecutiveFailures = 0;
        rateLimitedUntil = 0;
      }
    }),
  );
}

async function refreshFromApi(interactive: boolean): Promise<void> {
  // Skip if still rate-limited (unless user explicitly asked)
  if (!interactive && Date.now() < rateLimitedUntil) { return; }

  try {
    await dataService.fetchFromApi(interactive);
    // Reset backoff on success
    consecutiveFailures = 0;
  } catch (e) {
    if (e instanceof TokenExpiredError) {
      // Auth errors don't benefit from faster retry; don't bump the backoff
      // counter — the user must act. See CODE_REVIEW M4.
      vscode.window.showWarningMessage(
        'Copilot Tracker: GitHub token expired. Click Refresh to sign in again.',
      );
    } else if (e instanceof RateLimitError) {
      consecutiveFailures++;
      rateLimitedUntil = Date.now() + e.retryAfter * 1000;
      if (interactive) {
        vscode.window.showWarningMessage(
          `Copilot Tracker: Rate limited. Retrying in ${e.retryAfter}s.`,
        );
      }
    } else {
      // Transient network / 5xx errors: soft bump capped at 1 so a poor-wifi
      // session can't push us into hour-long backoff. See CODE_REVIEW M4.
      consecutiveFailures = Math.max(consecutiveFailures, 1);
      if (interactive) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Copilot Tracker: ${msg}`);
      }
    }
  }

  // Guide user when no token is available
  if (dataService.shouldShowNoTokenNotice() && interactive) {
    const choice = await vscode.window.showWarningMessage(
      'Copilot Tracker: No GitHub token found. Sign in to GitHub or create a fine-grained token with the "Plan" permission.',
      'Sign In',
      'Create Token',
      'Set Token',
    );
    if (choice === 'Sign In') {
      // Direct fetch — no recursion into refreshFromApi to avoid re-entering prompt logic
      dataService.forceRefresh();
      try {
        await dataService.fetchFromApi(true);
      } catch {
        // Error will surface on next interactive refresh
      }
    } else if (choice === 'Create Token') {
      await vscode.env.openExternal(vscode.Uri.parse(GITHUB_TOKEN_URL));
    } else if (choice === 'Set Token') {
      await vscode.commands.executeCommand('copilot-premium-tracker.setBillingToken');
    }
  }

  // Guide user when billing token is needed (404 on billing endpoints).
  // Guarded by `interactive` so background timers never pop modal notices.
  if (interactive && dataService.shouldShowBillingTokenNotice()) {
    const choice = await vscode.window.showInformationMessage(
      'Copilot Tracker: Billing data requires a fine-grained GitHub token with the "Plan" permission (read-only).',
      'Create Token',
      'Set Token',
    );
    if (choice === 'Create Token') {
      await vscode.env.openExternal(vscode.Uri.parse(GITHUB_TOKEN_URL));
    } else if (choice === 'Set Token') {
      await vscode.commands.executeCommand('copilot-premium-tracker.setBillingToken');
    }
  }

  refreshUI();
}

function getNextRefreshDelay(): number {
  return computeNextRefreshDelay(Date.now(), rateLimitedUntil, consecutiveFailures);
}

/**
 * Pure helper: given the current wall-clock time, the rate-limit deadline,
 * and the consecutive-failure count, compute the next refresh delay.
 *
 * Exported for regression tests (CODE_REVIEW L4):
 *  - A clock jump that leaves `now >= rateLimitedUntil` must still return at
 *    least `MIN_REFRESH_DELAY_MS` (no tight-loop).
 *  - A negative remainder must not underflow into a sub-ms `setTimeout`.
 */
export function computeNextRefreshDelay(
  now: number,
  rateLimitedUntilMs: number,
  failures: number,
  baseMs: number = BASE_REFRESH_INTERVAL_MS,
  maxMs: number = MAX_REFRESH_INTERVAL_MS,
  minMs: number = MIN_REFRESH_DELAY_MS,
): number {
  if (now < rateLimitedUntilMs) {
    return Math.max(minMs, rateLimitedUntilMs - now);
  }
  if (failures === 0) { return baseMs; }
  const backoff = baseMs * Math.pow(2, failures);
  return Math.min(Math.max(backoff, minMs), maxMs);
}

function scheduleNextRefresh(): void {
  if (disposed) { return; }
  if (refreshTimer) { clearTimeout(refreshTimer); }
  refreshTimer = setTimeout(async () => {
    if (disposed) { return; }
    await refreshFromApi(false);
    scheduleNextRefresh();
  }, getNextRefreshDelay());
}

const ALLOWED_WEBVIEW_COMMANDS = new Set([
  'copilot-premium-tracker.setBillingToken',
  'copilot-premium-tracker.clearBillingToken',
  'copilot-premium-tracker.refresh',
  'copilot-premium-tracker.showDashboard',
  'copilot-premium-tracker.addModel',
  'copilot-premium-tracker.setLimit',
  'copilot-premium-tracker.resetData',
]);

async function openExternalSafe(url: string): Promise<void> {
  if (!url) { return; }
  try {
    const parsed = vscode.Uri.parse(url);
    if (parsed.scheme === 'https') {
      await vscode.env.openExternal(parsed);
    }
  } catch {
    // ignore errors opening external links
  }
}

async function handleWebviewMessage(
  msg: { type: string; [key: string]: unknown },
  context: vscode.ExtensionContext,
): Promise<void> {
  switch (msg.type) {
    case 'refresh': {
      dataService.forceRefresh();
      consecutiveFailures = 0;
      await refreshFromApi(true);
      scheduleNextRefresh();
      refreshDashboard(context);
      break;
    }
    case 'addModel':
    case 'editModel': {
      const model = msg.model as UsageModel;
      if (model?.model) {
        await dataService.addModel(model);
        refreshUI();
        refreshDashboard(context);
      }
      break;
    }
    case 'removeModel': {
      const name = msg.modelName as string;
      if (name) {
        await dataService.removeModel(name);
        refreshUI();
        refreshDashboard(context);
      }
      break;
    }
    case 'setLimit': {
      const limit = Number(msg.limit);
      if (limit > 0 && Number.isFinite(limit)) {
        await dataService.setLimit(limit);
        refreshUI();
        refreshDashboard(context);
      }
      break;
    }
    case 'openExternal': {
      await openExternalSafe(msg.url as string);
      break;
    }
    case 'openExternalThenSetToken': {
      await openExternalSafe(msg.url as string);
      // Immediately prompt for the token so it's waiting when the user comes back
      await vscode.commands.executeCommand('copilot-premium-tracker.setBillingToken');
      break;
    }
    case 'runCommand': {
      const cmd = msg.command as string;
      if (cmd && ALLOWED_WEBVIEW_COMMANDS.has(cmd)) {
        await vscode.commands.executeCommand(cmd);
      }
      break;
    }
  }
}

async function promptAddModel(context: vscode.ExtensionContext): Promise<void> {
  const name = await vscode.window.showInputBox({ prompt: 'Model name', placeHolder: 'e.g. Claude Sonnet 4' });
  if (!name) { return; }
  const included = await vscode.window.showInputBox({ prompt: 'Included requests', placeHolder: '0', validateInput: v => v.trim() === '' || !Number.isFinite(Number(v)) || Number(v) < 0 ? 'Must be a non-negative number' : undefined });
  if (included === undefined) { return; }
  const billed = await vscode.window.showInputBox({ prompt: 'Billed requests', placeHolder: '0', validateInput: v => v.trim() === '' || !Number.isFinite(Number(v)) || Number(v) < 0 ? 'Must be a non-negative number' : undefined });
  if (billed === undefined) { return; }
  const billedAmt = await vscode.window.showInputBox({ prompt: 'Billed amount ($)', placeHolder: '0', validateInput: v => v.trim() === '' || !Number.isFinite(Number(v)) || Number(v) < 0 ? 'Must be a non-negative number' : undefined });
  if (billedAmt === undefined) { return; }

  await dataService.addModel({
    model: name,
    includedRequests: Number(included) || 0,
    billedRequests: Number(billed) || 0,
    grossAmount: 0, // auto-calculated by addModel()
    billedAmount: Number(billedAmt) || 0,
  });
  refreshUI();
  refreshDashboard(context);
}

async function promptSetLimit(context: vscode.ExtensionContext): Promise<void> {
  const current = dataService.getLimit();
  const value = await vscode.window.showInputBox({
    prompt: 'Monthly included premium requests limit',
    value: String(current),
    validateInput: v => (Number(v) <= 0 || !Number.isFinite(Number(v))) ? 'Must be a positive number' : undefined,
  });
  if (value === undefined) { return; }
  await dataService.setLimit(Number(value));
  refreshUI();
  refreshDashboard(context);
}

function refreshUI(): void {
  const data = dataService.getUsageData();
  // Share one wall-clock reading across status-bar + dashboard renders
  // to avoid millisecond drift (PERFORMANCE_REVIEW L2).
  const now = new Date();
  updateStatusBar(statusBarItem, data, now);
}

function refreshDashboard(context: vscode.ExtensionContext): void {
  const now = new Date();
  showDashboard(dataService.getUsageData(), context.extensionUri, now);
  setMessageHandler(async (msg) => handleWebviewMessage(msg, context));
  // Auto-send cached premium billing data so model names are detailed on load
  sendCachedBillingToWebview();
  // Ensure daily billing is fetched so "Today's usage" renders
  ensureDailyBilling(context);
}

function ensureDailyBilling(context: vscode.ExtensionContext): void {
  const cached = dataService.getCachedDailyBilling();
  if (cached.length > 0) { return; } // Already have data
  // Fetch daily billing and re-render dashboard with updated dailyUsage
  dataService.fetchDailyBilling(false)
    .then(() => {
      if (hasDashboard()) {
        showDashboard(dataService.getUsageData(), context.extensionUri);
        setMessageHandler(async (msg) => handleWebviewMessage(msg, context));
      }
      refreshUI();
    })
    .catch(() => {}); // Non-critical — dashboard still works without daily usage
}

function sendCachedBillingToWebview(): void {
  const tokenNeeded = dataService.isBillingTokenNeeded();
  const noToken = dataService.isNoTokenAvailable();
  const cached = dataService.getCachedPremiumBilling();

  if (noToken) {
    postMessageToWebview({
      type: 'billingRangeResult',
      items: [],
      error: 'No GitHub token is set. Add a fine-grained token to load billing data.',
      tokenNeeded: true,
      noToken: true,
    });
    return;
  }

  if (cached.length > 0) {
    postMessageToWebview({ type: 'billingRangeResult', items: cached });
  } else if (tokenNeeded) {
    // Token is already known to be insufficient — send error immediately, don't fetch
    postMessageToWebview({
      type: 'billingRangeResult',
      items: [],
      error: 'Billing API requires a fine-grained token with the "Plan" permission.',
      tokenNeeded: true,
    });
  } else {
    // No cache yet — trigger a fetch and send when ready
    dataService.fetchBillingRange(false)
      .then((items) => postMessageToWebview({ type: 'billingRangeResult', items }))
      .catch((err) => {
        const msg = err instanceof Error ? err.message : 'Failed to load billing data';
        postMessageToWebview({
          type: 'billingRangeResult',
          items: [],
          error: msg,
          tokenNeeded: dataService.isBillingTokenNeeded() || msg.includes('No token available'),
          noToken: msg.includes('No token available'),
        });
      });
  }
}

export function deactivate(): void {
  // Cleanup handled by disposables
}
