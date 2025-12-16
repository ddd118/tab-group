import * as vscode from "vscode";

type MatchField =
  | "tabLabel"
  | "tabInputType"
  | "viewType"
  | "fileName"
  | "uri"
  | "languageId";

interface RuleConfig {
  pattern: string;
  targetGroup: number; // ViewColumn number 1..9
  matchField?: MatchField;
}

interface CompiledRule {
  regex: RegExp;
  targetGroup: number;
  matchField: MatchField;
  raw: RuleConfig;
}

interface ExtensionConfig {
  rules: CompiledRule[];
  debug: boolean;
  debounceMs: number;
  requireTargetGroupExists: boolean;
  autoCreateGroups: boolean;
  maxAutoCreateGroups: number; // 0 => unlimited
  skipPinnedTabs: boolean;
}

let cfg: ExtensionConfig;
let output: vscode.OutputChannel;

let debounceTimer: NodeJS.Timeout | undefined;
let suppressUntil = 0; // unix ms
const recentlyRouted = new Set<string>();

export function activate(context: vscode.ExtensionContext) {
  output = vscode.window.createOutputChannel("Tab Router");

  // 初期ロード
  cfg = loadConfig();

  // 設定変更の監視
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("tabRouter")) {
        cfg = loadConfig();
        log("Configuration reloaded.");
      }
    })
  );

  // コマンド（正体調査用）
  context.subscriptions.push(
    vscode.commands.registerCommand("tabRouter.showActiveTabInfo", async () => {
      await showActiveTabInfo();
    }),
    vscode.commands.registerCommand("tabRouter.dumpTabGroups", async () => {
      await dumpTabGroups();
    }),
    vscode.commands.registerCommand("tabRouter.routeActiveTabNow", async () => {
      scheduleRoute("manual");
    })
  );

  // ★重要：TextEditor ではなく TabGroups を監視する
  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs(() =>
      scheduleRoute("onDidChangeTabs")
    ),
    vscode.window.tabGroups.onDidChangeTabGroups(() =>
      scheduleRoute("onDidChangeTabGroups")
    ),

    // 補助（環境によっては tabGroups イベントだけだと取りこぼすことがあるため）
    vscode.window.onDidChangeActiveTextEditor(() =>
      scheduleRoute("onDidChangeActiveTextEditor")
    ),
    vscode.window.onDidChangeActiveTerminal(() =>
      scheduleRoute("onDidChangeActiveTerminal")
    )
  );

  // 起動直後も一度評価
  scheduleRoute("startup");
}

export function deactivate() {
  // no-op
}

/* --------------------------
 * Routing core
 * -------------------------- */

function scheduleRoute(reason: string) {
  if (Date.now() < suppressUntil) {
    return;
  }

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  const delay = Math.max(0, cfg.debounceMs);
  debounceTimer = setTimeout(() => {
    debounceTimer = undefined;
    routeActiveTab(reason).catch((err) => {
      log(`routeActiveTab failed: ${stringifyError(err)}`);
    });
  }, delay);
}

async function routeActiveTab(reason: string): Promise<void> {
  if (Date.now() < suppressUntil) {
    return;
  }

  const activeGroup = vscode.window.tabGroups.activeTabGroup;
  const activeTab = activeGroup?.activeTab;
  if (!activeTab) {
    log(`[${reason}] No active tab.`);
    return;
  }

  if (cfg.skipPinnedTabs && activeTab.isPinned) {
    log(`[${reason}] Skipped pinned tab: ${activeTab.label}`);
    return;
  }

  const currentCol = toViewColumnNumber(activeGroup.viewColumn);
  if (!currentCol) {
    log(`[${reason}] Cannot determine current viewColumn.`);
    return;
  }

  const matched = await findFirstMatchingRule(activeTab, cfg.rules);
  if (!matched) {
    log(`[${reason}] No rule matched: ${activeTab.label}`);
    return;
  }

  const target = matched.targetGroup;

  if (target === currentCol) {
    log(`[${reason}] Already in target group ${target}: ${activeTab.label}`);
    return;
  }

  // 暴走防止：存在判定は visibleTextEditors ではなく tabGroups.all（Webview/Terminalも含む）
  const hasTarget = hasGroup(target);
  if (!hasTarget) {
    if (cfg.requireTargetGroupExists && !cfg.autoCreateGroups) {
      log(
        `[${reason}] Target group ${target} not found. Skipped (requireTargetGroupExists=true, autoCreateGroups=false).`
      );
      return;
    }

    if (cfg.autoCreateGroups) {
      const ok = await ensureGroupExists(target);
      if (!ok) {
        log(`[${reason}] Failed to create target group ${target}. Skipped.`);
        return;
      }
    } else {
      log(
        `[${reason}] Target group ${target} not found. Skipped (autoCreateGroups=false).`
      );
      return;
    }
  }

  const key = `${getTabIdentity(activeTab)}->${target}`;
  if (recentlyRouted.has(key)) {
    log(`[${reason}] Suppressed (recently routed): ${key}`);
    return;
  }

  recentlyRouted.add(key);
  setTimeout(() => recentlyRouted.delete(key), 1500);

  // moveActiveEditor 後にイベントが連鎖するので短時間抑制
  suppressUntil = Date.now() + 400;

  log(
    `[${reason}] Move '${activeTab.label}' (${getTabInputTypeName(
      activeTab.input
    )}) from ${currentCol} -> ${target} by rule: ${matched.raw.pattern} @${
      matched.matchField
    }`
  );

  // 実際の移動（アクティブタブに対して動作）
  await vscode.commands.executeCommand("moveActiveEditor", {
    to: "position",
    by: "group",
    value: target,
  } as any);
}

/* --------------------------
 * Matching
 * -------------------------- */

async function findFirstMatchingRule(
  tab: vscode.Tab,
  rules: CompiledRule[]
): Promise<CompiledRule | undefined> {
  for (const rule of rules) {
    const value = await getMatchValue(tab, rule.matchField);
    if (!value) {
      continue;
    }
    if (rule.regex.test(value)) {
      return rule;
    }
  }
  return undefined;
}

async function getMatchValue(
  tab: vscode.Tab,
  field: MatchField
): Promise<string> {
  const input = tab.input;

  switch (field) {
    case "tabLabel":
      return tab.label;

    case "tabInputType":
      return getTabInputTypeName(input);

    case "viewType": {
      const vt = getViewType(input);
      return vt ?? "";
    }

    case "uri": {
      const uri = getPrimaryUri(input);
      return uri ? uri.toString() : "";
    }

    case "fileName": {
      const uri = getPrimaryUri(input);
      // fileName相当として fsPath を使う（TextEditor不要）
      return uri ? uri.fsPath : "";
    }

    case "languageId": {
      const uri = getPrimaryUri(input);
      if (!uri) {
        return "";
      }
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        return doc.languageId;
      } catch {
        return "";
      }
    }

    default:
      return "";
  }
}

/* --------------------------
 * Group existence / creation
 * -------------------------- */

function hasGroup(targetViewColumn: number): boolean {
  // viewColumn は 1..9 の数値として扱える
  return vscode.window.tabGroups.all.some(
    (g) => toViewColumnNumber(g.viewColumn) === targetViewColumn
  );
}

async function ensureGroupExists(targetViewColumn: number): Promise<boolean> {
  if (hasGroup(targetViewColumn)) {
    return true;
  }

  let created = 0;
  const max = cfg.maxAutoCreateGroups;

  // 0は無制限だが推奨しない。安全のため上限を9に丸める
  const hardCeil = 9;

  while (!hasGroup(targetViewColumn)) {
    if (max > 0 && created >= max) {
      log(`autoCreateGroups hit maxAutoCreateGroups=${max}. stop.`);
      break;
    }
    if (created >= hardCeil) {
      log(`autoCreateGroups hit hardCeil=${hardCeil}. stop.`);
      break;
    }

    created++;
    await vscode.commands.executeCommand("workbench.action.splitEditorRight");
  }

  return hasGroup(targetViewColumn);
}

/* --------------------------
 * Tab inspection helpers (debug)
 * -------------------------- */

async function showActiveTabInfo(): Promise<void> {
  const activeGroup = vscode.window.tabGroups.activeTabGroup;
  const tab = activeGroup?.activeTab;

  if (!tab) {
    vscode.window.showInformationMessage("Tab Router: No active tab.");
    return;
  }

  const info = await buildTabInfo(tab);
  output.appendLine("----- Active Tab Info -----");
  output.appendLine(JSON.stringify(info, null, 2));
  output.show(true);

  vscode.window.showInformationMessage(
    `Tab Router: ${info.inputType} / group=${info.groupViewColumn} / label="${info.label}"`
  );
}

async function dumpTabGroups(): Promise<void> {
  const groups = [...vscode.window.tabGroups.all].sort((a, b) => {
    return (
      (toViewColumnNumber(a.viewColumn) ?? 0) -
      (toViewColumnNumber(b.viewColumn) ?? 0)
    );
  });

  output.appendLine("===== Tab Groups Dump =====");
  for (const g of groups) {
    const col = toViewColumnNumber(g.viewColumn);
    output.appendLine(
      `-- Group viewColumn=${col} isActive=${g.isActive} tabs=${
        g.tabs.length
      } activeTab="${g.activeTab?.label ?? ""}"`
    );
    for (const t of g.tabs) {
      const tInfo = await buildTabInfo(t);
      output.appendLine(
        `   * "${tInfo.label}" inputType=${tInfo.inputType} viewType=${
          tInfo.viewType ?? ""
        } uri=${tInfo.uri ?? ""} fileName=${tInfo.fileName ?? ""}`
      );
    }
  }
  output.show(true);
}

async function buildTabInfo(tab: vscode.Tab): Promise<Record<string, unknown>> {
  const input = tab.input;

  const inputType = getTabInputTypeName(input);
  const viewType = getViewType(input);
  const uri = getPrimaryUri(input);

  let languageId: string | undefined;
  if (uri) {
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      languageId = doc.languageId;
    } catch {
      languageId = undefined;
    }
  }

  return {
    label: tab.label,
    isActive: tab.isActive,
    isPinned: tab.isPinned,
    isPreview: tab.isPreview,

    groupViewColumn: toViewColumnNumber(tab.group.viewColumn),
    inputType,
    viewType: viewType ?? undefined,

    uri: uri ? uri.toString() : undefined,
    fileName: uri ? uri.fsPath : undefined,
    languageId,
  };
}

/* --------------------------
 * Tab input type helpers
 * -------------------------- */

function getTabInputTypeName(input: unknown): string {
  if (input instanceof vscode.TabInputText) {
    return "TabInputText";
  }
  if (input instanceof vscode.TabInputTextDiff) {
    return "TabInputTextDiff";
  }
  if (input instanceof vscode.TabInputCustom) {
    return "TabInputCustom";
  }
  if (input instanceof vscode.TabInputWebview) {
    return "TabInputWebview";
  }
  if (input instanceof vscode.TabInputNotebook) {
    return "TabInputNotebook";
  }
  if (input instanceof vscode.TabInputNotebookDiff) {
    return "TabInputNotebookDiff";
  }
  if (input instanceof vscode.TabInputTerminal) {
    return "TabInputTerminal";
  }
  return "Unknown";
}

function getViewType(input: unknown): string | undefined {
  if (input instanceof vscode.TabInputCustom) {
    return input.viewType;
  }
  if (input instanceof vscode.TabInputWebview) {
    return input.viewType;
  }
  return undefined;
}

function getPrimaryUri(input: unknown): vscode.Uri | undefined {
  if (input instanceof vscode.TabInputText) {
    return input.uri;
  }
  if (input instanceof vscode.TabInputTextDiff) {
    return input.modified;
  }
  if (input instanceof vscode.TabInputCustom) {
    return input.uri;
  }
  if (input instanceof vscode.TabInputNotebook) {
    return input.uri;
  }
  if (input instanceof vscode.TabInputNotebookDiff) {
    return input.modified;
  }
  return undefined;
}

function getTabIdentity(tab: vscode.Tab): string {
  const input = tab.input;

  if (input instanceof vscode.TabInputText) {
    return `text:${input.uri.toString()}`;
  }
  if (input instanceof vscode.TabInputTextDiff) {
    return `diff:${input.original.toString()}<->${input.modified.toString()}`;
  }
  if (input instanceof vscode.TabInputCustom) {
    return `custom:${input.viewType}:${input.uri.toString()}`;
  }
  if (input instanceof vscode.TabInputWebview) {
    return `webview:${input.viewType}:${tab.label}`;
  }
  if (input instanceof vscode.TabInputNotebook) {
    return `notebook:${input.notebookType}:${input.uri.toString()}`;
  }
  if (input instanceof vscode.TabInputNotebookDiff) {
    return `notebookDiff:${
      input.notebookType
    }:${input.original.toString()}<->${input.modified.toString()}`;
  }
  if (input instanceof vscode.TabInputTerminal) {
    return `terminal:${tab.label}`;
  }

  return `unknown:${tab.label}`;
}

function toViewColumnNumber(vc: vscode.ViewColumn): number | undefined {
  // ViewColumn は number-like。1..9 を期待
  const n = Number(vc);
  if (!Number.isFinite(n) || n <= 0) {
    return undefined;
  }
  return n;
}

/* --------------------------
 * Config / logging
 * -------------------------- */

function loadConfig(): ExtensionConfig {
  const c = vscode.workspace.getConfiguration("tabRouter");

  const debug = !!c.get<boolean>("debug", false);
  const debounceMs = Number(c.get<number>("debounceMs", 120));
  const requireTargetGroupExists = !!c.get<boolean>(
    "requireTargetGroupExists",
    true
  );
  const autoCreateGroups = !!c.get<boolean>("autoCreateGroups", false);
  const maxAutoCreateGroups = Number(c.get<number>("maxAutoCreateGroups", 2));
  const skipPinnedTabs = !!c.get<boolean>("skipPinnedTabs", false);

  const rawRules = c.get<RuleConfig[]>("rules", []);
  const rules = compileRules(rawRules);

  return {
    rules,
    debug,
    debounceMs: Number.isFinite(debounceMs) ? debounceMs : 120,
    requireTargetGroupExists,
    autoCreateGroups,
    maxAutoCreateGroups: Number.isFinite(maxAutoCreateGroups)
      ? maxAutoCreateGroups
      : 2,
    skipPinnedTabs,
  };
}

function compileRules(rawRules: RuleConfig[]): CompiledRule[] {
  const compiled: CompiledRule[] = [];

  for (const r of rawRules) {
    if (!r || typeof r.pattern !== "string" || !r.pattern.trim()) {
      continue;
    }
    const target = Number(r.targetGroup);
    if (!Number.isFinite(target) || target < 1 || target > 9) {
      continue;
    }

    const matchField: MatchField = (r.matchField ?? "fileName") as MatchField;

    try {
      const regex = new RegExp(r.pattern);
      compiled.push({
        regex,
        targetGroup: target,
        matchField,
        raw: r,
      });
    } catch (e) {
      // invalid regex
      log(`Invalid RegExp ignored: "${r.pattern}" (${stringifyError(e)})`);
    }
  }

  return compiled;
}

function log(message: string) {
  if (!cfg?.debug) {
    return;
  }
  const ts = new Date().toISOString();
  output.appendLine(`[${ts}] ${message}`);
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) {
    return `${err.name}: ${err.message}`;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
