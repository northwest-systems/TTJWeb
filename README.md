# TTJWeb

TTJCoreを通常のブラウザ・Orca内ブラウザから操作するローカル専用UIです。Project・Task・Ticketと順序付きJobを登録し、Runの開始・終了、進捗率・メッセージの報告、達成条件の確認と完了記録を行えます。

## 表示形式とレスポンシブ対応

URLで4つの表示形式を切り替えられます。ブラウザの戻る・進む履歴や直リンクにも対応しています。

- ツリー：`/?view=tree`（`/tree` も利用可能） — Task配下のTicketと先行依存のつながりをパン＆ズーム可能なインタラクティブツリーで表示（カード中央からの直角分岐・収束点と非接続交差のまたぐ半円を描き分け）
- カンバン：`/?view=kanban`（`/kanban` も利用可能） — 作業状態（未着手・作業中・待機・保留/障害・完了・中止）ごとのボード表示
- リスト：`/?view=list`（`/list` も利用可能） — TaskとTicketの目標・状態・担当を一覧表示
- タイムライン：`/?view=timeline`（`/timeline` も利用可能） — 作成・状態変更・Run実行・進捗報告の履歴を時系列表示

選択中のProject・Task・Ticketはクエリパラメータ（`project` / `task` / `ticket`）で保持されます。フィルタポップオーバーから進行対象のみ・ステータス・担当者・キーワード検索を組み合わせてツリー・カンバン・リストへ一貫適用できます。右上の歯車アイコンから設定モーダル（テーマ・表示タイムゾーン・接続情報・Jobアイコンキー一覧・Project/Worker管理）を、本アイコンからProjectの記録・知識（Knowledge）を管理できます。

## 必要なもの

- Python 3.10以降。標準ライブラリだけを使い、pipで追加するpackageはありません。
- run.progress・ticket.snapshot対応のTTJCore。通常のTTJ 1.1.0文書に加え、Coreの進捗APIを使います。
- 同じPCのブラウザ。HTML・CSS・JavaScript（ESM）はbuildなしで配信します。

## 起動する

まずCoreのホスト側で管理主体ttjwebを許可し、利用するprofileを起動します。既存Coreで管理主体を変更した場合は、そのCoreの再起動が必要です。TTJWebは管理権限を自動付与しません。

PowerShell 7：

~~~powershell
$env:TTJCORE_MANAGEMENT_ACTORS = '["ttjweb"]'
ttjcore --home ~/sample/path/sample.profile ensure
python server.py --home ~/sample/path/sample.profile
~~~

Bash：

~~~bash
export TTJCORE_MANAGEMENT_ACTORS='["ttjweb"]'
ttjcore --home ~/sample/path/sample.profile ensure
python3 server.py --home ~/sample/path/sample.profile
~~~

表示されたhttp://127.0.0.1:8765を開きます。CoreがPATHにない場合は--coreに実行ファイルのパス（例: `~/sample/path/ttjcore`）、ポートを変える場合は--portを指定します。--port 0は空きポートを使います。--actorで管理主体を変える場合はCoreにも同じ主体の許可が必要です。

## 作業の流れ

1. ProjectとTaskを作成し、目標と達成条件を登録する。
2. 「担当Sessionを登録」で作業担当者とSessionを作成する。
3. Ticketに担当SessionとJob列を登録する。担当とJob計画は確定後に変更しない。
4. Runを開始し、実際の作業に合わせて進捗率とメッセージを報告する。
5. Runを終了し、達成条件を確認してJobを完了する。全Job終了後のTicketはCoreが集約し、Taskは達成条件を確認して明示完了する。

進捗100%やRunの終了だけでJobを完了させません。再試行・後続Jobの開始時には前回実行の停止・副作用の安全確認を入力します。保留・中止時の外部processの停止は実行側の責務です。

「端末監視コマンドをコピー」で、同じCore/profileを参照するOSC 7501監視コマンドを取得できます。Orcaの専用端末で実行すると進捗を表示します。CoreがWSL内で動いている場合はWindows PowerShell向けのwslコマンドを生成します。

## 接続と権限

デフォルトではサーバーは `127.0.0.1` だけで待ち受け、`127.0.0.1:<port>` / `localhost:<port>` の `Host` と同じ画面の `http://<Host>` `Origin` からの JSON 操作だけを受け付けます。Core の IPC token や DB をブラウザへ公開しません。管理 actor はサーバー起動時の設定で固定し、実行 actor は対象 Ticket の現在 Job/Run から取得します。ブラウザから指定された actor や mode を信用しません。

Core への操作は `ttjcore rpc` で中継します。DB には直接接続せず、Core の revision・認可・原子的な変更と履歴を使います。状態更新は既存 event を待ち受けて再取得します。

## スマホから SSH なしでアクセスする（Tailscale Serve）

`tailscale serve` を併用することで、SSH ポートフォワーディングなしで tailnet 内のスマホ・タブレットから HTTPS 経由で安全に開けます。既存の `tailscale serve` サービスが `/` を使っている場合でも、専用 HTTPS ポート（例: `8878`）を割り当てられます。

1. 許可ホストを明示指定して TTJWeb を起動する（デフォルト動作は従来どおり `127.0.0.1` 限定のまま維持されます）:

~~~powershell
python server.py --home ~/sample/path/sample.profile --port 8878 --allow-host sample-host.tail0000.ts.net:8878
~~~

   - `--allow-host` は複数回指定・カンマ区切り・環境変数 `TTJWEB_ALLOW_HOSTS` に対応します。許可ホストに対しては `https://<Host>`（および `http://<Host>`）の同一オリジン操作のみ受け付け、他オリジンからの CSRF は引き続き `403` で拒否します。
   - 任意の追加保護オプション:
     - `--auth-token sample-token`（または環境変数 `TTJWEB_AUTH_TOKEN`）: 指定するとログイン画面（`/api/auth/login`、`HttpOnly; SameSite=Lax` Cookie、HTTPS 時は `Secure` 付与）および `Authorization: Bearer sample-token` によるトークン認証を有効化します。未指定時は Tailnet 認証のみでそのまま利用できます。
     - `--read-only`（または環境変数 `TTJWEB_READ_ONLY=1`）: 閲覧専用モード。すべての変更系 RPC を `403` で拒否し、UI の作成・編集・実行ボタンも無効化します。

2. Tailscale Serve で tailnet 内限定 HTTPS プロキシを公開する:

~~~powershell
tailscale serve --bg --https=8878 http://127.0.0.1:8878
~~~

3. スマホのブラウザから `https://sample-host.tail0000.ts.net:8878/` を開きます。ツリー画面は 1 本指パン・2 本指ピンチズームおよび上部ズームボタンに対応しています。

## Orca 右サイドバー常駐プラグイン（ON / OFF 切替・サーバー管理・スマホ QR）

リポジトリ内の `orca-plugin/` に、Orca の右サイドバーへ TTJWeb を常駐表示できるプラグイン（ID: `ttjweb-sidebar`, v0.2.0）を同梱しています。

### 主な機能
- **ON / OFF 切り替え**: サイドバー上部のトグルスイッチ、ステータスバーの `TTJ: ON` / `TTJ: OFF`、コマンドパレット（`TTJWeb: 右サイドバー常駐を ON / OFF 切り替え`）、または Orca の Settings → Plugins → TTJWeb から切り替えられます。OFF 時は自動更新とバックエンド通信を完全に停止します（起動中のサーバー自体は停止しないため、スマホからの閲覧は継続できます）。
- **ボタンでサーバー起動 / 停止・起動設定**: 上部バーの電源アイコンからサーバー管理カードを開き、コマンドを打たずに `起動` / `停止` / `再起動` が行えます。起動中の `server.py` の設定を自動記憶するため、停止後の再起動もワンクリックで完結し、折りたたみ式の「起動設定」フォームから `serverWorkdir` / `corePath` / `homePath` / `wslDistro` / `mobileUrl` 等をその場で編集・保存できます。コマンドパレット（`TTJWeb: サーバーを起動` / `TTJWeb: サーバーを停止`）にも対応しています。
- **スマホ接続リンク・オフライン QR コード・Tailscale 公開トグル**: 上部バーのスマホアイコンからスマホ接続カードを開き、自動検出（または設定済み）のスマホ用 URL の表示、「ブラウザで開く」「URL コピー」、外部通信なしのオフライン QR コード SVG、および対象ポートのみの Tailscale Serve 公開 ON / OFF トグル（コマンドパレット `TTJWeb: Tailscale スマホ公開を ON / OFF 切り替え` 対応）を操作できます。
- **2 つのバックエンド方式**:
  - `TTJWeb サーバー (HTTP)`（既定）: 稼働中の TTJWeb サーバー（例: `http://127.0.0.1:8878`）へ Node Worker 経由で接続します（`--auth-token` 設定時はプラグイン設定の `authToken` を利用）。
  - `ttjcore 直接実行`: Node Worker から `ttjcore`（Windows では任意の WSL ディストリ経由も可。例: `sample-wsl-distro`）を直接呼び出します。
- **オフライン完結パネル**: パネル内アセットと QR コードエンコーダー（`panel/qrcode.mjs`）はすべて `orca-plugin/panel/` に同梱されており、HTML フレームから外部ネットワーク通信を行いません。

### 検証・開発ロード手順

`static/` を変更した後は、同梱アセットを同期してください:

~~~powershell
python scripts/sync_orca_plugin.py
~~~

プラグインの検証とテスト:

~~~powershell
orca plugin validate ./orca-plugin --json
orca plugin test ./orca-plugin --json
orca plugin check ./orca-plugin --json
orca plugin inspect ./orca-plugin --json
~~~

Orca へ開発ロードする場合（初回は権限確認の承認プロンプト／`--approve` が必要です）:

~~~powershell
orca plugin dev load ./orca-plugin --json
~~~

## テスト

~~~sh
python -m unittest discover -s tests
node --test tests/test_views.mjs
orca plugin test ./orca-plugin --json
~~~

TTJCoreの仕様とCLI操作は[TTJCore](https://github.com/northwest-systems/TTJCore)を参照してください。
