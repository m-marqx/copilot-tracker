import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { UsageData } from '../dataService';
import { buildDashboardViewModel, getWebviewHtml } from './webviewContent';

let currentPanel: vscode.WebviewPanel | undefined;
let currentExtensionUri: vscode.Uri | undefined;
let messageHandler: ((msg: { type: string; [key: string]: unknown }) => Promise<void>) | undefined;

export function setMessageHandler(
  handler: (msg: { type: string; [key: string]: unknown }) => Promise<void>,
): void {
  messageHandler = handler;
}

export function showDashboard(
  data: UsageData,
  extensionUri: vscode.Uri,
  now: Date = new Date(),
): void {
  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.One);
    // Panel already open â€” prefer the lightweight message-patching path over
    // rebuilding the full HTML string (PERFORMANCE_REVIEW M1 / CODE_REVIEW H3).
    updateDashboardData(data, now);
    return;
  }

  currentExtensionUri = extensionUri;

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
  currentPanel.webview.html = buildHtml(data, currentPanel.webview, extensionUri, now);

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
    currentExtensionUri = undefined;
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

/**
 * Push an incremental `updateData` message carrying a pre-computed view-model.
 * Cheap compared to rebuilding the full HTML and preserves form focus / CSS
 * transitions. Silently no-ops if the panel has been disposed.
 */
export function updateDashboardData(data: UsageData, now: Date = new Date()): void {
  if (!currentPanel) { return; }
  const viewModel = buildDashboardViewModel(data, now);
  currentPanel.webview.postMessage({ type: 'updateData', viewModel });
}

export function disposeDashboard(): void {
  if (currentPanel) {
    currentPanel.dispose();
    currentPanel = undefined;
    currentExtensionUri = undefined;
    messageHandler = undefined;
  }
}

function buildHtml(
  data: UsageData,
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  now: Date,
): string {
  const nonce = getNonce();
  return getWebviewHtml(data, webview, nonce, extensionUri, now);
}

function getNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function getActiveExtensionUri(): vscode.Uri | undefined {
  return currentExtensionUri;
}
