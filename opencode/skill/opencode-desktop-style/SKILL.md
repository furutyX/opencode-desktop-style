---
name: opencode-desktop-style
description: OpenCode デスクトップに「グルーピングの枠」と開閉マーカー(+/-)の見た目カスタムを適用する非公式ワークフロー。Use when the user wants to apply or tune the OpenCode desktop grouping frames, when the styling disappeared after an app update, or when the user runs /desktop-style.
---

# OpenCode Desktop Style（適用）

OpenCode デスクトップ（Electron）の `app.asar` に CSS を注入し、
**ツール実行のまとまり／アシスタント応答を枠で囲み、開閉マーカー（+ / −）を付ける**。
実体は非公式 CLI `opencode-desktop-style`（npx で実行）。

## 前提

- Node.js が必要。
- `app.asar` を書き換えるので、**必ずアプリを閉じてから**適用する（起動中は CLI が拒否する）。
- 非公式・無保証。将来アプリ側の整合性検証が有効になると使えなくなる可能性がある。

## 手順

1. 状態確認:
   ```
   npx -y opencode-desktop-style status
   ```
2. `state` が `pristine (未適用)` で、`app` が `running` の場合は、ユーザーに
   **OpenCode を閉じてもらう**（勝手に終了させない）。
3. 適用:
   ```
   npx -y opencode-desktop-style apply
   ```
4. **OpenCode を再起動**すると反映される。
5. 再起動なしで先に見た目だけ確認したい場合は、`preview` の出力を
   DevTools（メニュー「表示」→「Toggle Developer Tools」）の Console に貼る:
   ```
   npx -y opencode-desktop-style preview
   ```

## アプリ更新後

自動更新で `app.asar` が差し替わると見た目は消える。**同じ手順で `apply` を再実行**すればよい
（CLI は更新後の素の asar を検知して再適用する）。

## 見た目の調整

- 既定 CSS はパッケージの `css/overrides.css`。
- 自分の CSS を使う場合:
  ```
  npx -y opencode-desktop-style apply --css "C:\path\to\my.css"
  ```
- 主な対象セレクタ:
  - ツール群: `[data-component="collapsed-tool-group"]`
  - 応答本文: `[data-component="text-part"]`
  - 思考: `[data-component="reasoning-part"]`
  - 開閉トリガー: `[data-slot="collapsible-trigger"]`（`aria-expanded` で状態）

## 元に戻す

レイアウトが崩れた／気に入らない場合は、
`opencode-desktop-style-revert` スキルまたは `/desktop-style-revert` を使って元に戻す。

## ガードレール

- アプリ起動中に `apply` / `revert` を実行しない（ユーザーに閉じてもらう）。
- ユーザーの環境を書き換える操作なので、実行前に「アプリを閉じてよいか」を一度確認する。
- 失敗時はエラーをそのまま伝え、勝手に `--force` しない。
