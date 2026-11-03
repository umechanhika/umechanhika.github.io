/* テラリアモード。ページの末尾まで読んだ人へのおまけ。

   末尾の「テラリアモードで遊ぶ」を押すと、今見えている画面がそのまま闘技場になり、
   サイト主のアイコンをドットに起こしたキャラが地面に立つ。左右から跳ねて来るスライムを
   避けながら戦う。射撃は自動で、向いている側のいちばん近いスライムを狙って連射する。
   矢印キー（スマホはスティック）で移動、上で跳び、押し続けると燃料のある間だけ飛ぶ。
   スライムに触れるとハートが減り、3 つ失うと終わり。得点と自己ベストを出して、すぐ再挑戦できる。

   外れたレーザーは掲載情報に当たって壊す。壊すのは見た目だけで、要素に tr-gone を付けて
   visibility: hidden にするのでレイアウトは崩れず、再挑戦とやめるときに全部元に戻す。

   座標はすべて文書座標（画面座標に scrollY を足した値）で持つ。ページはスクロールさせず、
   画面に固定した canvas に地面・スライム・キャラ・レーザー・破片を描く。 */
(function () {
  'use strict';

  var root = document.documentElement;
  var launchRow = document.querySelector('.tr-launch-row');
  var launch = document.querySelector('.tr-launch');
  var launchIcon = document.querySelector('.tr-launch__icon');
  if (!launchRow || !launch || !launchIcon) throw new Error('terraria-mode: 起動ボタンが見つからない');

  /* --- ドット絵 ---------------------------------------------------
     サイト主のアイコン（黒いスーツに白いシャツのドロイド）をドットに起こしたもの。
     右向きの 14x18 マス。'.' は透明。左向きは左右反転して描く。
     左端 2 列は背中のジェットパック。前の腕と銃は狙いに合わせて回すので別に描く。 */
  var PALETTE = {
    A: '#8fc34a', /* ドロイドの緑。頭と手 */
    D: '#161616', /* 髪 */
    W: '#ececec', /* 目とシャツ */
    K: '#333333', /* スーツ */
    P: '#161616', /* ズボン */
    N: '#e0e0e0', /* スニーカー */
    O: '#8a8f94', /* スニーカーの底。紙色に白が溶けないための縁 */
    J: '#7d8591', /* ジェットパック */
    L: '#c9d1dc', /* ジェットパックの光と銃身の先 */
    R: '#d9412f', /* ノズル */
    G: '#4a5160', /* 銃身 */
    M: '#ff3b3b'  /* 銃口 */
  };
  var BODY = [
    '.....A...A....',
    '....DDDDDDA...',
    '...DDDDAAAAA..',
    '...DAAAAWAWA..',
    '...AAAAAAAAA..',
    '...AAAAAAAAA..',
    'JJ.KKKAAAKKK..',
    'JL.KKKWAWKKK..',
    'JJ.KKKWWWKKK..',
    'JJ.KKKWWWKKK..',
    'JJ.KKKWWWKKK..',
    'RR.KKKWWWKKK..',
    '...KKKWWWKKK..',
    '...KKKWWWKKK..',
    '...KKKWWWKKK..',
    '...KKKWWWKKK..',
    '...KKKWWWKKK..'
  ];
  /* 脚は元の絵のとおり、長い上着の裾から細い 2 本が出て、外向きに広い靴を履く */
  var LEGS_STAND = [
    '....PP..PP....',
    '....PP..PP....',
    '....PP..PP....',
    '....PP..PP....',
    '....PP..PP....',
    '..NNNN..NNNN..',
    '..OOOO..OOOO..'
  ];
  var LEGS_WALK = [
    '...PP....PP...',
    '...PP....PP...',
    '..PP......PP..',
    '..PP......PP..',
    '..PP......PP..',
    'NNNN......NNNN',
    'OOOO......OOOO'
  ];
  var SPRITE_W = 14;
  var SPRITE_H = 24;
  /* 肩の位置（スプライト内のマス）。銃はここを軸に回す */
  var SHOULDER_COL = 9;
  var SHOULDER_ROW = 7;
  /* 肩から銃口までの長さ（マス） */
  var GUN_LEN = 17;

  function drawRows(ctx, rows, ox, oy, scale, palette) {
    var colors = palette || PALETTE;
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      for (var c = 0; c < row.length; c++) {
        var ch = row.charAt(c);
        if (ch === '.') continue;
        ctx.fillStyle = colors[ch];
        ctx.fillRect(ox + c * scale, oy + r * scale, scale, scale);
      }
    }
  }

  /* 起動ボタンの中のキャラ */
  (function drawLaunchIcon() {
    var ctx = launchIcon.getContext('2d');
    var scale = launchIcon.width / SPRITE_W;
    drawRows(ctx, BODY, 0, 0, scale);
    drawRows(ctx, LEGS_STAND, 0, BODY.length * scale, scale);
  })();

  /* --- 末尾まで読んだら起動ボタンを出す --- */

  function atBottom() {
    return window.innerHeight + window.scrollY >= root.scrollHeight - 24;
  }
  function revealIfBottom() {
    if (!atBottom()) return;
    launchRow.classList.add('is-ready');
    window.removeEventListener('scroll', revealIfBottom);
    window.removeEventListener('resize', revealIfBottom);
  }
  window.addEventListener('scroll', revealIfBottom, { passive: true });
  window.addEventListener('resize', revealIfBottom);
  revealIfBottom();

  /* --- 壊せるもの ---------------------------------------------------
     葉: 見出し・段落・リスト項目・画像など、それ以上分けない要素。1 つずつ壊す。
     箱: カードや参照の枠。中の葉を全部壊すと枠も消える。生きている間は足場になる。 */
  var LEAF = 'h1, h2, h3, p, li, img, dl > div, a.channel, a.btn, .site-foot__index a, .ref__label, .ref__title, .ref__desc';
  var BOX = '.card, .ref, .job';
  /* 足場になる葉。文章の上には乗れない */
  var PLATFORM_LEAF = 'img, dl > div, a.channel, a.btn, .tags li';
  var SKIP = '.site-head, .skip, .route-bus, .tr-launch-row, .tr-ui';
  var TEXT_COLORS = ['#201a13', '#4d443a', '#6f6353'];
  var FRAME_COLORS = ['#e3dac8', '#efe7d6', '#fffdf6'];

  function rectOf(el) {
    var r = el.getBoundingClientRect();
    return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height };
  }

  /* 同一オリジンの画像から破片の色を拾う */
  function imageColors(img) {
    if (!(img.complete && img.naturalWidth > 0)) return TEXT_COLORS;
    if (new URL(img.currentSrc || img.src, location.href).origin !== location.origin) return TEXT_COLORS;
    var c = document.createElement('canvas');
    c.width = 6;
    c.height = 6;
    var g = c.getContext('2d');
    g.drawImage(img, 0, 0, 6, 6);
    var d = g.getImageData(0, 0, 6, 6).data;
    var colors = [];
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      colors.push('rgb(' + d[i] + ',' + d[i + 1] + ',' + d[i + 2] + ')');
    }
    return colors.length ? colors : TEXT_COLORS;
  }

  function collectTargets() {
    var leaves = [];
    var boxes = [];
    var boxByEl = [];
    var nodes = document.querySelectorAll(LEAF);
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.closest(SKIP)) continue;
      if (el.querySelector(LEAF)) continue;
      var r = rectOf(el);
      if (r.w < 2 || r.h < 2) continue;
      var isImg = el.tagName === 'IMG';
      var leaf = {
        el: el,
        x: r.x, y: r.y, w: r.w, h: r.h,
        hp: 0,
        maxHp: Math.max(2, Math.min(40, Math.round(r.w * r.h / 7000))),
        alive: true,
        platform: el.matches(PLATFORM_LEAF),
        colors: isImg ? imageColors(el) : el.matches('.tags li, a.channel, a.btn') ? FRAME_COLORS : TEXT_COLORS,
        box: null,
        hitUntil: 0
      };
      var boxEl = el.closest(BOX);
      if (boxEl) {
        var idx = boxByEl.indexOf(boxEl);
        if (idx < 0) {
          var br = rectOf(boxEl);
          boxByEl.push(boxEl);
          boxes.push({
            el: boxEl,
            x: br.x, y: br.y, w: br.w, h: br.h,
            alive: true,
            platform: boxEl.matches('.card, .ref'),
            colors: FRAME_COLORS,
            leaves: []
          });
          idx = boxes.length - 1;
        }
        leaf.box = boxes[idx];
        boxes[idx].leaves.push(leaf);
      }
      leaf.hp = leaf.maxHp;
      leaves.push(leaf);
    }
    return { leaves: leaves, boxes: boxes };
  }

  function remeasure(world) {
    world.leaves.forEach(function (t) {
      var r = rectOf(t.el);
      t.x = r.x; t.y = r.y; t.w = r.w; t.h = r.h;
    });
    world.boxes.forEach(function (b) {
      var r = rectOf(b.el);
      b.x = r.x; b.y = r.y; b.w = r.w; b.h = r.h;
    });
  }

  /* タイルの位置から 0〜1 を決める。描くたびに変わらないので模様がちらつかない */
  function noise(i, j) {
    var n = (i * 73856093) ^ (j * 19349663);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }

  /* --- 画面の部品 --- */

  function el(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text) e.textContent = text;
    return e;
  }

  /* 親指で倒すスティック。中心からのずれを -1〜1 のベクトルで知らせる */
  function makeStick(pad, knob, radius, onChange) {
    var id = null;
    var cx = 0;
    var cy = 0;
    function update(e) {
      var dx = e.clientX - cx;
      var dy = e.clientY - cy;
      var len = Math.sqrt(dx * dx + dy * dy);
      var k = len > radius ? radius / len : 1;
      knob.style.transform = 'translate(' + dx * k + 'px, ' + dy * k + 'px)';
      onChange({ x: dx * k / radius, y: dy * k / radius }, true);
    }
    pad.addEventListener('pointerdown', function (e) {
      if (id !== null) return;
      e.preventDefault();
      id = e.pointerId;
      pad.setPointerCapture(id);
      var r = pad.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      update(e);
    });
    pad.addEventListener('pointermove', function (e) {
      if (e.pointerId === id) update(e);
    });
    function release(e) {
      if (e.pointerId !== id) return;
      id = null;
      knob.style.transform = '';
      onChange({ x: 0, y: 0 }, false);
    }
    pad.addEventListener('pointerup', release);
    pad.addEventListener('pointercancel', release);
  }

  /* --- スライム ---------------------------------------------------
     テラリアのスライムと同じで、地面で少し休んでからキャラへ向かって跳ねる。
     大きさはマス数。速さ・跳ぶ高さ・休む時間・体力・倒した点が種類で違う。 */
  var SLIME_TYPES = {
    green: { cw: 10, ch: 7, hp: 3, speed: 150, jump: 600, rest: 0.42, points: 10, body: '#5db13e', light: '#a3e27f', eye: '#1d3a12' },
    blue: { cw: 12, ch: 8, hp: 6, speed: 180, jump: 660, rest: 0.36, points: 20, body: '#3d7ed6', light: '#9cc3f2', eye: '#122a55' },
    red: { cw: 14, ch: 10, hp: 10, speed: 200, jump: 740, rest: 0.3, points: 40, body: '#d2473a', light: '#f2a497', eye: '#4a1410' }
  };

  /* n 番目のウェーブの構成。数と速さが少しずつ増え、3 から青、5 から赤が混ざる */
  function waveSpec(n) {
    return {
      count: Math.min(20, 4 + 2 * (n - 1)),
      interval: Math.max(0.45, 1.3 - 0.1 * (n - 1)),
      speed: 1 + 0.07 * (n - 1),
      pick: function () {
        var r = Math.random();
        if (n >= 5 && r < 0.2) return 'red';
        if (n >= 3 && r < 0.5) return 'blue';
        return 'green';
      }
    };
  }

  /* 自己ベスト。端末に残す。プライベートブラウズなどで保存できない環境では 0 のまま扱う */
  var BEST_KEY = 'terraria-mode.best';
  function readBest() {
    try {
      return Number(localStorage.getItem(BEST_KEY)) || 0;
    } catch (e) {
      return 0;
    }
  }
  function writeBest(v) {
    try {
      localStorage.setItem(BEST_KEY, String(v));
    } catch (e) {
      /* 保存できない環境。画面の表示は今回の値で続ける */
    }
  }

  /* 墓石。やられた場所に落ちて来て、再挑戦しても地面に残る */
  var GRAVE_PALETTE = { G: '#8d9196', D: '#5c6066', L: '#b9bdc2' };
  var GRAVE = [
    '..LGGG..',
    '.LGGGGG.',
    'LGGGGGGG',
    'LGGDDGGG',
    'LGDDDDGG',
    'LGGDDGGG',
    'LGGDDGGG',
    'LGGGGGGG',
    'LGGGGGGG',
    'DDDDDDDD'
  ];
  var GRAVE_W = 8;
  var GRAVE_H = 10;

  /* --- 強化アイテム -------------------------------------------------
     壊した掲載情報から落ちる。拾うと一定時間、戦いが楽になる。
     dual: 二丁拳銃。背中側にも銃を持ち、両側のスライムを同時に狙う
     jet: 無限ジェット。燃料が減らない
     heart: ハートが 1 つ戻る。これだけはスライムから低確率で落ちる */
  var ITEM_PALETTE = {
    G: '#4a5160', L: '#c9d1dc', M: '#ff3b3b', K: '#2b2b2b',
    J: '#7d8591', R: '#d9412f', F: '#ffb13b', Y: '#ffe08a',
    H: '#ff3b3b', P: '#ff8a8a'
  };
  var ITEMS = {
    dual: {
      name: '二丁拳銃', color: '#6b8cff', seconds: 10,
      rows: [
        '.GGGGGGLM',
        '.GGGGGGLM',
        '..KK.....',
        '.........',
        'MLGGGGGG.',
        'MLGGGGGG.',
        '.....KK..'
      ]
    },
    jet: {
      name: '無限ジェット', color: '#ffb13b', seconds: 10,
      rows: [
        '.JJJJ.',
        'JJLJJJ',
        'JJJJJJ',
        'JJJJJJ',
        'JJJJJJ',
        'RR..RR',
        'FF..FF',
        'YF..FY',
        '.Y..Y.'
      ]
    },
    heart: {
      name: 'ハート', color: '#ff3b3b', seconds: 0,
      rows: [
        '.HH.HH.',
        'HPHHHHH',
        'HHHHHHH',
        '.HHHHH.',
        '..HHH..',
        '...H...'
      ]
    }
  };
  var ITEM_LIFE = 14;

  /* ドット絵のハート。HUD の残り体力に使う */
  var HEART_SVG = '<svg viewBox="0 0 7 6" width="14" height="12" aria-hidden="true" shape-rendering="crispEdges">' +
    '<rect x="1" y="0" width="2" height="1"/><rect x="4" y="0" width="2" height="1"/>' +
    '<rect x="0" y="1" width="7" height="2"/><rect x="1" y="3" width="5" height="1"/>' +
    '<rect x="2" y="4" width="3" height="1"/><rect x="3" y="5" width="1" height="1"/></svg>';

  /* --- ゲーム本体 --- */

  var game = null;
  var HEARTS = 3;

  function start() {
    if (game) return;
    var coarse = window.matchMedia('(pointer: coarse)').matches;
    var scale = window.matchMedia('(max-width: 720px)').matches ? 2 : 3;
    /* 速さはキャラの大きさに比例させる。小さい画面では小さく、遅く */
    var k = scale / 3;

    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    root.classList.add('tr-playing');

    /* --- 画面の部品を組む --- */

    var canvas = el('canvas', 'tr-canvas');
    canvas.setAttribute('aria-hidden', 'true');
    var ui = el('div', 'tr-ui' + (coarse ? ' is-touch' : ''));

    var hud = el('div', 'tr-hud');
    var hearts = el('div', 'tr-hearts');
    hearts.setAttribute('aria-label', '残り体力');
    var heartEls = [];
    for (var hi = 0; hi < HEARTS; hi++) {
      var heart = el('span', 'tr-heart');
      heart.innerHTML = HEART_SVG;
      hearts.appendChild(heart);
      heartEls.push(heart);
    }
    var waveEl = el('span', 'tr-stat');
    var scoreEl = el('span', 'tr-stat');
    var bestEl = el('span', 'tr-stat');
    var quit = el('button', 'tr-quit', 'やめる');
    quit.type = 'button';
    hud.appendChild(hearts);
    hud.appendChild(waveEl);
    hud.appendChild(scoreEl);
    hud.appendChild(bestEl);
    hud.appendChild(quit);

    var pad = el('div', 'tr-pad');
    var stick = el('div', 'tr-stick');
    stick.setAttribute('aria-label', '移動スティック');
    var stickKnob = el('span', 'tr-knob');
    stick.appendChild(stickKnob);
    pad.appendChild(stick);

    var banner = el('p', 'tr-banner');
    var bannerWave = el('span', 'tr-banner__wave');
    var bannerNote = el('span', 'tr-banner__note');
    banner.appendChild(bannerWave);
    banner.appendChild(bannerNote);

    var over = el('div', 'tr-over');
    over.hidden = true;
    var overTitle = el('p', 'tr-over__title', 'スライムにやられました');
    var overScore = el('p', 'tr-over__score');
    var overBest = el('p', 'tr-over__best');
    var overActions = el('div', 'tr-over__actions');
    var retry = el('button', 'tr-retry', coarse ? 'もう一回' : 'もう一回（Space）');
    retry.type = 'button';
    var overQuit = el('button', 'tr-quit', 'やめる');
    overQuit.type = 'button';
    overActions.appendChild(retry);
    overActions.appendChild(overQuit);
    over.appendChild(overTitle);
    over.appendChild(overScore);
    over.appendChild(overBest);
    over.appendChild(overActions);

    ui.appendChild(hud);
    ui.appendChild(pad);
    ui.appendChild(banner);
    ui.appendChild(over);
    document.body.appendChild(canvas);
    document.body.appendChild(ui);

    var ctx = canvas.getContext('2d');
    var dpr = 1;
    function sizeCanvas() {
      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
    }
    sizeCanvas();

    /* --- 闘技場 ---------------------------------------------------
       今見えている画面がそのまま闘技場。ページはスクロールさせない。
       下の 22% は地面で、その上端が床。壊せるのは画面に入っている要素だけ。 */
    var world = collectTargets();
    var arena = { left: 0, top: 0, width: 0, height: 0, floorY: 0, groundH: 0 };
    var near = [];
    function measureArena() {
      arena.left = window.scrollX;
      arena.top = window.scrollY;
      arena.width = window.innerWidth;
      arena.height = window.innerHeight;
      arena.groundH = Math.round(window.innerHeight * 0.22);
      arena.floorY = arena.top + arena.height - arena.groundH;
      ui.style.setProperty('--tr-ground', arena.groundH + 'px');
      near = world.leaves.filter(function (t) {
        return t.x < arena.left + arena.width && t.x + t.w > arena.left &&
          t.y < arena.floorY && t.y + t.h > arena.top;
      });
    }
    measureArena();

    /* --- 状態 --- */

    var player = {
      w: SPRITE_W * scale,
      h: SPRITE_H * scale,
      x: 0, y: 0, vx: 0, vy: 0,
      facing: 1,
      onGround: false,
      thrusting: false,
      fuel: 1,
      hearts: HEARTS,
      invUntil: 0,
      dead: false,
      walkT: 0,
      walkFrame: 0,
      gunAngle: 0,
      gunAngle2: 0
    };
    var FUEL_SECONDS = 1.0;
    var keys = { left: false, right: false, jump: false };
    var stickV = { x: 0, y: 0 };
    var stickOn = false;
    var tapJump = false;
    var jumpWasDown = false;
    var slimes = [];
    var lasers = [];
    var particles = [];
    var graves = [];
    var items = [];
    var floaters = [];
    var buff = { dual: 0, jet: 0 };
    var drops = 0;
    var pickups = 0;
    var flashing = [];
    var shotCooldown = 0;
    var muzzleFlash = 0;
    var SHOT_INTERVAL = 0.12;
    var state = 'play';
    var deadTimer = 0;
    var wave = 0;
    var spec = null;
    var toSpawn = 0;
    var spawnTimer = 0;
    var spawnLeft = true;
    var waveGap = 0.6;
    var score = 0;
    var destroyed = 0;
    var best = readBest();
    var bannerTimer = 0;
    var runStart = performance.now();

    function resetPlayer() {
      player.x = arena.left + arena.width / 2 - player.w / 2;
      player.y = arena.floorY - player.h;
      player.vx = 0;
      player.vy = 0;
      player.facing = 1;
      player.onGround = true;
      player.fuel = 1;
      player.hearts = HEARTS;
      player.invUntil = 0;
      player.dead = false;
    }
    resetPlayer();

    function updateHud() {
      heartEls.forEach(function (h, i) { h.classList.toggle('is-lost', i >= player.hearts); });
      waveEl.textContent = 'WAVE ' + Math.max(1, wave);
      scoreEl.textContent = 'スコア ' + score;
      bestEl.textContent = 'ベスト ' + best;
    }
    updateHud();

    function showBanner(n, count) {
      bannerWave.textContent = 'WAVE ' + n;
      bannerNote.textContent = 'スライムが ' + count + ' 匹来ます';
      banner.classList.add('is-shown');
      bannerTimer = 2.2;
    }

    /* --- 入力 --- */

    var KEYS = {
      ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'jump', ' ': 'jump',
      a: 'left', d: 'right', w: 'jump'
    };
    function onKey(e, down) {
      if (e.key === 'Escape') {
        if (down) stop();
        return;
      }
      if (state === 'over' && down && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        restart();
        return;
      }
      var name = KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (!name) return;
      e.preventDefault();
      keys[name] = down;
    }
    function onKeyDown(e) { onKey(e, true); }
    function onKeyUp(e) { onKey(e, false); }
    /* 闘技場のタップ・クリックはジャンプ。押している間は飛ぶ */
    function onPointerDown(e) {
      if (e.button !== 0) return;
      e.preventDefault();
      tapJump = true;
    }
    function onPointerUp() { tapJump = false; }
    function prevent(e) { e.preventDefault(); }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('contextmenu', prevent);
    quit.addEventListener('click', stop);
    overQuit.addEventListener('click', stop);
    retry.addEventListener('click', restart);

    makeStick(stick, stickKnob, 40, function (v, on) {
      stickV = v;
      stickOn = on;
    });

    var resizeRaf = 0;
    function onResize() {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(function () {
        resizeRaf = 0;
        sizeCanvas();
        remeasure(world);
        measureArena();
      });
    }
    window.addEventListener('resize', onResize);

    /* --- 破片と光 --- */

    function pushParticle(p) {
      if (particles.length < 900) particles.push(p);
    }

    function spawnDebris(x, y, w, h, n, size, colors) {
      for (var i = 0; i < n; i++) {
        pushParticle({
          x: x + Math.random() * w,
          y: y + Math.random() * h,
          vx: (Math.random() - 0.5) * 360 * k,
          vy: (-Math.random() * 320 - 40) * k,
          life: 0.8 + Math.random() * 0.7,
          age: 0,
          size: size,
          color: colors[Math.floor(Math.random() * colors.length)]
        });
      }
    }

    function spawnSparks(x, y, dir, colors) {
      for (var i = 0; i < 4; i++) {
        var a = Math.atan2(dir.y, dir.x) + Math.PI + (Math.random() - 0.5) * 1.6;
        var s = (120 + Math.random() * 220) * k;
        pushParticle({
          x: x, y: y,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s,
          life: 0.25 + Math.random() * 0.2,
          age: 0,
          size: Math.max(2, scale - 1),
          color: colors[Math.floor(Math.random() * colors.length)]
        });
      }
    }

    function flash(t, now) {
      if (!t.hitUntil) {
        t.el.classList.add('tr-hit');
        flashing.push(t);
      }
      t.hitUntil = now + 0.09;
    }

    /* 掲載情報を壊す。壊した数は得点に足す */
    function destroyTarget(t) {
      t.alive = false;
      t.el.classList.add('tr-gone');
      spawnDebris(t.x, Math.max(t.y, arena.top), t.w, Math.min(t.y + t.h, arena.floorY) - Math.max(t.y, arena.top),
        Math.max(6, Math.min(50, Math.round(t.w * t.h / 1500))), scale, t.colors);
      destroyed++;
      score += 2;
      dropFromTarget(t);
      var box = t.box;
      if (box && box.alive && box.leaves.every(function (l) { return !l.alive; })) {
        box.alive = false;
        box.el.classList.add('tr-gone');
        spawnDebris(box.x, box.y, box.w, box.h, 24, scale, box.colors);
        dropItem(Math.random() < 0.5 ? 'dual' : 'jet', box.x + box.w / 2, Math.min(Math.max(box.y + box.h / 2, arena.top + 20), arena.floorY - 20));
      }
    }

    /* アイテムを落とす。落ちた場所が画面の外なら中へ寄せる */
    function dropItem(key, x, y) {
      var def = ITEMS[key];
      var w = def.rows[0].length * scale;
      var h = def.rows.length * scale;
      items.push({
        key: key,
        x: Math.min(Math.max(x - w / 2, arena.left + 4), arena.left + arena.width - w - 4),
        y: Math.min(Math.max(y - h / 2, arena.top), arena.floorY - h),
        w: w, h: h,
        vy: -120 * k,
        landed: false,
        age: 0
      });
      drops++;
    }

    /* 壊した掲載情報から落ちる種類と確率。大きいものほど確実に落ちる */
    function dropFromTarget(t) {
      var chance = t.el.tagName === 'IMG' ? 1 : t.platform ? 0.5 : 0.3;
      if (Math.random() >= chance) return;
      dropItem(Math.random() < 0.5 ? 'dual' : 'jet',
        t.x + t.w / 2, Math.min(Math.max(t.y + t.h / 2, arena.top + 20), arena.floorY - 20));
    }

    function floatText(x, y, text, color) {
      floaters.push({ x: x, y: y, text: text, color: color, age: 0 });
    }

    function pickUp(it) {
      var def = ITEMS[it.key];
      pickups++;
      if (it.key === 'heart') {
        if (player.hearts < HEARTS) player.hearts++;
        else score += 20;
      } else {
        buff[it.key] = def.seconds;
      }
      floatText(player.x + player.w / 2, player.y - 6 * scale, def.name, def.color);
      updateHud();
    }

    function restorePage() {
      world.leaves.concat(world.boxes).forEach(function (x) {
        x.el.classList.remove('tr-gone');
        x.el.classList.remove('tr-hit');
        x.alive = true;
        x.hitUntil = 0;
        if (x.maxHp) x.hp = x.maxHp;
      });
      flashing = [];
    }

    function inRect(px, py, x, y, w, h) {
      return px >= x && px <= x + w && py >= y && py <= y + h;
    }

    /* --- ウェーブとスライム --- */

    function nextWave() {
      wave++;
      spec = waveSpec(wave);
      toSpawn = spec.count;
      spawnTimer = 0.9;
      spawnLeft = Math.random() < 0.5;
      showBanner(wave, spec.count);
      updateHud();
    }

    function spawnSlime() {
      var type = SLIME_TYPES[spec.pick()];
      var w = type.cw * scale;
      var h = type.ch * scale;
      /* 左右交互に出す。片側だけだと正面の自動射撃が全部倒してしまう */
      var fromLeft = spawnLeft;
      spawnLeft = !spawnLeft;
      slimes.push({
        type: type,
        w: w, h: h,
        x: fromLeft ? arena.left - w - 4 : arena.left + arena.width + 4,
        y: arena.floorY - h,
        vx: 0, vy: 0,
        hp: type.hp,
        face: fromLeft ? 1 : -1,
        onGround: true,
        rest: type.rest * 0.5,
        squash: 0,
        flash: 0,
        inside: false
      });
    }

    function updateSlime(s, dt) {
      if (s.onGround) {
        s.rest -= dt;
        if (s.rest <= 0) {
          var dir = player.x + player.w / 2 > s.x + s.w / 2 ? 1 : -1;
          s.face = dir;
          s.vx = dir * s.type.speed * spec.speed * k * (0.85 + Math.random() * 0.3);
          s.vy = -s.type.jump * k * (0.9 + Math.random() * 0.2);
          s.onGround = false;
          s.squash = -0.2;
        }
      } else {
        s.vy += 1500 * k * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        if (!s.inside && s.x > arena.left && s.x + s.w < arena.left + arena.width) s.inside = true;
        if (s.inside) {
          if (s.x < arena.left && s.vx < 0) { s.x = arena.left; s.vx = -s.vx; s.face = 1; }
          if (s.x + s.w > arena.left + arena.width && s.vx > 0) { s.x = arena.left + arena.width - s.w; s.vx = -s.vx; s.face = -1; }
        }
        if (s.y + s.h >= arena.floorY) {
          s.y = arena.floorY - s.h;
          s.vy = 0;
          s.vx = 0;
          s.onGround = true;
          s.rest = s.type.rest * (0.8 + Math.random() * 0.4);
          s.squash = 0.25;
        }
      }
      s.squash += (0 - s.squash) * Math.min(1, dt * 10);
      s.flash -= dt;
    }

    function killSlime(s) {
      spawnDebris(s.x, s.y, s.w, s.h, 14, scale, [s.type.body, s.type.light]);
      score += s.type.points;
      if (Math.random() < 0.08) dropItem('heart', s.x + s.w / 2, s.y);
      updateHud();
    }

    /* --- 被弾と死 --- */

    function hurt(s, t) {
      if (t < player.invUntil) return;
      player.hearts--;
      player.invUntil = t + 1.5;
      var dir = player.x + player.w / 2 > s.x + s.w / 2 ? 1 : -1;
      player.vx = dir * 320 * k;
      player.vy = -260 * k;
      player.onGround = false;
      s.vx = -dir * 160 * k;
      s.vy = -220 * k;
      s.onGround = false;
      spawnSparks(player.x + player.w / 2, player.y + player.h / 2, { x: -dir, y: 0 }, ['#ff3b3b', '#ffb13b']);
      updateHud();
      if (player.hearts <= 0) die();
    }

    function die() {
      state = 'dead';
      deadTimer = 1.0;
      player.dead = true;
      spawnDebris(player.x, player.y, player.w, player.h, 40, scale, [PALETTE.A, PALETTE.K, PALETTE.W, PALETTE.P]);
      graves.push({
        x: player.x + player.w / 2 - GRAVE_W * scale / 2,
        y: player.y,
        vy: -200 * k,
        w: GRAVE_W * scale,
        h: GRAVE_H * scale,
        landed: false
      });
      if (score > best) {
        best = score;
        writeBest(best);
        overBest.textContent = 'ベスト更新！';
      } else {
        overBest.textContent = 'ベスト ' + best;
      }
      overScore.textContent = 'スコア ' + score;
      updateHud();
    }

    function showOver() {
      state = 'over';
      over.hidden = false;
      retry.focus({ preventScroll: true });
    }

    function restart() {
      if (state !== 'over') return;
      over.hidden = true;
      restorePage();
      slimes = [];
      lasers = [];
      particles = [];
      items = [];
      floaters = [];
      buff.dual = 0;
      buff.jet = 0;
      wave = 0;
      spec = null;
      toSpawn = 0;
      waveGap = 0.6;
      score = 0;
      destroyed = 0;
      measureArena();
      resetPlayer();
      state = 'play';
      runStart = performance.now();
      updateHud();
    }

    /* --- 1 コマ進める --- */

    var last = performance.now();
    var raf = 0;

    function step(now) {
      raf = requestAnimationFrame(step);
      var dt = Math.min(0.034, (now - last) / 1000);
      last = now;
      var t = now / 1000;

      if (state === 'play') updatePlay(dt, t);
      else if (state === 'dead') {
        deadTimer -= dt;
        if (deadTimer <= 0) showOver();
      }

      /* 墓石。落ちて来て地面に刺さる */
      for (var gi = 0; gi < graves.length; gi++) {
        var g = graves[gi];
        if (g.landed) continue;
        g.vy += 1500 * k * dt;
        g.y += g.vy * dt;
        if (g.y + g.h >= arena.floorY + scale) {
          g.y = arena.floorY + scale - g.h;
          g.landed = true;
        }
      }

      for (var fi = floaters.length - 1; fi >= 0; fi--) {
        floaters[fi].age += dt;
        if (floaters[fi].age > 1.2) floaters.splice(fi, 1);
      }

      /* 破片。地面で跳ねる */
      for (var q = particles.length - 1; q >= 0; q--) {
        var pt = particles[q];
        pt.age += dt;
        if (pt.age >= pt.life) {
          particles.splice(q, 1);
          continue;
        }
        pt.vy += 1100 * k * dt;
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        if (pt.y > arena.floorY) {
          pt.y = arena.floorY;
          pt.vy *= -0.4;
          pt.vx *= 0.7;
        }
      }

      /* 当たった光を戻す */
      for (var f = flashing.length - 1; f >= 0; f--) {
        if (flashing[f].hitUntil <= t) {
          flashing[f].el.classList.remove('tr-hit');
          flashing[f].hitUntil = 0;
          flashing.splice(f, 1);
        }
      }

      if (bannerTimer > 0) {
        bannerTimer -= dt;
        if (bannerTimer <= 0) banner.classList.remove('is-shown');
      }

      draw(t);
    }

    function updatePlay(dt, t) {
      /* 入力をまとめる */
      var mx = 0;
      if (keys.left) mx -= 1;
      if (keys.right) mx += 1;
      var jump = keys.jump || tapJump;
      if (stickOn) {
        if (Math.abs(stickV.x) > 0.25) mx = stickV.x;
        if (stickV.y < -0.45) jump = true;
      }
      if (mx !== 0) player.facing = mx > 0 ? 1 : -1;

      /* 動き。地面からのジャンプはひと跳ね、押し続けると燃料のある間だけ飛ぶ */
      var speed = 320 * k;
      player.vx += (mx * speed - player.vx) * Math.min(1, dt * (player.onGround ? 14 : 7));
      var pressed = jump && !jumpWasDown;
      jumpWasDown = jump;
      if (pressed && player.onGround) {
        player.vy = -420 * k;
        player.onGround = false;
      }
      player.thrusting = false;
      if (jump && !player.onGround && player.fuel > 0) {
        player.thrusting = true;
        if (buff.jet <= 0) player.fuel = Math.max(0, player.fuel - dt / FUEL_SECONDS);
        player.vy -= 2600 * k * dt;
        if (player.vy < -480 * k) player.vy = -480 * k;
      }
      if (!player.thrusting) {
        player.vy += 1500 * k * dt;
        if (player.vy > 1000 * k) player.vy = 1000 * k;
      }
      if (player.onGround) player.fuel = Math.min(1, player.fuel + dt / (FUEL_SECONDS * 0.6));
      if (buff.jet > 0) player.fuel = 1;

      /* 強化の残り時間 */
      buff.dual = Math.max(0, buff.dual - dt);
      buff.jet = Math.max(0, buff.jet - dt);

      /* アイテム。落ちて来て床に乗り、しばらく待って消える。触れたら拾う */
      for (var ii = items.length - 1; ii >= 0; ii--) {
        var it = items[ii];
        it.age += dt;
        if (!it.landed) {
          it.vy += 1200 * k * dt;
          it.y += it.vy * dt;
          if (it.y + it.h >= arena.floorY) {
            it.y = arena.floorY - it.h;
            it.landed = true;
          }
        }
        if (it.age > ITEM_LIFE) {
          items.splice(ii, 1);
          continue;
        }
        if (player.x + player.w > it.x && player.x < it.x + it.w &&
            player.y + player.h > it.y && player.y < it.y + it.h) {
          pickUp(it);
          items.splice(ii, 1);
        }
      }

      var newX = Math.min(Math.max(player.x + player.vx * dt, arena.left), arena.left + arena.width - player.w);
      var newY = player.y + player.vy * dt;
      var feetOld = player.y + player.h;
      player.onGround = false;

      /* 足場。落ちているときだけ、上から乗る */
      if (player.vy > 0) {
        var feetNew = newY + player.h;
        var platforms = world.leaves.concat(world.boxes);
        for (var i = 0; i < platforms.length; i++) {
          var p = platforms[i];
          if (!p.alive || !p.platform || p.y >= arena.floorY) continue;
          if (feetOld > p.y + 1 || feetNew < p.y) continue;
          if (newX + player.w <= p.x + 3 || newX >= p.x + p.w - 3) continue;
          newY = p.y - player.h;
          player.vy = 0;
          player.onGround = true;
          break;
        }
      }
      if (newY + player.h >= arena.floorY) {
        newY = arena.floorY - player.h;
        player.vy = 0;
        player.onGround = true;
      }
      if (newY < arena.top) {
        newY = arena.top;
        player.vy = 0;
      }
      player.x = newX;
      player.y = newY;

      if (player.onGround && Math.abs(player.vx) > 20 * k) {
        player.walkT += dt;
        if (player.walkT > 0.12) {
          player.walkT = 0;
          player.walkFrame ^= 1;
        }
      } else {
        player.walkFrame = 0;
        player.walkT = 0;
      }

      /* ウェーブ。全部倒したら少し置いて次へ */
      if (spec && toSpawn > 0) {
        spawnTimer -= dt;
        if (spawnTimer <= 0) {
          spawnTimer = spec.interval;
          toSpawn--;
          spawnSlime();
        }
      } else if (slimes.length === 0) {
        waveGap -= dt;
        if (waveGap <= 0) {
          if (wave > 0) score += wave * 20;
          waveGap = 1.5;
          nextWave();
        }
      }

      /* スライム。触れたら被弾 */
      for (var si = 0; si < slimes.length; si++) {
        var s = slimes[si];
        updateSlime(s, dt);
        if (player.x + player.w > s.x + 2 && player.x < s.x + s.w - 2 &&
            player.y + player.h > s.y + 2 && player.y < s.y + s.h - 2) {
          hurt(s, t);
          if (state !== 'play') return;
        }
      }

      /* 自動射撃。向いている側でいちばん近いスライムを狙う。いなければ正面。
         銃は肩を軸に回るので、狙いも肩から測る。中心から測ると弾道が平行にずれて外れる。
         二丁拳銃の間は背中側の銃が反対側を同じように狙う */
      var shoulderY = player.y + SHOULDER_ROW * scale;
      function aimAt(dir, shoulderX) {
        var target = null;
        var bestD = 760 * k;
        for (var ti = 0; ti < slimes.length; ti++) {
          var c = slimes[ti];
          var dx = c.x + c.w / 2 - shoulderX;
          var dy = c.y + c.h / 2 - shoulderY;
          if (dx * dir <= 0) continue;
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d < bestD) {
            bestD = d;
            target = { dx: dx, dy: dy };
          }
        }
        var a = target ? Math.atan2(target.dy, Math.abs(target.dx)) : 0;
        return Math.max(-1.2, Math.min(1.2, a));
      }
      var frontX = player.x + (player.facing > 0 ? SHOULDER_COL : SPRITE_W - SHOULDER_COL) * scale;
      var backX = player.x + (player.facing > 0 ? SPRITE_W - SHOULDER_COL : SHOULDER_COL) * scale;
      player.gunAngle += (aimAt(player.facing, frontX) - player.gunAngle) * Math.min(1, dt * 30);
      if (buff.dual > 0) player.gunAngle2 += (aimAt(-player.facing, backX) - player.gunAngle2) * Math.min(1, dt * 30);
      shotCooldown -= dt;
      if (shotCooldown <= 0) {
        shotCooldown = SHOT_INTERVAL;
        muzzleFlash = 0.05;
        var sp = 1300 * k;
        var guns = buff.dual > 0
          ? [{ dir: player.facing, x: frontX, ang: player.gunAngle }, { dir: -player.facing, x: backX, ang: player.gunAngle2 }]
          : [{ dir: player.facing, x: frontX, ang: player.gunAngle }];
        for (var gi2 = 0; gi2 < guns.length; gi2++) {
          var gun = guns[gi2];
          var sa = gun.ang + (Math.random() - 0.5) * 0.05;
          lasers.push({
            x: gun.x + gun.dir * Math.cos(gun.ang) * GUN_LEN * scale,
            y: shoulderY + Math.sin(gun.ang) * GUN_LEN * scale,
            vx: gun.dir * Math.cos(sa) * sp,
            vy: Math.sin(sa) * sp,
            age: 0
          });
        }
      }
      muzzleFlash -= dt;

      /* レーザーを進めて当てる。スライムが先、外れた弾が掲載情報に当たる */
      for (var n = lasers.length - 1; n >= 0; n--) {
        var b = lasers[n];
        var ox = b.x;
        var oy = b.y;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.age += dt;
        var dead = b.age > 1.2 || b.x < arena.left - 40 || b.x > arena.left + arena.width + 40 ||
          b.y < arena.top - 40 || b.y > arena.floorY;
        hit: for (var st = 1; st <= 3 && !dead; st++) {
          var px = ox + (b.x - ox) * st / 3;
          var py = oy + (b.y - oy) * st / 3;
          for (var sj = slimes.length - 1; sj >= 0; sj--) {
            var sl = slimes[sj];
            if (!inRect(px, py, sl.x, sl.y, sl.w, sl.h)) continue;
            sl.hp -= 1;
            sl.flash = 0.08;
            sl.x += (b.vx > 0 ? 1 : -1) * 3 * k;
            spawnSparks(px, py, { x: b.vx, y: b.vy }, [sl.type.light, '#ff3b3b']);
            if (sl.hp <= 0) {
              killSlime(sl);
              slimes.splice(sj, 1);
            }
            dead = true;
            break hit;
          }
          for (var tj = 0; tj < near.length; tj++) {
            var tg = near[tj];
            if (!tg.alive || !inRect(px, py, tg.x, tg.y, tg.w, tg.h)) continue;
            tg.hp -= 1;
            flash(tg, t);
            spawnSparks(px, py, { x: b.vx, y: b.vy }, ['#ff3b3b', '#ffb13b']);
            if (tg.hp <= 0) {
              destroyTarget(tg);
              updateHud();
            }
            dead = true;
            break hit;
          }
        }
        if (dead) lasers.splice(n, 1);
      }
    }

    /* --- 描く --- */

    function drawSlime(s, sx, sy) {
      var type = s.type;
      var cx = Math.round(s.x + s.w / 2 - sx);
      var by = Math.round(s.y + s.h - sy);
      ctx.save();
      ctx.translate(cx, by);
      ctx.scale(1 + s.squash, 1 - s.squash);
      ctx.globalAlpha = 0.9;
      var ox = -Math.round(s.w / 2);
      var top = -s.h;
      ctx.fillStyle = s.flash > 0 ? '#ffffff' : type.body;
      for (var r = 0; r < type.ch; r++) {
        var inset = r === 0 ? 2 : r === 1 ? 1 : r === type.ch - 1 ? 1 : 0;
        ctx.fillRect(ox + inset * scale, top + r * scale, (type.cw - 2 * inset) * scale, scale);
      }
      if (s.flash <= 0) {
        ctx.fillStyle = type.light;
        ctx.fillRect(ox + 2 * scale, top + scale, 2 * scale, scale);
        ctx.fillRect(ox + 1 * scale, top + 2 * scale, scale, scale);
        ctx.fillStyle = type.eye;
        var ey = top + Math.floor(type.ch / 2) * scale;
        var e1 = s.face > 0 ? type.cw - 4 : 3;
        var e2 = s.face > 0 ? type.cw - 2 : 1;
        ctx.fillRect(ox + e1 * scale, ey, scale, scale);
        ctx.fillRect(ox + e2 * scale, ey, scale, scale);
      }
      ctx.restore();
    }

    /* 腕と銃。(x, y) が肩。flip は背中側の銃で、反対を向かせる */
    function drawGun(x, y, angle, flip) {
      ctx.save();
      ctx.translate(x, y);
      if (flip) ctx.scale(-1, 1);
      ctx.rotate(angle);
      ctx.fillStyle = PALETTE.K;
      ctx.fillRect(0, -scale, 6 * scale, 2 * scale);
      ctx.fillStyle = PALETTE.G;
      ctx.fillRect(6 * scale, -2 * scale, 7 * scale, 3 * scale);
      ctx.fillStyle = PALETTE.J;
      ctx.fillRect(8 * scale, scale, 2 * scale, 2 * scale);
      ctx.fillStyle = PALETTE.A;
      ctx.fillRect(5 * scale, -scale, 2 * scale, 2 * scale);
      ctx.fillStyle = PALETTE.L;
      ctx.fillRect(13 * scale, -scale, 3 * scale, 2 * scale);
      ctx.fillStyle = PALETTE.M;
      ctx.fillRect(16 * scale, -scale, scale, 2 * scale);
      if (muzzleFlash > 0) {
        ctx.fillStyle = '#ffe08a';
        ctx.fillRect(17 * scale, -2 * scale, 3 * scale, 4 * scale);
      }
      ctx.restore();
    }

    function draw(t) {
      var sx = window.scrollX;
      var sy = window.scrollY;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      ctx.imageSmoothingEnabled = false;

      /* 地面。いちばん上が草、その下が土。模様はタイルの位置から決めるので揺れない */
      var tile = 4 * scale;
      var gy = Math.round(arena.floorY - sy);
      ctx.fillStyle = '#6b4a2e';
      ctx.fillRect(0, gy, window.innerWidth, window.innerHeight - gy);
      var cols = Math.ceil(window.innerWidth / tile) + 1;
      var rows = Math.ceil((window.innerHeight - gy) / tile);
      for (var ci = 0; ci < cols; ci++) {
        var tx = ci * tile;
        for (var rj = 0; rj < rows; rj++) {
          var nz = noise(ci, rj);
          var ty = gy + rj * tile;
          if (rj === 0) {
            ctx.fillStyle = nz < 0.5 ? '#4f9d3a' : '#3f8a2f';
            ctx.fillRect(tx, ty, tile, tile);
            if (nz < 0.35) ctx.fillRect(tx + scale, ty - scale, scale, scale);
          } else if (nz < 0.18) {
            ctx.fillStyle = '#7d5a39';
            ctx.fillRect(tx, ty, tile, tile);
          } else if (nz > 0.9) {
            ctx.fillStyle = '#58391f';
            ctx.fillRect(tx + scale, ty + scale, 2 * scale, 2 * scale);
          }
        }
      }

      /* 墓石 */
      for (var gi = 0; gi < graves.length; gi++) {
        drawRows(ctx, GRAVE, Math.round(graves[gi].x - sx), Math.round(graves[gi].y - sy), scale, GRAVE_PALETTE);
      }

      /* アイテム。床の上で上下に揺れ、消える前は点滅する */
      for (var ii = 0; ii < items.length; ii++) {
        var it = items[ii];
        if (it.age > ITEM_LIFE - 3 && Math.floor(t * 8) % 2 === 0) continue;
        var bob = it.landed ? Math.round(Math.sin(t * 4 + ii) * scale) : 0;
        drawRows(ctx, ITEMS[it.key].rows, Math.round(it.x - sx), Math.round(it.y - sy) - 2 * scale + bob, scale, ITEM_PALETTE);
      }

      /* スライム */
      for (var si = 0; si < slimes.length; si++) drawSlime(slimes[si], sx, sy);

      /* レーザー */
      for (var i = 0; i < lasers.length; i++) {
        var b = lasers[i];
        ctx.save();
        ctx.translate(b.x - sx, b.y - sy);
        ctx.rotate(Math.atan2(b.vy, b.vx));
        ctx.fillStyle = '#ff3b3b';
        ctx.fillRect(-7 * scale, -scale, 7 * scale, 2 * scale);
        ctx.fillStyle = '#ffd0d0';
        ctx.fillRect(-6 * scale, -scale / 2, 5 * scale, scale);
        ctx.restore();
      }

      /* キャラ。被弾直後は点滅。左向きはスプライトの中心で左右反転 */
      if (!player.dead && !(t < player.invUntil && Math.floor(t * 12) % 2 === 0)) {
        var px = Math.round(player.x - sx);
        var py = Math.round(player.y - sy);
        ctx.save();
        if (player.facing < 0) {
          ctx.translate(px * 2 + player.w, 0);
          ctx.scale(-1, 1);
        }
        if (player.thrusting) {
          var flameLen = 2 + Math.floor(Math.random() * 3);
          for (var r = 0; r < flameLen; r++) {
            ctx.fillStyle = buff.jet > 0
              ? (r === 0 ? '#e0f0ff' : r === 1 ? '#8fc3ff' : '#4a8bff')
              : (r === 0 ? '#ffe08a' : r === 1 ? '#ffb13b' : '#ff6a2a');
            var fx = px + (r === 0 ? 0 : Math.random() < 0.5 ? 0 : 1) * scale;
            var fw = (r === 0 ? 2 : 1) * scale;
            ctx.fillRect(fx, py + (12 + r) * scale, fw, scale);
          }
        }
        drawRows(ctx, BODY, px, py, scale);
        drawRows(ctx, player.walkFrame ? LEGS_WALK : LEGS_STAND, px, py + BODY.length * scale, scale);
        /* 頭上のバー。燃料は使い始めたら出し、満タンに戻ったら消す。
           効いている強化はその色のバーが残り時間ぶん縮んでいき、最後の 3 秒は点滅する。
           敵を避けている最中に HUD は見られないので、視線の先のキャラに出す */
        var barW = 8 * scale;
        var barX = px + Math.round((player.w - barW) / 2);
        var barY = py - 3 * scale;
        function headBar(frac, color) {
          ctx.fillStyle = 'rgba(32, 26, 19, 0.55)';
          ctx.fillRect(barX - 1, barY - 1, barW + 2, scale + 2);
          ctx.fillStyle = color;
          ctx.fillRect(barX, barY, Math.round(barW * frac), scale);
          barY -= 2 * scale;
        }
        if (player.fuel < 1) headBar(player.fuel, '#ffb13b');
        ['jet', 'dual'].forEach(function (key) {
          if (buff[key] <= 0) return;
          if (buff[key] < 3 && Math.floor(t * 6) % 2 === 0) {
            barY -= 2 * scale;
            return;
          }
          headBar(buff[key] / ITEMS[key].seconds, ITEMS[key].color);
        });
        /* 腕と銃。肩を軸に狙いの向きへ回す。二丁拳銃の間は背中側の肩にもう 1 本 */
        drawGun(px + SHOULDER_COL * scale, py + SHOULDER_ROW * scale, player.gunAngle, false);
        if (buff.dual > 0) drawGun(px + (SPRITE_W - SHOULDER_COL) * scale, py + SHOULDER_ROW * scale, player.gunAngle2, true);
        ctx.restore();
      }

      /* 拾ったときの文字。上へ浮いて消える */
      ctx.font = '700 ' + (13 * Math.max(1, scale - 1)) + 'px "Zen Kaku Gothic New", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      for (var fi = 0; fi < floaters.length; fi++) {
        var fl = floaters[fi];
        ctx.globalAlpha = fl.age < 0.7 ? 1 : 1 - (fl.age - 0.7) / 0.5;
        ctx.fillStyle = fl.color;
        ctx.fillText(fl.text, Math.round(fl.x - sx), Math.round(fl.y - sy - fl.age * 30));
      }
      ctx.globalAlpha = 1;

      /* 破片。寿命の後半で薄くなる */
      for (var q = 0; q < particles.length; q++) {
        var pt = particles[q];
        var left = 1 - pt.age / pt.life;
        ctx.globalAlpha = left < 0.5 ? left * 2 : 1;
        ctx.fillStyle = pt.color;
        ctx.fillRect(Math.round(pt.x - sx), Math.round(pt.y - sy), pt.size, pt.size);
      }
      ctx.globalAlpha = 1;
    }

    /* --- 終わる。壊したものを全部戻す --- */

    function stop() {
      if (!game) return;
      game = null;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('resize', onResize);
      restorePage();
      canvas.remove();
      ui.remove();
      root.classList.remove('tr-playing');
      launch.focus({ preventScroll: true });
    }

    /* 調整用の覗き窓。URL に ?tr-debug を付けたときだけ、状態を読める */
    if (new URLSearchParams(location.search).has('tr-debug')) {
      window.trDebugGive = function (key) { if (state === 'play') pickUp({ key: key }); };
      window.trDebug = function () {
        return {
          state: state, wave: wave, score: score, hearts: player.hearts, destroyed: destroyed,
          drops: drops, pickups: pickups, buff: { dual: buff.dual, jet: buff.jet },
          items: items.map(function (i) { return { key: i.key, x: i.x, y: i.y }; }),
          elapsed: (performance.now() - runStart) / 1000,
          player: { x: player.x, y: player.y, onGround: player.onGround, fuel: player.fuel },
          slimes: slimes.map(function (s) { return { x: s.x, y: s.y, w: s.w, h: s.h, onGround: s.onGround }; }),
          arena: arena
        };
      };
    }

    game = { stop: stop };
    raf = requestAnimationFrame(step);
  }

  launch.addEventListener('click', start);
})();
