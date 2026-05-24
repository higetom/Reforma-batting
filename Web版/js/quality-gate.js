/**
 * Re'forma Web版 — 撮影品質ゲート G1
 *
 * 精度保証仕様書 G1(撮影品質ゲート)を実装。
 *
 * チェック内容:
 * 1. フレーム検出率 ≥80%(ローリング30フレーム平均)
 * 2. フレームレート ≥30fps
 * 3. 全身が画面内(顔・足の visibility ≥0.5)
 * 4. ランドマーク欠落フレームの管理
 *
 * 撮影中:リアルタイムで警告
 * 撮影後:総合判定を返す、不合格なら再撮影推奨
 */

(function (global) {
  'use strict';

  /**
   * QualityMonitor — 撮影中のリアルタイム品質モニター
   */
  class QualityMonitor {
    constructor(options) {
      options = options || {};
      this.windowSize = options.windowSize || 30; // ローリング窓
      this.minDetectionRate = options.minDetectionRate || 0.80;
      this.minFps = options.minFps || 30;
      this.minVisibility = options.minVisibility || 0.5;

      // 履歴
      this.detectionHistory = []; // true/false
      this.frameTimestamps = []; // ms
      this.visibilityHistory = []; // 0-1
      this.bodyInFrameHistory = []; // true/false

      this.issues = new Set();
      this.warningListeners = [];
    }

    /**
     * フレームごとに呼ばれる
     * @param {object|null} landmarks - MediaPipe の landmarks[0] or null(検出なし)
     * @param {number} timestamp - performance.now()
     */
    onFrame(landmarks, timestamp) {
      // 検出有無
      const detected = !!(landmarks && landmarks.length >= 33);
      this.detectionHistory.push(detected);
      if (this.detectionHistory.length > this.windowSize) this.detectionHistory.shift();

      // フレーム時刻
      this.frameTimestamps.push(timestamp);
      if (this.frameTimestamps.length > this.windowSize) this.frameTimestamps.shift();

      if (detected) {
        // 11-32(体)の visibility 平均
        let sumV = 0, n = 0;
        for (let i = 11; i < 33; i++) {
          if (landmarks[i] && typeof landmarks[i].visibility === 'number') {
            sumV += landmarks[i].visibility;
            n++;
          }
        }
        const avgV = n > 0 ? sumV / n : 0;
        this.visibilityHistory.push(avgV);
        if (this.visibilityHistory.length > this.windowSize) this.visibilityHistory.shift();

        // 全身が画面内か(顔=0、足=27,28 で判定)
        const hasFace = landmarks[0] && (landmarks[0].visibility || 0) > 0.3;
        const hasLeftFoot = landmarks[27] && (landmarks[27].visibility || 0) > 0.3;
        const hasRightFoot = landmarks[28] && (landmarks[28].visibility || 0) > 0.3;
        const bodyInFrame = hasFace && (hasLeftFoot || hasRightFoot);
        this.bodyInFrameHistory.push(bodyInFrame);
        if (this.bodyInFrameHistory.length > this.windowSize) this.bodyInFrameHistory.shift();
      }

      // 警告判定
      this._evaluateWarnings();
    }

    _evaluateWarnings() {
      const detectionRate = this._currentDetectionRate();
      const fps = this._currentFps();
      const bodyInFrameRate = this._currentBodyInFrameRate();
      const avgVis = this._currentAvgVisibility();

      const prevIssues = new Set(this.issues);
      this.issues.clear();

      // 検出率不足
      if (this.detectionHistory.length >= this.windowSize && detectionRate < this.minDetectionRate) {
        this.issues.add({
          code: 'LOW_DETECTION',
          severity: 'warning',
          message: '体が検出できていないフレームが多いです。明るい場所で全身が映る位置に立ってください。',
        });
      }

      // FPS不足
      if (this.frameTimestamps.length >= this.windowSize && fps < this.minFps) {
        this.issues.add({
          code: 'LOW_FPS',
          severity: 'warning',
          message: `フレームレートが低めです(${fps.toFixed(0)}fps)。他のアプリを閉じて再度お試しください。`,
        });
      }

      // 全身が画面に入っていない
      if (this.bodyInFrameHistory.length >= this.windowSize && bodyInFrameRate < 0.7) {
        this.issues.add({
          code: 'BODY_NOT_IN_FRAME',
          severity: 'warning',
          message: '全身が画面内に入っていません。カメラから距離を取って全身が映るようにしてください。',
        });
      }

      // visibility 不足
      if (this.visibilityHistory.length >= this.windowSize && avgVis < this.minVisibility) {
        this.issues.add({
          code: 'LOW_VISIBILITY',
          severity: 'info',
          message: '体の認識精度が低めです。明るい場所での撮影をおすすめします。',
        });
      }

      // 新規・解消した警告を通知
      this._notifyChanges(prevIssues, this.issues);
    }

    _notifyChanges(prev, current) {
      const currentCodes = new Set(Array.from(current).map(i => i.code));
      const prevCodes = new Set(Array.from(prev).map(i => i.code));

      // 新規警告
      Array.from(current).forEach(issue => {
        if (!prevCodes.has(issue.code)) {
          this._fire('warning', issue);
        }
      });
      // 解消警告
      Array.from(prev).forEach(issue => {
        if (!currentCodes.has(issue.code)) {
          this._fire('resolved', issue);
        }
      });
    }

    _fire(type, issue) {
      this.warningListeners.forEach(fn => {
        try { fn(type, issue); } catch (e) { console.warn('listener error:', e); }
      });
    }

    _currentDetectionRate() {
      if (this.detectionHistory.length === 0) return 0;
      const t = this.detectionHistory.filter(Boolean).length;
      return t / this.detectionHistory.length;
    }

    _currentFps() {
      if (this.frameTimestamps.length < 2) return 0;
      const dt = this.frameTimestamps[this.frameTimestamps.length - 1] - this.frameTimestamps[0];
      if (dt <= 0) return 0;
      return (this.frameTimestamps.length - 1) * 1000 / dt;
    }

    _currentBodyInFrameRate() {
      if (this.bodyInFrameHistory.length === 0) return 1;
      const t = this.bodyInFrameHistory.filter(Boolean).length;
      return t / this.bodyInFrameHistory.length;
    }

    _currentAvgVisibility() {
      if (this.visibilityHistory.length === 0) return 0;
      return this.visibilityHistory.reduce((s, v) => s + v, 0) / this.visibilityHistory.length;
    }

    /**
     * 警告リスナーを登録
     * @param {function(type, issue)} fn
     */
    onWarning(fn) {
      if (typeof fn === 'function') this.warningListeners.push(fn);
    }

    /**
     * 現在のリアルタイム品質スナップショット
     */
    getSnapshot() {
      return {
        detectionRate: this._currentDetectionRate(),
        fps: this._currentFps(),
        bodyInFrameRate: this._currentBodyInFrameRate(),
        avgVisibility: this._currentAvgVisibility(),
        activeIssues: Array.from(this.issues),
      };
    }

    /**
     * 撮影終了後の最終判定
     * @returns {object} { passed, summary, issues, suggestions }
     */
    finalCheck() {
      const snap = this.getSnapshot();
      const issues = [];
      const suggestions = [];

      if (snap.detectionRate < this.minDetectionRate) {
        issues.push({
          code: 'LOW_DETECTION_FINAL',
          severity: 'error',
          message: `体の検出率が ${Math.round(snap.detectionRate * 100)}% でした(目標 ${Math.round(this.minDetectionRate * 100)}% 以上)`,
        });
        suggestions.push('明るい場所での再撮影をおすすめします');
        suggestions.push('全身が画面内に入る位置(目安 2.5-4m)から撮影してください');
      }

      if (snap.fps < this.minFps) {
        issues.push({
          code: 'LOW_FPS_FINAL',
          severity: 'warning',
          message: `フレームレートが ${snap.fps.toFixed(0)}fps でした(目標 ${this.minFps}fps 以上)`,
        });
        suggestions.push('他のアプリを閉じて、ブラウザだけを起動した状態で再撮影してください');
      }

      if (snap.bodyInFrameRate < 0.7) {
        issues.push({
          code: 'BODY_OUT_FRAME',
          severity: 'error',
          message: '全身が画面内に入っていないフレームが多くありました',
        });
        suggestions.push('カメラから距離を取って、頭から足まで画面に収まる位置で撮影してください');
      }

      const passed = issues.filter(i => i.severity === 'error').length === 0;

      return {
        passed: passed,
        summary: {
          detectionRate: snap.detectionRate,
          fps: snap.fps,
          bodyInFrameRate: snap.bodyInFrameRate,
          avgVisibility: snap.avgVisibility,
        },
        issues: issues,
        suggestions: suggestions,
      };
    }

    reset() {
      this.detectionHistory = [];
      this.frameTimestamps = [];
      this.visibilityHistory = [];
      this.bodyInFrameHistory = [];
      this.issues.clear();
    }
  }

  // ─────────────────────────────────────────
  // 公開
  // ─────────────────────────────────────────
  global.ReformaQualityGate = {
    QualityMonitor: QualityMonitor,
  };
})(window);
