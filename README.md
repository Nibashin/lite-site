# 館山 夜釣り遠征 釣果ボード

2026.10.16〜17 の館山夜釣り遠征で、釣果を報告し合うためのサイトです。

- 4つのポイント(船形漁港・沖ノ島護岸・坂田漁港・洲崎灯台周辺)を地図と航空写真で表示
- 真ん中のピンに地図を合わせて釣れた場所を決め、魚(選択式)・サイズ・ひとこと・写真を登録
- ホワイトボード風のランキング(釣果数・アオリイカ最大・クロダイ最大・その他)を常に表示。釣果の写真を大きく貼り出し
- 誰かが登録すると、開いている全員の画面にすぐ反映
- 釣果を開くと、ほかの人がスタンプ(ナイス！・でかっ・うらやま・おめ)とコメントで反応できる
- 持って帰った魚の料理を、写真・ひとこと付きで記録。どの釣果を使ったかでつながる
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
4. 続けて [`supabase/update-2.sql`](supabase/update-2.sql)、[`supabase/update-3.sql`](supabase/update-3.sql)、[`supabase/update-4.sql`](supabase/update-4.sql)、[`supabase/update-5.sql`](supabase/update-5.sql) も同じように貼って **Run** する

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

---

# 筋トレ記録(`workout/`)

同じリポジトリの `workout/` フォルダに、開いてすぐ記録できる筋トレログを置いています。
公開URL:`https://<ユーザー名>.github.io/lite-site/workout/`

- 開いた瞬間、前回の種目・重量・回数が入った状態で「セット記録」が押せる
- 重量は ±2.5 / ±5、回数は ±1 のボタン。数字をタップすれば直接入力もできる
- きょうの記録は種目ごとにまとまって表示。×で削除(取り消しもできる)。行をタップすると日付・時刻・種目・重量・回数・メモを編集できる
- 上の ‹ › で日付を移動。過去の日を開いて「セット記録」を押すと、その日付で記録される(「きょう」をタップでカレンダー、別の日からは「きょう」に戻る)
- 「履歴」から CSV(今月 / 全部)を書き出し。スマホなら共有シートでファイルに保存できる
- CSV の読み込み(機種変更や手直し用)
- ホーム画面に追加するとアプリっぽく開けて、オフラインでも動く
- データはこの端末に保存。Supabase をつなぐと別の端末とも同期できる

## Supabase 同期を使う(任意)

1. Supabase の **SQL Editor** で [`supabase/workout.sql`](supabase/workout.sql) をまるごと貼って **Run**
2. **Project Settings → API** の「Project URL」と「anon public」キーを [`workout/config.js`](workout/config.js) に貼る
3. アプリの ⚙ 設定で好きな**合言葉**(4文字以上)を入れて「保存して同期」

同じ合言葉を入れた端末どうしで同じ記録が見られます。釣果ボードと同じプロジェクトを使ってもかまいません(テーブルは別です)。

## CSV の列

`日付, 時刻, 種目, 重量kg, 回数, ボリューム, メモ, id`(UTF-8 BOM付き。Excel でそのまま開けます)
