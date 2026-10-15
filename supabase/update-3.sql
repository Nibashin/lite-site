-- アップデート3:4か所目のポイント「洲崎灯台周辺」(sunosaki)を追加
-- SQL Editor に貼って「Run」してください。今までの釣果はそのまま残ります。
alter table public.catches drop constraint if exists catches_spot_check;
alter table public.catches
  add constraint catches_spot_check
  check (spot in ('funakata', 'okinoshima', 'sakata', 'sunosaki'));
