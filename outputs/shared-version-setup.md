# v.ridge参加記録 共有版の公開手順

## 1. Realtime設定を追加

SupabaseのSQL Editorで、最新版の`supabase-setup.sql`をすべて実行します。
既存テーブルやポリシーは保持・更新されるため、再実行して問題ありません。

## 2. GitHubへ更新ファイルをアップロード

以下を`ArakawaYuki/circle-check`のルートへ上書きアップロードします。

- `index.html`
- `app.js`
- `styles.css`
- `service-worker.js`
- `README.md`
- `manifest.webmanifest`
- `icons`フォルダ

GitHub Pagesへの反映後、公開URLを開くとログイン画面が表示されます。

## 3. 最初のログイン

Supabase Authenticationで作成した管理者メールアドレスとパスワードでログインします。

共有データが空で、以前の端末データが残っている場合は、メンバー画面に
「端末データを共有へ移行」ボタンが表示されます。バックアップを保存してから実行してください。

## 4. 共同編集者を追加

1. Supabaseの`Authentication > Users`から利用者を作成または招待します。
2. SQL Editorで、その人を編集者として登録します。

```sql
insert into public.app_users (user_id, display_name, role)
select id, '表示名', 'editor'
from auth.users
where email = '利用者のメールアドレス'
on conflict (user_id) do update
set display_name = excluded.display_name, role = excluded.role;
```

権限は`admin`、`editor`、`viewer`から選択できます。

- `admin`: 全編集、バックアップ復元、端末データ移行
- `editor`: メンバー・活動・参加記録を編集
- `viewer`: 閲覧・CSV・バックアップ保存のみ

利用停止時は`app_users`から対象者を削除し、必要に応じてAuthenticationのユーザーも削除します。
