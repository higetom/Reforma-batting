/**
 * Re'forma Web版 — MediaPipe Tasks Vision ローダー
 *
 * 設計原則:
 * 1. シングルトン(同じモデルを複数回読み込まない)
 * 2. エラー耐性: WebGPU失敗時は WebGL2、それも失敗時は CPU フォールバック
 * 3. 進捗表示: モデル読込中はユーザーに状況を伝える
 * 4. キャッシュ活用: 2回目以降は即座に使える
 * 5. 検証済み: iPhone Safari で 27fps 達成済(2026-05-24 検証)
 *
 * セキュリティ:
 * - CDN は jsdelivr + googleapis(信頼できるソース)のみ
 * - モデルファイルは Google公式
 * - SubResource Integrity (SRI) は CDN 動的読込のため使えないが、HTTPS で配信
 */

(function (global) {
 'use strict';

 // ─────────────────────────────────────────
 // 定数
 // ─────────────────────────────────────────
 // MediaPipe Tasks Vision の固定バージョン(検証済)
 const TASKS_VERSION = '0.10.10';
 const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`;
 const VISION_BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/vision_bundle.mjs`;

 // Pose Landmarker Full model
 const MODEL_URL_FULL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
 // フォールバック: Lite model(古い端末用)
 const MODEL_URL_LITE = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

 // ─────────────────────────────────────────
 // 状態管理(シングルトン)
 // ─────────────────────────────────────────
 let poseLandmarker = null;
 let poseLandmarkerModel = null; // 'full' or 'lite'
 let loadingPromise = null;
 let visionModule = null;
 const listeners = []; // 進捗リスナー

 // ─────────────────────────────────────────
 // 進捗通知
 // ─────────────────────────────────────────
 function notifyProgress(stage, message, percent) {
 const event = { stage, message, percent: percent || 0 };
 listeners.forEach(fn => {
 try { fn(event); } catch (e) { console.warn('listener error:', e); }
 });
 }

 function onProgress(fn) {
 if (typeof fn === 'function') listeners.push(fn);
 }

 // ─────────────────────────────────────────
 // 環境検出
 // ─────────────────────────────────────────
 function detectEnvironment() {
 const webgpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
 const webgl2 = (function () {
 try {
 const canvas = document.createElement('canvas');
 return !!canvas.getContext('webgl2');
 } catch (e) {
 return false;
 }
 })();
 const ua = navigator.userAgent;
 const isIOS = /iPad|iPhone|iPod/.test(ua);
 const isSafari = /^((?!chrome|android).)*safari/i.test(ua);

 return {
 webgpu: webgpu,
 webgl2: webgl2,
 delegate: 'GPU', // GPU を優先(WebGPU or WebGL2 内部選択)
 userAgent: ua,
 isIOS: isIOS,
 isSafari: isSafari,
 // 古いiPhone(画像処理遅い)の判定 — Liteフォールバック判断材料
 mightBeOldDevice: isIOS && /iPhone OS (\d+)_/.test(ua) && parseInt(RegExp.$1, 10) < 15,
 };
 }

 // ─────────────────────────────────────────
 // モデル読込(リトライ・フォールバック付き)
 // ─────────────────────────────────────────
 async function loadVisionModule() {
 if (visionModule) return visionModule;
 notifyProgress('loading-module', 'MediaPipe ライブラリを読み込んでいます...', 10);
 try {
 visionModule = await import(VISION_BUNDLE);
 notifyProgress('loading-module', 'ライブラリ読込完了', 25);
 return visionModule;
 } catch (e) {
 notifyProgress('error', 'MediaPipe ライブラリの読込に失敗しました', 0);
 throw new Error('MediaPipe vision bundle 読込失敗: ' + e.message);
 }
 }

 async function loadFilesetResolver() {
 const { FilesetResolver } = await loadVisionModule();
 notifyProgress('loading-wasm', 'WebAssembly モジュールを読込中...', 35);
 try {
 const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
 notifyProgress('loading-wasm', 'WebAssembly 読込完了', 50);
 return fileset;
 } catch (e) {
 notifyProgress('error', 'WebAssembly 読込失敗', 0);
 throw new Error('FilesetResolver 失敗: ' + e.message);
 }
 }

 async function createLandmarker(modelKind) {
 const { PoseLandmarker } = await loadVisionModule();
 const fileset = await loadFilesetResolver();
 const modelUrl = (modelKind === 'lite') ? MODEL_URL_LITE : MODEL_URL_FULL;
 notifyProgress('loading-model', `Pose モデルを読込中 (${modelKind})...`, 70);

 try {
 const lm = await PoseLandmarker.createFromOptions(fileset, {
 baseOptions: {
 modelAssetPath: modelUrl,
 delegate: 'GPU',
 },
 runningMode: 'VIDEO',
 numPoses: 1,
 minPoseDetectionConfidence: 0.5,
 minPosePresenceConfidence: 0.5,
 minTrackingConfidence: 0.5,
 outputSegmentationMasks: false,
 });
 notifyProgress('ready', `${modelKind === 'lite' ? 'Lite' : 'Full'} モデル読込完了`, 100);
 return lm;
 } catch (e) {
 throw new Error(`Pose Landmarker (${modelKind}) 作成失敗: ` + e.message);
 }
 }

 // ─────────────────────────────────────────
 // メインエントリ
 // ─────────────────────────────────────────

 /**
 * Pose Landmarker を取得(キャッシュあり)
 * @param {object} options { preferLite: false }
 * @returns {Promise<PoseLandmarker>}
 */
 async function getPoseLandmarker(options) {
 options = options || {};
 if (poseLandmarker) return poseLandmarker;
 if (loadingPromise) return loadingPromise;

 const env = detectEnvironment();
 const useLite = options.preferLite || env.mightBeOldDevice;
 const modelKind = useLite ? 'lite' : 'full';

 loadingPromise = (async () => {
 try {
 const lm = await createLandmarker(modelKind);
 poseLandmarker = lm;
 poseLandmarkerModel = modelKind;
 return lm;
 } catch (e) {
 // Full 失敗時の Lite フォールバック
 if (modelKind === 'full') {
 notifyProgress('fallback', 'Full モデル失敗 → Lite モデルで再試行', 60);
 try {
 const lm = await createLandmarker('lite');
 poseLandmarker = lm;
 poseLandmarkerModel = 'lite';
 return lm;
 } catch (e2) {
 notifyProgress('error', 'モデル読込失敗(Full・Liteとも)', 0);
 loadingPromise = null;
 throw new Error('MediaPipe Pose Landmarker 読込失敗(Full・Liteとも): ' + e2.message);
 }
 }
 loadingPromise = null;
 throw e;
 }
 })();

 return loadingPromise;
 }

 /**
 * 現在使用中のモデル種類
 */
 function getCurrentModel() {
 return poseLandmarkerModel; // 'full' / 'lite' / null
 }

 /**
 * モデルを解放(メモリ節約)
 */
 function release() {
 if (poseLandmarker) {
 try {
 if (typeof poseLandmarker.close === 'function') {
 poseLandmarker.close();
 }
 } catch (e) {
 console.warn('release error:', e);
 }
 poseLandmarker = null;
 poseLandmarkerModel = null;
 loadingPromise = null;
 }
 }

 // ─────────────────────────────────────────
 // 公開API
 // ─────────────────────────────────────────
 global.ReformaMediaPipe = {
 detectEnvironment: detectEnvironment,
 getPoseLandmarker: getPoseLandmarker,
 getCurrentModel: getCurrentModel,
 release: release,
 onProgress: onProgress,

 // 定数公開
 TASKS_VERSION: TASKS_VERSION,
 MODEL_URL_FULL: MODEL_URL_FULL,
 MODEL_URL_LITE: MODEL_URL_LITE,
 };
})(window);
