/* ============================================================
   AnnoStudio — 前端逻辑
   画布坐标：world = 图像像素坐标；screen = 屏幕坐标
   ============================================================ */
(() => {
  'use strict';

  const PALETTE = [
    '#5b8cff', '#3ddc97', '#ffb454', '#ff6b8b',
    '#b07cff', '#35c9d6', '#f5d547', '#ff8f5b',
    '#7ee0b8', '#8fa4ff', '#e26ad4', '#9ad83a',
  ];

  const $ = (id) => document.getElementById(id);
  const els = {
    folderChip: $('folderChip'), folderName: $('folderName'), homeBtn: $('homeBtn'),
    labelChip: $('labelChip'), labelDirVal: $('labelDirVal'), labelPop: $('labelPop'),
    labelPopPath: $('labelPopPath'), labelPopNote: $('labelPopNote'),
    formatSeg: $('formatSeg'), saveState: $('saveState'),
    exportBtn: $('exportBtn'), helpBtn: $('helpBtn'), openBtn: $('openBtn'),
    imgCount: $('imgCount'), doneCount: $('doneCount'),
    onlyUnlabeled: $('onlyUnlabeled'), unlabeledCount: $('unlabeledCount'),
    searchInput: $('searchInput'), thumbList: $('thumbList'), recursiveChk: $('recursiveChk'),
    stage: $('stage'), canvas: $('canvas'),
    hudMeta: $('hudMeta'), metaName: $('metaName'), metaSize: $('metaSize'), roBadge: $('roBadge'),
    hudNav: $('hudNav'), prevBtn: $('prevBtn'), navIndex: $('navIndex'),
    navTotal: $('navTotal'), nextBtn: $('nextBtn'),
    hudZoom: $('hudZoom'), zoomOut: $('zoomOut'), zoomVal: $('zoomVal'),
    zoomIn: $('zoomIn'), zoomFit: $('zoomFit'),
    empty: $('empty'), emptyPick: $('emptyPick'), pathInput: $('pathInput'),
    pathOpen: $('pathOpen'), recentWrap: $('recentWrap'), recentList: $('recentList'),
    busy: $('busy'), busyText: $('busyText'),
    classChips: $('classChips'), classInput: $('classInput'), classAdd: $('classAdd'),
    classMapBtn: $('classMapBtn'), classRescanBtn: $('classRescanBtn'),
    classFileBtn: $('classFileBtn'), classFilePop: $('classFilePop'),
    classFilePath: $('classFilePath'), classFileNote: $('classFileNote'),
    classFilePick: $('classFilePick'), classFileReset: $('classFileReset'),
    classMapModal: $('classMapModal'), classMapInput: $('classMapInput'),
    classMapSave: $('classMapSave'), classMapCancel: $('classMapCancel'),
    classMapClose: $('classMapClose'),
    boxCount: $('boxCount'), boxList: $('boxList'),
    cx1: $('cx1'), cy1: $('cy1'), cw: $('cw'), ch: $('ch'),
    delBtn: $('delBtn'), delLabel: $('delLabel'), selTitle: $('selTitle'),
    copyPrevBtn: $('copyPrevBtn'),
    toasts: $('toasts'), helpModal: $('helpModal'), helpClose: $('helpClose'),
  };

  const ctx = els.canvas.getContext('2d');

  const S = {
    folder: null,
    images: [],
    filtered: [],
    index: -1,
    classes: [],
    activeClass: null,
    classesFile: '',        // 手动指定的类别清单文件；空 = 自动查找
    format: 'yolo',
    labelDir: '',
    boxes: [],
    polygons: [],        // 只读的多边形标注（YOLO 分割）
    readonly: false,     // 当前图含多边形时整张图只读，不写回文件
    selection: [],       // 选中的框 id（可多选，最后一个是主选中）
    clipboard: [],       // 框的复制剪贴板
    pasteStep: 0,
    onlyUnlabeled: false,
    nodes: [],            // 侧栏当前渲染的节点流（分组标题 + 图片）
    collapsed: new Set(), // 折叠起来的子文件夹
    warnedPlaceholder: false,   // 缺 classes.txt 的提示只说一次
    warnedPoly: false,          // 多边形只读的提示只说一次
    warnedOther: new Set(),     // 「另一种格式有标注」的提示每种格式只说一次
    img: null,
    imgSize: { w: 0, h: 0 },
    view: { s: 1, x: 0, y: 0 },
    draft: null,
    drag: null,
    pan: null,
    undo: [],
    redo: [],
    dirty: false,
    saveTimer: null,
    saveSeq: 0,
    dpr: 1,
    vw: 1, vh: 1,
    renderLimit: 0,
    uid: 1,
    spaceDown: false,
  };

  /* ── 小工具 ─────────────────────────────────────────── */

  const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function colorFor(label) {
    const i = S.classes.indexOf(label);
    if (i >= 0) return PALETTE[i % PALETTE.length];
    let h = 0;
    for (let k = 0; k < label.length; k++) h = (h * 31 + label.charCodeAt(k)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  function toast(msg, kind = 'info', ms = 2600) {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = msg;
    els.toasts.appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 200);
    }, ms);
  }

  async function api(path, body) {
    const opts = body === undefined ? {} : {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    };
    const res = await fetch(path, opts);
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_) {
      throw new Error('服务返回了无法解析的内容');
    }
    if (!res.ok || data.error) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  function busy(on, text) {
    els.busy.hidden = !on;
    if (text) els.busyText.textContent = text;
  }

  function setSaveState(state, text) {
    els.saveState.dataset.state = state;
    const label = text || ({
      idle: '就绪', saved: '已保存', dirty: '未保存', saving: '保存中…', error: '保存失败',
    }[state] || '就绪');
    els.saveState.querySelector('span').textContent = label;
  }

  /* ── 坐标变换 ────────────────────────────────────────── */

  const toScreen = (wx, wy) => ({ x: wx * S.view.s + S.view.x, y: wy * S.view.s + S.view.y });
  const toWorld = (sx, sy) => ({ x: (sx - S.view.x) / S.view.s, y: (sy - S.view.y) / S.view.s });

  function localPt(e) {
    const r = els.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function clampView() {
    const iw = S.imgSize.w * S.view.s;
    const ih = S.imgSize.h * S.view.s;
    const m = 70;
    S.view.x = Math.min(S.vw - m, Math.max(m - iw, S.view.x));
    S.view.y = Math.min(S.vh - m, Math.max(m - ih, S.view.y));
  }

  function fitView() {
    if (!S.img) return;
    const pad = 46;
    const sx = (S.vw - pad * 2) / S.imgSize.w;
    const sy = (S.vh - pad * 2) / S.imgSize.h;
    const s = Math.max(0.01, Math.min(sx, sy));
    S.view.s = s;
    S.view.x = (S.vw - S.imgSize.w * s) / 2;
    S.view.y = (S.vh - S.imgSize.h * s) / 2;
    updateZoomLabel();
    draw();
  }

  function zoomAt(cx, cy, factor) {
    const next = Math.max(0.02, Math.min(40, S.view.s * factor));
    const k = next / S.view.s;
    S.view.x = cx - (cx - S.view.x) * k;
    S.view.y = cy - (cy - S.view.y) * k;
    S.view.s = next;
    clampView();
    updateZoomLabel();
    draw();
  }

  function setZoomAbsolute(scale) {
    const cx = S.vw / 2, cy = S.vh / 2;
    zoomAt(cx, cy, scale / S.view.s);
    S.view.x = (S.vw - S.imgSize.w * S.view.s) / 2;
    S.view.y = (S.vh - S.imgSize.h * S.view.s) / 2;
    clampView();
    draw();
  }

  function updateZoomLabel() {
    els.zoomVal.textContent = Math.round(S.view.s * 100) + '%';
  }

  /* ── 画布尺寸 ────────────────────────────────────────── */

  function resizeCanvas() {
    S.vw = Math.max(1, els.stage.clientWidth);
    S.vh = Math.max(1, els.stage.clientHeight);
    S.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    els.canvas.width = Math.round(S.vw * S.dpr);
    els.canvas.height = Math.round(S.vh * S.dpr);
    draw();
  }

  /* ── 绘制 ────────────────────────────────────────────── */

  function roundRect(c, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.lineTo(x + w - rr, y);
    c.quadraticCurveTo(x + w, y, x + w, y + rr);
    c.lineTo(x + w, y + h - rr);
    c.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    c.lineTo(x + rr, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - rr);
    c.lineTo(x, y + rr);
    c.quadraticCurveTo(x, y, x + rr, y);
    c.closePath();
  }

  function draw() {
    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    ctx.clearRect(0, 0, S.vw, S.vh);
    if (!S.img) return;

    ctx.save();
    ctx.translate(S.view.x, S.view.y);
    ctx.scale(S.view.s, S.view.s);
    ctx.imageSmoothingEnabled = S.view.s < 1;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(S.img, 0, 0);
    ctx.restore();

    const a = toScreen(0, 0), b = toScreen(S.imgSize.w, S.imgSize.h);
    ctx.strokeStyle = 'rgba(255,255,255,.10)';
    ctx.lineWidth = 1;
    ctx.strokeRect(a.x + 0.5, a.y + 0.5, b.x - a.x, b.y - a.y);

    const single = S.selection.length === 1 ? S.selection[0] : null;
    for (const poly of S.polygons) drawPolygon(poly);
    for (const box of S.boxes) {
      drawBox(box, isSelected(box.id), box.id === single);
    }
    if (S.draft) drawDraft(S.draft);
  }

  function drawLabelChip(text, sx, sy, col) {
    ctx.font = '600 11px "Segoe UI", "Microsoft YaHei UI", sans-serif';
    const tw = ctx.measureText(text).width;
    const padX = 5, chipH = 16;
    const chipW = tw + padX * 2;
    let cxp = sx;
    let cyp = sy - chipH - 3;
    if (cyp < 1) cyp = sy + 3;
    if (cxp + chipW > S.vw - 4) cxp = Math.max(4, S.vw - 4 - chipW);

    ctx.fillStyle = col;
    roundRect(ctx, cxp, cyp, chipW, chipH, 3);
    ctx.fill();

    ctx.fillStyle = '#0a0c10';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cxp + padX, cyp + chipH / 2 + 0.5);
  }

  /** 只读的多边形：半透明填充 + 顶点小方块 */
  function drawPolygon(poly) {
    if (!poly.points || poly.points.length < 3) return;
    const pts = poly.points.map((pt) => toScreen(pt[0], pt[1]));
    const col = colorFor(poly.label);

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();

    ctx.fillStyle = col + '1e';
    ctx.fill();
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = col;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    for (const pt of pts) {
      ctx.beginPath();
      ctx.rect(pt.x - 1.5, pt.y - 1.5, 3, 3);
      ctx.fill();
    }

    drawLabelChip(poly.label, pts[0].x, pts[0].y, col);
  }

  function drawBox(box, selected, withHandles) {
    const p = toScreen(box.x1, box.y1);
    const q = toScreen(box.x2, box.y2);
    const w = Math.max(1, q.x - p.x);
    const h = Math.max(1, q.y - p.y);
    const col = colorFor(box.label);

    ctx.fillStyle = col + '22';
    ctx.fillRect(p.x, p.y, w, h);

    ctx.lineWidth = selected ? 2 : 1.5;
    ctx.strokeStyle = selected ? '#ffffff' : col;
    ctx.strokeRect(p.x + 0.5, p.y + 0.5, w, h);

    drawLabelChip(box.label, p.x, p.y, col);

    if (withHandles) {
      const hs = 3.5;
      const pts = handlesOf(p, q);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      for (const pt of pts) {
        ctx.beginPath();
        ctx.rect(pt.x - hs, pt.y - hs, hs * 2, hs * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  function handlesOf(p, q) {
    const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
    return [
      { x: p.x, y: p.y, dir: 'nw' }, { x: mx, y: p.y, dir: 'n' }, { x: q.x, y: p.y, dir: 'ne' },
      { x: q.x, y: my, dir: 'e' }, { x: q.x, y: q.y, dir: 'se' }, { x: mx, y: q.y, dir: 's' },
      { x: p.x, y: q.y, dir: 'sw' }, { x: p.x, y: my, dir: 'w' },
    ];
  }

  function drawDraft(d) {
    const p = toScreen(d.x1, d.y1);
    const q = toScreen(d.x2, d.y2);
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = S.activeClass ? colorFor(S.activeClass) : '#5b8cff';
    ctx.strokeRect(Math.min(p.x, q.x) + 0.5, Math.min(p.y, q.y) + 0.5,
      Math.abs(q.x - p.x), Math.abs(q.y - p.y));
    ctx.restore();
  }

  /* ── 命中检测 ────────────────────────────────────────── */

  function boxAt(wp) {
    for (let i = S.boxes.length - 1; i >= 0; i--) {
      const b = S.boxes[i];
      if (wp.x >= b.x1 && wp.x <= b.x2 && wp.y >= b.y1 && wp.y <= b.y2) return b;
    }
    return null;
  }

  function handleAt(sp) {
    if (S.selection.length !== 1) return null;   // 多选时不显示控制点
    const box = primaryBox();
    if (!box) return null;
    const p = toScreen(box.x1, box.y1);
    const q = toScreen(box.x2, box.y2);
    for (const h of handlesOf(p, q)) {
      if (Math.abs(sp.x - h.x) <= 6 && Math.abs(sp.y - h.y) <= 6) return h.dir;
    }
    return null;
  }

  /* ── 标注数据 ────────────────────────────────────────── */

  function snapshot() {
    return S.boxes.map((b) => ({ ...b }));
  }

  function commit(before) {
    S.undo.push(before);
    if (S.undo.length > 120) S.undo.shift();
    S.redo.length = 0;
    markDirty();
  }

  function markDirty() {
    S.dirty = true;
    setSaveState('dirty');
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(saveNow, 600);
  }

  function isSelected(id) {
    return S.selection.indexOf(id) >= 0;
  }

  function primaryId() {
    return S.selection.length ? S.selection[S.selection.length - 1] : null;
  }

  function primaryBox() {
    const id = primaryId();
    if (id == null) return null;
    return S.boxes.find((b) => b.id === id) || null;
  }

  function selectedBoxes() {
    return S.boxes.filter((b) => isSelected(b.id));
  }

  function refreshSelectionUI() {
    renderBoxList();
    updateCoords();
    updateDelBtn();
    draw();
  }

  function select(id) {
    S.selection = id == null ? [] : [id];
    refreshSelectionUI();
  }

  function toggleSelect(id) {
    const i = S.selection.indexOf(id);
    if (i >= 0) S.selection.splice(i, 1);
    else S.selection.push(id);
    refreshSelectionUI();
  }

  function selectAll() {
    if (!S.boxes.length) return;
    S.selection = S.boxes.map((b) => b.id);
    refreshSelectionUI();
    toast('已全选 ' + S.selection.length + ' 个框', 'info', 1400);
  }

  function deleteSelected() {
    if (!S.selection.length) return;
    const before = snapshot();
    const ids = S.selection.slice();
    S.boxes = S.boxes.filter((b) => ids.indexOf(b.id) < 0);
    S.selection = [];
    commit(before);
    afterBoxChange();
    toast(ids.length > 1 ? '已删除 ' + ids.length + ' 个框' : '已删除 1 个框', 'info', 1400);
  }

  /** 把选中的框统一改成某个类别；返回改了几个。 */
  function applyClassToSelection(label) {
    if (!S.selection.length) return 0;
    const ids = S.selection.slice();
    const before = snapshot();
    let changed = 0;
    for (const b of S.boxes) {
      if (ids.indexOf(b.id) >= 0 && b.label !== label) {
        b.label = label;
        changed += 1;
      }
    }
    if (!changed) return 0;
    commit(before);
    afterBoxChange();
    return changed;
  }

  /* ── 框的复制 / 粘贴 ─────────────────────────────────── */

  /** 当前图是只读多边形时，挡掉所有修改操作 */
  function readonlyBlocked() {
    if (!S.readonly) return false;
    toast('这张图是多边形（分割）标注，只读，不能在这里修改。', 'warn', 3000);
    return true;
  }

  function copySelection() {
    const picked = selectedBoxes();
    if (!picked.length) return toast('先选中要复制的框', 'warn');
    S.clipboard = picked.map((b) => ({
      label: b.label, x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2,
    }));
    S.pasteStep = 0;
    toast('已复制 ' + picked.length + ' 个框（Ctrl+V 粘贴）', 'ok', 1800);
  }

  function pasteClipboard() {
    if (readonlyBlocked()) return;
    if (!S.clipboard.length) return toast('剪贴板是空的，先 Ctrl+C 复制', 'warn');
    if (!S.img) return;
    const W = S.imgSize.w, H = S.imgSize.h;
    S.pasteStep += 1;
    const off = 16 * S.pasteStep;
    const before = snapshot();
    const added = [];
    for (const c of S.clipboard) {
      const w = c.x2 - c.x1, h = c.y2 - c.y1;
      const x1 = Math.min(Math.max(0, W - w), Math.max(0, c.x1 + off));
      const y1 = Math.min(Math.max(0, H - h), Math.max(0, c.y1 + off));
      const box = { id: S.uid++, label: c.label, x1, y1, x2: x1 + w, y2: y1 + h };
      S.boxes.push(box);
      added.push(box.id);
    }
    S.selection = added;
    commit(before);
    afterBoxChange();
    toast('已粘贴 ' + added.length + ' 个框', 'ok', 1600);
  }

  /* ── 复制上一张的标注 ────────────────────────────────── */

  async function imageSizeOf(rel) {
    try {
      const img = await loadImage('/api/image?path=' + encodeURIComponent(rel));
      return { w: img.naturalWidth, h: img.naturalHeight };
    } catch (_) {
      return { w: S.imgSize.w, h: S.imgSize.h };   // 读不到就按当前尺寸处理
    }
  }

  async function copyFromPrevious() {
    if (!S.img) return;
    if (readonlyBlocked()) return;
    if (S.index <= 0) return toast('这是第一张，没有上一张可复制', 'warn');

    const prev = S.images[S.index - 1];
    let ann;
    try {
      ann = await api('/api/ann?path=' + encodeURIComponent(prev.rel));
    } catch (err) {
      return toast('读取上一张失败：' + err.message, 'err', 5000);
    }
    if (!ann.boxes || !ann.boxes.length) {
      return toast('上一张（' + prev.name + '）没有标注框', 'warn');
    }

    const src = await imageSizeOf(prev.rel);
    const W = S.imgSize.w, H = S.imgSize.h;
    const sx = src.w ? W / src.w : 1;
    const sy = src.h ? H / src.h : 1;
    const scaled = (src.w !== W || src.h !== H);

    const before = snapshot();
    let added = 0, dup = 0;
    for (const b of ann.boxes) {
      let x1 = +b.x1, y1 = +b.y1, x2 = +b.x2, y2 = +b.y2;
      if (ann.normalized) {
        x1 *= src.w; x2 *= src.w; y1 *= src.h; y2 *= src.h;
      }
      x1 *= sx; x2 *= sx; y1 *= sy; y2 *= sy;
      if (x2 < x1) { const t = x1; x1 = x2; x2 = t; }
      if (y2 < y1) { const t = y1; y1 = y2; y2 = t; }
      x1 = Math.max(0, Math.min(W, x1)); x2 = Math.max(0, Math.min(W, x2));
      y1 = Math.max(0, Math.min(H, y1)); y2 = Math.max(0, Math.min(H, y2));
      if (x2 - x1 < 2 || y2 - y1 < 2) continue;

      const label = String(b.label || 'object');
      const same = S.boxes.some((o) => o.label === label
        && Math.abs(o.x1 - x1) < 2 && Math.abs(o.y1 - y1) < 2
        && Math.abs(o.x2 - x2) < 2 && Math.abs(o.y2 - y2) < 2);
      if (same) { dup += 1; continue; }

      S.boxes.push({ id: S.uid++, label, x1, y1, x2, y2 });
      if (!S.classes.includes(label)) S.classes.push(label);
      added += 1;
    }

    if (!added) {
      toast(dup ? '上一张的框已经在这张图里了' : '没有可复制的框', 'warn');
      return;
    }
    S.selection = [];
    commit(before);
    afterBoxChange();
    toast('已从上一张复制 ' + added + ' 个框'
      + (scaled ? '（图片尺寸不同，已按比例缩放）' : '')
      + (dup ? '，跳过 ' + dup + ' 个重复' : ''), 'ok', 4000);
  }

  /* ── 保存 ────────────────────────────────────────────── */

  async function saveNow() {
    clearTimeout(S.saveTimer);
    if (S.readonly) return;          // 多边形标注只读，绝不写回
    if (!S.img || S.index < 0 || !S.images[S.index]) return;
    const item = S.images[S.index];
    const seq = ++S.saveSeq;
    setSaveState('saving');
    try {
      const res = await api('/api/save', {
        path: item.rel,
        format: S.format,
        size: { w: S.imgSize.w, h: S.imgSize.h },
        boxes: S.boxes.map((b) => ({ label: b.label, x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 })),
      });
      if (seq !== S.saveSeq) return;
      S.dirty = false;
      setSaveState('saved');
      item.ann = res.boxes > 0;
      updateThumbState(item);
      updateCounters();
      if (res.warning) toast(res.warning, 'warn', 5000);
    } catch (err) {
      if (seq !== S.saveSeq) return;
      setSaveState('error');
      toast('保存失败：' + err.message, 'err', 5000);
    }
  }

  async function flushSave() {
    if (S.saveTimer) {
      clearTimeout(S.saveTimer);
      S.saveTimer = null;
    }
    if (S.dirty) await saveNow();
  }

  /* ── 文件夹与图像列表 ───────────────────────────────── */

  function hydrate(items) {
    return (items || []).map((it, i) => ({
      rel: it.rel,
      name: String(it.rel).split('/').pop(),
      ann: !!it.ann,
      i,
    }));
  }

  function folderLabel(path) {
    const parts = String(path).split(/[\\/]/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : path;
  }

  function applyFolder(data, opts = {}) {
    S.folder = data.folder;
    S.images = hydrate(data.images);
    S.classes = data.classes || [];
    S.format = data.format || 'yolo';
    S.labelDir = data.label_dir || '';
    S.classesFile = data.classes_file || '';
    S.activeClass = S.classes[0] || null;
    S.index = -1;
    S.boxes = [];
    S.polygons = [];
    S.readonly = false;
    S.selection = [];
    S.nodes = [];
    S.collapsed = new Set();
    S.img = null;
    S.undo.length = 0;
    S.redo.length = 0;
    S.dirty = false;

    els.folderName.textContent = data.name || folderLabel(data.root || data.folder);
    els.folderChip.title = data.root || data.folder;
    els.recursiveChk.checked = !!data.recursive;
    setFormatUI(S.format);
    updateLabelChip();
    updateClassFileUI();
    const rootFolder = data.root || data.folder;
    pushRecent(rootFolder);
    setSaveState('idle');

    els.empty.hidden = true;
    els.hudMeta.hidden = false;
    els.hudNav.hidden = false;
    els.hudZoom.hidden = false;
    setControlsEnabled(true);

    renderThumbList();
    renderChips();
    updateCounters();

    if (data.auto_layout) {
      toast('检测到 images/ + labels/ 结构：已自动把 images 当图片目录、labels 当标注目录。',
        'ok', 6500);
    }
    if (data.subfolder_images > 0) {
      toast('这个目录的子文件夹里还有 ' + data.subfolder_images + ' 张图片，'
        + '勾选左下角的「包含子文件夹」可以一起加载（左侧会按文件夹分组显示）。',
        'info', 7500);
    }
    if (data.classes_file && data.classes_file_ok === false) {
      toast('之前指定的类别文件找不到了：' + data.classes_file + '，已临时改用自动查找。',
        'warn', 8000);
    }

    if (!S.images.length) {
      showEmpty('这个文件夹里没有找到图片');
      return;
    }

    const key = 'anno.last:' + data.folder;
    let start = 0;
    const saved = localStorage.getItem(key);
    if (saved) {
      const found = S.images.findIndex((im) => im.rel === saved);
      if (found >= 0) start = found;
    }
    if (opts.startAt != null) start = opts.startAt;
    selectImage(start);
  }

  function setControlsEnabled(on) {
    els.classInput.disabled = !on;
    els.classAdd.disabled = !on;
    els.exportBtn.disabled = !on;
    els.labelChip.disabled = !on;
    els.onlyUnlabeled.disabled = !on;
    els.classMapBtn.disabled = !on;
    els.classRescanBtn.disabled = !on;
    els.classFileBtn.disabled = !on;
    if (!on) els.classFilePop.hidden = true;
    if (!on) els.labelPop.hidden = true;
    els.classInput.placeholder = on ? '新增类别…' : '先打开文件夹';
  }

  function showEmpty(message) {
    els.empty.hidden = false;
    els.hudMeta.hidden = true;
    els.hudNav.hidden = true;
    els.hudZoom.hidden = true;
    setControlsEnabled(false);
    S.img = null;
    draw();
    if (message) toast(message, 'warn');
  }

  /** 点左上角：保存后关掉当前数据集，回到起始页 */
  async function closeFolder() {
    if (!S.folder) return;                 // 已经在起始页
    if (S.dirty) await flushSave();
    try {
      await api('/api/close', {});
    } catch (err) {
      return toast('回到起始页失败：' + err.message, 'err', 5000);
    }
    resetToStart();
  }

  function resetToStart() {
    S.folder = null;
    S.images = [];
    S.filtered = [];
    S.nodes = [];
    S.index = -1;
    S.boxes = [];
    S.polygons = [];
    S.readonly = false;
    S.selection = [];
    S.classes = [];
    S.activeClass = null;
    S.classesFile = '';
    S.labelDir = '';
    S.format = 'yolo';
    S.img = null;
    S.imgSize = { w: 0, h: 0 };
    S.undo.length = 0;
    S.redo.length = 0;
    S.dirty = false;
    S.collapsed = new Set();
    S.warnedOther = new Set();
    S.warnedPlaceholder = false;
    S.onlyUnlabeled = false;

    els.folderName.textContent = '未打开文件夹';
    els.folderChip.title = '';
    els.searchInput.value = '';
    els.thumbList.innerHTML = '';
    els.recursiveChk.checked = false;
    setFormatUI(S.format);
    updateLabelChip();
    updateClassFileUI();

    renderChips();
    renderBoxList();
    updateCounters();
    updateCoords();
    updateDelBtn();
    setSaveState('idle');
    showEmpty(null);
  }

  async function openPath(path) {
    const target = String(path || '').trim().replace(/^["']|["']$/g, '');
    if (!target) return toast('请先填写文件夹路径', 'warn');
    await flushSave();
    busy(true, '正在扫描文件夹…');
    try {
      const data = await api('/api/open', { path: target, recursive: els.recursiveChk.checked });
      applyFolder(data);
    } catch (err) {
      toast('打开失败：' + err.message, 'err', 5000);
    } finally {
      busy(false);
    }
  }

  async function pickFolder() {
    await flushSave();
    busy(true, '请在弹出的窗口里选择文件夹…');
    try {
      const data = await api('/api/pick', {});
      if (data && data.canceled) return;
      if (data && data.folder) applyFolder(data);
    } catch (err) {
      toast('选择文件夹失败：' + err.message, 'err', 5000);
    } finally {
      busy(false);
    }
  }

  /* ── 选图 ────────────────────────────────────────────── */

  async function selectImage(i) {
    if (i < 0 || i >= S.images.length) return;
    await flushSave();

    S.index = i;
    const item = S.images[i];
    localStorage.setItem('anno.last:' + S.folder, item.rel);
    markActiveRow();
    updateCounters();

    busy(true, '载入图像…');
    let img;
    try {
      img = await loadImage('/api/image?path=' + encodeURIComponent(item.rel));
    } catch (err) {
      busy(false);
      toast('无法载入图像：' + item.name, 'err', 5000);
      return;
    }
    S.img = img;
    S.imgSize = { w: img.naturalWidth, h: img.naturalHeight };
    S.boxes = [];
    S.polygons = [];
    S.readonly = false;
    S.selection = [];
    S.undo.length = 0;
    S.redo.length = 0;
    S.dirty = false;
    els.metaName.textContent = item.name;
    els.metaSize.textContent = img.naturalWidth + ' × ' + img.naturalHeight;
    els.roBadge.hidden = true;
    els.navIndex.textContent = String(i + 1);
    els.navTotal.textContent = String(S.images.length);
    fitView();
    setSaveState('idle');

    try {
      const ann = await api('/api/ann?path=' + encodeURIComponent(item.rel));
      S.boxes = normalizeBoxes(ann);
      S.polygons = normalizePolygons(ann);
      S.readonly = !!ann.readonly;
      els.roBadge.hidden = !S.readonly;
      if (ann.warning) toast(ann.warning, 'warn', 6000);
      if (S.readonly && !S.warnedPoly) {
        S.warnedPoly = true;
        toast('这张图是多边形（分割）标注，目前只供查看：可以浏览、缩放，不会修改原文件。',
          'info', 7000);
      }
      if (ann.other_format && !S.warnedOther.has(ann.other_format)) {
        S.warnedOther.add(ann.other_format);
        toast('当前是 ' + String(S.format).toUpperCase() + ' 模式，但这张图有 '
          + String(ann.other_format).toUpperCase() + ' 格式的标注；切到 '
          + String(ann.other_format).toUpperCase()
          + ' 就能看到（原文件没有被删除）。', 'warn', 8500);
      }
      for (const b of S.boxes) {
        if (!S.classes.includes(b.label)) S.classes.push(b.label);
      }
      for (const p of S.polygons) {
        if (!S.classes.includes(p.label)) S.classes.push(p.label);
      }
    } catch (err) {
      toast('读取标注失败：' + err.message, 'err', 6000);
    }

    if (!S.activeClass && S.classes.length) S.activeClass = S.classes[0];

    // YOLO 缺 classes.txt 时只能显示 class_0 这类占位名，提示一次就够了
    if (S.format === 'yolo' && !S.warnedPlaceholder
        && S.boxes.some((b) => /^class_\d+$/.test(b.label))) {
      S.warnedPlaceholder = true;
      toast('这些标注只有类别序号（目录里没有 classes.txt）。'
        + '点类别标题右边的「映射」按序号填真实名字。', 'warn', 8000);
    }

    renderChips();
    renderBoxList();
    updateCoords();
    updateDelBtn();
    updateCounters();
    busy(false);
    draw();
    scrollRowIntoView();
  }

  function normalizeBoxes(ann) {
    const list = ann.boxes || [];
    const W = S.imgSize.w, H = S.imgSize.h;
    const out = [];
    for (const b of list) {
      let x1 = +b.x1, y1 = +b.y1, x2 = +b.x2, y2 = +b.y2;
      if (ann.normalized) {
        x1 *= W; x2 *= W; y1 *= H; y2 *= H;
      }
      if (!isFinite(x1) || !isFinite(y1) || !isFinite(x2) || !isFinite(y2)) continue;
      if (x2 < x1) [x1, x2] = [x2, x1];
      if (y2 < y1) [y1, y2] = [y2, y1];
      out.push({
        id: S.uid++,
        label: String(b.label || 'object'),
        x1: Math.max(0, Math.min(W, x1)),
        y1: Math.max(0, Math.min(H, y1)),
        x2: Math.max(0, Math.min(W, x2)),
        y2: Math.max(0, Math.min(H, y2)),
      });
    }
    return out;
  }

  /** YOLO 分割多边形：归一化点 → 像素点（只读展示用） */
  function normalizePolygons(ann) {
    const list = ann.polygons || [];
    const W = S.imgSize.w, H = S.imgSize.h;
    const out = [];
    for (const item of list) {
      const pts = (item.points || []).map((pt) => {
        let x = +pt[0], y = +pt[1];
        if (ann.normalized) { x *= W; y *= H; }
        return [Math.max(0, Math.min(W, x)), Math.max(0, Math.min(H, y))];
      }).filter((pt) => isFinite(pt[0]) && isFinite(pt[1]));
      if (pts.length < 3) continue;
      out.push({ id: S.uid++, label: String(item.label || 'object'), points: pts });
    }
    return out;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('decode failed'));
      img.src = src;
    });
  }

  async function step(delta) {
    if (!S.images.length) return;
    const next = Math.min(S.images.length - 1, Math.max(0, S.index + delta));
    if (next === S.index) return;
    await selectImage(next);
  }

  /** 往后找第一张还没标注的图，到头了就从头绕一圈。 */
  async function nextUnlabeled() {
    if (!S.images.length) return;
    for (let k = S.index + 1; k < S.images.length; k++) {
      if (!S.images[k].ann) return selectImage(k);
    }
    for (let k = 0; k <= S.index && k < S.images.length; k++) {
      if (!S.images[k].ann) return selectImage(k);
    }
    toast('全部图片都标注完了', 'ok', 2400);
  }

  function toggleOnlyUnlabeled() {
    S.onlyUnlabeled = !S.onlyUnlabeled;
    renderThumbList();
    if (S.onlyUnlabeled) scrollRowIntoView();
  }

  /* ── 侧栏列表（按子文件夹分组） ─────────────────────── */

  function dirOf(rel) {
    const i = rel.lastIndexOf('/');
    return i < 0 ? '' : rel.slice(0, i);
  }

  function groupItems(items) {
    const order = [];
    const map = new Map();
    for (const it of items) {
      const dir = dirOf(it.rel);
      if (!map.has(dir)) { map.set(dir, []); order.push(dir); }
      map.get(dir).push(it);
    }
    const groups = order.map((dir) => ({ dir, items: map.get(dir) }));
    // 根目录的图片排在第一个分组，其余保持自然顺序
    const rootIdx = groups.findIndex((g) => g.dir === '');
    if (rootIdx > 0) groups.unshift(groups.splice(rootIdx, 1)[0]);
    return groups;
  }

  function renderThumbList() {
    const q = els.searchInput.value.trim().toLowerCase();
    S.filtered = S.images.filter((im) => {
      if (S.onlyUnlabeled && im.ann) return false;
      if (q && !im.rel.toLowerCase().includes(q)) return false;   // 可以按子目录名搜
      return true;
    });

    const groups = groupItems(S.filtered);
    const withHeaders = groups.length > 1 || (groups.length === 1 && groups[0].dir !== '');

    S.nodes = [];
    for (const g of groups) {
      if (withHeaders) {
        S.nodes.push({
          type: 'group', dir: g.dir,
          total: g.items.length,
          done: g.items.filter((x) => x.ann).length,
        });
        if (S.collapsed.has(g.dir)) continue;
      }
      for (const it of g.items) S.nodes.push({ type: 'image', item: it });
    }

    els.thumbList.innerHTML = '';
    S.renderLimit = 0;
    if (!S.nodes.length) {
      const msg = S.onlyUnlabeled
        ? (S.images.length ? '全部标注完了' : '还没有图片')
        : '没有匹配的图像';
      els.thumbList.innerHTML = '<div class="list-empty">' + msg + '</div>';
      updateCounters();
      return;
    }
    appendRows();
    updateCounters();
  }

  function appendRows() {
    if (S.renderLimit >= S.nodes.length) return;
    const CHUNK = 80;
    const end = Math.min(S.renderLimit + CHUNK, S.nodes.length);
    const frag = document.createDocumentFragment();
    for (let k = S.renderLimit; k < end; k++) {
      const node = S.nodes[k];
      frag.appendChild(node.type === 'group' ? makeGroupRow(node) : makeRow(node.item));
    }
    els.thumbList.appendChild(frag);
    S.renderLimit = end;
  }

  function makeGroupRow(node) {
    const row = document.createElement('div');
    row.className = 'group-row' + (S.collapsed.has(node.dir) ? ' collapsed' : '');
    row.dataset.dir = node.dir;
    row.title = node.dir || '(根目录)';
    row.innerHTML =
      '<svg class="caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>'
      + '<span class="group-name">' + escHtml(node.dir || '(根目录)') + '</span>'
      + '<span class="group-count">' + node.done + '/' + node.total + '</span>';
    return row;
  }

  function makeRow(item) {
    const row = document.createElement('div');
    row.className = 'thumb-row'
      + (item.i === S.index ? ' active' : '')
      + (item.ann ? ' has-ann' : '');
    row.dataset.i = String(item.i);
    row.title = item.rel;
    row.innerHTML =
      '<img class="thumb-img" loading="lazy" decoding="async" alt="" src="/api/image?path='
        + encodeURIComponent(item.rel) + '">'
      + '<div class="thumb-meta">'
      + '<span class="thumb-name">' + escHtml(item.name) + '</span>'
      + '<span class="thumb-sub">' + (item.ann ? '已标注' : '未标注') + '</span>'
      + '</div><span class="thumb-dot"></span>';
    return row;
  }

  function updateThumbState(item) {
    const row = els.thumbList.querySelector('.thumb-row[data-i="' + item.i + '"]');
    if (row) {
      row.classList.toggle('has-ann', item.ann);
      const sub = row.querySelector('.thumb-sub');
      if (sub) sub.textContent = item.ann ? '已标注' : '未标注';
    }
    refreshGroupCounts();
  }

  /** 只更新分组标题上的「已完成/总数」，不重建列表 */
  function refreshGroupCounts() {
    const heads = els.thumbList.querySelectorAll('.group-row');
    if (!heads.length) return;
    const stats = new Map();
    for (const im of S.filtered) {
      const dir = dirOf(im.rel);
      const s = stats.get(dir) || { total: 0, done: 0 };
      s.total += 1;
      if (im.ann) s.done += 1;
      stats.set(dir, s);
    }
    heads.forEach((head) => {
      const s = stats.get(head.dataset.dir);
      const el = head.querySelector('.group-count');
      if (s && el) el.textContent = s.done + '/' + s.total;
    });
  }

  function markActiveRow() {
    els.thumbList.querySelectorAll('.thumb-row.active').forEach((r) => r.classList.remove('active'));
    const row = els.thumbList.querySelector('.thumb-row[data-i="' + S.index + '"]');
    if (row) row.classList.add('active');
  }

  function scrollRowIntoView() {
    const pos = S.nodes.findIndex((n) => n.type === 'image' && n.item.i === S.index);
    if (pos < 0) return;
    while (S.renderLimit <= pos) appendRows();
    markActiveRow();
    const row = els.thumbList.querySelector('.thumb-row[data-i="' + S.index + '"]');
    if (row) row.scrollIntoView({ block: 'nearest' });
  }

  function updateCounters() {
    const done = S.images.filter((im) => im.ann).length;
    els.imgCount.textContent = String(S.images.length);
    els.doneCount.textContent = String(done);
    els.unlabeledCount.textContent = String(S.images.length - done);
    els.onlyUnlabeled.classList.toggle('on', S.onlyUnlabeled);
    els.boxCount.textContent = String(S.boxes.length + S.polygons.length);
  }

  /* ── 类别 ────────────────────────────────────────────── */

  function renderChips() {
    const counts = {};
    for (const b of S.boxes) counts[b.label] = (counts[b.label] || 0) + 1;

    if (!S.classes.length) {
      els.classChips.innerHTML = '<div class="list-empty" style="padding:6px 2px">还没有类别，先添加一个</div>';
      return;
    }
    const frag = document.createDocumentFragment();
    for (const label of S.classes) {
      const btn = document.createElement('button');
      btn.className = 'chip' + (label === S.activeClass ? ' on' : '');
      btn.dataset.label = label;
      btn.style.setProperty('--c', colorFor(label));
      btn.title = '点击设为当前类别；有选中框时会一起改类别。右键删除';
      btn.innerHTML = '<i class="swatch"></i><span>' + escHtml(label) + '</span>'
        + (counts[label] ? '<b class="count">' + counts[label] + '</b>' : '');
      frag.appendChild(btn);
    }
    els.classChips.innerHTML = '';
    els.classChips.appendChild(frag);
  }

  async function addClass() {
    const name = els.classInput.value.trim();
    if (!name) return;
    if (S.classes.includes(name)) {
      toast('类别已存在：' + name, 'warn');
      els.classInput.value = '';
      return;
    }
    S.classes.push(name);
    S.activeClass = name;
    els.classInput.value = '';
    renderChips();
    await persistClasses();
  }

  async function removeClass(name) {
    const used = S.boxes.filter((b) => b.label === name).length;
    if (used && !confirm('「' + name + '」还有 ' + used + ' 个标注框，删除类别后这些框会保留原样。继续？')) return;
    S.classes = S.classes.filter((c) => c !== name);
    if (S.activeClass === name) S.activeClass = S.classes[0] || null;
    renderChips();
    await persistClasses();
  }

  async function persistClasses() {
    try {
      await api('/api/classes', { classes: S.classes });
    } catch (err) {
      toast('类别保存失败：' + err.message, 'err');
    }
  }

  /* ── 重扫 / 类别名映射 ───────────────────────────────── */

  async function rescanClasses() {
    if (!S.folder) return toast('先打开一个文件夹', 'warn');
    await flushSave();
    busy(true, '正在扫描已有标注…');
    try {
      const res = await api('/api/classes/rescan', {});
      S.classes = res.classes || [];
      if (!S.classes.includes(S.activeClass)) S.activeClass = S.classes[0] || null;
      renderChips();
      // YOLO 是整份替换：序号到名字的映射变了，当前图必须重读
      if (res.mode === 'replace') await reloadAnnotations();

      const added = res.added || [];
      if (added.length) {
        toast('发现 ' + added.length + ' 个新类别：' + added.slice(0, 6).join('、')
          + (added.length > 6 ? ' 等' : ''), 'ok', 4000);
      } else {
        toast('类别没有变化（扫描了 ' + (res.scanned || 0) + ' 个标注文件）', 'info', 3000);
      }
      if (res.truncated) {
        toast('标注文件太多，只扫描了前 ' + res.scanned + ' 个', 'warn', 4500);
      }
    } catch (err) {
      toast('重新扫描失败：' + err.message, 'err', 6000);
    } finally {
      busy(false);
    }
  }

  /* ── 指定类别清单文件 ───────────────────────────────── */

  function updateClassFileUI() {
    const has = !!S.classesFile;
    els.classFileBtn.classList.toggle('on', has);
    els.classFilePath.textContent = has ? S.classesFile : '自动查找（图片根目录 / labels 目录）';
    els.classFileNote.textContent = has
      ? '类别以这个文件为准；在界面里增删类别会写回它'
      : '按 根目录 → labels 目录 的顺序找 classes.txt';
  }

  async function setClassFile(path) {
    if (!S.folder) return toast('先打开一个文件夹', 'warn');
    els.classFilePop.hidden = true;
    await flushSave();
    busy(true, '读取类别文件…');
    try {
      const res = await api('/api/classfile', { path: path || '' });
      S.classesFile = res.classes_file || '';
      S.classes = res.classes || [];
      if (!S.classes.includes(S.activeClass)) S.activeClass = S.classes[0] || null;
      renderChips();
      updateClassFileUI();
      await reloadAnnotations();     // YOLO 的序号映射可能变了，当前图要重读
      toast((S.classesFile ? '类别文件已切换' : '已恢复自动查找')
        + '（' + S.classes.length + ' 个类别）', 'ok', 4000);
    } catch (err) {
      toast('切换类别文件失败：' + err.message, 'err', 6000);
    } finally {
      busy(false);
    }
  }

  async function pickClassFile() {
    busy(true, '请选择类别文件…');
    try {
      const res = await api('/api/pick', { role: 'classfile' });
      if (res && res.path) await setClassFile(res.path);
    } catch (err) {
      toast('选择文件失败：' + err.message, 'err', 5000);
    } finally {
      busy(false);
    }
  }

  /** 没有类别名时，用当前图里的 class_N 占位名拼一份初始文本 */
  function guessClassMapText() {
    if (S.classes.length) return S.classes.join('\n');
    let max = -1;
    for (const b of S.boxes) {
      const m = /^class_(\d+)$/.exec(b.label);
      if (m) max = Math.max(max, Number(m[1]));
    }
    const lines = [];
    for (let i = 0; i <= max; i++) lines.push('class_' + i);
    return lines.join('\n');
  }

  function openClassMap() {
    if (!S.folder) return toast('先打开一个文件夹', 'warn');
    els.classMapInput.value = guessClassMapText();
    els.classMapModal.hidden = false;
    setTimeout(() => els.classMapInput.focus(), 30);
  }

  async function saveClassMap() {
    const names = els.classMapInput.value
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!names.length) return toast('至少填一个类别名', 'warn');
    const seen = {};
    for (const n of names) {
      if (seen[n]) return toast('类别名重复：' + n, 'warn');
      seen[n] = true;
    }

    els.classMapModal.hidden = true;
    busy(true, '保存类别名…');
    try {
      const res = await api('/api/classes', { classes: names });
      S.classes = res.classes || names;
      if (!S.classes.includes(S.activeClass)) S.activeClass = S.classes[0] || null;
      renderChips();
      await reloadAnnotations();     // 按新映射重读当前图
      toast('类别已更新（共 ' + S.classes.length + ' 个）'
        + (res.wrote_txt ? '，已写入 classes.txt' : ''), 'ok', 4000);
    } catch (err) {
      toast('保存类别失败：' + err.message, 'err', 5000);
    } finally {
      busy(false);
    }
  }

  /* ── 本图标注列表 ────────────────────────────────────── */

  function renderBoxList() {
    if (!S.boxes.length && !S.polygons.length) {
      let msg = '尚未载入图像';
      if (S.img) msg = S.readonly ? '这张图没有可编辑的标注' : '在图上拖拽即可画框';
      els.boxList.innerHTML = '<div class="list-empty">' + msg + '</div>';
      return;
    }
    const frag = document.createDocumentFragment();
    for (const b of S.boxes) {
      const row = document.createElement('div');
      row.className = 'box-row' + (isSelected(b.id) ? ' on' : '');
      row.dataset.id = String(b.id);
      row.style.setProperty('--c', colorFor(b.label));
      row.innerHTML = '<i class="swatch"></i>'
        + '<span class="label">' + escHtml(b.label) + '</span>'
        + '<button class="del" title="删除这个框">×</button>';
      frag.appendChild(row);
    }
    // 多边形只读：列出但不给删除按钮
    for (const poly of S.polygons) {
      const row = document.createElement('div');
      row.className = 'box-row poly-row';
      row.style.setProperty('--c', colorFor(poly.label));
      row.title = '多边形标注（只读，' + poly.points.length + ' 个点）';
      row.innerHTML = '<i class="swatch"></i>'
        + '<span class="label">' + escHtml(poly.label) + '</span>'
        + '<span class="poly-tag">多边形</span>';
      frag.appendChild(row);
    }
    els.boxList.innerHTML = '';
    els.boxList.appendChild(frag);
  }

  function updateCoords() {
    const box = S.selection.length === 1 ? primaryBox() : null;
    if (!box) {
      els.cx1.textContent = els.cy1.textContent = els.cw.textContent = els.ch.textContent = '—';
    } else {
      els.cx1.textContent = Math.round(box.x1);
      els.cy1.textContent = Math.round(box.y1);
      els.cw.textContent = Math.round(box.x2 - box.x1);
      els.ch.textContent = Math.round(box.y2 - box.y1);
    }
    const n = S.selection.length;
    els.selTitle.textContent = n > 1 ? '已选中 ' + n + ' 个框' : (n === 1 ? '选中框' : '选中框');
  }

  function updateDelBtn() {
    const n = S.selection.length;
    els.delBtn.disabled = n === 0;
    els.delLabel.textContent = n > 1 ? '删除 ' + n + ' 个 (Del)' : '删除 (Del)';
  }

  /* ── 指针交互 ────────────────────────────────────────── */

  function onPointerDown(e) {
    if (!S.img) return;
    // 中键、右键、空格+左键 都用来平移画面
    if (e.button === 1 || e.button === 2 || S.spaceDown) {
      e.preventDefault();
      S.pan = { sx: localPt(e).x, sy: localPt(e).y, ox: S.view.x, oy: S.view.y };
      els.canvas.style.cursor = 'grabbing';
      els.canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    if (readonlyBlocked()) return;

    const sp = localPt(e);
    els.canvas.setPointerCapture(e.pointerId);

    if (S.selection.length === 1) {
      const dir = handleAt(sp);
      if (dir) {
        const box = primaryBox();
        S.drag = { mode: 'resize', dir, box, start: toWorld(sp.x, sp.y), before: snapshot() };
        return;
      }
    }

    const wp = toWorld(sp.x, sp.y);
    const hit = boxAt(wp);
    if (hit) {
      if (e.shiftKey) {          // Shift + 点击 = 加选 / 减选
        toggleSelect(hit.id);
        return;
      }
      if (!isSelected(hit.id)) select(hit.id);
      S.drag = {
        mode: 'move', start: wp, before: snapshot(), moved: false, box: hit,
        origs: selectedBoxes().map((b) => ({ id: b.id, x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 })),
      };
      return;
    }

    if (!S.activeClass) {
      toast('先在右侧选择一个类别，再画框', 'warn');
      return;
    }
    if (!e.shiftKey && S.selection.length) {
      S.selection = [];
      refreshSelectionUI();
    }
    S.drag = { mode: 'draw', start: wp, before: snapshot(), moved: false };
    S.draft = { x1: wp.x, y1: wp.y, x2: wp.x, y2: wp.y };
  }

  function onPointerMove(e) {
    if (S.pan) {
      const sp = localPt(e);
      S.view.x = S.pan.ox + (sp.x - S.pan.sx);
      S.view.y = S.pan.oy + (sp.y - S.pan.sy);
      clampView();
      draw();
      return;
    }
    if (!S.drag) {
      updateCursor(e);
      return;
    }

    const sp = localPt(e);
    const wp = toWorld(sp.x, sp.y);
    const W = S.imgSize.w, H = S.imgSize.h;
    const clampX = (v) => Math.max(0, Math.min(W, v));
    const clampY = (v) => Math.max(0, Math.min(H, v));

    if (S.drag.mode === 'draw') {
      S.drag.moved = true;
      S.draft = {
        x1: clampX(S.drag.start.x), y1: clampY(S.drag.start.y),
        x2: clampX(wp.x), y2: clampY(wp.y),
      };
      draw();
      return;
    }

    if (S.drag.mode === 'move') {
      const dx = wp.x - S.drag.start.x;
      const dy = wp.y - S.drag.start.y;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) S.drag.moved = true;

      // 整组一起移动，并保证没有框被拖出图像边界
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const o of S.drag.origs) {
        minX = Math.min(minX, o.x1); minY = Math.min(minY, o.y1);
        maxX = Math.max(maxX, o.x2); maxY = Math.max(maxY, o.y2);
      }
      const ddx = Math.min(W - maxX, Math.max(-minX, dx));
      const ddy = Math.min(H - maxY, Math.max(-minY, dy));
      for (const o of S.drag.origs) {
        const b = S.boxes.find((bx) => bx.id === o.id);
        if (!b) continue;
        b.x1 = o.x1 + ddx; b.x2 = o.x2 + ddx;
        b.y1 = o.y1 + ddy; b.y2 = o.y2 + ddy;
      }
      updateCoords();
      draw();
      return;
    }

    if (S.drag.mode === 'resize') {
      const b = S.drag.box;
      const o = S.drag.orig || (S.drag.orig = { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 });
      let x1 = o.x1, y1 = o.y1, x2 = o.x2, y2 = o.y2;
      const dir = S.drag.dir;
      if (dir.includes('w')) x1 = clampX(wp.x);
      if (dir.includes('e')) x2 = clampX(wp.x);
      if (dir.includes('n')) y1 = clampY(wp.y);
      if (dir.includes('s')) y2 = clampY(wp.y);
      if (x2 - x1 < 3) { if (dir.includes('w')) x1 = x2 - 3; else x2 = x1 + 3; }
      if (y2 - y1 < 3) { if (dir.includes('n')) y1 = y2 - 3; else y2 = y1 + 3; }
      b.x1 = Math.max(0, x1); b.y1 = Math.max(0, y1);
      b.x2 = Math.min(W, x2); b.y2 = Math.min(H, y2);
      updateCoords();
      draw();
      return;
    }
  }

  function onPointerUp(e) {
    if (S.pan) {
      S.pan = null;
      els.canvas.style.cursor = S.spaceDown ? 'grab' : 'default';
      return;
    }
    if (!S.drag) return;
    const drag = S.drag;
    S.drag = null;

    if (drag.mode === 'draw') {
      const d = S.draft;
      S.draft = null;
      if (!d || Math.abs(d.x2 - d.x1) < 4 || Math.abs(d.y2 - d.y1) < 4) {
        if (!drag.moved) select(null);
        draw();
        return;
      }
      const box = {
        id: S.uid++,
        label: S.activeClass,
        x1: Math.min(d.x1, d.x2), y1: Math.min(d.y1, d.y2),
        x2: Math.max(d.x1, d.x2), y2: Math.max(d.y1, d.y2),
      };
      S.boxes.push(box);
      S.selection = [box.id];
      commit(drag.before);
      afterBoxChange();
      return;
    }

    if ((drag.mode === 'move' || drag.mode === 'resize') && drag.moved) {
      commit(drag.before);
      afterBoxChange();
      return;
    }
    draw();
  }

  function afterBoxChange() {
    const alive = new Set(S.boxes.map((b) => b.id));
    S.selection = S.selection.filter((id) => alive.has(id));
    renderBoxList();
    renderChips();
    updateCoords();
    updateDelBtn();
    updateCounters();
    draw();
  }

  function updateCursor(e) {
    if (!S.img) return;
    const sp = localPt(e);
    if (S.spaceDown) { els.canvas.style.cursor = 'grab'; return; }
    if (S.selection.length === 1) {
      const dir = handleAt(sp);
      if (dir) {
        els.canvas.style.cursor = ({ nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' })[dir];
        return;
      }
    }
    const wp = toWorld(sp.x, sp.y);
    els.canvas.style.cursor = boxAt(wp) ? 'move' : 'crosshair';
  }

  /* ── 事件绑定 ────────────────────────────────────────── */

  function wire() {
    els.homeBtn.addEventListener('click', closeFolder);
    els.openBtn.addEventListener('click', pickFolder);
    els.emptyPick.addEventListener('click', pickFolder);
    els.pathOpen.addEventListener('click', () => openPath(els.pathInput.value));
    els.pathInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') openPath(els.pathInput.value);
    });

    els.recursiveChk.addEventListener('change', async () => {
      if (!S.folder) return;
      await flushSave();
      busy(true, '重新扫描…');
      try {
        const data = await api('/api/open', { path: S.folder, recursive: els.recursiveChk.checked });
        applyFolder(data, { startAt: Math.max(0, S.index) });
      } catch (err) {
        toast('扫描失败：' + err.message, 'err');
      } finally {
        busy(false);
      }
    });

    els.thumbList.addEventListener('click', (e) => {
      const group = e.target.closest('.group-row');
      if (group) {
        const dir = group.dataset.dir;
        if (S.collapsed.has(dir)) S.collapsed.delete(dir);
        else S.collapsed.add(dir);
        renderThumbList();
        scrollRowIntoView();
        return;
      }
      const row = e.target.closest('.thumb-row');
      if (!row) return;
      selectImage(Number(row.dataset.i));
    });

    els.thumbList.addEventListener('scroll', () => {
      const el = els.thumbList;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240) appendRows();
    });

    els.searchInput.addEventListener('input', () => { renderThumbList(); scrollRowIntoView(); });

    els.formatSeg.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-format]');
      if (!btn) return;
      switchFormat(btn.dataset.format);
    });

    els.labelChip.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleLabelPop();
    });
    els.labelPop.addEventListener('click', (e) => {
      const item = e.target.closest('.pop-item');
      if (!item) return;
      els.labelPop.hidden = true;
      const mode = item.dataset.mode;
      if (mode === 'custom') pickLabelDir();
      else setLabelDir(mode === 'labels' ? 'labels' : '');
    });
    document.addEventListener('click', (e) => {
      if (!els.labelPop.hidden && !e.target.closest('.label-wrap')) els.labelPop.hidden = true;
    });

    els.classChips.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      const label = chip.dataset.label;
      S.activeClass = label;
      const changed = applyClassToSelection(label);   // 有选中框时顺便批量改类别
      renderChips();
      if (changed) toast('已把 ' + changed + ' 个框改为「' + label + '」', 'ok', 2200);
    });
    els.classChips.addEventListener('contextmenu', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      e.preventDefault();
      removeClass(chip.dataset.label);
    });

    els.classAdd.addEventListener('click', addClass);
    els.classInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addClass();
    });

    els.classRescanBtn.addEventListener('click', rescanClasses);
    els.classMapBtn.addEventListener('click', openClassMap);

    els.classFileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      updateClassFileUI();
      els.classFilePop.hidden = !els.classFilePop.hidden;
    });
    els.classFilePick.addEventListener('click', pickClassFile);
    els.classFileReset.addEventListener('click', () => setClassFile(''));
    document.addEventListener('click', (e) => {
      if (!els.classFilePop.hidden && !e.target.closest('.pf-wrap')) els.classFilePop.hidden = true;
    });
    els.classMapSave.addEventListener('click', saveClassMap);
    els.classMapCancel.addEventListener('click', () => { els.classMapModal.hidden = true; });
    els.classMapClose.addEventListener('click', () => { els.classMapModal.hidden = true; });
    els.classMapModal.addEventListener('click', (e) => {
      if (e.target === els.classMapModal) els.classMapModal.hidden = true;
    });

    els.boxList.addEventListener('click', (e) => {
      const row = e.target.closest('.box-row');
      if (!row) return;
      if (!row.dataset.id) return;          // 多边形行不可选
      const id = Number(row.dataset.id);
      if (e.target.closest('.del')) {
        const before = snapshot();
        S.boxes = S.boxes.filter((b) => b.id !== id);
        S.selection = S.selection.filter((x) => x !== id);
        commit(before);
        afterBoxChange();
        return;
      }
      if (e.shiftKey || e.ctrlKey || e.metaKey) toggleSelect(id);
      else select(id);
    });

    els.copyPrevBtn.addEventListener('click', copyFromPrevious);
    els.onlyUnlabeled.addEventListener('click', toggleOnlyUnlabeled);

    els.delBtn.addEventListener('click', deleteSelected);

    els.prevBtn.addEventListener('click', () => step(-1));
    els.nextBtn.addEventListener('click', () => step(1));
    els.zoomIn.addEventListener('click', () => zoomAt(S.vw / 2, S.vh / 2, 1.25));
    els.zoomOut.addEventListener('click', () => zoomAt(S.vw / 2, S.vh / 2, 0.8));
    els.zoomFit.addEventListener('click', fitView);
    els.zoomVal.addEventListener('click', () => setZoomAbsolute(1));

    els.exportBtn.addEventListener('click', async () => {
      if (!S.folder) return toast('先打开一个文件夹', 'warn');
      await flushSave();
      busy(true, '正在导出 YOLO 数据集…');
      try {
        const res = await api('/api/export', {});
        if (!res.images) {
          toast(S.format === 'yolo'
            ? '当前已经是 YOLO 格式，已重新生成 classes.txt 和 data.yaml'
            : '没有找到 VOC 标注文件，只生成了 classes.txt 和 data.yaml', 'warn', 5000);
        } else {
          toast('已导出 ' + res.images + ' 张标注，共 ' + res.boxes + ' 个框，'
            + res.classes.length + ' 个类别'
            + (res.errors && res.errors.length ? '（' + res.errors.length + ' 张跳过）' : ''),
            'ok', 4500);
        }
      } catch (err) {
        toast('导出失败：' + err.message, 'err', 5000);
      } finally {
        busy(false);
      }
    });

    els.helpBtn.addEventListener('click', () => { els.helpModal.hidden = false; });
    els.helpClose.addEventListener('click', () => { els.helpModal.hidden = true; });
    els.helpModal.addEventListener('click', (e) => {
      if (e.target === els.helpModal) els.helpModal.hidden = true;
    });

    els.canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    // 右键用来平移画面，整个应用区域都不弹浏览器菜单
    // （只挂 canvas 的话，在 HUD 按钮或空状态卡片上右键仍会弹出）
    document.addEventListener('contextmenu', (e) => {
      if (e.target.closest && e.target.closest('#app')) e.preventDefault();
    });
    els.canvas.addEventListener('wheel', (e) => {
      if (!S.img) return;
      e.preventDefault();
      const sp = localPt(e);
      const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(sp.x, sp.y, Math.exp(-d * 0.0015));
    }, { passive: false });

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') { S.spaceDown = false; els.canvas.style.cursor = 'default'; }
    });

    window.addEventListener('resize', resizeCanvas);
    if (window.ResizeObserver) new ResizeObserver(resizeCanvas).observe(els.stage);

    window.addEventListener('beforeunload', (e) => {
      if (S.dirty) { e.preventDefault(); e.returnValue = ''; }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && S.dirty) saveNow();
    });
  }

  async function switchFormat(fmt) {
    if (fmt === S.format) return;
    if (!S.folder) { S.format = fmt; setFormatUI(fmt); return; }
    await flushSave();
    const before = S.boxes.length;
    busy(true, '切换格式…');
    try {
      const res = await api('/api/format', { format: fmt });
      S.format = res.format;
      S.classes = res.classes || S.classes;
      S.images = hydrate(res.images);
      setFormatUI(S.format);
      updateLabelChip();
      renderThumbList();
      updateCounters();
      await reloadAnnotations();
      if (before > 0 && S.boxes.length === 0) {
        // 切到新格式时原本的标注不在这个格式里，必须说清楚，否则用户会以为数据没了
        toast('当前目录没有 ' + fmt.toUpperCase() + ' 标注文件，所以这里暂时是空的。'
          + '原来的标注仍在磁盘上，切回去即可看到。', 'warn', 6500);
      } else {
        toast('已切换到 ' + fmt.toUpperCase() + ' 格式', 'ok');
      }
      if (res.warning) toast(res.warning, 'warn', 8000);
    } catch (err) {
      toast('切换失败：' + err.message, 'err');
    } finally {
      busy(false);
    }
  }

  function setFormatUI(fmt) {
    els.formatSeg.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('on', b.dataset.format === fmt);
    });
  }

  /* ── 标注目录 ────────────────────────────────────────── */

  function defaultLabelDir() {
    return S.format === 'yolo' ? joinFolder('labels') : '与图片同目录';
  }

  function joinFolder(name) {
    if (!S.folder) return name;
    return S.folder.replace(/[\\/]+$/, '') + '\\' + name;
  }

  function labelDirDisplay() {
    if (!S.labelDir) return S.format === 'yolo' ? 'labels/' : '同目录';
    const f = (S.folder || '').replace(/[\\/]+$/, '');
    let rel = S.labelDir;
    if (f && rel.toLowerCase().startsWith(f.toLowerCase())) {
      rel = rel.slice(f.length).replace(/^[\\/]+/, '');
    }
    if (!rel) return S.labelDir;
    const parts = rel.split(/[\\/]/);
    return parts.length > 2 ? '…/' + parts.slice(-2).join('/') : rel;
  }

  function updateLabelChip() {
    els.labelDirVal.textContent = labelDirDisplay();
    els.labelChip.title = S.labelDir
      ? '标注保存到：' + S.labelDir
      : '标注保存在：' + defaultLabelDir();

    els.labelPopPath.textContent = S.labelDir || defaultLabelDir();
    const labeled = S.images.filter((im) => im.ann).length;
    els.labelPopNote.textContent = !S.folder
      ? '先打开一个图片文件夹'
      : (labeled ? '这个位置已经找到 ' + labeled + ' 张图的标注' : '这个位置还没有标注文件，画框后会新建');

    const mode = S.labelDir ? 'custom' : (S.format === 'yolo' ? 'labels' : 'same');
    els.labelPop.querySelectorAll('.pop-item').forEach((b) => {
      b.classList.toggle('on', b.dataset.mode === mode);
    });
  }

  function toggleLabelPop() {
    if (els.labelChip.disabled) return;
    updateLabelChip();
    els.labelPop.hidden = !els.labelPop.hidden;
  }

  async function reloadAnnotations() {
    if (S.index < 0 || !S.img || !S.images[S.index]) return;
    S.boxes = [];
    S.polygons = [];
    S.readonly = false;
    S.selection = [];
    try {
      const ann = await api('/api/ann?path=' + encodeURIComponent(S.images[S.index].rel));
      S.boxes = normalizeBoxes(ann);
      S.polygons = normalizePolygons(ann);
      S.readonly = !!ann.readonly;
      els.roBadge.hidden = !S.readonly;
      if (ann.warning) toast(ann.warning, 'warn', 6000);
      for (const b of S.boxes) {
        if (!S.classes.includes(b.label)) S.classes.push(b.label);
      }
      for (const p of S.polygons) {
        if (!S.classes.includes(p.label)) S.classes.push(p.label);
      }
    } catch (err) {
      toast('读取标注失败：' + err.message, 'err', 5000);
    }
    renderChips();
    afterBoxChange();
  }

  async function setLabelDir(path) {
    if (!S.folder) return toast('先打开一个文件夹', 'warn');
    await flushSave();
    const before = S.boxes.length;
    busy(true, '切换标注目录…');
    try {
      const res = await api('/api/labeldir', { path: path || '' });
      S.labelDir = res.label_dir || '';
      S.images = hydrate(res.images);
      if (res.classes && res.classes.length) {
        S.classes = res.classes;
        if (!S.classes.includes(S.activeClass)) S.activeClass = S.classes[0] || null;
      }
      renderThumbList();
      updateCounters();
      updateLabelChip();
      await reloadAnnotations();
      if (before > 0 && S.boxes.length === 0) {
        toast('这个目录里没有找到当前图片的标注，所以暂时显示为空。'
          + '原来的标注文件没有被删除，切回原位置就能看到。', 'warn', 7000);
      } else if (res.created) {
        toast('已新建标注目录并切换过去', 'ok');
      } else {
        toast('标注目录已切换', 'ok');
      }
    } catch (err) {
      toast('切换标注目录失败：' + err.message, 'err', 5000);
    } finally {
      busy(false);
    }
  }

  async function pickLabelDir() {
    busy(true, '请选择标注保存目录…');
    try {
      const res = await api('/api/pick', { role: 'labels' });
      if (res && res.folder) await setLabelDir(res.folder);
    } catch (err) {
      toast('选择目录失败：' + err.message, 'err', 5000);
    } finally {
      busy(false);
    }
  }

  function onKeyDown(e) {
    const t = e.target;
    const tag = (t.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || t.isContentEditable) {
      if (e.key === 'Escape') t.blur();
      return;
    }
    if (!els.helpModal.hidden && e.key === 'Escape') { els.helpModal.hidden = true; return; }
    if (!els.classMapModal.hidden && e.key === 'Escape') { els.classMapModal.hidden = true; return; }
    if (!els.classFilePop.hidden && e.key === 'Escape') { els.classFilePop.hidden = true; return; }
    if (!els.labelPop.hidden && e.key === 'Escape') { els.labelPop.hidden = true; return; }

    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;

    if (mod && k === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (mod && k === 's') { e.preventDefault(); flushSave().then(() => toast('已保存', 'ok')); return; }
    if (mod && k === '1') { e.preventDefault(); setZoomAbsolute(1); return; }
    if (mod && k === 'c') { e.preventDefault(); copySelection(); return; }
    if (mod && k === 'v') { e.preventDefault(); pasteClipboard(); return; }
    if (mod && k === 'a') { e.preventDefault(); selectAll(); return; }
    if (mod) return;

    if (e.code === 'Space') {
      e.preventDefault();
      S.spaceDown = true;
      els.canvas.style.cursor = 'grab';
      return;
    }

    switch (e.key) {
      case 'Escape':
        S.draft = null; S.drag = null; select(null); draw();
        return;
      case 'Delete': case 'Backspace':
        e.preventDefault(); deleteSelected(); return;
      case 'ArrowLeft': case 'a': case 'A':
        e.preventDefault(); step(-1); return;
      case 'ArrowRight': case 'd': case 'D':
        e.preventDefault(); step(1); return;
      case 'f': case 'F':
        e.preventDefault(); fitView(); return;
      case 'c': case 'C':
        e.preventDefault(); copyFromPrevious(); return;
      case 'n': case 'N':
        e.preventDefault(); nextUnlabeled(); return;
      case 'u': case 'U':
        e.preventDefault(); toggleOnlyUnlabeled(); return;
      case '+': case '=':
        e.preventDefault(); zoomAt(S.vw / 2, S.vh / 2, 1.25); return;
      case '-': case '_':
        e.preventDefault(); zoomAt(S.vw / 2, S.vh / 2, 0.8); return;
      case '?':
        els.helpModal.hidden = false; return;
      default: break;
    }

    if (/^[1-9]$/.test(e.key)) {
      const idx = Number(e.key) - 1;
      if (S.classes[idx]) {
        S.activeClass = S.classes[idx];
        renderChips();
        toast('当前类别：' + S.classes[idx], 'info', 1100);
      }
    }
  }

  function undo() {
    if (!S.undo.length) return;
    S.redo.push(snapshot());
    S.boxes = S.undo.pop();
    S.selection = [];
    markDirty();
    afterBoxChange();
  }

  function redo() {
    if (!S.redo.length) return;
    S.undo.push(snapshot());
    S.boxes = S.redo.pop();
    S.selection = [];
    markDirty();
    afterBoxChange();
  }

  /* ── 最近文件夹 ──────────────────────────────────────── */

  function pushRecent(path) {
    let list = [];
    try { list = JSON.parse(localStorage.getItem('anno.recent') || '[]'); } catch (_) { list = []; }
    if (!Array.isArray(list)) list = [];
    list = list.filter((p) => p !== path);
    list.unshift(path);
    list = list.slice(0, 6);
    localStorage.setItem('anno.recent', JSON.stringify(list));
    renderRecent();
  }

  function renderRecent() {
    let list = [];
    try { list = JSON.parse(localStorage.getItem('anno.recent') || '[]'); } catch (_) { list = []; }
    if (!Array.isArray(list) || !list.length) {
      els.recentWrap.hidden = true;
      return;
    }
    els.recentWrap.hidden = false;
    els.recentList.innerHTML = '';
    for (const p of list) {
      const btn = document.createElement('button');
      btn.className = 'recent-item';
      btn.textContent = p;
      btn.title = p;
      btn.addEventListener('click', () => openPath(p));
      els.recentList.appendChild(btn);
    }
  }

  /* ── 启动 ────────────────────────────────────────────── */

  async function boot() {
    wire();
    resizeCanvas();
    updateZoomLabel();
    renderRecent();
    try {
      const st = await api('/api/state');
      if (st.folder && st.images && st.images.length) {
        applyFolder(st);
      } else {
        showEmpty(null);
      }
    } catch (err) {
      showEmpty(null);
      toast('连接后端失败：' + err.message, 'err', 6000);
    }
  }

  boot();
})();
