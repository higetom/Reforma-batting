/**
 * Re'forma Web版 — RMST v2 解析ロジック(JavaScript版)
 *
 * Python版 movement_signature_test_v2.py からの忠実移植
 *
 * 入力: 録画されたフレーム配列 [{t, landmarks: [{x,y,z,v}*33]}, ...]
 * 出力: タイプ判定結果(rmp_profile.py 互換)
 *
 * プロトコル(60秒):
 *   0-3秒    正面起立
 *   3-4秒    向き変え
 *   4-7秒    横向き起立
 *   7-19秒   オーバーヘッドスクワット×3
 *   19-31秒  Hip 90-90
 *   31-41秒  T-spine回旋
 *   41-55秒  CMJ×3
 *   55-60秒  終了
 *
 * 精度: Python版と数値計算が一致するよう実装(数値計算は浮動小数を保持)
 */

(function (global) {
  'use strict';

  // ─────────────────────────────────────────
  // プロトコル定義(Python版と同一)
  // ─────────────────────────────────────────
  const PROTOCOL = [
    { id: 'stance_front',   t_start: 0,  t_end: 3,  label: '正面起立' },
    { id: 'transition',     t_start: 3,  t_end: 4,  label: '向き変え' },
    { id: 'stance_side',    t_start: 4,  t_end: 7,  label: '横向き起立' },
    { id: 'overhead_squat', t_start: 7,  t_end: 19, label: 'OHスクワット×3' },
    { id: 'hip_90_90',      t_start: 19, t_end: 31, label: 'Hip 90-90' },
    { id: 't_spine_rot',    t_start: 31, t_end: 41, label: 'T-spine回旋' },
    { id: 'cmj',            t_start: 41, t_end: 55, label: 'CMJ×3' },
  ];

  // ─────────────────────────────────────────
  // ユーティリティ
  // ─────────────────────────────────────────
  function deg(rad) { return rad * 180 / Math.PI; }
  function rad(deg) { return deg * Math.PI / 180; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function safeMean(arr, fallback) {
    fallback = fallback || 0;
    const valid = arr.filter(v => typeof v === 'number' && !isNaN(v));
    return valid.length > 0 ? valid.reduce((s, v) => s + v, 0) / valid.length : fallback;
  }
  function ptp(arr) {
    if (arr.length === 0) return 0;
    let mn = arr[0], mx = arr[0];
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] < mn) mn = arr[i];
      if (arr[i] > mx) mx = arr[i];
    }
    return mx - mn;
  }

  function calcAngle2D(a, b, c) {
    // 3点 a-b-c の内角(度)
    const bax = a.x - b.x, bay = a.y - b.y;
    const bcx = c.x - b.x, bcy = c.y - b.y;
    const n1 = Math.hypot(bax, bay);
    const n2 = Math.hypot(bcx, bcy);
    if (n1 < 1e-8 || n2 < 1e-8) return 0;
    const dot = bax * bcx + bay * bcy;
    return deg(Math.acos(clamp(dot / (n1 * n2), -1, 1)));
  }

  function framesInRange(frames, tStartSec, tEndSec) {
    const tStartMs = tStartSec * 1000;
    const tEndMs = tEndSec * 1000;
    return frames.filter(f => f.t >= tStartMs && f.t < tEndMs);
  }

  // ─────────────────────────────────────────
  // 各動作の測定関数(Python版と論理一致)
  // ─────────────────────────────────────────

  function measureStance(framesFront, framesSide) {
    // 横向きフレーム: head_forward, lumbar_lordosis
    const headForward = [];
    const lumbarLordosis = [];
    framesSide.forEach(f => {
      const lm = f.landmarks;
      if (!lm || !lm[0] || !lm[11] || !lm[23]) return;
      if (lm[0].v < 0.5 || lm[11].v < 0.5 || lm[23].v < 0.5) return;
      const noseX = lm[0].x;
      const shoMidX = (lm[11].x + lm[12].x) / 2;
      const hipMidX = (lm[23].x + lm[24].x) / 2;
      const shoMidY = (lm[11].y + lm[12].y) / 2;
      const hipMidY = (lm[23].y + lm[24].y) / 2;
      const torsoLen = Math.max(Math.abs(shoMidY - hipMidY), 0.05);
      headForward.push((noseX - shoMidX) / torsoLen);
      lumbarLordosis.push((hipMidX - shoMidX) / torsoLen);
    });

    // 正面フレーム: 左右非対称
    const asymComponents = [];
    framesFront.forEach(f => {
      const lm = f.landmarks;
      if (!lm) return;
      if (lm[11] && lm[12] && lm[11].v > 0.5 && lm[12].v > 0.5) {
        asymComponents.push(Math.abs(lm[11].y - lm[12].y));
      }
      if (lm[23] && lm[24] && lm[23].v > 0.5 && lm[24].v > 0.5) {
        asymComponents.push(Math.abs(lm[23].y - lm[24].y));
      }
      if (lm[27] && lm[28] && lm[27].v > 0.5 && lm[28].v > 0.5) {
        asymComponents.push(Math.abs(lm[27].y - lm[28].y));
      }
    });

    return {
      head_forward_ratio: safeMean(headForward),
      lumbar_lordosis_ratio: safeMean(lumbarLordosis),
      frontal_asymmetry: safeMean(asymComponents, 0),
    };
  }

  function measureOverheadSquat(framesOh) {
    const kneeAngL = [], kneeAngR = [];
    const hipAngL = [], hipAngR = [];
    const armOhL = [], armOhR = [];
    const kneeValgus = [];

    framesOh.forEach(f => {
      const lm = f.landmarks;
      if (!lm) return;
      // 左膝(180-(hip-knee-ankle))
      if (lm[23] && lm[25] && lm[27] && lm[23].v > 0.4 && lm[25].v > 0.4 && lm[27].v > 0.4) {
        kneeAngL.push(180 - calcAngle2D(lm[23], lm[25], lm[27]));
        if (lm[11] && lm[11].v > 0.4) {
          hipAngL.push(calcAngle2D(lm[11], lm[23], lm[25]));
        }
      }
      if (lm[24] && lm[26] && lm[28] && lm[24].v > 0.4 && lm[26].v > 0.4 && lm[28].v > 0.4) {
        kneeAngR.push(180 - calcAngle2D(lm[24], lm[26], lm[28]));
        if (lm[12] && lm[12].v > 0.4) {
          hipAngR.push(calcAngle2D(lm[12], lm[24], lm[26]));
        }
      }
      // 腕が頭上
      if (lm[11] && lm[13] && lm[15] && lm[11].v > 0.4 && lm[13].v > 0.4 && lm[15].v > 0.4) {
        const vBase = { x: lm[13].x, y: lm[13].y - 0.1 };
        armOhL.push(calcAngle2D(vBase, lm[13], lm[15]));
      }
      if (lm[12] && lm[14] && lm[16] && lm[12].v > 0.4 && lm[14].v > 0.4 && lm[16].v > 0.4) {
        const vBase = { x: lm[14].x, y: lm[14].y - 0.1 };
        armOhR.push(calcAngle2D(vBase, lm[14], lm[16]));
      }
      // 膝の内方偏位
      if (lm[25] && lm[27] && lm[26] && lm[28] &&
          lm[25].v > 0.4 && lm[27].v > 0.4 && lm[26].v > 0.4 && lm[28].v > 0.4) {
        const ankleDist = Math.abs(lm[27].x - lm[28].x);
        const kneeDist = Math.abs(lm[25].x - lm[26].x);
        if (ankleDist > 0.01) {
          kneeValgus.push(1.0 - (kneeDist / ankleDist));
        }
      }
    });

    const kneeMaxL = kneeAngL.length > 0 ? Math.max(...kneeAngL) : 0;
    const kneeMaxR = kneeAngR.length > 0 ? Math.max(...kneeAngR) : 0;

    return {
      squat_depth_deg: (kneeMaxL + kneeMaxR) / 2,
      knee_asymmetry: Math.abs(kneeMaxL - kneeMaxR),
      knee_valgus: safeMean(kneeValgus),
      arm_overhead_L_avg: safeMean(armOhL),
      arm_overhead_R_avg: safeMean(armOhR),
      hip_max_flex_L: hipAngL.length > 0 ? Math.max(...hipAngL) : 0,
      hip_max_flex_R: hipAngR.length > 0 ? Math.max(...hipAngR) : 0,
    };
  }

  function measureHip9090(framesHip) {
    const kneeLAngles = [], kneeRAngles = [];
    framesHip.forEach(f => {
      const lm = f.landmarks;
      if (!lm) return;
      if (lm[23] && lm[25] && lm[23].v > 0.4 && lm[25].v > 0.4) {
        const dx = lm[25].x - lm[23].x;
        const dy = lm[25].y - lm[23].y;
        kneeLAngles.push(deg(Math.atan2(dy, dx)));
      }
      if (lm[24] && lm[26] && lm[24].v > 0.4 && lm[26].v > 0.4) {
        const dx = lm[26].x - lm[24].x;
        const dy = lm[26].y - lm[24].y;
        kneeRAngles.push(deg(Math.atan2(dy, dx)));
      }
    });

    const romL = kneeLAngles.length > 5 ? ptp(kneeLAngles) : 0;
    const romR = kneeRAngles.length > 5 ? ptp(kneeRAngles) : 0;

    return {
      hip_rom_L_deg: Math.min(romL, 90),
      hip_rom_R_deg: Math.min(romR, 90),
      hip_rom_asymmetry: Math.abs(romL - romR),
    };
  }

  function measureTspineRotation(framesTs) {
    const shoAngles = [];
    framesTs.forEach(f => {
      const lm = f.landmarks;
      if (!lm) return;
      if (lm[11] && lm[12] && lm[11].v > 0.4 && lm[12].v > 0.4) {
        const dx = lm[12].x - lm[11].x;
        const dy = lm[12].y - lm[11].y;
        shoAngles.push(deg(Math.atan2(dy, dx)));
      }
    });

    const rom = shoAngles.length > 5 ? ptp(shoAngles) : 0;
    let romL = rom / 2, romR = rom / 2;
    if (shoAngles.length > 10) {
      const mid = Math.floor(shoAngles.length / 2);
      romL = ptp(shoAngles.slice(0, mid));
      romR = ptp(shoAngles.slice(mid));
    }

    return {
      tspine_rom_deg: Math.min(rom, 100),
      tspine_rom_L_deg: Math.min(romL, 60),
      tspine_rom_R_deg: Math.min(romR, 60),
      tspine_asymmetry: Math.abs(romL - romR),
    };
  }

  function measureCMJ(framesCmj, fps) {
    if (framesCmj.length < 10) {
      return { jump_height_norm: 0, n_jumps_detected: 0, ground_contact_avg_ms: 0 };
    }
    fps = fps || 30;
    const hipY = framesCmj.map(f => {
      const lm = f.landmarks;
      if (lm && lm[23] && lm[24] && lm[23].v > 0.3 && lm[24].v > 0.3) {
        return (lm[23].y + lm[24].y) / 2;
      }
      return NaN;
    });
    const valid = hipY.filter(v => !isNaN(v));
    if (valid.length < 5) {
      return { jump_height_norm: 0, n_jumps_detected: 0, ground_contact_avg_ms: 0 };
    }
    // 簡易: 極小値を「ジャンプ最高点」とみなす
    // 移動平均で平滑化
    const win = 7;
    const smooth = valid.map((_, i) => {
      const start = Math.max(0, i - Math.floor(win / 2));
      const end = Math.min(valid.length, i + Math.ceil(win / 2));
      let sum = 0, cnt = 0;
      for (let j = start; j < end; j++) { sum += valid[j]; cnt++; }
      return sum / cnt;
    });
    // 簡易ピーク検出
    const peaks = [];
    const minDist = Math.floor(fps * 0.5);
    for (let i = 2; i < smooth.length - 2; i++) {
      if (smooth[i] < smooth[i-1] && smooth[i] < smooth[i+1] &&
          smooth[i] < smooth[i-2] && smooth[i] < smooth[i+2]) {
        if (peaks.length === 0 || (i - peaks[peaks.length-1]) >= minDist) {
          peaks.push(i);
        }
      }
    }
    const heights = peaks.map(p => {
      const winStart = Math.max(0, p - Math.floor(fps * 0.5));
      const baseline = Math.max(...smooth.slice(winStart, p + 1));
      return baseline - smooth[p];
    });
    return {
      jump_height_norm: heights.length > 0 ? safeMean(heights) : 0,
      n_jumps_detected: peaks.length,
      ground_contact_avg_ms: 0,
    };
  }

  // ─────────────────────────────────────────
  // 4タイプ判定(Python版と一致)
  // ─────────────────────────────────────────
  function classifyRmpV2(stance, squat, hip90, tspine, cmj) {
    const scores = { 'リーチ型': 0, 'ドライブ型': 0, 'ウィップ型': 0, 'フロー型': 0 };

    // 1. 姿勢(Janda)
    const headFwd = stance.head_forward_ratio || 0;
    const lumbar = stance.lumbar_lordosis_ratio || 0;
    if (headFwd > 0.15) scores['リーチ型'] += 2.0;
    if (lumbar > 0.15) scores['ドライブ型'] += 2.0;
    if (Math.abs(headFwd) < 0.1 && Math.abs(lumbar) < 0.1) {
      scores['ウィップ型'] += 1.5;
      scores['フロー型'] += 1.0;
    }

    // 2. 胸椎可動性
    const tspRom = tspine.tspine_rom_deg || 0;
    if (tspRom > 60) scores['ウィップ型'] += 2.5;
    else if (tspRom > 40) scores['ウィップ型'] += 1.0;
    else if (tspRom < 25) scores['リーチ型'] += 1.0;

    // 3. 股関節ROM
    const hipAvg = ((hip90.hip_rom_L_deg || 0) + (hip90.hip_rom_R_deg || 0)) / 2;
    if (hipAvg > 50) scores['ドライブ型'] += 1.5;
    if (hipAvg < 25) scores['リーチ型'] += 1.0;

    // 4. スクワット深さ
    const sqDepth = squat.squat_depth_deg || 0;
    if (sqDepth > 100) scores['ドライブ型'] += 1.5;
    if (sqDepth < 60) scores['リーチ型'] += 1.0;

    // 5. ジャンプ
    const jumpH = cmj.jump_height_norm || 0;
    if (jumpH > 0.10) scores['ドライブ型'] += 1.5;
    if (jumpH > 0.06 && jumpH <= 0.10) scores['フロー型'] += 0.5;

    // 6. バランス
    const sumSpecific = scores['リーチ型'] + scores['ドライブ型'] + scores['ウィップ型'];
    if (sumSpecific < 2.0) scores['フロー型'] += 2.0;

    // 確率化
    const total = Object.values(scores).reduce((s, v) => s + v, 0);
    if (total <= 0) {
      return {
        rmp_type: 'フロー型',
        confidence: 0.3,
        scores: { 'リーチ型': 0.25, 'ドライブ型': 0.25, 'ウィップ型': 0.25, 'フロー型': 0.25 },
      };
    }
    const norm = {};
    Object.keys(scores).forEach(k => { norm[k] = scores[k] / total; });
    let top = ['フロー型', 0];
    Object.entries(norm).forEach(([k, v]) => { if (v > top[1]) top = [k, v]; });

    return {
      rmp_type: top[0],
      confidence: top[1],
      scores: Object.fromEntries(Object.entries(norm).map(([k, v]) => [k, Math.round(v * 1000) / 1000])),
    };
  }

  function compute5dStats(stance, squat, hip90, tspine, cmj) {
    return {
      '腕の振り': clamp(Math.round((stance.head_forward_ratio || 0) * 20 + 3), 1, 5),
      '体幹回旋': clamp(Math.round((tspine.tspine_rom_deg || 0) / 15), 1, 5),
      '下半身駆動': clamp(Math.round(
        ((cmj.jump_height_norm || 0) * 30 +
         ((hip90.hip_rom_L_deg || 0) + (hip90.hip_rom_R_deg || 0)) / 40)
      ), 1, 5),
      '姿勢中立性': clamp(Math.round(5 - Math.abs(stance.head_forward_ratio || 0) * 20), 1, 5),
      '左右対称性': clamp(Math.round(5 - (stance.frontal_asymmetry || 0) * 100), 1, 5),
      '爆発力': clamp(Math.round((cmj.jump_height_norm || 0) * 50), 1, 5),
      '可動性': clamp(Math.round(
        ((squat.squat_depth_deg || 0) / 30 + (tspine.tspine_rom_deg || 0) / 30) / 2
      ), 1, 5),
    };
  }

  function computeInjuryRiskScore(stance, squat, hip90, tspine) {
    let risk = 0;
    if ((stance.head_forward_ratio || 0) > 0.2) risk += 15;
    if ((stance.lumbar_lordosis_ratio || 0) > 0.2) risk += 15;
    const asym = stance.frontal_asymmetry || 0;
    if (asym > 0.03) risk += 15;
    else if (asym > 0.02) risk += 10;
    if ((squat.knee_valgus || 0) > 0.2) risk += 15;
    if ((squat.knee_asymmetry || 0) > 15) risk += 10;
    if (((hip90.hip_rom_L_deg || 0) + (hip90.hip_rom_R_deg || 0)) / 2 < 25) risk += 10;
    if ((tspine.tspine_rom_deg || 0) < 30) risk += 10;
    if ((tspine.tspine_asymmetry || 0) > 15) risk += 10;
    return Math.min(Math.round(risk), 100);
  }

  // ─────────────────────────────────────────
  // 動物図鑑情報
  // ─────────────────────────────────────────
  const POKEDEX = {
    'リーチ型': { animal_jp: '鷲',   animal_emoji: '🦅', type_en: 'Upper-Driven',
                  characteristic: '腕の使い方と上肢のコントロールでスイングを完結させる傾向' },
    'ドライブ型': { animal_jp: 'サイ', animal_emoji: '🦏', type_en: 'Lower-Driven',
                  characteristic: '下半身始動の体重移動と地面反力でスイングを駆動する傾向' },
    'ウィップ型': { animal_jp: '蛇',   animal_emoji: '🐍', type_en: 'Rotational-Driven',
                  characteristic: '体幹の回旋速度としなりでスイングを駆動する。kinetic chain の理想形' },
    'フロー型':   { animal_jp: '猫',   animal_emoji: '🐱', type_en: 'Integrated',
                  characteristic: '場面に応じて打ち方を使い分けられる。万能型・適応型' },
  };

  // ─────────────────────────────────────────
  // メイン解析エントリ
  // ─────────────────────────────────────────
  /**
   * RMST v2 解析
   * @param {object} input - { frames: [{t, landmarks}*N], avg_fps: number, ... }
   * @returns {object} 解析結果(rmp_profile 互換)
   */
  function analyzeRMSTv2(input) {
    const frames = input.frames || [];
    if (frames.length < 30) {
      return { error: '動画が短すぎる/姿勢検出できないフレームが多い' };
    }
    const avgFps = input.avg_fps || 30;

    // 各動作のフレーム(時刻 ms ベース)
    const phaseFrames = {};
    const expected = {};
    PROTOCOL.forEach(p => {
      phaseFrames[p.id] = framesInRange(frames, p.t_start, p.t_end);
      expected[p.id] = Math.floor((p.t_end - p.t_start) * avgFps);
    });

    // 品質チェック
    const quality = {};
    PROTOCOL.forEach(p => {
      quality[p.id] = Math.min(1, phaseFrames[p.id].length / Math.max(1, expected[p.id]));
    });

    // 計測
    const stance = measureStance(phaseFrames['stance_front'] || [], phaseFrames['stance_side'] || []);
    const squat = measureOverheadSquat(phaseFrames['overhead_squat'] || []);
    const hip90 = measureHip9090(phaseFrames['hip_90_90'] || []);
    const tspine = measureTspineRotation(phaseFrames['t_spine_rot'] || []);
    const cmj = measureCMJ(phaseFrames['cmj'] || [], avgFps);

    // 4タイプ判定
    const classification = classifyRmpV2(stance, squat, hip90, tspine, cmj);
    const rmpType = classification.rmp_type;
    const stats = compute5dStats(stance, squat, hip90, tspine, cmj);
    const injuryRisk = computeInjuryRiskScore(stance, squat, hip90, tspine);
    const pokedex = POKEDEX[rmpType];

    return {
      rmp_type: rmpType,
      type_en: pokedex.type_en,
      animal_jp: pokedex.animal_jp,
      animal_emoji: pokedex.animal_emoji,
      confidence: classification.confidence,
      stats: stats,
      all_scores: classification.scores,
      injury_risk_score: injuryRisk,
      quality_check: quality,
      measurements: {
        stance: stance,
        overhead_squat: squat,
        hip_90_90: hip90,
        tspine_rotation: tspine,
        cmj: cmj,
      },
      pokedex_entry: pokedex,
      _protocol_version: 'RMST v2 (60秒・5動作, Web版)',
    };
  }

  // ─────────────────────────────────────────
  // 公開
  // ─────────────────────────────────────────
  global.ReformaRMSTAnalyzer = {
    analyzeRMSTv2: analyzeRMSTv2,
    PROTOCOL: PROTOCOL,
    POKEDEX: POKEDEX,
  };
})(window);
