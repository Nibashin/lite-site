# 館山 夜釣り遠征 釣果ボード

2026.10.16〜17 の館山夜釣り遠征で、釣果を報告し合うためのサイトです。

- 3つのポイント(船形漁港・沖ノ島護岸・坂田漁港)を地図と航空写真で表示
- 真ん中のピンに地図を合わせて釣れた場所を決め、魚(選択式)・サイズ・ひとこと・写真を登録
- ランキング(釣果数・アオリイカ最大・クロダイ最大・ほかの魚)を常に表示
- 誰かが登録すると、開いている全員の画面にすぐ反映
- 最新の1匹をタイトルの下に大きく表示
- 名前とアイコンはブラウザに記憶。同じ名前を入れるとアイコンが復活(上書きもOK)。一度登録した名前は合言葉いらず
- スケジュールページ(`schedule.html`)でみんなで予定を見て編集
- 地図の「ここを初期位置にする」で、各ポイントを押したときの表示位置を保存

地図と航空写真には国土地理院の「地理院タイル」を使っています。

## 使えるようにする手順

Supabase をつながなくても「お試しモード」で動きます。この場合、データはその端末にだけ保存されます。
友達と共有するには、以下を一度だけ設定します。

### 1. Supabase のプロジェクトを作る

1. https://supabase.com で無料アカウントを作り、「New project」でプロジェクトを作る(リージョンは Tokyo がおすすめ)
2. 左メニューの **SQL Editor** を開き、[`supabase/setup.sql`](supabase/setup.sql) の中身をまるごと貼り付ける
3. SQL の中の `'tateyama'` を、友達だけに教える**合言葉**に書き換えてから **Run** を押す
4. 続けて [`supabase/update-2.sql`](supabase/update-2.sql) も同じように貼って **Run** する

### 2. 接続情報をサイトに入れる

1. Supabase の **Project Settings → API** を開く
2. 「Project URL」と「anon public」キーを [`js/config.js`](js/config.js) に貼り付ける

```js
window.FISHING_CONFIG = {
  supabaseUrl: 'https://xxxxxxxx.supabase.co',
  supabaseAnonKey: 'eyJhbGciOi...',
};
```

anon キーは公開しても大丈夫なキーです。書き込みと削除は合言葉で守られています。

### 3. GitHub Pages で公開する

GitHub のリポジトリで **Settings → Pages** を開き、「Branch」に `main` / `/ (root)` を選んで保存します。
数分後に `https://<ユーザー名>.github.io/lite-site/` で開けるようになります。

## 調整したいとき

- ポイントの地図の中心やズーム → 地図を合わせて「ここを初期位置にする」(元の値は `js/common.js` の `SPOT_GEO`)
- 魚のリスト → `js/common.js` の `FISH`
- スケジュールやポイントの説明 → スケジュールページの「編集する」
- 合言葉を変える → Supabase の SQL Editor で `check_passcode` 関数を書き換えて再実行
