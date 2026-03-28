import * as vscode from 'vscode';
import { UsageData } from '../dataService';
import { getWebviewHtml } from './webviewContent';

let currentPanel: vscode.WebviewPanel | undefined;
let messageHandler: ((msg: { type: string; [key: string]: unknown }) => Promise<void>) | undefined;

export function setMessageHandler(
  handler: (msg: { type: string; [key: string]: unknown }) => Promise<void>,
): void {
  messageHandler = handler;
}

export function showDashboard(
  data: UsageData,
  extensionUri: vscode.Uri
): void {
  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.One);
    currentPanel.webview.html = buildHtml(data, currentPanel.webview, extensionUri);
    return;
  }

  currentPanel = vscode.window.createWebviewPanel(
    'copilotPremiumDashboard',
    'Premium Request Analytics',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      localResourceRoots: [extensionUri],
      retainContextWhenHidden: true,
    }
  );

  currentPanel.iconPath = new vscode.ThemeIcon('copilot');
  currentPanel.webview.html = buildHtml(data, currentPanel.webview, extensionUri);

  currentPanel.webview.onDidReceiveMessage(async (msg) => {
    if (messageHandler) {
      await messageHandler(msg);
    }
  });

  currentPanel.onDidDispose(() => {
    currentPanel = undefined;
    messageHandler = undefined;
  });
}

export function disposeDashboard(): void {
  if (currentPanel) {
    currentPanel.dispose();
    currentPanel = undefined;
    messageHandler = undefined;
  }
}

function buildHtml(data: UsageData, webview: vscode.Webview, _extensionUri: vscode.Uri): string {
  const nonce = getNonce();
  return getWebviewHtml(data, webview, nonce);
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
