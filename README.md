# Tab Router

[日本語](#日本語) | [English](#english)

---

## 日本語

正規表現でタブをマッチさせ、特定のエディタグループに自動ルーティングするVSCode拡張機能です。

Webview、ターミナル、カスタムエディタなど、様々なタブタイプに対応しています。

### スクリーンショット

<!-- 後で画像を追加してください -->
<!-- ![Tab Router Demo](images/demo.gif) -->
<!-- ![設定例](images/settings.png) -->

### 機能

- 正規表現パターンでタブをマッチング
- マッチしたタブを指定したエディタグループに自動移動
- 複数のマッチフィールド対応（ファイル名、URI、言語ID、タブラベル等）
- Webview・ターミナルタブもサポート
- ピン留めタブのスキップオプション
- エディタグループの自動作成オプション

### インストール

1. VSCode拡張機能マーケットプレイスで「Tab Router」を検索
2. インストールをクリック

または、コマンドパレット（`Ctrl+P`）で:

```
ext install ddd118.tab-router
```

### 使い方

#### 基本設定

`settings.json` にルールを追加します：

```json
{
  "tabRouter.rules": [
    {
      "pattern": "\\.test\\.ts$",
      "targetGroup": 2,
      "matchField": "fileName"
    },
    {
      "pattern": "\\.md$",
      "targetGroup": 3,
      "matchField": "fileName"
    }
  ]
}
```

#### 設定例

**テストファイルを右側に表示:**

```json
{
  "tabRouter.rules": [
    { "pattern": "\\.(test|spec)\\.(ts|js)$", "targetGroup": 2 }
  ],
  "tabRouter.autoCreateGroups": true
}
```

**言語別にグループ分け:**

```json
{
  "tabRouter.rules": [
    { "pattern": "typescript", "targetGroup": 2, "matchField": "languageId" },
    { "pattern": "markdown", "targetGroup": 3, "matchField": "languageId" }
  ]
}
```

### コマンド

| コマンド | 説明 |
|---------|------|
| `Tab Router: Show Active Tab Info` | アクティブなタブの情報を表示 |
| `Tab Router: Dump Tab Groups` | 全タブグループの情報をダンプ |
| `Tab Router: Route Active Tab Now` | 現在のタブを即座にルーティング |

### 設定項目

| 設定 | 型 | デフォルト | 説明 |
|-----|---|----------|------|
| `tabRouter.rules` | array | `[]` | ルーティングルールの配列 |
| `tabRouter.debug` | boolean | `false` | デバッグログを有効化 |
| `tabRouter.debounceMs` | number | `120` | デバウンス時間（ms） |
| `tabRouter.requireTargetGroupExists` | boolean | `true` | ターゲットグループ存在時のみ移動 |
| `tabRouter.autoCreateGroups` | boolean | `false` | グループを自動作成 |
| `tabRouter.maxAutoCreateGroups` | number | `2` | 自動作成の上限数 |
| `tabRouter.skipPinnedTabs` | boolean | `false` | ピン留めタブをスキップ |

#### ルールのプロパティ

| プロパティ | 型 | 必須 | 説明 |
|-----------|---|-----|------|
| `pattern` | string | ○ | JavaScript正規表現 |
| `targetGroup` | number (1-9) | ○ | 移動先グループ番号 |
| `matchField` | string | - | マッチ対象（デフォルト: `fileName`） |

#### matchField の値

| 値 | 説明 |
|---|------|
| `fileName` | ファイルパス（デフォルト） |
| `uri` | URI文字列 |
| `tabLabel` | タブのラベル |
| `tabInputType` | 入力タイプ（TabInputText等） |
| `viewType` | ビュータイプ（Webview等） |
| `languageId` | 言語識別子 |

---

## English

A VSCode extension that routes tabs to specific editor groups based on regex pattern matching.

Supports various tab types including Webview, Terminal, and custom editors.

### Screenshots

<!-- Add images later -->
<!-- ![Tab Router Demo](images/demo.gif) -->
<!-- ![Settings Example](images/settings.png) -->

### Features

- Match tabs using regex patterns
- Automatically move matched tabs to specified editor groups
- Multiple match fields (fileName, URI, languageId, tabLabel, etc.)
- Support for Webview and Terminal tabs
- Option to skip pinned tabs
- Auto-create editor groups option

### Installation

1. Search for "Tab Router" in VSCode Extensions Marketplace
2. Click Install

Or via Command Palette (`Ctrl+P`):

```
ext install ddd118.tab-router
```

### Usage

#### Basic Configuration

Add rules to `settings.json`:

```json
{
  "tabRouter.rules": [
    {
      "pattern": "\\.test\\.ts$",
      "targetGroup": 2,
      "matchField": "fileName"
    },
    {
      "pattern": "\\.md$",
      "targetGroup": 3,
      "matchField": "fileName"
    }
  ]
}
```

### Commands

| Command | Description |
|---------|-------------|
| `Tab Router: Show Active Tab Info` | Show information about active tab |
| `Tab Router: Dump Tab Groups` | Dump all tab group information |
| `Tab Router: Route Active Tab Now` | Route the current tab immediately |

### Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `tabRouter.rules` | array | `[]` | Array of routing rules |
| `tabRouter.debug` | boolean | `false` | Enable debug logging |
| `tabRouter.debounceMs` | number | `120` | Debounce time (ms) |
| `tabRouter.requireTargetGroupExists` | boolean | `true` | Only move if target group exists |
| `tabRouter.autoCreateGroups` | boolean | `false` | Auto-create groups |
| `tabRouter.maxAutoCreateGroups` | number | `2` | Max auto-created groups |
| `tabRouter.skipPinnedTabs` | boolean | `false` | Skip pinned tabs |

#### Rule Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `pattern` | string | Yes | JavaScript regex |
| `targetGroup` | number (1-9) | Yes | Target group number |
| `matchField` | string | No | Match field (default: `fileName`) |

#### matchField Values

| Value | Description |
|-------|-------------|
| `fileName` | File path (default) |
| `uri` | URI string |
| `tabLabel` | Tab label |
| `tabInputType` | Input type (TabInputText, etc.) |
| `viewType` | View type (Webview, etc.) |
| `languageId` | Language identifier |

---

## License

MIT
