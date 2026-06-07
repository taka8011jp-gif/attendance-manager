# 勤怠管理アプリ

スタッフコードでログインし、勤務開始・勤務終了の1ボタンで勤怠を記録するアプリです。
Supabaseを設定した本番環境では、勤怠データはSupabaseに共有保存されます。
同じVercel URLを開いたスマホ・PCで同じ記録を確認できます。

## 本番構成

- GitHub: コード管理
- Vercel: スマホから開く公開URL
- Supabase: 勤怠データの共有保存

## Supabase設定

SupabaseのSQL Editorで `supabase/attendance-store.sql` を実行します。

Vercelの環境変数に次を登録します。

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

`SUPABASE_SERVICE_ROLE_KEY` は管理用の秘密キーです。ブラウザ側には出さず、Vercelの環境変数にだけ入れてください。

## ローカルで試す

PCで次を実行します。

```bash
npm install
npm run dev -- --hostname 0.0.0.0
```

スマホのブラウザで次の形のURLを開きます。

```text
http://PCのIPアドレス:3000
```

例:

```text
http://192.168.1.25:3000
```

Windowsのファイアウォール確認が出た場合は許可してください。PCの電源が切れたりスリープしたりすると、スマホからも開けなくなります。

`.env.local` にSupabaseの環境変数を入れると、ローカルでもSupabaseに保存します。環境変数がない場合はPC内の `data/attendance-store.json` に保存します。

## 初期コード

- 店長: `1000`
- 佐藤: `1001`
- 鈴木: `1002`
- 管理者専用コード: `19788011`

## ローカル保存先

Supabase未設定時の勤怠データは `data/attendance-store.json` に保存されます。
営業日は午前7時から翌午前7時です。午前7時を過ぎても勤務終了がない場合は未登録として扱います。

外出先や別店舗からも使う場合は、GitHubにアップロードしてVercelに接続し、Supabaseの環境変数をVercelへ登録してください。
