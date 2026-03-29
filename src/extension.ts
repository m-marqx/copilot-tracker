import * as vscode from 'vscode';
import { DataService, UsageModel } from './dataService';
import { TokenExpiredError, RateLimitError } from './api';
import { createStatusBarItem, updateStatusBar } from './statusBar';
import { showDashboard, disposeDashboard, setMessageHandler } from './webview/webviewProvider';

let statusBarItem: vscode.StatusBarItem;
let dataService: DataService;
let refreshTimer: ReturnType<typeof setInterval> | undefined;

const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  dataService = new DataService(context.globalState);
  statusBarItem = createStatusBarItem();

  // Initial fetch from API (silent, no prompt)
  await refreshFromApi(false);

  // Auto-refresh timer
  refreshTimer = setInterval(() => refreshFromApi(false), REFRESH_INTERVAL_MS);

  const showCmd = vscode.commands.registerCommand(
    'copilot-premium-tracker.showDashboard',
    () => {
      showDashboard(dataService.getUsageData(), context.extensionUri);
      setMessageHandler(async (msg) => handleWebviewMessage(msg, context));
    },
  );

  const refreshCmd = vscode.commands.registerCommand(
    'copilot-premium-tracker.refresh',
    async () => {
      dataService.clearCache();
      await refreshFromApi(true);
      refreshDashboard(context);
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

  context.subscriptions.push(
    statusBarItem, showCmd, refreshCmd, addModelCmd, setLimitCmd, resetCmd,
    { dispose: () => { disposeDashboard(); if (refreshTimer) { clearInterval(refreshTimer); } } },
  );
}

async function refreshFromApi(interactive: boolean): Promise<void> {
  try {
    await dataService.fetchFromApi(interactive);
  } catch (e) {
    if (e instanceof TokenExpiredError) {
      vscode.window.showWarningMessage(
        'Copilot Tracker: GitHub token expired. Click Refresh to sign in again.',
      );
    } else if (e instanceof RateLimitError) {
      // Silently wait for rate limit to expire
    } else if (interactive) {
      const msg = e instanceof Error ? e.message : String(e);
      vscode.window.showErrorMessage(`Copilot Tracker: ${msg}`);
    }
  }
  refreshUI();
}

async function handleWebviewMessage(
  msg: { type: string; [key: string]: unknown },
  context: vscode.ExtensionContext,
): Promise<void> {
  switch (msg.type) {
    case 'refresh': {
      dataService.clearCache();
      await refreshFromApi(true);
      refreshDashboard(context);
      break;
    }
    case 'addModel': {
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
      if (limit > 0) {
        await dataService.setLimit(limit);
        refreshUI();
        refreshDashboard(context);
      }
      break;
    }
    case 'editModel': {
      const model = msg.model as UsageModel;
      if (model?.model) {
        await dataService.addModel(model);
        refreshUI();
        refreshDashboard(context);
      }
      break;
    }
  }
}

async function promptAddModel(context: vscode.ExtensionContext): Promise<void> {
  const name = await vscode.window.showInputBox({ prompt: 'Model name', placeHolder: 'e.g. Claude Sonnet 4' });
  if (!name) { return; }
  const included = await vscode.window.showInputBox({ prompt: 'Included requests', placeHolder: '0', validateInput: v => isNaN(Number(v)) ? 'Must be a number' : undefined });
  if (included === undefined) { return; }
  const billed = await vscode.window.showInputBox({ prompt: 'Billed requests', placeHolder: '0', validateInput: v => isNaN(Number(v)) ? 'Must be a number' : undefined });
  if (billed === undefined) { return; }
  const gross = await vscode.window.showInputBox({ prompt: 'Gross amount ($)', placeHolder: '0', validateInput: v => isNaN(Number(v)) ? 'Must be a number' : undefined });
  if (gross === undefined) { return; }
  const billedAmt = await vscode.window.showInputBox({ prompt: 'Billed amount ($)', placeHolder: '0', validateInput: v => isNaN(Number(v)) ? 'Must be a number' : undefined });
  if (billedAmt === undefined) { return; }

  await dataService.addModel({
    model: name,
    includedRequests: Number(included) || 0,
    billedRequests: Number(billed) || 0,
    grossAmount: Number(gross) || 0,
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
    validateInput: v => (isNaN(Number(v)) || Number(v) <= 0) ? 'Must be a positive number' : undefined,
  });
  if (value === undefined) { return; }
  await dataService.setLimit(Number(value));
  refreshUI();
  refreshDashboard(context);
}

function refreshUI(): void {
  const data = dataService.getUsageData();
  updateStatusBar(statusBarItem, data);
}

function refreshDashboard(context: vscode.ExtensionContext): void {
  showDashboard(dataService.getUsageData(), context.extensionUri);
  setMessageHandler(async (msg) => handleWebviewMessage(msg, context));
}

export function deactivate(): void {
  // Cleanup handled by disposables
}
