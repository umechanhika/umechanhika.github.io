# umechanhika.com

梅津 光のポートフォリオサイトです。<https://umechanhika.com/>

GitHub Pages が `master` ブランチのルートをそのまま配信します。ビルドはありません。

## ファイル

| パス | 中身 |
|------|------|
| `index.html` | サイト本体。1ページで完結します |
| `style.css` | スタイル。設計の方針はファイル冒頭のコメントにあります |
| `route-map.js` | ヘッダーの経路図と本文のスクロールを同期します |
| `assets/` | 画像 |
| `tools/ogp.html` | OGP 画像の版下 |
| `robots.txt` | クローラー向けの許可設定とサイトマップの場所 |
| `sitemap.xml` | 検索エンジン向けのサイトマップ。ページを増やしたら追記します |
| `CNAME` | GitHub Pages のカスタムドメイン設定 |
| `app-ads.txt` | AdMob の広告枠所有者を宣言するファイル |
## ローカルで確認する

```
python3 -m http.server 8000
```

<http://localhost:8000/> を開きます。
