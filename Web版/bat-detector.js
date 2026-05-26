/**
 * Re'forma Web版 — YOLOv8n バット検出モジュール
 *
 * 動作概要:
 * 1. onnxruntime-web 1.18 を jsDelivr CDN から動的ロード
 * 2. models/yolov8n.onnx を同一オリジンから fetch（GitHub Pages 上のリポジトリ）
 * 3. 各フレーム JPEG を 640×640 レターボックスにリサイズ → ONNX 推論
 * 4. COCO class 34（baseball bat）の検出結果を正規化座標で返す
 * 5. 全フレームのバット幅最大値をスケール基準（既知実長 84cm）として利用
 *
 * スケール計算の根拠:
 *   側面動画でバットが水平に近いとき（コンタクト前後）は
 *   バットの画像上の幅 ≈ 実長の投影長（≒実長）。
 *   全フレームの最大幅を採用することで「最もカメラと垂直な瞬間」に近い値を取得。
 *   誤差は前腕推定ベース（±20〜25%）より小さい想定（±5〜10%）。
 *
 * 公開 API:
 *   ReformaBatDetector.init()                        → Session のロードのみ（事前 warm-up 用）
 *   ReformaBatDetector.runOnFrames(frames, W, H, cb) → バット追跡結果を返す Promise
 *   ReformaBatDetector.BAT_REAL_LEN_M                → 0.84（定数）
 */

(function (global) {
  'use strict';

  /* ──────────────────────────────────────────────────
   * 定数
   * ────────────────────────────────────────────────── */
  var ONNX_CDN_URL  = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/ort.min.js';
  var WASM_CDN_PATH = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/';
  var MODEL_RELPATH = 'models/yolov8n.onnx';

  var INPUT_W    = 640;
  var INPUT_H    = 640;
  var BAT_CLS    = 34;    // COCO 0-indexed: baseball bat
  var CONF_MIN   = 0.25;
  var NMS_IOU    = 0.45;
  var BAT_LEN_M  = 0.84;  // 標準バット長 84cm

  /* ──────────────────────────────────────────────────
   * 内部状態
   * ────────────────────────────────────────────────── */
  var _session     = null;
  var _initPromise = null;
  var _initFailed  = false;

  /* ──────────────────────────────────────────────────
   * 初期化: CDN スクリプトロード → ONNX モデルロード
   * ────────────────────────────────────────────────── */
  function init() {
    if (_session)     return Promise.resolve(_session);
    if (_initPromise) return _initPromise;
    if (_initFailed)  return Promise.reject(new Error('BatDetector: 初期化済み失敗'));

    _initPromise = _doInit().then(function (s) {
      _session = s;
      return s;
    }).catch(function (e) {
      _initFailed  = true;
      _initPromise = null;
      throw e;
    });

    return _initPromise;
  }

  function _doInit() {
    return _loadScript(ONNX_CDN_URL).then(function () {
      var ort = global.ort;
      if (!ort || !ort.InferenceSession) {
        throw new Error('onnxruntime-web の読込後に ort が見つかりません');
      }

      /* WASM バイナリの取得先を CDN に設定 */
      ort.env.wasm.wasmPaths  = WASM_CDN_PATH;
      ort.env.wasm.numThreads = 1; /* Safari: COOP/COEP なしではマルチスレッド不可 */

      var modelUrl = _resolveModelUrl();
      return fetch(modelUrl).then(function (r) {
        if (!r.ok) throw new Error('yolov8n.onnx 取得失敗 (HTTP ' + r.status + ')');
        return r.arrayBuffer();
      }).then(function (buf) {
        return ort.InferenceSession.create(buf, {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all',
        });
      });
    });
  }

  function _loadScript(url) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + url + '"]')) {
        // すでに挿入済みなら少し待って ort が定義されるのを確認
        if (global.ort) { resolve(); return; }
        var t = 0;
        var poll = setInterval(function () {
          t += 50;
          if (global.ort) { clearInterval(poll); resolve(); }
          else if (t > 5000) { clearInterval(poll); reject(new Error('ort タイムアウト')); }
        }, 50);
        return;
      }
      var s = document.createElement('script');
      s.src   = url;
      s.async = true;
      s.onload  = function () { resolve(); };
      s.onerror = function () { reject(new Error('スクリプト読込失敗: ' + url)); };
      document.head.appendChild(s);
    });
  }

  function _resolveModelUrl() {
    /* batting_result.html と同階層を起点に models/yolov8n.onnx を指す */
    var path = location.pathname;
    var base = path.substring(0, path.lastIndexOf('/') + 1);
    return location.origin + base + MODEL_RELPATH;
  }

  /* ──────────────────────────────────────────────────
   * 前処理: HTMLImageElement → Float32Array [1,3,640,640]
   *  Letterbox: 灰色パディングでアスペクト比を保ちながら 640×640 に収める
   * ────────────────────────────────────────────────── */
  function _preprocess(imgElem, origW, origH) {
    var cv  = document.createElement('canvas');
    cv.width = INPUT_W; cv.height = INPUT_H;
    var ctx = cv.getContext('2d');

    var scale = Math.min(INPUT_W / origW, INPUT_H / origH);
    var nw    = Math.round(origW * scale);
    var nh    = Math.round(origH * scale);
    var padX  = Math.floor((INPUT_W - nw) / 2);
    var padY  = Math.floor((INPUT_H - nh) / 2);

    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, INPUT_W, INPUT_H);
    ctx.drawImage(imgElem, padX, padY, nw, nh);

    var pixels = ctx.getImageData(0, 0, INPUT_W, INPUT_H).data;
    var len    = INPUT_W * INPUT_H;
    var f32    = new Float32Array(3 * len);
    for (var i = 0; i < len; i++) {
      f32[i]           = pixels[i * 4]     / 255; /* R */
      f32[len + i]     = pixels[i * 4 + 1] / 255; /* G */
      f32[2 * len + i] = pixels[i * 4 + 2] / 255; /* B */
    }
    return { f32: f32, padX: padX, padY: padY, scale: scale };
  }

  /* ──────────────────────────────────────────────────
   * IoU / NMS
   * ────────────────────────────────────────────────── */
  function _iou(a, b) {
    var ix1 = Math.max(a[0], b[0]), iy1 = Math.max(a[1], b[1]);
    var ix2 = Math.min(a[2], b[2]), iy2 = Math.min(a[3], b[3]);
    var inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
    var aA = (a[2] - a[0]) * (a[3] - a[1]);
    var bA = (b[2] - b[0]) * (b[3] - b[1]);
    return inter / (aA + bA - inter + 1e-6);
  }

  function _nms(dets) {
    /* dets: [{x1,y1,x2,y2,conf}] — 信頼度降順にソートして greedy NMS */
    dets.sort(function (a, b) { return b.conf - a.conf; });
    var kept = [], used = new Uint8Array(dets.length);
    for (var i = 0; i < dets.length; i++) {
      if (used[i]) continue;
      kept.push(dets[i]);
      for (var j = i + 1; j < dets.length; j++) {
        if (!used[j] &&
            _iou([dets[i].x1, dets[i].y1, dets[i].x2, dets[i].y2],
                 [dets[j].x1, dets[j].y1, dets[j].x2, dets[j].y2]) > NMS_IOU) {
          used[j] = 1;
        }
      }
    }
    return kept;
  }

  /* ──────────────────────────────────────────────────
   * 単フレーム推論
   *   imgElem: HTMLImageElement
   *   origW/origH: 元画像サイズ (px)
   *   戻り値: [{x1,y1,x2,y2,conf}] 正規化座標 (0-1)
   * ────────────────────────────────────────────────── */
  function _detectOne(imgElem, origW, origH) {
    return init().then(function (sess) {
      var ort  = global.ort;
      var prep = _preprocess(imgElem, origW, origH);

      var tensor = new ort.Tensor('float32', prep.f32, [1, 3, INPUT_W, INPUT_H]);
      var feeds  = {};
      feeds[sess.inputNames[0]] = tensor;

      return sess.run(feeds).then(function (results) {
        var raw = results[sess.outputNames[0]].data; /* Float32Array */
        /* YOLOv8 ONNX エクスポート形式: [1, 84, 8400]
         * raw[dim * 8400 + i] で参照
         * dim: 0=cx, 1=cy, 2=w, 3=h, 4+c=class_c_conf (COCO 80クラス) */
        var N    = 8400;
        var dets = [];

        for (var i = 0; i < N; i++) {
          var batConf = raw[(4 + BAT_CLS) * N + i];
          if (batConf < CONF_MIN) continue;

          var cx640 = raw[0 * N + i];
          var cy640 = raw[1 * N + i];
          var bw640 = raw[2 * N + i];
          var bh640 = raw[3 * N + i];

          /* 640×640空間 → 元画像正規化座標 (0-1) */
          var x1 = Math.max(0, Math.min(1, (cx640 - bw640 / 2 - prep.padX) / prep.scale / origW));
          var y1 = Math.max(0, Math.min(1, (cy640 - bh640 / 2 - prep.padY) / prep.scale / origH));
          var x2 = Math.max(0, Math.min(1, (cx640 + bw640 / 2 - prep.padX) / prep.scale / origW));
          var y2 = Math.max(0, Math.min(1, (cy640 + bh640 / 2 - prep.padY) / prep.scale / origH));

          if (x2 <= x1 + 0.005 || y2 <= y1 + 0.005) continue;

          dets.push({ x1: x1, y1: y1, x2: x2, y2: y2, conf: batConf });
        }

        return _nms(dets);
      });
    });
  }

  /* ──────────────────────────────────────────────────
   * 全フレーム処理（バッチ）
   *
   * @param {Array}    imgFrames  [{img: dataURL, t: ms}]  IDB フレーム列
   * @param {number}   origW      元映像幅 (px)
   * @param {number}   origH      元映像高さ (px)
   * @param {Function} onProgress (done, total) → void  null 可
   *
   * @returns Promise<{
   *   batTrack:        [{t, cx, cy, w, h, conf}],  // 検出フレームのみ (正規化座標)
   *   maxBatWidthNorm: number,                      // スケール計算用
   *   detectedFrames:  number,
   * }>
   *
   * batTrack[i].t を frames[].t と突き合わせることでスピード計算が可能
   * ────────────────────────────────────────────────── */
  function runOnFrames(imgFrames, origW, origH, onProgress) {
    if (!imgFrames || imgFrames.length === 0) {
      return Promise.resolve({ batTrack: [], maxBatWidthNorm: 0, detectedFrames: 0 });
    }

    return init().catch(function (e) {
      console.warn('[BatDetector] 初期化失敗（フォールバック）:', e.message);
      return null;
    }).then(function (sess) {
      if (!sess) return { batTrack: [], maxBatWidthNorm: 0, detectedFrames: 0 };

      /* 逐次処理（Promise チェーン）— GPU 競合を避けるため並列不可 */
      var batTrack        = [];
      var maxBatWidthNorm = 0;

      function loop(idx) {
        if (idx >= imgFrames.length) {
          return Promise.resolve();
        }

        var frame = imgFrames[idx];

        return _loadImage(frame.img).then(function (imgElem) {
          return _detectOne(imgElem, origW, origH);
        }).then(function (dets) {
          if (dets.length > 0) {
            var d  = dets[0]; /* 最高スコア検出 */
            var cx = (d.x1 + d.x2) / 2;
            var cy = (d.y1 + d.y2) / 2;
            var bw = d.x2 - d.x1;
            var bh = d.y2 - d.y1;

            batTrack.push({ t: frame.t, cx: cx, cy: cy, w: bw, h: bh, conf: d.conf });
            if (bw > maxBatWidthNorm) maxBatWidthNorm = bw;
          }
        }).catch(function () {
          /* 推論エラーはスキップ */
        }).then(function () {
          if (onProgress) {
            try { onProgress(idx + 1, imgFrames.length); } catch (e2) { /* ignore */ }
          }
          return loop(idx + 1);
        });
      }

      return loop(0).then(function () {
        return {
          batTrack:        batTrack,
          maxBatWidthNorm: maxBatWidthNorm,
          detectedFrames:  batTrack.length,
        };
      });
    });
  }

  /* ──────────────────────────────────────────────────
   * 補助: Image ロード
   * ────────────────────────────────────────────────── */
  function _loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img   = new Image();
      img.onload  = function () { resolve(img); };
      img.onerror = function () { reject(new Error('画像ロード失敗')); };
      img.src = src;
    });
  }

  /* ──────────────────────────────────────────────────
   * 公開 API
   * ────────────────────────────────────────────────── */
  global.ReformaBatDetector = {
    init:          init,
    runOnFrames:   runOnFrames,
    BAT_REAL_LEN_M: BAT_LEN_M,
  };

})(typeof window !== 'undefined' ? window : global);
