import * as vscode from 'vscode';

type MatchField = 'fileName' | 'uri' | 'languageId';

interface RuleConfig {
  pattern: string;
  targetGroup: number;
  matchField?: MatchField;
}

interface CompiledRule {
  regex: RegExp;
  targetGroup: number;
  matchField: MatchField;
  raw: RuleConfig;
}

export function activate(context: vscode.ExtensionContext) {
  let rules = loadRules();

  // 設定が変わったらルールを再読み込み
  const configDisposable = vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('tabRouter.rules')) {
      rules = loadRules();
    }
  });
  
  // アクティブエディタが変わるたびに発火
  const editorDisposable = vscode.window.onDidChangeActiveTextEditor(async editor => {
    if (!editor) {
      return;
    }

    const doc = editor.document;
    const currentGroup = editor.viewColumn ?? 1;

	console.log(`languageId: ${doc.languageId}`);
	console.log(`fileName: ${doc.fileName}`);
	console.log(`uri: ${doc.uri.toString()}`);

    const matched = findFirstMatchingRule(doc, rules);
    if (!matched) {
      return;
    }

    const targetGroup = matched.targetGroup;

    // すでに目的のグループなら何もしない
    if (currentGroup === targetGroup) {
      return;
    }

    // 無限ループ防止：ドキュメント + ターゲットグループの組み合わせで一度だけ試す
    const key = `${doc.uri.toString()}::${targetGroup}`;
    if (recentlyRouted.has(key)) {
      return;
    }
    recentlyRouted.add(key);
    // 少し経ったら忘れる（セッション中だけの簡易キャッシュ）
    setTimeout(() => recentlyRouted.delete(key), 2000);

    try {
      await ensureGroupExists(targetGroup);
      await vscode.commands.executeCommand('moveActiveEditor', {
        to: 'position',
        by: 'group',
        value: targetGroup
      } as any);
    } catch (err) {
      console.error('Tab Router: failed to move editor', err);
    }
  });

  context.subscriptions.push(configDisposable, editorDisposable);
}

// 最近ルーティングした (doc, group) コンビを記録（無限ループ対策）
const recentlyRouted = new Set<string>();

function loadRules(): CompiledRule[] {
  const config = vscode.workspace.getConfiguration('tabRouter');
  const rawRules = config.get<RuleConfig[]>('rules', []);

  const compiled: CompiledRule[] = [];

  for (const r of rawRules) {
    if (!r.pattern || !r.targetGroup) {
      continue;
    }
    try {
      const regex = new RegExp(r.pattern);
      compiled.push({
        regex,
        targetGroup: r.targetGroup,
        matchField: (r.matchField ?? 'fileName') as MatchField,
        raw: r
      });
    } catch (e) {
      console.warn(`Tab Router: invalid RegExp "${r.pattern}"`, e);
    }
  }

  return compiled;
}

function getMatchString(doc: vscode.TextDocument, field: MatchField): string {
  switch (field) {
    case 'fileName':
      return doc.fileName;
    case 'uri':
      return doc.uri.toString();
    case 'languageId':
      return doc.languageId;
    default:
      return doc.fileName;
  }
}

function findFirstMatchingRule(
  doc: vscode.TextDocument,
  rules: CompiledRule[]
): CompiledRule | undefined {
  for (const rule of rules) {
    const target = getMatchString(doc, rule.matchField);
    if (rule.regex.test(target)) {
      return rule;
    }
  }
  return undefined;
}

/**
 * targetGroup 番目のエディタグループが存在するようにする。
 * 足りなければ右に split してグループを増やす。
 */
async function ensureGroupExists(targetGroup: number): Promise<void> {
  // すでに十分なグループがあれば何もしない
  let maxGroup = getMaxGroupIndex();
  if (maxGroup >= targetGroup) {
    return;
  }

  // 足りない分だけ右に分割して増やす
  while (maxGroup < targetGroup) {
    await vscode.commands.executeCommand('workbench.action.splitEditorRight');
    const newMax = getMaxGroupIndex();
    if (newMax <= maxGroup) {
      // 何らかの理由で増えなかった場合は諦める
      break;
    }
    maxGroup = newMax;
  }
}

function getMaxGroupIndex(): number {
  const editors = vscode.window.visibleTextEditors;
  if (editors.length === 0) {
    return 1;
  }
  let max = 1;
  for (const e of editors) {
    const col = e.viewColumn ?? 1;
    if (col > max) {
      max = col;
    }
  }
  return max;
}

export function deactivate() {
  // 特にやることなし
}
