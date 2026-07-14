# 📶 おうちネット Hub

**家庭向け総合インターネット支援アプリ**

自宅のWi-Fi情報を入力すると、来客がスマホのカメラをかざすだけで接続できる
QRコードを表示します。くすみカラーの落ち着いたデザインで、来客にそのまま
見せられる佇まいを目指しました。

将来的にさまざまな家庭向けネットワーク機能を追加していくための土台として、
拡張しやすい構成（純粋ロジック層 / 永続化層 / Web層の分離）にしています。

---

## 機能

| 機能 | 説明 |
|------|------|
| 📶 **WiFi QRコード生成** | SSID・パスワード・セキュリティ種別を入力すると即座にQRを生成。SVG保存も可能 |
| 🖥 **来客用フルスクリーン表示** | QRを大きく表示。玄関先やリビングのタブレットでそのまま提示できます |
| 📇 **ネットワークプロファイル管理**（提案①） | 自宅用・来客用など複数のネットワークを保存・切替・削除 |
| 🔐 **パスワード強度診断＆生成**（提案②） | 入力パスワードの強度をその場で診断／安全なランダムパスワードを生成 |
| 🚀 **かんたん通信速度テスト**（提案③） | サーバーとの実効ダウンロード速度・応答速度(ping)を計測。**履歴を暗号化保存**しグラフ表示 |
| 🩺 **かんたんネット診断**（提案④） | 質問に答えるだけで、つながらない原因と対処法を案内するウィザード |
| 🧮 **データ使用量シミュレーター**（提案⑤） | 1日の利用時間から月間データ使用量の目安を計算 |
| 🎨 **おえかき3D**（子供向け） | 描いた絵を"それっぽく"立体化し、海岸ステージをうろうろさせるミニゲーム |

#### 🎨 おえかき3D について
- **おえかき／ステージのサブタブ構成**。描いて「3Dにする！」を押すと自動でステージへ。
- 描いた絵をトリミング→DS相当（最大64px）に縮小してテクスチャ化。
- **おえかき／ステージのサブタブ構成**。ステージは**全画面表示**にも対応。
- ステージは**スーパーマリオRPG風のアイソメトリック（斜め見下ろし・奥行き）**。厚みのある砂浜スラブの島＋タイル格子、周囲の海・波打ち際の泡・きらめき・太陽、ヤシの木／岩／ヒトデを**前後関係（奥行きソート）で重ねて**配置。
- **横長の広いステージ（26×14タイル）**。生成される絵は**小さめ**なので、たくさん置くほど**街**になっていきます。
- **ズーム（拡大縮小）**対応（＋／－ボタン・マウスホイール）。
- なかまは**分散ロジック**（散らばった初期配置＋近すぎる仲間から離れる分離力）でひと所に固まらない。
- **タップでジャンプ／ドラッグでつかんで移動／「なおす」で再編集／「ばいばい」で削除**。
- 作った街は**ブラウザにローカル保存**（localStorage）され、次回アクセス時に**自動で読み込み**。
- **スプライトスタック（積層）＋影**で描いた絵に立体感。**SNES相当の 384×256** バックバッファ＋`image-rendering: pixelated` のレトロ質感。
- 外部ライブラリ不使用（Canvas 2Dのみ）。CSP `default-src 'self'` のままオフラインで動作。

### 📱 iPadにインストール（PWA）

本アプリは **PWA（Progressive Web App）** としてインストールできます。

**方法A（公開URLから・推奨）**
1. GitHub Actions で GitHub Pages に公開（下記）
2. iPad の **Safari** で公開URLを開く
3. 共有ボタン →「**ホーム画面に追加**」
4. ホーム画面のアイコンから、全画面のアプリとして起動（おえかき3D等はオフラインでも動作）

**方法B（家庭内サーバーから）**
`python run.py` で起動したPCのLAN内URLを iPad Safari で開き、同様に「ホーム画面に追加」。
QRコード・プロファイル・速度テストなどサーバー機能もすべて利用できます。

> ℹ️ App Store 配布のネイティブアプリ化には Mac / Xcode / Apple Developer 登録が必要で、汎用の GitHub Actions だけでは作成できません。**iPadへ「アプリとして」入れる実用的な方法がこの PWA インストール**です。

### 🚀 GitHub Actions で公開（yml実行）

- [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) … 静的PWAを **GitHub Pages** に公開（`main` へのpush、または手動実行）。リポジトリの **Settings → Pages → Source = GitHub Actions** で有効化。
- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) … フロント・バック両方のテストを実行。

> Pages（静的配信）では WiFi QR / プロファイル / 速度テスト等のサーバー機能は動作しません（おえかき3D などクライアント機能はフル動作）。全機能は方法B（Flaskサーバー）でご利用ください。

### 🔒 セキュリティ

- **保存データの暗号化（at rest）**: プロファイルと速度履歴は Fernet(AES-128-CBC + HMAC) で暗号化して保存。平文はディスクに残りません。鍵は初回に自動生成され `data/.secret.key`（gitignore対象）に保管。
- **来客画面のパスワード非表示**: 来客用フルスクリーンは既定でパスワードを表示しません。設定画面のオプションを有効にしたときのみ表示します。
- **セキュリティヘッダ**: `Content-Security-Policy` / `X-Frame-Options: DENY` / `X-Content-Type-Options: nosniff` / `Referrer-Policy: no-referrer` を全レスポンスに付与。API応答は `Cache-Control: no-store`。
- **入力サイズ制限**: リクエストボディを 256KB に制限（過大ペイロード対策、超過時 413）。
- **パストラバーサル対策**: 静的配信は公開ディレクトリ外へ脱出できません。

---

## 構成

```
おうちネット Hub/
├─ run.py                 起動スクリプト
├─ requirements.txt
├─ app/
│  ├─ core.py             純粋ロジック（WiFi文字列/QR/パスワード/検証/データ試算）
│  ├─ crypto.py           暗号化ユーティリティ（Fernet, 鍵管理）
│  ├─ store.py            永続化（暗号化, アトミック書込, スレッドセーフ）
│  └─ server.py           Flask（静的配信 + JSON API + セキュリティヘッダ）
├─ static/
│  ├─ index.html
│  ├─ manifest.webmanifest  PWA マニフェスト
│  ├─ sw.js                 Service Worker（オフライン対応）
│  ├─ css/styles.css      くすみカラーのスタイル
│  ├─ js/app.js           フロントエンド制御
│  ├─ js/kids.js          おえかき3D（アイソメトリック街づくり）
│  └─ icons/              PWA アイコン（tools/make_icons.py で生成）
├─ tools/make_icons.py     アイコン生成スクリプト
├─ .github/workflows/      GitHub Actions（Pages公開 / テスト）
├─ data/                  プロファイル保存先（自動生成）
└─ tests/
   ├─ test_core.py        コアロジック単体テスト
   ├─ test_store.py       永続化層（暗号化）テスト
   ├─ test_api.py         HTTP API テスト
   ├─ test_security.py    セキュリティテスト（暗号化/ヘッダ/入力制限/パス脱出）
   └─ test_frontend.py    Playwright による E2E（実ブラウザ）テスト
```

---

## セットアップ & 起動

```bash
# 依存インストール
python -m pip install -r requirements.txt

# 起動
python run.py
```

起動後、ブラウザで <http://127.0.0.1:5000> を開いてください。

---

## テスト

フロント・バックエンド両方を網羅したテストスイートを同梱しています。

```bash
# バックエンド（ロジック / 永続化 / API）
python -m pip install -r requirements.txt

# フロントエンドE2Eに必要なブラウザ（初回のみ）
python -m playwright install chromium

# 全テスト実行
python -m pytest
```

- バックエンド: `pytest`（Flask test client）
- フロントエンド: `pytest` + `Playwright`（Chromium 実ブラウザでE2E検証）

---

## API 概要

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/health` | ヘルスチェック |
| POST | `/api/qr` | WiFi情報 → QRのSVGとペイロード |
| GET/POST | `/api/profiles` | プロファイル一覧 / 追加 |
| GET/PUT/DELETE | `/api/profiles/<id>` | 個別取得 / 更新 / 削除 |
| POST | `/api/password/analyze` | パスワード強度診断 |
| GET | `/api/password/generate` | パスワード生成 |
| GET | `/api/speedtest/ping` | 応答計測用 |
| GET | `/api/speedtest/payload?bytes=N` | 速度計測用データ |

---

## メモ

- パスワードはローカルのJSONファイル(`data/profiles.json`)に平文で保存されます。
  家庭内利用を前提とした設計です。外部公開する場合は暗号化・認証の追加を推奨します。
- 速度テストは「このサーバー（ローカル）との実効速度」を測るものです。
  インターネット回線速度そのものとは異なります。
