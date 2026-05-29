/**
 * Re'forma — 解析記録の保存・読み込み
 *
 * IndexedDB 'reforma_batting_v1' の saved_records ストアを使用。
 * 最大10件保存（古い順に自動削除）。
 */
(function (global) {
  'use strict';

  var DB_NAME    = 'reforma_batting_v1';
  var DB_VERSION = 3; // v3: saved_records ストア追加
  var STORE_NAME = 'saved_records';
  var MAX_RECORDS = 10;

  // ── DB オープン ────────────────────────────────────────────
  function openDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        // 既存のストアは維持
        if (!db.objectStoreNames.contains('frames')) {
          db.createObjectStore('frames');
        }
        // v3: saved_records ストア追加
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          var store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('savedAt', 'savedAt', { unique: false });
        }
      };
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror   = function (e) { reject(e.target.error); };
    });
  }

  // ── 記録を保存 ─────────────────────────────────────────────
  /**
   * @param {object} payload - sessionStorage の reforma_last_batting の内容
   * @param {string} memo    - ユーザーメモ（課題・コメント等）
   * @param {string[]} tags  - タグ配列（'ベスト', '課題', 内角/外角/高め/低め など）
   * @param {string} thumbnail - 代表フレームの dataURL (JPEG)
   */
  function saveRecord(payload, memo, tags, thumbnail) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var record = {
          id: Date.now(),
          savedAt: new Date().toISOString(),
          playerName: (window.ReformaUserProfile && window.ReformaUserProfile.getDisplayName()) || '',
          ageGroup: (function () {
            var p = window.ReformaUserProfile && window.ReformaUserProfile.load();
            return p ? p.ageGroup : null;
          })(),
          memo: memo || '',
          tags: tags || [],
          thumbnail: thumbnail || null,
          // 解析サマリー（軽量版: JPEGフレームは除く）
          summary: {
            source:         payload.source,
            captured_at:    payload.captured_at,
            n_frames:       payload.n_frames,
            raw_fps:        payload.raw_fps,
            side:           payload.analysis && payload.analysis.side,
            side_jp:        payload.analysis && payload.analysis.side_jp,
            total_score:    payload.analysis && payload.analysis.total_score,
            phase_quality:  payload.analysis && payload.analysis.phase_quality,
            kinetic_chain:  payload.analysis && payload.analysis.kinetic_chain,
            metric_evals:   payload.analysis && payload.analysis.metric_evals,
            phases:         payload.analysis && payload.analysis.phases,
            course:         payload.course || null,
            height_cm:      payload.height_cm || null,
          },
          // 改善ドリルリスト（ボトルネックから自動生成）
          drills: (function () {
            try {
              var bn = payload.analysis &&
                       payload.analysis.kinetic_chain &&
                       payload.analysis.kinetic_chain.bottleneck;
              if (!bn) return [];
              var rm = window.ReformaBattingData &&
                       window.ReformaBattingData.IMPROVEMENT_ROADMAPS &&
                       window.ReformaBattingData.IMPROVEMENT_ROADMAPS[bn.id];
              if (!rm || !rm.phases) return [];
              // Phase 1 のドリルのみ抜粋
              return rm.phases[0] ? rm.phases[0].exercises : [];
            } catch (e) { return []; }
          })(),
        };

        // 保存
        var tx = db.transaction(STORE_NAME, 'readwrite');
        var store = tx.objectStore(STORE_NAME);
        var addReq = store.put(record);
        addReq.onsuccess = function () {
          // MAX_RECORDS 超過分を削除（古い順）
          var allReq = store.getAll();
          allReq.onsuccess = function (ev) {
            var all = ev.target.result || [];
            all.sort(function (a, b) { return a.savedAt < b.savedAt ? -1 : 1; });
            while (all.length > MAX_RECORDS) {
              store.delete(all.shift().id);
            }
          };
        };
        tx.oncomplete = function () { db.close(); resolve(record); };
        tx.onerror    = function (e) { db.close(); reject(e.target.error); };
      });
    });
  }

  // ── 記録を全件取得 ─────────────────────────────────────────
  function getAllRecords() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx    = db.transaction(STORE_NAME, 'readonly');
        var store = tx.objectStore(STORE_NAME);
        var req   = store.getAll();
        req.onsuccess = function (e) {
          var all = (e.target.result || []).slice();
          all.sort(function (a, b) { return a.savedAt < b.savedAt ? 1 : -1; }); // 新しい順
          db.close();
          resolve(all);
        };
        req.onerror = function (e) { db.close(); reject(e.target.error); };
      });
    });
  }

  // ── 記録を1件削除 ─────────────────────────────────────────
  function deleteRecord(id) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx  = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(id);
        tx.oncomplete = function () { db.close(); resolve(); };
        tx.onerror    = function (e) { db.close(); reject(e.target.error); };
      });
    });
  }

  // ── 全件削除 ──────────────────────────────────────────────
  function clearAllRecords() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx  = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
        tx.oncomplete = function () { db.close(); resolve(); };
        tx.onerror    = function (e) { db.close(); reject(e.target.error); };
      });
    });
  }

  global.ReformaRecordsDB = {
    saveRecord:       saveRecord,
    getAllRecords:     getAllRecords,
    deleteRecord:     deleteRecord,
    clearAllRecords:  clearAllRecords,
    MAX_RECORDS:      MAX_RECORDS,
  };
})(window);
