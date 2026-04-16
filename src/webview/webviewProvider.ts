import * as vscode from 'vscode';
import * as crypto from 'crypto';
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
    currentPanel.webview.html = buildHtml(data, currentPanel.webview);
    return;
  }

  currentPanel = vscode.window.createWebviewPanel(
    'copilotPremiumDashboard',
    'Premium Request Analytics',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      localResourceRoots: [extensionUri],
    }
  );

  currentPanel.iconPath = new vscode.ThemeIcon('copilot');
  currentPanel.webview.html = buildHtml(data, currentPanel.webview);

  currentPanel.webview.onDidReceiveMessage(async (msg) => {
    if (messageHandler) {
      try {
        await messageHandler(msg);
      } catch {
        // Errors handled by the message handler's caller
      }
    }
  });

  currentPanel.onDidDispose(() => {
    currentPanel = undefined;
    messageHandler = undefined;
  });
}

export function hasDashboard(): boolean {
  return currentPanel !== undefined;
}

export function postMessageToWebview(message: unknown): void {
  if (currentPanel) {
    currentPanel.webview.postMessage(message);
  }
}

export function disposeDashboard(): void {
  if (currentPanel) {
    currentPanel.dispose();
    currentPanel = undefined;
    messageHandler = undefined;
  }
}

function buildHtml(data: UsageData, webview: vscode.Webview): string {
  const nonce = getNonce();
  return getWebviewHtml(data, webview, nonce);
}

function getNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}
