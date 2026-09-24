# TRPG Studio

GMとPCが同じルームでリアルタイムにメッセージを送受信する最小構成です。

## 起動

```text
npm install
npm start
```

ブラウザで `http://localhost:3000` を開き、GMがルームIDを決めてPCへ参加URLを共有します。メッセージ履歴はサーバーのメモリ上に保持され、サーバー再起動で消えます。