---
name: desktop-style
description: OpenCode デスクトップにグルーピングの枠／開閉マーカーを適用する（非公式）
---

OpenCode デスクトップの見た目カスタム（ツール実行のまとまり・アシスタント応答の枠、開閉マーカー +/−）を適用する。

非公式 CLI `opencode-desktop-style` を npx で実行する。

1. 状態確認:
   ```
   npx -y opencode-desktop-style status
   ```
2. アプリが起動中なら、アプリを閉じてもらう（強行しない）。
3. 適用:
   ```
   npx -y opencode-desktop-style apply
   ```
4. 反映には OpenCode の再起動が必要。再起動なしで確認したい場合は:
   ```
   npx -y opencode-desktop-style preview
   ```
   の出力を DevTools の Console に貼る。

アプリ更新後に見た目が消えたら、同じ `apply` を再実行すればよい。

元に戻す場合は `/desktop-style-revert` を使う。
