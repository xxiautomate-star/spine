import * as vscode from 'vscode';
import * as path from 'path';
import { isConfigured, getApiKey } from './config';
import { capture, search, ping, SpineClientError } from './spine-client';

// ── Status bar ────────────────────────────────────────────────────────────────

let statusBarItem: vscode.StatusBarItem;
let connectionState: 'checking' | 'connected' | 'disconnected' | 'no-key' = 'no-key';

function updateStatusBar(): void {
  if (!vscode.workspace.getConfiguration('spine').get<boolean>('showStatusBar', true)) {
    statusBarItem.hide();
    return;
  }
  switch (connectionState) {
    case 'connected':
      statusBarItem.text = '$(database) Spine';
      statusBarItem.tooltip = 'Spine: connected. Click to search.';
      statusBarItem.backgroundColor = undefined;
      break;
    case 'checking':
      statusBarItem.text = '$(sync~spin) Spine';
      statusBarItem.tooltip = 'Spine: checking connection…';
      break;
    case 'disconnected':
      statusBarItem.text = '$(warning) Spine';
      statusBarItem.tooltip = 'Spine: could not reach API. Check your API key.';
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      break;
    case 'no-key':
      statusBarItem.text = '$(key) Spine';
      statusBarItem.tooltip = 'Spine: no API key. Run "npx @xxi/spine-mcp init" to set up.';
      statusBarItem.backgroundColor = undefined;
      break;
  }
  statusBarItem.show();
}

async function checkConnection(): Promise<void> {
  if (!isConfigured()) {
    connectionState = 'no-key';
    updateStatusBar();
    return;
  }
  connectionState = 'checking';
  updateStatusBar();
  const ok = await ping();
  connectionState = ok ? 'connected' : 'disconnected';
  updateStatusBar();
}

// ── Auto-capture on save ──────────────────────────────────────────────────────

const saveDebounce = new Map<string, NodeJS.Timeout>();

function handleSave(doc: vscode.TextDocument): void {
  const config = vscode.workspace.getConfiguration('spine');
  if (!config.get<boolean>('autoCaptureOnSave', false)) return;
  if (!isConfigured()) return;

  const fsPath = doc.uri.fsPath;

  // Debounce per file: clear previous timer
  const existing = saveDebounce.get(fsPath);
  if (existing) clearTimeout(existing);

  saveDebounce.set(
    fsPath,
    setTimeout(() => {
      saveDebounce.delete(fsPath);
      void doAutoCapture(doc);
    }, 1200)
  );
}

async function doAutoCapture(doc: vscode.TextDocument): Promise<void> {
  const config = vscode.workspace.getConfiguration('spine');
  const minLen = config.get<number>('autoCaptureMinLength', 80);

  const editor = vscode.window.visibleTextEditors.find(
    (e) => e.document.uri.fsPath === doc.uri.fsPath
  );

  let content: string;
  if (editor) {
    // Capture 20 lines around cursor position
    const cursor = editor.selection.active;
    const start = Math.max(0, cursor.line - 20);
    const end = Math.min(doc.lineCount - 1, cursor.line + 10);
    const range = new vscode.Range(start, 0, end, doc.lineAt(end).text.length);
    content = doc.getText(range).trim();
  } else {
    // No visible editor — skip (content could be huge)
    return;
  }

  if (!content || content.length < minLen) return;

  const relative = vscode.workspace.asRelativePath(doc.uri, true);
  const workspaceName = vscode.workspace.name ?? 'workspace';
  const source = `${workspaceName}/${relative}`;
  const tags = [doc.languageId, 'auto-save'];

  try {
    await capture(content.slice(0, 4000), source, tags);
    void vscode.window.setStatusBarMessage(`$(check) Spine: saved context from ${path.basename(doc.fileName)}`, 3000);
  } catch (err) {
    // Silent — don't interrupt save flow
    if (err instanceof SpineClientError && err.status === 402) {
      void vscode.window.showWarningMessage('Spine: memory cap reached. Upgrade to Pro to continue auto-capture.');
    }
  }
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function cmdCaptureSelection(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage('Spine: no active editor.');
    return;
  }
  if (editor.selection.isEmpty) {
    void vscode.window.showWarningMessage('Spine: select some text first.');
    return;
  }
  if (!isConfigured()) {
    void vscode.window.showErrorMessage('Spine: no API key. Run "npx @xxi/spine-mcp init" to set up.');
    return;
  }

  const selected = editor.document.getText(editor.selection).trim();
  if (!selected) {
    void vscode.window.showWarningMessage('Spine: selection is empty.');
    return;
  }

  const relative = vscode.workspace.asRelativePath(editor.document.uri, true);
  const workspaceName = vscode.workspace.name ?? 'workspace';
  const source = `${workspaceName}/${relative}`;
  const tags = [editor.document.languageId];

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Spine: capturing…' },
    async () => {
      try {
        const result = await capture(selected.slice(0, 8000), source, tags);
        void vscode.window.showInformationMessage(
          `Spine: memory stored (${result.id.slice(0, 8)}…)`,
          'Search Spine'
        ).then((action) => {
          if (action === 'Search Spine') void vscode.commands.executeCommand('spine.search');
        });
        connectionState = 'connected';
        updateStatusBar();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        if (err instanceof SpineClientError && err.status === 402) {
          void vscode.window.showWarningMessage('Spine: memory cap reached. Upgrade at spine.xxiautomate.com/billing');
        } else {
          void vscode.window.showErrorMessage(`Spine: ${msg}`);
        }
      }
    }
  );
}

async function cmdAddMemory(): Promise<void> {
  if (!isConfigured()) {
    void vscode.window.showErrorMessage('Spine: no API key. Run "npx @xxi/spine-mcp init" to set up.');
    return;
  }

  const content = await vscode.window.showInputBox({
    prompt: 'What do you want Spine to remember?',
    placeHolder: 'e.g. "We use PostgreSQL 15. No MySQL."',
    ignoreFocusOut: true,
  });
  if (!content || !content.trim()) return;

  const workspaceName = vscode.workspace.name ?? 'workspace';

  try {
    const result = await capture(content.trim(), workspaceName, ['manual']);
    void vscode.window.showInformationMessage(`Spine: stored (${result.id.slice(0, 8)}…)`);
    connectionState = 'connected';
    updateStatusBar();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    void vscode.window.showErrorMessage(`Spine: ${msg}`);
  }
}

async function cmdSearch(): Promise<void> {
  if (!isConfigured()) {
    void vscode.window.showErrorMessage('Spine: no API key. Run "npx @xxi/spine-mcp init" to set up.');
    return;
  }

  const query = await vscode.window.showInputBox({
    prompt: 'Search your memory archive…',
    placeHolder: 'e.g. "auth bug fix", "database schema decision", "that performance issue"',
    ignoreFocusOut: true,
  });
  if (!query || !query.trim()) return;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Spine: searching for "${query.trim()}"…` },
    async () => {
      try {
        const result = await search(query.trim(), 8);
        const memories = result.memories ?? [];

        if (memories.length === 0) {
          void vscode.window.showInformationMessage('Spine: no matching memories found.');
          return;
        }

        // Show results in a quick pick
        type MemItem = vscode.QuickPickItem & { memContent: string };
        const items: MemItem[] = memories.map((m, i) => {
          const ago = timeSince(m.createdAt);
          const preview = m.content.length > 80 ? m.content.slice(0, 80) + '…' : m.content;
          const sim = m.similarity != null ? ` · ${Math.round(m.similarity * 100)}% match` : '';
          return {
            label: `$(search) ${preview}`,
            description: `${ago}${m.source ? ` · ${m.source}` : ''}${sim}`,
            detail: m.content.length > 80 ? m.content.slice(0, 300) : undefined,
            memContent: m.content,
          } as MemItem;
        });

        const separator: vscode.QuickPickItem = {
          label: `${memories.length} memories found for "${query.trim()}"`,
          kind: vscode.QuickPickItemKind.Separator,
        };

        const picked = await vscode.window.showQuickPick([separator, ...items], {
          matchOnDescription: true,
          matchOnDetail: true,
          placeHolder: 'Select a memory to copy to clipboard',
        }) as MemItem | undefined;

        if (picked && picked.memContent) {
          await vscode.env.clipboard.writeText(picked.memContent);
          void vscode.window.showInformationMessage('Spine: memory copied to clipboard.');
        }

        connectionState = 'connected';
        updateStatusBar();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        void vscode.window.showErrorMessage(`Spine: ${msg}`);
        connectionState = 'disconnected';
        updateStatusBar();
      }
    }
  );
}

async function cmdShowStatus(): Promise<void> {
  const key = getApiKey();
  if (!key) {
    const action = await vscode.window.showWarningMessage(
      'Spine: no API key configured.',
      'Open Settings',
      'Setup Docs'
    );
    if (action === 'Open Settings') {
      void vscode.commands.executeCommand('workbench.action.openSettings', 'spine.apiKey');
    }
    return;
  }
  await checkConnection();
  const state = connectionState === 'connected' ? '✓ connected' : '✗ unreachable';
  void vscode.window.showInformationMessage(`Spine: ${state}. Key: ${key.slice(0, 12)}…`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeSince(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

// ── Activation / deactivation ─────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'spine.search';
  context.subscriptions.push(statusBarItem);
  updateStatusBar();
  void checkConnection();

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('spine.captureSelection', cmdCaptureSelection),
    vscode.commands.registerCommand('spine.addMemory', cmdAddMemory),
    vscode.commands.registerCommand('spine.search', cmdSearch),
    vscode.commands.registerCommand('spine.showStatus', cmdShowStatus)
  );

  // Auto-capture on save
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(handleSave)
  );

  // Re-check connection when config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('spine')) {
        void checkConnection();
      }
    })
  );

  // Recheck every 10 minutes in background
  const interval = setInterval(() => void checkConnection(), 10 * 60 * 1000);
  context.subscriptions.push({ dispose: () => clearInterval(interval) });
}

export function deactivate(): void {
  for (const t of saveDebounce.values()) clearTimeout(t);
  saveDebounce.clear();
}
