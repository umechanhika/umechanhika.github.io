/* テラリアモード。ページの末尾まで読んだ人へのおまけ。

   末尾の「テラリアモードで遊ぶ」を押すと、ドット絵のキャラがページの一番下に現れる。
   矢印キー（スマホは画面左のスティック）で歩き、上でジェットパックを噴かして飛ぶ。
   Space かクリック（スマホは画面右のボタン）でレーザーを連射し、当たった掲載情報を壊す。

   壊すのは見た目だけ。要素に tr-gone を付けて visibility: hidden にするので
   レイアウトは崩れず、やめたときに全部元に戻す。本文のマークアップには書き込まない。

   座標はすべて文書座標（画面座標に scrollY を足した値）で持つ。キャラを追って
   ページをスクロールし、画面に固定した canvas にキャラ・レーザー・破片を描く。
   壊せる要素の矩形は開始時と画面サイズ変更時に測る。壊しても visibility しか
   変えないので、途中で測り直す必要はない。 */
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
    K: '#2b2b2b', /* スーツ */
    P: '#141414', /* ズボン */
    N: '#e8e8e8', /* スニーカー */
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
    'JJ.KKKAWAKKK..',
    'JL.KKKWWWKKK..',
    'JJ.KKKWWWKKK..',
    'JJ.KKKWWWKKK..',
    'JJ.KKKWWWKKK..',
    'RR.KKKWWWKKK..',
    '...KKKWWWKKK..'
  ];
  var LEGS_STAND = [
    '...PPP...PPP..',
    '...PPP...PPP..',
    '...PPP...PPP..',
    '...PPP...PPP..',
    '..NNNN..NNNN..'
  ];
  var LEGS_WALK = [
    '..PPP.....PPP.',
    '..PPP.....PPP.',
    '.PPP.......PPP',
    '.PPP.......PPP',
    'NNNN......NNNN'
  ];
  var SPRITE_W = 14;
  var SPRITE_H = 18;
  /* 肩の位置（スプライト内のマス）。銃はここを軸に回す */
  var SHOULDER_COL = 9;
  var SHOULDER_ROW = 7;
  /* 肩から銃口までの長さ（マス） */
  var GUN_LEN = 17;

  function drawRows(ctx, rows, ox, oy, scale) {
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      for (var c = 0; c < row.length; c++) {
        var ch = row.charAt(c);
        if (ch === '.') continue;
        ctx.fillStyle = PALETTE[ch];
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
        hp: Math.max(2, Math.min(40, Math.round(r.w * r.h / 7000))),
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

  /* --- ゲーム本体 --- */

  var game = null;

  function start() {
    if (game) return;
    var coarse = window.matchMedia('(pointer: coarse)').matches;
    var scale = window.matchMedia('(max-width: 720px)').matches ? 2 : 3;
    /* 速さはキャラの大きさに比例させる。小さい画面では小さく、遅く */
    var k = scale / 3;

    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    root.classList.add('tr-playing');

    var canvas = el('canvas', 'tr-canvas');
    canvas.setAttribute('aria-hidden', 'true');
    var ui = el('div', 'tr-ui' + (coarse ? ' is-touch' : ''));
    var hud = el('div', 'tr-hud');
    var count = el('span', 'tr-count');
    var quit = el('button', 'tr-quit', 'やめる');
    quit.type = 'button';
    hud.appendChild(count);
    hud.appendChild(quit);
    var help = el('p', 'tr-help', coarse
      ? '左のスティックで移動、上に倒すとジェットパック。右のボタンで射撃、ボタンを引きずると狙う向きが変わります。壊したものは、やめると元に戻ります。'
      : '← → で移動、↑ でジェットパック、Space かクリックで射撃。狙いはマウスの位置です。Esc でやめると、壊したものは元に戻ります。');
    var pad = el('div', 'tr-pad');
    var stick = el('div', 'tr-stick');
    stick.setAttribute('aria-label', '移動スティック');
    var stickKnob = el('span', 'tr-knob');
    stick.appendChild(stickKnob);
    var fire = el('div', 'tr-fire');
    fire.setAttribute('aria-label', '射撃ボタン');
    var fireKnob = el('span', 'tr-knob', '射撃');
    fire.appendChild(fireKnob);
    pad.appendChild(stick);
    pad.appendChild(fire);
    var done = el('div', 'tr-done');
    done.hidden = true;
    done.appendChild(el('p', null, 'ぜんぶ壊しました。'));
    var restore = el('button', 'tr-restore', '元に戻す');
    restore.type = 'button';
    done.appendChild(restore);
    ui.appendChild(hud);
    ui.appendChild(help);
    ui.appendChild(pad);
    ui.appendChild(done);
    /* 地面。ページの下に土の層ぶんの余白を足し、キャラをその上に立たせる。
       画面の端に立つと埋め込みやブラウザの下端のバーに脚が隠れるため */
    var ground = el('div', 'tr-ground');
    ground.setAttribute('aria-hidden', 'true');
    document.body.appendChild(ground);
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

    /* overflow: hidden でスクロールバーが消えて幅が変わった後に測る */
    var world = collectTargets();
    var total = world.leaves.length;
    var destroyed = 0;
    var groundH = 0;
    var floorY = 0;
    var docW = root.scrollWidth;
    function measureGround() {
      groundH = ground.offsetHeight;
      floorY = root.scrollHeight - groundH;
    }
    measureGround();

    var player = {
      w: SPRITE_W * scale,
      h: SPRITE_H * scale,
      x: 0, y: 0, vx: 0, vy: 0,
      facing: 1,
      onGround: false,
      thrusting: false,
      walkT: 0,
      walkFrame: 0
    };
    player.x = window.scrollX + window.innerWidth / 2 - player.w / 2;
    player.y = floorY - player.h;

    var keys = { left: false, right: false, up: false, down: false, fire: false };
    var stickV = { x: 0, y: 0 };
    var stickOn = false;
    var padFire = false;
    var padAim = null;
    var mouse = null;
    var mouseFire = false;
    var aimMode = 'keys';
    var aim = { x: 1, y: 0 };
    var lasers = [];
    var particles = [];
    var flashing = [];
    var shotCooldown = 0;
    var muzzleFlash = 0;
    var SHOT_INTERVAL = 0.07;
    var helpTimer = setTimeout(function () { help.classList.add('is-faded'); }, 9000);

    function updateCount() {
      count.textContent = 'こわした ' + destroyed + ' / ' + total;
    }
    updateCount();

    /* --- 入力 --- */

    var KEYS = {
      ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
      a: 'left', d: 'right', w: 'up', s: 'down',
      ' ': 'fire', z: 'fire', x: 'fire'
    };
    function onKey(e, down) {
      if (e.key === 'Escape') {
        if (down) stop();
        return;
      }
      var name = KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (!name) return;
      e.preventDefault();
      keys[name] = down;
      if (down && name !== 'fire') aimMode = 'keys';
    }
    function onKeyDown(e) { onKey(e, true); }
    function onKeyUp(e) { onKey(e, false); }
    function onPointerMove(e) {
      if (e.pointerType === 'touch') return;
      mouse = { x: e.clientX, y: e.clientY };
      aimMode = 'mouse';
    }
    function onPointerDown(e) {
      if (e.pointerType === 'touch' || e.button !== 0) return;
      e.preventDefault();
      onPointerMove(e);
      mouseFire = true;
    }
    function onPointerUp() { mouseFire = false; }
    function prevent(e) { e.preventDefault(); }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('contextmenu', prevent);
    quit.addEventListener('click', stop);
    restore.addEventListener('click', stop);

    makeStick(stick, stickKnob, 40, function (v, on) {
      stickV = v;
      stickOn = on;
      if (on) aimMode = 'keys';
    });
    makeStick(fire, fireKnob, 28, function (v, on) {
      padFire = on;
      var len = Math.sqrt(v.x * v.x + v.y * v.y);
      padAim = len > 0.35 ? { x: v.x / len, y: v.y / len } : null;
    });

    var resizeRaf = 0;
    function onResize() {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(function () {
        resizeRaf = 0;
        sizeCanvas();
        remeasure(world);
        measureGround();
        docW = root.scrollWidth;
      });
    }
    window.addEventListener('resize', onResize);

    /* --- 壊す --- */

    function spawnDebris(t, n, size) {
      /* 画面の外に散っても見えないので、画面内の部分からだけ出す */
      var top = Math.max(t.y, window.scrollY - 40);
      var bottom = Math.min(t.y + t.h, window.scrollY + window.innerHeight + 40);
      if (bottom <= top) return;
      for (var i = 0; i < n && particles.length < 900; i++) {
        particles.push({
          x: t.x + Math.random() * t.w,
          y: top + Math.random() * (bottom - top),
          vx: (Math.random() - 0.5) * 360 * k,
          vy: (-Math.random() * 320 - 40) * k,
          life: 0.8 + Math.random() * 0.7,
          age: 0,
          size: size,
          color: t.colors[Math.floor(Math.random() * t.colors.length)]
        });
      }
    }

    function spawnSparks(x, y, dir) {
      for (var i = 0; i < 4 && particles.length < 900; i++) {
        var a = Math.atan2(dir.y, dir.x) + Math.PI + (Math.random() - 0.5) * 1.6;
        var s = (120 + Math.random() * 220) * k;
        particles.push({
          x: x, y: y,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s,
          life: 0.25 + Math.random() * 0.2,
          age: 0,
          size: Math.max(2, scale - 1),
          color: Math.random() < 0.5 ? '#ff3b3b' : '#ffb13b'
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

    function destroy(t) {
      t.alive = false;
      t.el.classList.add('tr-gone');
      spawnDebris(t, Math.max(6, Math.min(70, Math.round(t.w * t.h / 1200))), scale);
      destroyed++;
      updateCount();
      var box = t.box;
      if (box && box.alive && box.leaves.every(function (l) { return !l.alive; })) {
        box.alive = false;
        box.el.classList.add('tr-gone');
        spawnDebris(box, 24, scale);
      }
      if (destroyed === total) {
        done.hidden = false;
        restore.focus();
      }
    }

    function hitTest(t, px, py) {
      return px >= t.x && px <= t.x + t.w && py >= t.y && py <= t.y + t.h;
    }

    /* --- 1 コマ進める --- */

    var last = performance.now();
    var raf = 0;

    function step(now) {
      raf = requestAnimationFrame(step);
      var dt = Math.min(0.034, (now - last) / 1000);
      last = now;
      var t = now / 1000;

      /* 入力をまとめる */
      var mx = 0;
      if (keys.left) mx -= 1;
      if (keys.right) mx += 1;
      var thrust = keys.up;
      var drop = keys.down;
      if (stickOn) {
        if (Math.abs(stickV.x) > 0.25) mx = stickV.x;
        if (stickV.y < -0.45) thrust = true;
        if (stickV.y > 0.6) drop = true;
      }
      var firing = keys.fire || mouseFire || padFire;

      /* 狙い */
      var cxv = player.x + player.w / 2 - window.scrollX;
      var cyv = player.y + player.h / 2 - window.scrollY;
      if (padAim) {
        aim = padAim;
      } else if (aimMode === 'mouse' && mouse) {
        var dx = mouse.x - cxv;
        var dy = mouse.y - cyv;
        var len = Math.sqrt(dx * dx + dy * dy) || 1;
        aim = { x: dx / len, y: dy / len };
      } else {
        var ax = 0;
        var ay = 0;
        if (stickOn && Math.sqrt(stickV.x * stickV.x + stickV.y * stickV.y) > 0.3) {
          ax = stickV.x;
          ay = stickV.y;
        } else {
          ax = (keys.left ? -1 : 0) + (keys.right ? 1 : 0);
          ay = (keys.up ? -1 : 0) + (keys.down ? 1 : 0);
        }
        if (ax === 0 && ay === 0) ax = player.facing;
        var alen = Math.sqrt(ax * ax + ay * ay);
        aim = { x: ax / alen, y: ay / alen };
      }
      if (Math.abs(aim.x) > 0.2) player.facing = aim.x > 0 ? 1 : -1;
      else if (mx !== 0) player.facing = mx > 0 ? 1 : -1;

      /* 動き */
      var speed = 320 * k;
      var targetVx = mx * speed;
      player.vx += (targetVx - player.vx) * Math.min(1, dt * (player.onGround ? 14 : 7));
      player.thrusting = thrust;
      if (thrust) {
        player.vy -= 2800 * k * dt;
        if (player.vy < -520 * k) player.vy = -520 * k;
      } else {
        player.vy += 1500 * k * dt;
        if (player.vy > 1000 * k) player.vy = 1000 * k;
      }
      var newX = Math.min(Math.max(player.x + player.vx * dt, 0), docW - player.w);
      var newY = player.y + player.vy * dt;
      var feetOld = player.y + player.h;
      player.onGround = false;

      /* 足場。落ちているときだけ、上から乗る */
      if (player.vy > 0 && !drop) {
        var feetNew = newY + player.h;
        var platforms = world.leaves.concat(world.boxes);
        for (var i = 0; i < platforms.length; i++) {
          var p = platforms[i];
          if (!p.alive || !p.platform) continue;
          if (feetOld > p.y + 1 || feetNew < p.y) continue;
          if (newX + player.w <= p.x + 3 || newX >= p.x + p.w - 3) continue;
          newY = p.y - player.h;
          player.vy = 0;
          player.onGround = true;
          break;
        }
      }
      if (newY + player.h >= floorY) {
        newY = floorY - player.h;
        player.vy = 0;
        player.onGround = true;
      }
      if (newY < 0) {
        newY = 0;
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

      /* カメラ。キャラが画面の上下 35% の帯から出たら追う */
      var vh = window.innerHeight;
      var top = window.scrollY;
      var cy = player.y + player.h / 2;
      var want = top;
      if (cy < top + vh * 0.35) want = cy - vh * 0.35;
      else if (cy > top + vh * 0.65) want = cy - vh * 0.65;
      want = Math.min(Math.max(want, 0), floorY + groundH - vh);
      if (Math.abs(want - top) > 0.5) window.scrollTo({ top: want, left: window.scrollX, behavior: 'instant' });

      /* 射撃 */
      var ang = Math.atan2(aim.y, aim.x * player.facing);
      var shoulderX = player.x + (player.facing > 0 ? SHOULDER_COL : SPRITE_W - SHOULDER_COL) * scale;
      var shoulderY = player.y + SHOULDER_ROW * scale;
      var muzzleX = shoulderX + player.facing * Math.cos(ang) * GUN_LEN * scale;
      var muzzleY = shoulderY + Math.sin(ang) * GUN_LEN * scale;
      shotCooldown -= dt;
      if (firing && shotCooldown <= 0) {
        shotCooldown = SHOT_INTERVAL;
        muzzleFlash = 0.05;
        var spread = (Math.random() - 0.5) * 0.06;
        var sa = ang + spread;
        var sp = 1300 * k;
        lasers.push({
          x: muzzleX, y: muzzleY,
          vx: player.facing * Math.cos(sa) * sp,
          vy: Math.sin(sa) * sp,
          age: 0
        });
        help.classList.add('is-faded');
      }
      muzzleFlash -= dt;

      /* レーザーを進めて当てる */
      var bandTop = top - 300;
      var bandBottom = top + vh + 300;
      var near = [];
      for (var li = 0; li < world.leaves.length; li++) {
        var leaf = world.leaves[li];
        if (leaf.alive && leaf.y < bandBottom && leaf.y + leaf.h > bandTop) near.push(leaf);
      }
      for (var n = lasers.length - 1; n >= 0; n--) {
        var b = lasers[n];
        var ox = b.x;
        var oy = b.y;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.age += dt;
        var dead = b.age > 1.5 || b.x < 0 || b.x > docW || b.y < 0 || b.y > floorY;
        if (!dead) {
          /* 1 コマで進む距離が薄い要素より長いので、途中の点でも当たりを見る */
          hit: for (var s = 1; s <= 3; s++) {
            var px = ox + (b.x - ox) * s / 3;
            var py = oy + (b.y - oy) * s / 3;
            for (var ti = 0; ti < near.length; ti++) {
              var tg = near[ti];
              if (!tg.alive || !hitTest(tg, px, py)) continue;
              tg.hp -= 1;
              flash(tg, t);
              spawnSparks(px, py, { x: b.vx, y: b.vy });
              if (tg.hp <= 0) destroy(tg);
              dead = true;
              break hit;
            }
          }
        }
        if (dead) lasers.splice(n, 1);
      }

      /* 当たった光を戻す */
      for (var f = flashing.length - 1; f >= 0; f--) {
        if (flashing[f].hitUntil <= t) {
          flashing[f].el.classList.remove('tr-hit');
          flashing[f].hitUntil = 0;
          flashing.splice(f, 1);
        }
      }

      /* 破片 */
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
        if (pt.y > floorY) {
          pt.y = floorY;
          pt.vy *= -0.4;
          pt.vx *= 0.7;
        }
      }

      draw(t, ang, shoulderX, shoulderY, muzzleX, muzzleY);
    }

    /* --- 描く --- */

    function draw(t, ang, shoulderX, shoulderY, muzzleX, muzzleY) {
      var sx = window.scrollX;
      var sy = window.scrollY;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      ctx.imageSmoothingEnabled = false;

      /* 地面。いちばん上が草、その下が土。模様はタイルの位置から決めるので揺れない */
      var tile = 4 * scale;
      var gy = Math.round(floorY - sy);
      if (gy < window.innerHeight) {
        ctx.fillStyle = '#6b4a2e';
        ctx.fillRect(0, gy, window.innerWidth, window.innerHeight - gy);
        var col0 = Math.floor(sx / tile);
        var cols = Math.ceil(window.innerWidth / tile) + 1;
        var rows = Math.ceil((window.innerHeight - gy) / tile);
        for (var ci = 0; ci < cols; ci++) {
          var tx = (col0 + ci) * tile - sx;
          for (var rj = 0; rj < rows; rj++) {
            var n = noise(col0 + ci, rj);
            var ty = gy + rj * tile;
            if (rj === 0) {
              ctx.fillStyle = n < 0.5 ? '#4f9d3a' : '#3f8a2f';
              ctx.fillRect(tx, ty, tile, tile);
              if (n < 0.35) ctx.fillRect(tx + scale, ty - scale, scale, scale);
            } else if (n < 0.18) {
              ctx.fillStyle = '#7d5a39';
              ctx.fillRect(tx, ty, tile, tile);
            } else if (n > 0.9) {
              ctx.fillStyle = '#58391f';
              ctx.fillRect(tx + scale, ty + scale, 2 * scale, 2 * scale);
            }
          }
        }
      }

      /* レーザー */
      for (var i = 0; i < lasers.length; i++) {
        var b = lasers[i];
        var a = Math.atan2(b.vy, b.vx);
        ctx.save();
        ctx.translate(b.x - sx, b.y - sy);
        ctx.rotate(a);
        ctx.fillStyle = '#ff3b3b';
        ctx.fillRect(-7 * scale, -scale, 7 * scale, 2 * scale);
        ctx.fillStyle = '#ffd0d0';
        ctx.fillRect(-6 * scale, -scale / 2, 5 * scale, scale);
        ctx.restore();
      }

      /* キャラ。左向きはスプライトの中心で左右反転 */
      var px = Math.round(player.x - sx);
      var py = Math.round(player.y - sy);
      ctx.save();
      if (player.facing < 0) {
        ctx.translate(px * 2 + player.w, 0);
        ctx.scale(-1, 1);
      }
      /* ジェットパックの炎 */
      if (player.thrusting) {
        var flameLen = 2 + Math.floor(Math.random() * 3);
        for (var r = 0; r < flameLen; r++) {
          ctx.fillStyle = r === 0 ? '#ffe08a' : r === 1 ? '#ffb13b' : '#ff6a2a';
          var fx = px + (r === 0 ? 0 : Math.random() < 0.5 ? 0 : 1) * scale;
          var fw = (r === 0 ? 2 : 1) * scale;
          ctx.fillRect(fx, py + (12 + r) * scale, fw, scale);
        }
      }
      drawRows(ctx, BODY, px, py, scale);
      drawRows(ctx, player.walkFrame ? LEGS_WALK : LEGS_STAND, px, py + BODY.length * scale, scale);
      /* 腕と銃。肩を軸に狙いの向きへ回す */
      ctx.translate(px + SHOULDER_COL * scale, py + SHOULDER_ROW * scale);
      ctx.rotate(ang);
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
      clearTimeout(helpTimer);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('resize', onResize);
      world.leaves.concat(world.boxes).forEach(function (x) {
        x.el.classList.remove('tr-gone');
        x.el.classList.remove('tr-hit');
      });
      ground.remove();
      canvas.remove();
      ui.remove();
      root.classList.remove('tr-playing');
      launch.focus({ preventScroll: true });
    }

    game = { stop: stop };
    raf = requestAnimationFrame(step);
  }

  launch.addEventListener('click', start);
})();
