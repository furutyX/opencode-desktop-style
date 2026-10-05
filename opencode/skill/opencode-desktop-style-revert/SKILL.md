---
name: opencode-desktop-style-revert
description: OpenCode デスクトップの見た目カスタム（枠・開閉マーカー）を元に戻すロールバック用ワークフロー。Use when the OpenCode desktop layout looks broken or the user asks to revert/undo/restore the desktop style, or runs /desktop-style-revert.
---

# OpenCode Desktop Style（元に戻す）

`opencode-desktop-style` で注入した CSS を除去し、OpenCode デスクトップを
**素の見た目に戻す**。レイアウト崩れ時のセーフティネット。

## 前提

- **アプリを閉じてから**実行する（起動中は CLI が拒否する）。
- 初回 `apply` 時に `app.asar` は `app.asar.orig` にバックアップされている。

## 手順

1. 状態確認:
   ```
   npx -y opencode-desktop-style status
   ```
   - `state: PATCHED (適用済み)` かつ `backup: (present)` ならそのまま戻せる。
   - `backup: (none)` の場合は手動復旧（下記）。
2. アプリ起動中なら、ユーザーに **OpenCode を閉じてもらう**。
3. 元に戻す:
   ```
   npx -y opencode-desktop-style revert
   ```
4. **OpenCode を再起動**すると素の見た目に戻る。

## バックアップが無い場合の手動復旧

CSS は `app.asar` 内 `out/renderer/index.html` の
`<style id="oc-desktop-overrides"> … </style>` を1つ足しているだけ。
復旧手段（優先順）:

1. OpenCode を**再インストール or 更新**する（`app.asar` が新品に戻る）。
2. `--asar <path>` で対象を明示して再実行する:
   ```
   npx -y opencode-desktop-style revert --asar "<app.asar のフルパス>"
   ```
3. どうしても消したいだけなら、`index.html` 内の
   `<style id="oc-desktop-overrides">…</style>` を除去してもよい（非推奨・自己責任）。

## ガードレール

- アプリ起動中に実行しない。
- 破壊的操作の前に必ず `status` で `backup` の有無を確認する。
- 不明点があれば `--force` で押し切らず、ユーザーに確認する。
