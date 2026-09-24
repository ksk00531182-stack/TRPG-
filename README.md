# TRPG Studio

GMとPCが同じルームでリアルタイムにメッセージを送受信する最小構成です。

## 起動

```text
npm install
npm start
```

ブラウザで `http://localhost:3000` を開き、GMがルームIDを決めてPCへ参加URLを共有します。メッセージ履歴はサーバーのメモリ上に保持され、サーバー再起動で消えます。

## R2設定

Renderまたはローカル環境に次の環境変数を設定すると、GM画面から素材をR2へ直接アップロードできます。

```text
R2_ACCOUNT_ID=Cloudflare Account ID
R2_ACCESS_KEY_ID=R2 Access Key ID
R2_SECRET_ACCESS_KEY=R2 Secret Access Key
R2_BUCKET_NAME=R2 bucket name
```

R2バケットのCORSには、TRPG StudioのURLからの `PUT` と `GET` を許可してください。開発中は `http://localhost:3000`、Renderでは実際のサービスURLを許可します。認証情報はブラウザやリポジトリへ書き込まないでください。

R2のCORS設定例:

```json
[
	{
		"AllowedOrigins": ["http://localhost:3000", "https://あなたのサービス.onrender.com"],
		"AllowedMethods": ["GET", "PUT", "HEAD"],
		"AllowedHeaders": ["Content-Type"],
		"ExposeHeaders": ["ETag"],
		"MaxAgeSeconds": 3600
	}
]
```