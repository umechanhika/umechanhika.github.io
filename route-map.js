/* 経路図と本文のスクロールを同期する。

   縦スクロール → 経路図: 本文の位置を駅の間で線形に写し、現在地を動かす。
   経路図のドラッグ → 縦スクロール: 現在地の x から本文の位置を逆算して scrollTo する。

   「読んでいるセクション」は、先頭が画面の縦中央を越えた最後のセクション。
   ページの末尾まで来たときは最後のセクションとする（短いセクションは中央に届かないため）。
   経路図のバスの位置だけはヘッダーの下端を基準にする。駅をタップしたとき、
   見出しがヘッダーの直下に着いた瞬間にバスが駅に乗るようにするため。

   縦の経路のバスは、ページの先頭で最初の駅、末尾で最後の駅に乗り、
   その間を読んだ割合に応じて画面上を下へ進む。

   同期は双方向なので、互いの scroll イベントが呼び合って発振しないよう、
   操作を始めた側を「主」として記録し、従う側のイベントは無視する。 */
(function () {
  'use strict';

  var root = document.documentElement;
  var viewport = document.querySelector('.route-map__viewport');
  var hero = document.querySelector('.hero');
  var track = viewport.querySelector('.route-map__track');
  var here = viewport.querySelector('.route-map__here');
  var header = document.querySelector('.site-head');
  var stations = Array.prototype.slice.call(track.querySelectorAll('.route-map__station'));
  var links = stations.map(function (li) { return li.querySelector('a'); });
  var dots = stations.map(function (li) { return li.querySelector('.route-map__dot'); });
  var targets = links.map(function (a) {
    var target = document.querySelector(a.getAttribute('href'));
    if (!target) throw new Error('route-map: 駅の行き先が見つからない: ' + a.getAttribute('href'));
    return target;
  });

  /* 駅ごとの座標。measure() で更新する
     xs: 経路図上の駅の x
     ys: 駅の見出しがヘッダーの直下に着く scrollY（経路図のバスの基準）
     ysMid: セクションの先頭が画面の縦中央を越える scrollY（読んでいるセクションの基準） */
  var xs = [];
  var ys = [];
  var ysMid = [];
  var last = stations.length - 1;
  var maxY = 0;

  /* 縦の経路のバスの画面上の y。ページ先頭での位置と末尾での位置 */
  var busYStart = 0;
  var busYEnd = 0;

  /* 縦の経路上の駅（見出しの丸）の文書上の y */
  function stationDocY(section) {
    var title = section.querySelector('.hero__lead, .section__title');
    if (!title) throw new Error('route-map: 見出しが見つからない: #' + section.id);
    var dot = getComputedStyle(title, '::before');
    return title.getBoundingClientRect().top + window.scrollY + parseFloat(dot.top) + parseFloat(dot.height) / 2;
  }

  function measure() {
    var trackLeft = track.getBoundingClientRect().left;
    xs = dots.map(function (dot) {
      var r = dot.getBoundingClientRect();
      return r.left + r.width / 2 - trackLeft;
    });
    var headerHeight = header.offsetHeight;
    root.style.setProperty('--head-h', headerHeight + 'px');
    maxY = root.scrollHeight - window.innerHeight;
    var half = window.innerHeight / 2;
    ys = [];
    ysMid = [];
    targets.forEach(function (t) {
      var top = t.getBoundingClientRect().top + window.scrollY;
      ys.push(Math.min(Math.max(0, top - headerHeight), maxY));
      ysMid.push(Math.min(Math.max(0, top - half), maxY));
    });

    busYStart = stationDocY(targets[0]);
    busYEnd = stationDocY(targets[last]) - maxY;
    var rail = getComputedStyle(hero, '::before');
    var railX = hero.getBoundingClientRect().left + parseFloat(rail.left) + parseFloat(rail.width) / 2;
    root.style.setProperty('--rail-x', railX + 'px');
  }

  /* 区分線形写像。from の i 番目と i+1 番目の間を to の同じ区間に写す */
  function map(value, from, to) {
    if (value <= from[0]) return to[0];
    for (var i = 0; i < last; i++) {
      if (value < from[i + 1]) {
        var span = from[i + 1] - from[i];
        var t = span > 0 ? (value - from[i]) / span : 1;
        return to[i] + t * (to[i + 1] - to[i]);
      }
    }
    return to[last];
  }

  /* 読んでいるセクションの番号。ページの先頭では最初のセクション
     （画面が高いと、先頭にいても次のセクションが中央を越えていることがあるため） */
  function currentIndex(y) {
    if (y <= 0) return 0;
    var idx = 0;
    for (var i = 0; i <= last; i++) {
      if (ysMid[i] <= y + 0.5) idx = i;
    }
    return idx;
  }

  var currentX = 0;

  /* x: 経路図のバスの位置、y: 本文の scrollY */
  function render(x, y) {
    /* 進行方向。戻るときはバスを反転する */
    if (x < currentX - 0.5) here.classList.add('is-back');
    else if (x > currentX + 0.5) here.classList.remove('is-back');
    currentX = x;
    here.style.setProperty('--x', x + 'px');

    var progress = maxY > 0 ? Math.min(Math.max(y / maxY, 0), 1) : 0;
    root.style.setProperty('--bus-y', busYStart + (busYEnd - busYStart) * progress + 'px');

    /* 経路図が画面より広いときは、現在地が見える位置まで横に送る */
    var margin = 56;
    var width = viewport.clientWidth;
    var maxLeft = Math.max(0, viewport.scrollWidth - width);
    var left = viewport.scrollLeft;
    if (x - left < margin) {
      viewport.scrollLeft = Math.max(0, x - margin);
    } else if (x - left > width - margin) {
      viewport.scrollLeft = Math.min(maxLeft, x - width + margin);
    }

    var idx = currentIndex(y);
    stations.forEach(function (li, i) { li.classList.toggle('is-current', i === idx); });
    targets.forEach(function (t, i) { t.classList.toggle('is-current', i === idx); });
    links.forEach(function (a, i) {
      if (i === idx) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    });
  }

  /* --- 縦スクロール → 経路図 --- */

  var master = 'vertical';
  var raf = 0;

  function followVertical() {
    if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = 0;
      render(map(window.scrollY, ys, xs), window.scrollY);
    });
  }

  window.addEventListener('scroll', function () {
    if (master === 'vertical') followVertical();
  }, { passive: true });

  /* --- 経路図のドラッグ → 縦スクロール --- */

  var drag = null;
  var suppressClick = false;
  var dragThreshold = 4;

  /* 駅のリンクは標準でドラッグできる。ブラウザのドラッグ&ドロップが始まると
     pointercancel が飛んで同期が切れるので、経路図の中では始めさせない */
  viewport.addEventListener('dragstart', function (e) { e.preventDefault(); });

  viewport.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    suppressClick = false;
    /* 現在地を指の移動量ぶんだけ動かす。押した位置へ飛ばさない */
    drag = { startX: e.clientX, fromX: currentX, moved: false };
    master = 'horizontal';
  });

  window.addEventListener('pointermove', function (e) {
    if (!drag) return;
    if (!drag.moved) {
      if (Math.abs(e.clientX - drag.startX) < dragThreshold) return;
      drag.moved = true;
      viewport.classList.add('is-dragging');
    }
    var x = drag.fromX + (e.clientX - drag.startX);
    x = Math.min(Math.max(x, xs[0]), xs[last]);
    var y = map(x, xs, ys);
    window.scrollTo({ top: y, behavior: 'instant' });
    render(x, y);
  });

  function endDrag() {
    if (!drag) return;
    suppressClick = drag.moved;
    drag = null;
    viewport.classList.remove('is-dragging');
    master = 'vertical';
    followVertical();
  }
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  /* ドラッグの終わりに駅の上で指を離しても、駅へ飛ばない */
  viewport.addEventListener('click', function (e) {
    if (suppressClick) {
      e.preventDefault();
      suppressClick = false;
    }
  }, true);

  /* --- 寸法の変化に追従する --- */

  function relayout() {
    measure();
    followVertical();
  }
  window.addEventListener('resize', relayout);
  window.addEventListener('load', relayout);
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(relayout).observe(document.body);
  }
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(relayout);
  }
  root.classList.add('route-sync');
  relayout();
})();
