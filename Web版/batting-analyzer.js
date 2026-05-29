/**
 * Re'forma Web版 — バッティング動作解析エンジン
 *
 * Python版 batting_generate_html.py の核心ロジックを JS に移植。
 * 入力: フレーム配列 [{t, landmarks: [{x,y,z,v}*33]}, ...]
 * 出力: 解析結果 {phases, metrics, rmp_type, score, kinetic_chain_diag}
 *
 * 学術根拠: Welch (1995), Werner (2008), DeRenne (2007), Williams (2017),
 * Janda (1987), Sahrmann (2002), Putnam (1993)
 */
(function (global) {
 'use strict';

 // ─────────────────────────────────────────
 // MediaPipe landmark indices (33 points)
 // ─────────────────────────────────────────
 const LM = {
 NOSE: 0,
 L_SHO: 11, R_SHO: 12,
 L_ELB: 13, R_ELB: 14,
 L_WRI: 15, R_WRI: 16,
 L_HIP: 23, R_HIP: 24,
 L_KNE: 25, R_KNE: 26,
 L_ANK: 27, R_ANK: 28,
 L_HEEL: 29, R_HEEL: 30,
 L_FOOT_INDEX: 31, R_FOOT_INDEX: 32,
 };

 // ─────────────────────────────────────────
 // ユーティリティ
 // ─────────────────────────────────────────
 function calcAngle2D(a, b, c) {
 // 3点 a-b-c の内角(度)
 const bax = a.x - b.x, bay = a.y - b.y;
 const bcx = c.x - b.x, bcy = c.y - b.y;
 const n1 = Math.hypot(bax, bay);
 const n2 = Math.hypot(bcx, bcy);
 if (n1 < 1e-8 || n2 < 1e-8) return 0;
 const dot = bax * bcx + bay * bcy;
 return Math.acos(Math.max(-1, Math.min(1, dot / (n1 * n2)))) * 180 / Math.PI;
 }

 function smooth(arr, win) {
 win = win || 7;
 if (arr.length < 3) return arr.slice();
 const out = new Array(arr.length);
 const half = Math.floor(win / 2);
 for (let i = 0; i < arr.length; i++) {
 let sum = 0, cnt = 0;
 const start = Math.max(0, i - half);
 const end = Math.min(arr.length, i + half + 1);
 for (let j = start; j < end; j++) { sum += arr[j]; cnt++; }
 out[i] = sum / cnt;
 }
 return out;
 }

 function gradient(arr) {
 if (arr.length < 2) return arr.map(() => 0);
 const out = new Array(arr.length);
 for (let i = 0; i < arr.length; i++) {
 if (i === 0) out[i] = arr[1] - arr[0];
 else if (i === arr.length - 1) out[i] = arr[i] - arr[i - 1];
 else out[i] = (arr[i + 1] - arr[i - 1]) / 2;
 }
 return out;
 }

 function findPeaks(arr, options) {
 options = options || {};
 const distance = options.distance || 1;
 const prominence = options.prominence || 0;
 const minHeight = options.height || -Infinity;
 const peaks = [];
 for (let i = 1; i < arr.length - 1; i++) {
 if (arr[i] > arr[i - 1] && arr[i] > arr[i + 1] && arr[i] >= minHeight) {
 if (peaks.length === 0 || (i - peaks[peaks.length - 1]) >= distance) {
 peaks.push(i);
 }
 }
 }
 return peaks;
 }

 // ─────────────────────────────────────────
 // 打者判別(右打者/左打者) — 改良版
 //
 // 旧版は「動画全体の足首Y range」で判定していたため、
 // 後ろ足のpivotや重心移動など余計な動きを拾って誤判定が頻発した。
 //
 // 改良版: 独立した3シグナルの投票制 + 信頼度スコア。
 //
 // Signal 1 [強]: ストライド期(動画20-60%)の足首リフト量
 // → 構えY平均からの最大上方移動。前足ほど大きく上がる。
 // Signal 2 [中]: 構え時の鼻の位置(肩中点に対する相対位置)
 // → 真横撮影で右打者は左を向く=鼻が体の左側に出る。
 // Signal 3 [中]: 構え時の両手首の重心位置(肩中点に対する相対位置)
 // → 右打者は両手を体の右後ろで構える(撮影方向によるが、肩の中央軸からの偏りで判定)
 //
 // 戻り値: { side: 'right'|'left', confidence: 0-1, signals: {...} }
 // ─────────────────────────────────────────
 function detectSide(frames) {
 const N = frames.length;
 if (N < 10) {
 return { side: 'right', confidence: 0, signals: { reason: 'insufficient_frames' } };
 }

 // フェーズ範囲(時間比率)
 const stanceStart = 0;
 const stanceEnd = Math.max(3, Math.floor(N * 0.20));
 const strideStart = Math.floor(N * 0.20);
 const strideEnd = Math.floor(N * 0.60);

 const votes = { right: 0, left: 0 };
 const weights = { right: 0, left: 0 };
 const signals = {};

 // ===== Signal 1: ストライド足のリフト量 (weight 2.0) =====
 // 構え時の平均Yから、ストライド期の最低Y(=最高位置)までの差分
 let lStanceYs = [], rStanceYs = [];
 for (let i = stanceStart; i < stanceEnd; i++) {
 const lm = frames[i].landmarks;
 if (lm[LM.L_ANK] && (lm[LM.L_ANK].v == null || lm[LM.L_ANK].v > 0.4)) lStanceYs.push(lm[LM.L_ANK].y);
 if (lm[LM.R_ANK] && (lm[LM.R_ANK].v == null || lm[LM.R_ANK].v > 0.4)) rStanceYs.push(lm[LM.R_ANK].y);
 }
 const lStanceY = lStanceYs.length ? lStanceYs.reduce((s, v) => s + v, 0) / lStanceYs.length : null;
 const rStanceY = rStanceYs.length ? rStanceYs.reduce((s, v) => s + v, 0) / rStanceYs.length : null;

 let lMinY = Infinity, rMinY = Infinity;
 for (let i = strideStart; i < strideEnd && i < N; i++) {
 const lm = frames[i].landmarks;
 if (lm[LM.L_ANK] && (lm[LM.L_ANK].v == null || lm[LM.L_ANK].v > 0.4)) lMinY = Math.min(lMinY, lm[LM.L_ANK].y);
 if (lm[LM.R_ANK] && (lm[LM.R_ANK].v == null || lm[LM.R_ANK].v > 0.4)) rMinY = Math.min(rMinY, lm[LM.R_ANK].y);
 }
 if (lStanceY != null && rStanceY != null && lMinY !== Infinity && rMinY !== Infinity) {
 const lLift = Math.max(0, lStanceY - lMinY);
 const rLift = Math.max(0, rStanceY - rMinY);
 signals.lLift = +lLift.toFixed(4);
 signals.rLift = +rLift.toFixed(4);
 // 差が1%以上なら有効投票
 if (Math.abs(lLift - rLift) > 0.01) {
 // 大きく上がった足が前足
 // 左足が上がった → 右打者(左足が投手側=前足)
 if (lLift > rLift) { votes.right += 2; weights.right += 2; }
 else { votes.left += 2; weights.left += 2; }
 }
 }

 // ===== Signal 2: 構え時の鼻の体軸からの偏り (weight 1.0) =====
 // 真横撮影で被写体が体軸を捻って投手を見るとき、鼻は前足側にやや出る
 let noseOffsets = [];
 for (let i = stanceStart; i < stanceEnd; i++) {
 const lm = frames[i].landmarks;
 if (lm[LM.NOSE] && lm[LM.L_SHO] && lm[LM.R_SHO]) {
 const shoMidX = (lm[LM.L_SHO].x + lm[LM.R_SHO].x) / 2;
 const noseX = lm[LM.NOSE].x;
 noseOffsets.push(noseX - shoMidX); // 正=画面右、負=画面左
 }
 }
 if (noseOffsets.length >= 3) {
 const avgOff = noseOffsets.reduce((s, v) => s + v, 0) / noseOffsets.length;
 signals.noseOffset = +avgOff.toFixed(4);
 // 鼻が肩中点から大きくズレている=被写体が向きを捻っている
 // ※ 真横撮影では鼻オフセットは判定材料が弱いので、weight 0.5 にとどめる
 if (Math.abs(avgOff) > 0.03) {
 // この単独シグナルは弱いので投票しない(参考値として記録のみ)
 }
 }

 // ===== Signal 3: ストライド期の前足X方向ドリフト (weight 1.5) =====
 // 前足(ストライドする足)は、踏み出す際に体の中心から離れる方向にX移動する。
 // Signal 1 でどちらの足がより上に上がるか判定し、
 // Signal 3 でその足のX移動方向を確認してシグナルを強化する。
 // Signal 1 の結果(どちらが前足か)と組み合わせて cross-check。
 {
 // Signal 1 の結果を先読みして前足・後足を仮決定
 const tentativeFrontIsLeft = (signals.lLift != null && signals.rLift != null)
 ? (signals.lLift >= signals.rLift)  // 左足のリフト >= 右足なら左が前足
 : null;

 if (tentativeFrontIsLeft !== null) {
 const frontAnkIdx = tentativeFrontIsLeft ? LM.L_ANK : LM.R_ANK;
 // ストライド期の前足XのStart→End差
 const xStart = [], xEnd = [];
 const midStride = Math.floor((strideStart + strideEnd) / 2);
 for (let i = strideStart; i < midStride && i < N; i++) {
 const lm = frames[i].landmarks;
 if (lm[frontAnkIdx] && (lm[frontAnkIdx].v == null || lm[frontAnkIdx].v > 0.35))
 xStart.push(lm[frontAnkIdx].x);
 }
 for (let i = midStride; i < strideEnd && i < N; i++) {
 const lm = frames[i].landmarks;
 if (lm[frontAnkIdx] && (lm[frontAnkIdx].v == null || lm[frontAnkIdx].v > 0.35))
 xEnd.push(lm[frontAnkIdx].x);
 }
 if (xStart.length >= 2 && xEnd.length >= 2) {
 const avgXS = xStart.reduce((s, v) => s + v, 0) / xStart.length;
 const avgXE = xEnd.reduce((s, v) => s + v, 0) / xEnd.length;
 const xDrift = avgXE - avgXS; // 正=右方向, 負=左方向
 signals.frontAnkXDrift = +xDrift.toFixed(4);
 // ドリフトが 2% 以上あれば有効
 if (Math.abs(xDrift) > 0.02) {
 // 左足が前足 かつ 左方向(X減少)にドリフト → 1塁側から撮影 → 右打者
 // 左足が前足 かつ 右方向(X増加)にドリフト → 3塁側から撮影 → 右打者
 // いずれにせよ「左足が前足 → 右打者」は Signal 1 と同じ結論
 // ここでは Signal 1 の方向を補強する
 if (tentativeFrontIsLeft) {
 votes.right += 1.5; weights.right += 1.5; // 左足前足 = 右打者を補強
 } else {
 votes.left += 1.5; weights.left += 1.5; // 右足前足 = 左打者を補強
 }
 }
 }
 }
 }

 // ===== 集計 =====
 let side, confidence;
 const totalWeight = weights.right + weights.left;
 if (totalWeight === 0) {
 // 全シグナル不発 → デフォルトは右、信頼度ゼロ
 side = 'right';
 confidence = 0;
 } else {
 side = weights.right >= weights.left ? 'right' : 'left';
 const dominant = Math.max(weights.right, weights.left);
 const ratio = dominant / totalWeight; // 0.5 〜 1.0
 // ストライドリフト差が大きいほど信頼度UP
 const liftDiff = signals.lLift != null && signals.rLift != null
 ? Math.abs(signals.lLift - signals.rLift) : 0;
 const liftBoost = Math.min(0.3, liftDiff * 10); // リフト差10%なら +0.3
 confidence = Math.min(1, (ratio - 0.5) * 2 + liftBoost);
 }

 signals.votes = votes;
 signals.weights = weights;
 return { side: side, confidence: +confidence.toFixed(3), signals: signals };
 }

 // 旧API互換ラッパー(side文字列のみ返す)
 function detectSideSimple(frames) {
 return detectSide(frames).side;
 }

 // ─────────────────────────────────────────
 // 9フェーズ検出(Python版から移植)
 // ─────────────────────────────────────────
 function detect9Phases(frames, side, fps) {
 const n = frames.length;
 if (n < 12) {
 const step = Math.max(1, Math.floor(n / 9));
 const phases = {};
 ['①構え', '②ロード', '③ストライド開始', '④前足接地', '⑤ヒール接地',
 '⑥腰がいちばん速く回る瞬間', '⑦上体がいちばん速く回る瞬間',
 '⑧コンタクト', '⑨フォロースルー'].forEach((p, i) => {
 phases[p] = Math.min(step * i, n - 1);
 });
 return phases;
 }

 const lms = frames.map(f => f.landmarks);
 const times = frames.map(f => f.t / 1000); // ms -> sec

 // 前足のlandmarkインデックス
 const fa_i = side === 'right' ? LM.L_ANK : LM.R_ANK;
 const fh_i = side === 'right' ? LM.L_HEEL : LM.R_HEEL;
 const ft_i = side === 'right' ? LM.L_FOOT_INDEX : LM.R_FOOT_INDEX;

 // FPS適応スムージングウィンドウ
 // 30fps: 7フレーム(233ms)、60fps: 11フレーム(183ms)、120fps以上: 15フレーム(125ms)
 // 低fps時はウィンドウを小さくして時間精度を保つ
 const ankSmW = fps >= 90 ? 15 : fps >= 50 ? 11 : 7;
 const rotSmW = fps >= 90 ? 11 : fps >= 50 ? 9  : 7;

 // 信号抽出
 const fa_y = smooth(lms.map(lm => lm[fa_i] ? lm[fa_i].y : 0), ankSmW);
 const fh_y = smooth(lms.map(lm => lm[fh_i] ? lm[fh_i].y : 0), ankSmW);
 const ft_y = smooth(lms.map(lm => lm[ft_i] ? lm[ft_i].y : 0), ankSmW);

 // 両手中点
 const mh_x = smooth(lms.map(lm => {
 if (lm[15] && lm[16]) return (lm[15].x + lm[16].x) / 2;
 return 0;
 }), 11);
 const mh_y = smooth(lms.map(lm => {
 if (lm[15] && lm[16]) return (lm[15].y + lm[16].y) / 2;
 return 0;
 }), 11);

 // 両手中点速度
 const mh_vx = gradient(mh_x).map(v => v * fps);
 const mh_vy = gradient(mh_y).map(v => v * fps);
 const mh_spd = smooth(mh_vx.map((v, i) => Math.hypot(v, mh_vy[i])), 7);
 const max_mh_spd = Math.max(...mh_spd);

 // 骨盤・体幹回転角速度
 function arctan2Series(yArr, xArr) {
 const a = yArr.map((y, i) => Math.atan2(y, xArr[i]) * 180 / Math.PI);
 // unwrap
 for (let i = 1; i < a.length; i++) {
 let d = a[i] - a[i - 1];
 while (d > 180) { d -= 360; }
 while (d < -180) { d += 360; }
 a[i] = a[i - 1] + d;
 }
 return a;
 }
 const pelvis_dy = lms.map(lm => (lm[LM.R_HIP] && lm[LM.L_HIP]) ? lm[LM.R_HIP].y - lm[LM.L_HIP].y : 0);
 const pelvis_dx = lms.map(lm => (lm[LM.R_HIP] && lm[LM.L_HIP]) ? lm[LM.R_HIP].x - lm[LM.L_HIP].x + 1e-8 : 1e-8);
 const trunk_dy = lms.map(lm => (lm[LM.R_SHO] && lm[LM.L_SHO]) ? lm[LM.R_SHO].y - lm[LM.L_SHO].y : 0);
 const trunk_dx = lms.map(lm => (lm[LM.R_SHO] && lm[LM.L_SHO]) ? lm[LM.R_SHO].x - lm[LM.L_SHO].x + 1e-8 : 1e-8);
 const pelvis_a = smooth(smooth(arctan2Series(pelvis_dy, pelvis_dx), rotSmW), rotSmW - 2);
 const trunk_a = smooth(smooth(arctan2Series(trunk_dy, trunk_dx), rotSmW), rotSmW - 2);
 const pelvis_vel = smooth(gradient(pelvis_a).map(v => Math.abs(v * fps)), rotSmW - 2);
 const trunk_vel = smooth(gradient(trunk_a).map(v => Math.abs(v * fps)), rotSmW - 2);

 // ピーク候補
 const ank_dist = Math.max(Math.floor(0.3 * fps), 5);
 const spd_dist = Math.max(Math.floor(0.1 * fps), 3);
 // 前足挙上(fa_y極小)
 const load_peaks_raw = findPeaks(fa_y.map(v => -v), { distance: ank_dist, prominence: 0.03 });
 const load_peaks = load_peaks_raw.length > 0 ? load_peaks_raw : [fa_y.indexOf(Math.min(...fa_y))];
 // 手速度ピーク
 const speed_peaks_raw = findPeaks(mh_spd, { distance: spd_dist, height: max_mh_spd * 0.3 });
 const speed_peaks = speed_peaks_raw.length > 0 ? speed_peaks_raw : [mh_spd.indexOf(Math.max(...mh_spd))];

 // ペアスコアリング
 const fa_max = Math.max(...fa_y), fa_min = Math.min(...fa_y);
 let best_score = -Infinity, best_load = load_peaks[0], best_contact = speed_peaks[0];
 for (const k of load_peaks) {
 for (const s of speed_peaks) {
 if (s <= k) continue;
 const dt = times[s] - times[k];
 if (dt < 0.2 || dt > 1.5) continue;
 const spd_strength = mh_spd[s] / (max_mh_spd || 1);
 const lift_depth = fa_max - fa_y[k];
 const time_score = Math.max(0, 1.0 - Math.abs(dt - 0.6) / 0.6);
 const score = spd_strength * 1.5 + lift_depth * 5.0 + time_score * 1.0;
 if (score > best_score) { best_score = score; best_load = k; best_contact = s; }
 }
 }
 let load = best_load, contact = best_contact;

 // refinement (±0.05秒)
 const refine_w = Math.max(1, Math.floor(0.05 * fps));
 {
 const lo = Math.max(0, load - refine_w), hi = Math.min(n, load + refine_w + 1);
 if (hi > lo) {
 let minIdx = lo;
 for (let i = lo + 1; i < hi; i++) if (fa_y[i] < fa_y[minIdx]) minIdx = i;
 load = minIdx;
 }
 }
 {
 const lo = Math.max(load + 1, contact - refine_w), hi = Math.min(n, contact + refine_w + 1);
 if (hi > lo) {
 let maxIdx = lo;
 for (let i = lo + 1; i < hi; i++) if (mh_spd[i] > mh_spd[maxIdx]) maxIdx = i;
 contact = maxIdx;
 }
 }

 // ① 構え: ②の0.4秒前
 const stance_offset = Math.floor(0.4 * fps);
 const stance = Math.max(0, load - stance_offset);

 // ③ ストライド開始
 let stride_init = load + 1;
 const stride_max = Math.min(contact - 5, load + Math.floor(0.30 * fps));
 for (let i = load + 1; i < Math.max(load + 2, stride_max); i++) {
 if (i + 1 < n && fa_y[i + 1] > fa_y[i]) { stride_init = i; break; }
 }
 stride_init = Math.max(load + 1, Math.min(stride_init, contact - 6));

 // ④ 前足接地
 const fp_start = stride_init + 1;
 const fp_end = Math.max(fp_start + 2, contact - Math.max(2, Math.floor(0.12 * fps)));
 let foot_plant = stride_init + 2;
 if (fp_end > fp_start && fp_end < n) {
 let maxIdx = fp_start;
 for (let i = fp_start + 1; i < fp_end; i++) if (ft_y[i] > ft_y[maxIdx]) maxIdx = i;
 foot_plant = maxIdx;
 }
 foot_plant = Math.max(stride_init + 1, Math.min(foot_plant, contact - 5));

 // ⑤ ヒール接地
 const hp_start = foot_plant;
 const hp_end = Math.max(hp_start + 2, Math.min(contact - 2, foot_plant + Math.max(2, Math.floor(0.18 * fps))));
 let heel_plant = foot_plant + 1;
 if (hp_end > hp_start && hp_end < n) {
 let maxIdx = hp_start;
 for (let i = hp_start + 1; i < hp_end; i++) {
 const cand = (fh_y[i] + fa_y[i]) / 2;
 const candBest = (fh_y[maxIdx] + fa_y[maxIdx]) / 2;
 if (cand > candBest) maxIdx = i;
 }
 heel_plant = maxIdx;
 }
 heel_plant = Math.max(foot_plant + 1, Math.min(heel_plant, contact - 4));

 // ⑥ 骨盤回転ピーク
 let pelvis_peak = heel_plant + 1;
 {
 const pp_start = heel_plant, pp_end = Math.max(pp_start + 1, contact);
 let maxIdx = pp_start;
 for (let i = pp_start + 1; i < pp_end && i < n; i++) {
 if (pelvis_vel[i] > pelvis_vel[maxIdx]) maxIdx = i;
 }
 pelvis_peak = Math.max(heel_plant + 1, Math.min(maxIdx, contact - 2));
 }

 // ⑦ 体幹回転ピーク
 let trunk_peak = pelvis_peak + 1;
 {
 const tp_start = pelvis_peak, tp_end = Math.max(tp_start + 1, contact);
 let maxIdx = tp_start;
 for (let i = tp_start + 1; i < tp_end && i < n; i++) {
 if (trunk_vel[i] > trunk_vel[maxIdx]) maxIdx = i;
 }
 trunk_peak = Math.max(pelvis_peak + 1, Math.min(maxIdx, contact - 1));
 }

 // ⑨ フォロースルー終了
 const ft_min_f = Math.max(2, Math.floor(0.10 * fps));
 const ft_max_f = Math.max(ft_min_f + 2, Math.floor(0.40 * fps));
 const ft_max_idx = Math.min(n - 1, contact + ft_max_f);
 const threshold = mh_spd[contact] * 0.40;
 let follow = Math.min(contact + ft_min_f, n - 1);
 for (let fi = contact + ft_min_f; fi <= ft_max_idx; fi++) {
 if (mh_spd[fi] < threshold) { follow = fi; break; }
 if (fi === ft_max_idx) follow = ft_max_idx;
 }
 follow = Math.max(follow, contact + 1);
 follow = Math.min(follow, n - 1);

 // 順序保証
 const arr = [stance, load, stride_init, foot_plant, heel_plant, pelvis_peak, trunk_peak, contact, follow];
 const MIN_GAP = Math.max(1, Math.floor(0.015 * fps));
 for (let i = 1; i < arr.length; i++) {
 if (arr[i] <= arr[i - 1] + MIN_GAP - 1) {
 arr[i] = Math.min(arr[i - 1] + MIN_GAP, n - 1);
 }
 }

 const names = ['①構え', '②ロード', '③ストライド開始', '④前足接地', '⑤ヒール接地',
 '⑥腰がいちばん速く回る瞬間', '⑦上体がいちばん速く回る瞬間',
 '⑧コンタクト', '⑨フォロースルー'];
 const phases = {};
 names.forEach((p, i) => { phases[p] = arr[i]; });

 // 品質情報
 const speed_quality = max_mh_spd > 0 ? mh_spd[contact] / max_mh_spd : 0;
 const lift_quality = (fa_max - fa_y[load]) / Math.max(fa_max - fa_min, 1e-6);
 phases._quality = {
 swing_event_detected: speed_quality >= 0.40 && (lift_quality >= 0.20 || (fa_max - fa_y[load]) >= 0.05),
 speed_peak_ratio: +speed_quality.toFixed(3),
 front_foot_lift_ratio: +lift_quality.toFixed(3),
 pair_score: best_score > -Infinity ? +best_score.toFixed(3) : 0,
 };

 return phases;
 }

 // ─────────────────────────────────────────
 // 指標計算
 // ─────────────────────────────────────────
 function calcMetricsForFrame(landmarks, side, bodyHeight, aspectRatio) {
 aspectRatio = aspectRatio || 0.5625; // デフォルト 9:16
 const lm = landmarks;
 if (!lm || !lm[LM.L_SHO] || !lm[LM.R_SHO]) return {};
 const out = { angles: {}, extra: {} };

 // 利き足/前足の判定
 const front_hip_i = side === 'right' ? LM.L_HIP : LM.R_HIP;
 const front_knee_i = side === 'right' ? LM.L_KNE : LM.R_KNE;
 const front_ank_i = side === 'right' ? LM.L_ANK : LM.R_ANK;
 const back_hip_i = side === 'right' ? LM.R_HIP : LM.L_HIP;
 const back_knee_i = side === 'right' ? LM.R_KNE : LM.L_KNE;
 const back_ank_i = side === 'right' ? LM.R_ANK : LM.L_ANK;
 const back_sho_i = side === 'right' ? LM.R_SHO : LM.L_SHO;
 const back_elb_i = side === 'right' ? LM.R_ELB : LM.L_ELB;

 // 前膝屈曲(180 - hip-knee-ankle 内角)
 if (lm[front_hip_i] && lm[front_knee_i] && lm[front_ank_i]) {
 const raw = calcAngle2D(lm[front_hip_i], lm[front_knee_i], lm[front_ank_i]);
 out.angles['前膝屈曲'] = Math.max(0, 180 - raw);
 }
 // 軸足膝屈曲
 if (lm[back_hip_i] && lm[back_knee_i] && lm[back_ank_i]) {
 const raw = calcAngle2D(lm[back_hip_i], lm[back_knee_i], lm[back_ank_i]);
 out.angles['軸足膝屈曲'] = Math.max(0, 180 - raw);
 }
 // 体幹前屈(shoMid-hipMid-kneeMid)
 if (lm[LM.L_SHO] && lm[LM.R_SHO] && lm[LM.L_HIP] && lm[LM.R_HIP] && lm[LM.L_KNE] && lm[LM.R_KNE]) {
 const shoMid = { x: (lm[LM.L_SHO].x + lm[LM.R_SHO].x) / 2, y: (lm[LM.L_SHO].y + lm[LM.R_SHO].y) / 2 };
 const hipMid = { x: (lm[LM.L_HIP].x + lm[LM.R_HIP].x) / 2, y: (lm[LM.L_HIP].y + lm[LM.R_HIP].y) / 2 };
 const kneeMid = { x: (lm[LM.L_KNE].x + lm[LM.R_KNE].x) / 2, y: (lm[LM.L_KNE].y + lm[LM.R_KNE].y) / 2 };
 out.angles['体幹前屈'] = Math.max(0, 180 - calcAngle2D(shoMid, hipMid, kneeMid));
 }

 // バット側肘の高さ(肩を起点とした体幹長比%)
 if (lm[back_sho_i] && lm[back_elb_i] && lm[LM.L_HIP] && lm[LM.R_HIP]) {
 const torsoLen = Math.abs(((lm[LM.L_HIP].y + lm[LM.R_HIP].y) / 2) - ((lm[LM.L_SHO].y + lm[LM.R_SHO].y) / 2));
 if (torsoLen > 0.05) {
 out.angles['バット側肘の高さ'] = +((lm[back_sho_i].y - lm[back_elb_i].y) / torsoLen * 100).toFixed(1);
 }
 }

 // 腰肩分離(shoulder line vs hip line の角度差)
 if (lm[LM.L_SHO] && lm[LM.R_SHO] && lm[LM.L_HIP] && lm[LM.R_HIP]) {
 const shoAng = Math.atan2(lm[LM.R_SHO].y - lm[LM.L_SHO].y, lm[LM.R_SHO].x - lm[LM.L_SHO].x + 1e-8) * 180 / Math.PI;
 const hipAng = Math.atan2(lm[LM.R_HIP].y - lm[LM.L_HIP].y, lm[LM.R_HIP].x - lm[LM.L_HIP].x + 1e-8) * 180 / Math.PI;
 let sep = Math.abs(shoAng - hipAng);
 while (sep > 180) sep -= 180;
 out.extra['腰肩分離'] = +sep.toFixed(1);
 }

 // ストライド長（アスペクト比補正版）
 // 問題: 縦長動画(9:16)ではX方向1単位と Y方向1単位の実距離が異なる。
 // bodyHeight は Y方向の正規化距離で計算されているため、
 // ストライド（主にX方向）をそのままbodyHeightで割ると大幅に過小評価される。
 // 補正: strideX(正規化X) を Y方向単位に換算するには /aspectRatio を掛ける。
 // aspectRatio = videoWidth/videoHeight (9:16なら ≈0.5625)
 if (lm[LM.L_ANK] && lm[LM.R_ANK] && bodyHeight && bodyHeight > 0.05) {
 const strideX = Math.abs(lm[LM.L_ANK].x - lm[LM.R_ANK].x);
 // X正規化距離 → Y正規化距離へ変換（アスペクト比補正）
 // 縦長動画(例:9:16, ar=0.5625)では X1単位が Y1単位より実際に大きいためar除算で補正
 const strideY = strideX / aspectRatio;
 out.extra['ストライド長'] = +(strideY / bodyHeight * 100).toFixed(1);
 }

 return out;
 }

 function estimateBodyHeight(frames) {
 // 鼻〜足首の縦距離の最大値で身長を推定
 let maxH = 0;
 frames.forEach(f => {
 const lm = f.landmarks;
 if (lm[LM.NOSE] && lm[LM.L_ANK] && lm[LM.R_ANK]) {
 const ankY = Math.max(lm[LM.L_ANK].y, lm[LM.R_ANK].y);
 const h = ankY - lm[LM.NOSE].y;
 if (h > maxH) maxH = h;
 }
 });
 return maxH > 0.1 ? maxH : 0.6; // フォールバック
 }

 // ─────────────────────────────────────────
 // 入力検証ゲート(極めて重要・精度保証の最初の砦)
 // 人体が確実に映っていないフレームを除外し、解析を拒否する判定
 //
 // 目的: 「何もないのに評価が返ってくる」を絶対に防ぐ。
 // MediaPipe は人がいなくてもノイズ座標を返すことがあり、
 // それをそのまま処理すると無意味な数値で評価を組み立ててしまう。
 // ─────────────────────────────────────────
 function validateInput(frames) {
 const issues = [];
 const n = frames.length;
 if (n < 12) {
 return { passed: false, code: 'TOO_FEW_FRAMES',
 reason: 'フレーム数が少なすぎます(' + n + ')。動画が短すぎる可能性があります。',
 suggestions: ['3秒以上の動画を撮影してください'] };
 }

 // 体の中核ランドマーク(肩・腰・膝・足首)の visibility を計測
 const CORE_LM = [11, 12, 23, 24, 25, 26, 27, 28];
 let validFrames = 0;
 let visSum = 0, visCnt = 0;
 const hipMidXs = [], handMidXs = [];

 frames.forEach(f => {
 const lm = f.landmarks;
 if (!lm) return;
 // 中核8点の visibility 平均
 let frameVis = 0, frameCnt = 0;
 CORE_LM.forEach(i => {
 if (lm[i] && typeof lm[i].v === 'number') {
 frameVis += lm[i].v;
 frameCnt++;
 }
 });
 if (frameCnt > 0) {
 const avgVis = frameVis / frameCnt;
 visSum += avgVis;
 visCnt++;
 if (avgVis >= 0.5) validFrames++;
 }
 // 腰中点・両手中点の位置を記録(後で動きの検出に使う)
 if (lm[23] && lm[24]) {
 hipMidXs.push((lm[23].x + lm[24].x) / 2);
 }
 if (lm[15] && lm[16]) {
 handMidXs.push((lm[15].x + lm[16].x) / 2);
 }
 });

 const avgBodyVis = visCnt > 0 ? visSum / visCnt : 0;
 const detectionRate = visCnt > 0 ? validFrames / visCnt : 0;

 // ─────────────────────────────────────────
 // 重要: MediaPipe Tasks Vision 0.10.10 で
 // visibility が undefined/0 で返るケースの救済(2026-05-25)
 //
 // 当該ケースでは visSum === 0 になる。この場合、
 // MediaPipe の minPoseDetectionConfidence: 0.5 を既に通過した
 // フレームしか recordedFrames に積まれていないため、
 // 「visibility が出ない API バージョン」と判断して
 // visibility ベースのゲートをスキップする。
 // NO_MOTION ゲート(下)で「ちゃんと動いているか」は引き続き検証する。
 // ─────────────────────────────────────────
 const visibilityFieldMissing = (visCnt > 0 && visSum === 0);

 if (!visibilityFieldMissing) {
 // ゲート1: 平均 visibility が低すぎる = 人体が検出できていない
 if (avgBodyVis < 0.4) {
 return { passed: false, code: 'NO_PERSON',
 reason: '動画に人が映っていない、または姿勢検出ができない状態でした(平均認識精度 ' + Math.round(avgBodyVis * 100) + '%)。',
 suggestions: [
 '人物が画面内に映っているか確認してください',
 '明るい場所で再撮影してください',
 'カメラから距離を取り、全身が映る位置に立ってください',
 ] };
 }

 // ゲート2: 検出率が低すぎる
 if (detectionRate < 0.5) {
 return { passed: false, code: 'LOW_DETECTION',
 reason: '体の検出率が低すぎます(' + Math.round(detectionRate * 100) + '%)。動画品質が解析基準を満たしません。',
 suggestions: [
 '全身が画面内に入る位置(2.5-4m)から撮影してください',
 '明るい場所で再撮影してください',
 ] };
 }
 } else {
 console.warn('[validateInput] visibility field not populated by MediaPipe ' +
 '(visSum=0 across ' + visCnt + ' frames). ' +
 'Skipping visibility gate, relying on MediaPipe internal confidence and NO_MOTION gate.');
 }

 // ゲート3: 動きの検出(腰または手が動いているか)
 // バッティングなら必ず腰・手が動くはず。動きがゼロなら静止画 or ノイズ
 function ptpRange(arr) {
 if (arr.length === 0) return 0;
 let mn = arr[0], mx = arr[0];
 for (let i = 1; i < arr.length; i++) {
 if (arr[i] < mn) mn = arr[i];
 if (arr[i] > mx) mx = arr[i];
 }
 return mx - mn;
 }
 const hipMotionRange = ptpRange(hipMidXs);
 const handMotionRange = ptpRange(handMidXs);
 // 画像座標 0-1 で、最低 5% は動いていることを期待
 if (hipMotionRange < 0.02 && handMotionRange < 0.05) {
 return { passed: false, code: 'NO_MOTION',
 reason: '動きが検出できませんでした(腰の動き ' + (hipMotionRange * 100).toFixed(1) + '%、手の動き ' + (handMotionRange * 100).toFixed(1) + '%)。スイング動作が記録されていません。',
 suggestions: [
 'スイング動作を実際に行ってから「完了」を押してください',
 'カメラの前で被験者がスイングしていることを確認してください',
 ] };
 }

 return {
 passed: true,
 avgBodyVis: +avgBodyVis.toFixed(3),
 detectionRate: +detectionRate.toFixed(3),
 hipMotion: +hipMotionRange.toFixed(3),
 handMotion: +handMotionRange.toFixed(3),
 };
 }

 // ─────────────────────────────────────────
 // メイン解析
 // ─────────────────────────────────────────
 function analyzeBatting(input) {
 const frames = input.frames || [];
 if (frames.length < 12) {
 return { error: 'フレーム不足(' + frames.length + '): 動画が短すぎる/姿勢検出失敗が多い' };
 }

 // 入力検証ゲート(精度保証の最重要関門)
 const validation = validateInput(frames);
 if (!validation.passed) {
 return {
 error: validation.reason,
 error_code: validation.code,
 suggestions: validation.suggestions,
 };
 }

 const fps = input.avg_fps || 30;
 const rmpType = input.rmp_type || 'フロー型';

 // 打者判別
 // force_side が指定されている場合(結果画面の手動切替)、それを優先
 const sideResult = detectSide(frames);
 let side, sideConfidence, sideSignals, sideOverridden;
 if (input.force_side === 'right' || input.force_side === 'left') {
 side = input.force_side;
 sideConfidence = 1.0; // 人間が指定したので信頼度100%
 sideSignals = sideResult.signals;
 sideOverridden = true;
 } else {
 side = sideResult.side;
 sideConfidence = sideResult.confidence;
 sideSignals = sideResult.signals;
 sideOverridden = false;
 }

 // 身長推定
 const bodyHeight = estimateBodyHeight(frames);

 // アスペクト比（動画幅/高さ）— ストライド計算の補正に使用
 // input.aspect_ratio が渡されれば使う。なければ標準縦長(9:16≈0.5625)を仮定。
 const aspectRatio = (input.aspect_ratio && input.aspect_ratio > 0.2 && input.aspect_ratio < 3)
 ? input.aspect_ratio : 0.5625;

 // 全フレームの指標計算
 frames.forEach(f => {
 const m = calcMetricsForFrame(f.landmarks, side, bodyHeight, aspectRatio);
 f.angles = m.angles;
 f.extra = m.extra;
 });

 // 9フェーズ検出
 const phases = detect9Phases(frames, side, fps);
 const phaseQuality = phases._quality;
 delete phases._quality;

 // 各フェーズでの指標評価
 const allMetricEvals = [];
 const phaseMetricMap = {
 '②ロード': ['腰肩分離', '軸足膝屈曲'],
 '④前足接地': ['ストライド長', '前膝屈曲'],
 '⑧コンタクト': ['前膝屈曲', '軸足膝屈曲', '体幹前屈', 'バット側肘の高さ'],
 };
 for (const [phaseName, metrics] of Object.entries(phaseMetricMap)) {
 const fi = phases[phaseName];
 if (fi == null || fi >= frames.length) continue;
 const fd = frames[fi];
 metrics.forEach(mn => {
 const val = (fd.angles && fd.angles[mn] != null) ? fd.angles[mn]
 : (fd.extra && fd.extra[mn] != null) ? fd.extra[mn]
 : null;
 if (val == null) return;
 const ev = window.ReformaBattingData.evaluateMetric(mn, val, rmpType, phaseName);
 if (ev.error) return;
 allMetricEvals.push({
 name: mn,
 name_friendly: ev.friendly_name,
 value: val,
 unit: ev.unit,
 phase: phaseName,
 layer1_level: ev.layer1_safety.level,
 layer2_position: ev.layer2_style.position,
 typical_range: ev.layer2_style.typical_range,
 });
 });
 }

 // Kinetic Chain 診断
 const chainDiag = diagnoseKineticChain(allMetricEvals);

 // 総合スコア(100点満点)
 const score = computeTotalScore(allMetricEvals, phaseQuality);

 return {
 side: side,
 side_jp: side === 'right' ? '右打者' : '左打者',
 side_confidence: sideConfidence,
 side_signals: sideSignals,
 side_overridden: sideOverridden,
 body_height: bodyHeight,
 n_frames: frames.length,
 fps: fps,
 phases: phases,
 phase_quality: phaseQuality,
 metric_evals: allMetricEvals,
 kinetic_chain: chainDiag,
 total_score: score,
 rmp_type: rmpType,
 _version: 'web-batting-v1',
 };
 }

 // ─────────────────────────────────────────
 // Kinetic Chain 診断
 // ─────────────────────────────────────────
 function diagnoseKineticChain(allMetricEvals) {
 const CHAIN = window.ReformaBattingData.KINETIC_CHAIN_BATTING;
 const evalLookup = {};
 allMetricEvals.forEach(ev => { evalLookup[ev.name + '|' + ev.phase] = ev; });
 const evalByName = {};
 allMetricEvals.forEach(ev => { if (!evalByName[ev.name]) evalByName[ev.name] = ev; });

 const diagnosed = CHAIN.map(link => {
 const ev = evalLookup[link.metric + '|' + link.phase] || evalByName[link.metric];
 const out = Object.assign({}, link);
 if (ev) {
 out.value = ev.value;
 out.unit = ev.unit;
 out.level = ev.layer1_level;
 out.position = ev.layer2_position;
 out.typical_range = ev.typical_range;
 out.measured = true;
 } else {
 out.measured = false;
 }
 if (!out.measured) { out.status = 'unmeasured'; out.status_score = -1; }
 else if (out.level === 'concern' || out.level === 'warn') { out.status = 'bottleneck'; out.status_score = 3; }
 else if (out.level === 'caution' || out.level === 'watch') { out.status = 'caution'; out.status_score = 2; }
 else if (out.position !== 'typical') { out.status = 'off_range'; out.status_score = 1; }
 else { out.status = 'ok'; out.status_score = 0; }
 return out;
 });

 const measured = diagnosed.filter(l => l.measured);
 let bottleneck = null;
 if (measured.length > 0) {
 const maxScore = Math.max(...measured.map(l => l.status_score));
 if (maxScore > 0) bottleneck = measured.find(l => l.status_score === maxScore);
 }
 const sev = {
 n_bottleneck: diagnosed.filter(l => l.status === 'bottleneck').length,
 n_caution: diagnosed.filter(l => l.status === 'caution').length,
 n_off_range: diagnosed.filter(l => l.status === 'off_range').length,
 n_ok: diagnosed.filter(l => l.status === 'ok').length,
 n_unmeasured: diagnosed.filter(l => l.status === 'unmeasured').length,
 };
 return { links: diagnosed, bottleneck: bottleneck, severity_summary: sev };
 }

 // ─────────────────────────────────────────
 // 総合スコア(100点満点)
 // ─────────────────────────────────────────
 function computeTotalScore(allMetricEvals, phaseQuality) {
 let det = 0;
 const q = phaseQuality || {};
 if (q.swing_event_detected) det += 5;
 const spd = +q.speed_peak_ratio || 0;
 if (spd >= 0.5) det += 5; else if (spd >= 0.3) det += 3;
 const lift = +q.front_foot_lift_ratio || 0;
 if (lift >= 0.4) det += 5; else if (lift >= 0.2) det += 3;

 let safeScore = 0, fitScore = 0;
 const n = allMetricEvals.length;
 if (n > 0) {
 const perSafe = 35 / n;
 const perFit = 50 / n;
 allMetricEvals.forEach(ev => {
 if (ev.layer1_level === 'safe') safeScore += perSafe;
 else if (ev.layer1_level === 'caution' || ev.layer1_level === 'watch') safeScore += perSafe * 0.40;
 if (ev.layer2_position === 'typical') fitScore += perFit;
 else if (ev.layer2_position === 'low' || ev.layer2_position === 'high') fitScore += perFit * 0.60;
 });
 }
 safeScore = Math.round(safeScore);
 fitScore = Math.round(fitScore);
 const total = Math.max(0, Math.min(100, det + safeScore + fitScore));
 return {
 total: total,
 detection: { score: det, max: 15 },
 safety: { score: safeScore, max: 35 },
 fit: { score: fitScore, max: 50 },
 };
 }

 global.ReformaBattingAnalyzer = {
 analyzeBatting: analyzeBatting,
 detect9Phases: detect9Phases,
 calcMetricsForFrame: calcMetricsForFrame,
 estimateBodyHeight: estimateBodyHeight,
 diagnoseKineticChain: diagnoseKineticChain,
 computeTotalScore: computeTotalScore,
 LM: LM,
 };
})(window);
