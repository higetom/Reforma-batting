# Re'forma Web版 — Week 2 実装

スマートフォン Safari で動作する Web版 Re'forma の Week 2(L0/L0.5/L1/L2)実装です。

## このフォルダの中身

```
Web版/
├── index.html              ← L0 ランディングページ
├── welcome.html            ← L0.5 初回ユーザー登録
├── rmst.html               ← L1 RMST撮影画面(60秒・5動作)
├── rmst_result.html        ← L2 タイプ判定結果(動物図鑑風)
├── vercel.json             ← セキュリティHTTPヘッダー設定
├── css/
│   └── common.css          ← 共通スタイル(品ある大人向けデザイン)
└── js/
    ├── user-profile.js     ← ユーザー名管理(XSS対策・入力検証)
    ├── mediapipe-loader.js ← MediaPipe Tasks Vision ローダー(フォールバック付)
    ├── quality-gate.js     ← 撮影品質ゲート G1(精度保証仕様書 準拠)
    ├── rmst-v2-analyzer.js ← RMST v2 解析ロジック(Python版から忠実移植)
    └── type-advice.js      ← タイプ別アドバイスDB
```

## デプロイ手順

### Vercel(推奨)
1. GitHub の Reforma-batting リポジトリの中に `Web版/` ファイル一式をアップロード
2. Vercel が自動的に再デプロイ
3. URL: `https://reforma-batting.vercel.app/Web版/index.html` または別プロジェクトとして作成

### または、新規Vercelプロジェクトとして
1. GitHub に新規リポジトリを作成
2. このフォルダ一式をアップロード
3. Vercel で Import
4. 自動的に `vercel.json` のセキュリティヘッダーが適用される

## 動作確認の流れ

iPhone Safari で:
1. `index.html` を開く
2. 「無料で動作タイプを診断する」をタップ
3. `welcome.html` で名前入力 → はじめる
4. `rmst.html` で:
   - 「カメラを準備する」をタップ
   - カメラ許可
   - モデル読込完了を待つ(初回 10-30秒)
   - 「60秒の撮影を開始する」をタップ
   - 画面指示に従って 60秒の動作
5. `rmst_result.html` で判定結果を確認

## セキュリティ実装

### Content Security Policy (CSP)
全ページに meta タグで CSP を設定:
- `default-src 'self'`: 自分のオリジンのみ
- `script-src`: jsdelivr(MediaPipe CDN)のみ追加許可
- `connect-src`: jsdelivr + googleapis(モデルダウンロード用)のみ
- `object-src 'none'`: object/embed タグ禁止

### HTTPセキュリティヘッダー(vercel.json)
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=()`
- `Strict-Transport-Security: max-age=31536000`(HSTS, HTTPS強制)
- `Cross-Origin-Embedder-Policy: credentialless`(WebGPU要件)
- `Cross-Origin-Opener-Policy: same-origin`

### XSS対策
- 全ユーザー入力(名前)は `ReformaUserProfile.escapeHtml()` で必ずエスケープ
- 名前入力時に HTMLタグ・script疑似パターンを禁止
- DOM操作は `textContent` 優先、`innerHTML` 使用時は必ずエスケープ済データのみ

### プライバシー
- localStorage のみ使用(サーバー送信ゼロ)
- 動画もブラウザの外には出ない(MediaPipe はブラウザ内で実行)
- メールアドレスは収集しない(必要時のみ将来取得)

### 入力検証(user-profile.js)
- 名前: 最大20文字、HTMLタグ禁止、制御文字禁止、script疑似パターン禁止
- 年齢層: ホワイトリスト検証(elementary/junior/adult/coach のみ)

## 精度保証

`精度保証仕様書.md` に従い、以下を実装:

### G1 撮影品質ゲート(quality-gate.js)
- フレーム検出率 ≥80%(ローリング30フレーム)
- FPS ≥25(警告)、≥15(許容)、<15(不合格)
- 全身が画面内(顔・足の visibility ≥0.5)
- リアルタイム警告 + 撮影終了後の最終判定

### G3 信頼区間表示
- 確信度 ≥75%: 「確定」表示
- 50-75%: 「推定」表示
- <50%: 「参考」表示+再撮影推奨

### 精度の正直な開示
- 全ページのフッターに測定誤差を明記
- 結果画面に「2D動画の限界」を案内

## 既知の制約・将来の改善点

### Week 2 段階で意図的に未実装
- 動物のイラスト(現状は絵文字、Week 4 で品ある SVG イラストに置換予定)
- スタンダード/アドバンス モード切替(Week 4)
- バッティング解析(Week 3)
- 有料版誘導(Week 5)

### 既知の制約
- iPhone 12 以降推奨(MediaPipe Tasks Full model の WebGPU 性能要件)
- 古いブラウザ(iOS 14 以下、Chrome 100 以下)は未サポート

## TOM への確認依頼項目(中間レビュー)

iPhone Safari で実機テストして以下を確認してください:

- [ ] index.html が品ある大人向けデザインで表示されているか
- [ ] welcome.html で名前+年齢層を登録できるか
- [ ] rmst.html でカメラが起動するか
- [ ] 骨格が体に正しく重なるか
- [ ] 60秒の撮影が完走するか
- [ ] FPS が緑(25以上)で表示されているか
- [ ] rmst_result.html でタイプが判定されるか
- [ ] {ユーザー名}さんという呼びかけが個別化されているか
- [ ] 子供扱いしない品ある表現になっているか
- [ ] 精度の正直な開示が出ているか

NG 箇所があれば私(Claude)に連絡 → 修正対応します。
