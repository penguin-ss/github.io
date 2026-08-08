# 宿題QR 共有カメラ

GitHub Pagesへ配置するカメラ専用の静的ページです。

- GAS画面から `window.open` で起動する
- `channel` と `parentOrigin` をURLパラメータで受け取る
- QRから読み取った固定トークンだけを `postMessage` で元のGAS画面へ返す
- 児童名簿、氏名、PIN、スプレッドシートIDは持たない
- カメラ画像は保存・送信しない

公開URLは `https://penguin-ss.github.io/github.io/homework-qr-scanner/` です。直接開いた場合は保存先がないためカメラを起動せず、GAS Webアプリから起動する運用にします。
