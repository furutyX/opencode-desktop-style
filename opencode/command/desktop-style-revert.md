---
name: desktop-style-revert
description: OpenCode デスクトップの見た目カスタム（枠・開閉マーカー）を元に戻す
---

OpenCode デスクトップの見た目カスタムを除去して、素の見た目に戻す（レイアウト崩れ時のロールバック）。

1. 状態確認:
   ```
   npx -y opencode-desktop-style status
   ```
2. アプリが起動中なら、アプリを閉じてもらう。
3. 元に戻す:
   ```
   npx -y opencode-desktop-style revert
   ```
4. OpenCode を再起動すると素の見た目に戻る。

`backup: (none)` の場合は、アプリの再インストール/更新で `app.asar` が新品に戻るか、
`--asar <path>` を明示して実行する。
