import * as vscode from 'vscode';
import { ManualDataService, UsageModel } from './dataService';
import { createStatusBarItem, updateStatusBar } from './statusBar';
import { showDashboard, disposeDashboard, setMessageHandler } from './webview/webviewProvider';

let statusBarItem: vscode.StatusBarItem;
let dataService: ManualDataService;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  dataService = new ManualDataService(context.globalState);
  statusBarItem = createStatusBarItem();

  refreshUI();

  const showCmd = vscode.commands.registerCommand(
    'copilot-premium-tracker.showDashboard',
    () => {
      showDashboard(dataService.getUsageData(), context.extensionUri);
      setMessageHandler(async (msg) => handleWebviewMessage(msg, context));
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

  context.subscriptions.push(statusBarItem, showCmd, addModelCmd, setLimitCmd, resetCmd, {
    dispose: () => disposeDashboard(),
  });
}

async function handleWebviewMessage(
  msg: { type: string; [key: string]: unknown },
  context: vscode.ExtensionContext,
): Promise<void> {
  switch (msg.type) {
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
