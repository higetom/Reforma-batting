/**
 * Re'forma Web版 — バッティング動作解析データ
 *
 * Python版から軽量化して移植。指標範囲・タイプ別評価・Kinetic Chain・改善ロードマップ。
 * 学術根拠: Welch (1995), Werner (2008), DeRenne (2007), Williams (2017), Janda (1987)
 */
(function (global) {
 'use strict';

 // ─────────────────────────────────────────
 // 9フェーズ定義
 // ─────────────────────────────────────────
 const PHASE_NAMES = [
 '①構え', '②ロード', '③ストライド開始', '④前足接地', '⑤ヒール接地',
 '⑥腰がいちばん速く回る瞬間', '⑦上体がいちばん速く回る瞬間',
 '⑧コンタクト', '⑨フォロースルー',
 ];

 const PHASE_COLORS = {
 '①構え': '#2ecc71', '②ロード': '#3498db', '③ストライド開始': '#5dade2',
 '④前足接地': '#9b59b6', '⑤ヒール接地': '#af7ac5',
 '⑥腰がいちばん速く回る瞬間': '#f39c12', '⑦上体がいちばん速く回る瞬間': '#e67e22',
 '⑧コンタクト': '#e74c3c', '⑨フォロースルー': '#c0392b',
 };

 // ─────────────────────────────────────────
 // 指標評価DB(タイプ別範囲+フェーズ別override)
 // Python版 BATTING_EVAL_DB の軽量版
 // ─────────────────────────────────────────
 // ────────────────────────────────────────────────────────────
 // 評価DB改訂メモ（v2 — 2026-05-29）
 //
 // 2D真横動画の測定限界を踏まえた調整方針:
 //  ① 腰肩分離: 奥行き回転(XZ平面)はカメラで捉えられないため2D値は過小評価される。
 //    → 典型範囲・安全閾値とも緩和。
 //  ② 体幹前屈: shoMid-hipMid-kneeMidの角度計算は近似であり誤差が大きい。
 //    → 安全閾値を広げ、異常と判定しにくくする。
 //  ③ ストライド長: アスペクト比補正後の値に対して範囲は現実的。
 //    ただし撮影距離依存性が残るため、下限閾値を緩和。
 //  ④ 前膝屈曲・軸足膝屈曲: 真横撮影で比較的信頼性が高い。現状に近い範囲を維持。
 //  ⑤ バット側肘の高さ: Y座標ベースで信頼性が高い。現状維持。
 // ────────────────────────────────────────────────────────────
 const BATTING_EVAL_DB = {
 'ストライド長': {
 unit: '%',
 phase: '④前足接地',
 friendly: '踏み出しの幅',
 // 安全閾値: 撮影距離による誤差を考慮し下限を緩和（20%未満で危険、30%未満で要注意）
 safety: { caution_low: 30, risk_low: 20, caution_high: 100, risk_high: 115 },
 style_by_type: {
 'リーチ型': { typical_range: [50, 75] },
 'ドライブ型': { typical_range: [65, 95] },
 'ウィップ型': { typical_range: [55, 85] },
 'フロー型': { typical_range: [50, 90] },
 },
 },
 '前膝屈曲': {
 unit: '°',
 phase: '⑧コンタクト',
 friendly: '前足の曲げ伸ばし',
 // コンタクト時: stiff front leg (DeRenne 2007) — 理想は0〜15°程度の軽度屈曲
 // 25°超でcautionは厳しすぎるため30°に緩和
 safety: { caution_low: -5, risk_low: -10, caution_high: 30, risk_high: 45 },
 style_by_type: {
 'リーチ型': { typical_range: [5, 22] },
 'ドライブ型': { typical_range: [0, 15] },
 'ウィップ型': { typical_range: [3, 18] },
 'フロー型': { typical_range: [5, 25] },
 },
 // フェーズ別override（前足接地時は衝撃吸収のために屈曲が必要 = コンタクト時と逆）
 phase_overrides: {
 '④前足接地': {
 description: '衝撃吸収のための膝屈曲（20〜55°が正常範囲）',
 style_by_type: {
 'リーチ型': { typical_range: [20, 50] },
 'ドライブ型': { typical_range: [25, 55] },
 'ウィップ型': { typical_range: [20, 45] },
 'フロー型': { typical_range: [20, 50] },
 },
 },
 },
 },
 '軸足膝屈曲': {
 unit: '°',
 phase: '⑧コンタクト',
 friendly: '後ろ足の沈み込み',
 // ロード〜コンタクトを通じて10〜40°程度の屈曲が典型
 safety: { caution_low: 0, risk_low: -5, caution_high: 55, risk_high: 65 },
 style_by_type: {
 'リーチ型': { typical_range: [10, 35] },
 'ドライブ型': { typical_range: [15, 40] },
 'ウィップ型': { typical_range: [10, 35] },
 'フロー型': { typical_range: [10, 40] },
 },
 },
 '体幹前屈': {
 unit: '°',
 phase: '⑧コンタクト',
 friendly: '上半身の前傾',
 // 2D動画では計算誤差が大きいため、安全閾値を大きく緩和
 // 異常と判定するのは明らかな過前傾（40°超）または後傾（-15°以下）のみ
 safety: { caution_low: -15, risk_low: -25, caution_high: 40, risk_high: 55 },
 style_by_type: {
 'リーチ型': { typical_range: [0, 22] },
 'ドライブ型': { typical_range: [2, 25] },
 'ウィップ型': { typical_range: [0, 20] },
 'フロー型': { typical_range: [0, 22] },
 },
 },
 '腰肩分離': {
 unit: '°',
 phase: '②ロード',
 friendly: '体のひねり',
 // 2D真横撮影では奥行き方向の回転が捉えられないため値が過小評価される。
 // 実際の3D腰肩分離30〜50°でも2D投影では15〜35°程度に見える。
 // → 典型範囲・安全閾値を3D文献値より低く設定する。
 safety: { caution_low: 5, risk_low: 0, caution_high: 60, risk_high: 75 },
 style_by_type: {
 'リーチ型': { typical_range: [15, 40] },
 'ドライブ型': { typical_range: [20, 50] },
 'ウィップ型': { typical_range: [25, 55] },
 'フロー型': { typical_range: [15, 45] },
 },
 },
 'バット側肘の高さ': {
 unit: '%',
 phase: '⑧コンタクト',
 friendly: '後ろ肘の高さ',
 // Y座標ベースで信頼性が高い指標。現状ほぼ維持。
 // 100%超（肘が肩より大幅に上）はほぼ起こらないため上限を現実的な値に
 safety: { caution_low: 5, risk_low: -5, caution_high: 105, risk_high: 120 },
 style_by_type: {
 'リーチ型': { typical_range: [35, 75] },
 'ドライブ型': { typical_range: [45, 80] },
 'ウィップ型': { typical_range: [40, 80] },
 'フロー型': { typical_range: [35, 80] },
 },
 },
 };

 /**
 * 3層評価(simplified)
 */
 function evaluateMetric(metricName, value, rmpType, phase) {
 rmpType = rmpType || 'フロー型';
 const entry = BATTING_EVAL_DB[metricName];
 if (!entry) return { error: 'unknown metric: ' + metricName };

 // フェーズ別 override
 let style_dict = entry.style_by_type;
 let phase_description = null;
 if (phase && entry.phase_overrides && entry.phase_overrides[phase]) {
 style_dict = entry.phase_overrides[phase].style_by_type || style_dict;
 phase_description = entry.phase_overrides[phase].description;
 }
 const safety = entry.safety;
 const style = style_dict[rmpType] || style_dict['フロー型'];

 // Layer 1: 安全性
 let layer1;
 if (value <= safety.risk_low) layer1 = { level: 'concern', label: '危険水準(下)' };
 else if (value >= safety.risk_high) layer1 = { level: 'concern', label: '危険水準(上)' };
 else if (value < safety.caution_low) layer1 = { level: 'caution', label: '要注意(下)' };
 else if (value > safety.caution_high) layer1 = { level: 'caution', label: '要注意(上)' };
 else layer1 = { level: 'safe', label: '安全範囲内' };

 // Layer 2: スタイル位置づけ
 const range = style.typical_range;
 let layer2 = { typical_range: range };
 if (value < range[0]) {
 layer2.position = 'low';
 layer2.label = rmpType + 'としては低めの値';
 } else if (value > range[1]) {
 layer2.position = 'high';
 layer2.label = rmpType + 'としては高めの値';
 } else {
 layer2.position = 'typical';
 layer2.label = rmpType + 'の典型的範囲内';
 }

 return {
 layer1_safety: layer1,
 layer2_style: layer2,
 unit: entry.unit,
 phase: phase || entry.phase,
 phase_description: phase_description,
 friendly_name: entry.friendly,
 };
 }

 // ─────────────────────────────────────────
 // Kinetic Chain(7リンク)
 // Python版 KINETIC_CHAIN_BATTING と同等
 // ─────────────────────────────────────────
 const KINETIC_CHAIN_BATTING = [
 {
 id: 'load_leg', label_friendly: '軸足の沈み込み', label_pro: '軸足膝屈曲(ロード時)',
 metric: '軸足膝屈曲', phase: '②ロード',
 function: '下半身パワーの溜め込み',
 weak_cascade: 'ロード不足 → 下半身パワー蓄積弱 → 全身連動の起点が弱まる',
 injury_risk: '腰部・軸足ハムストリングへの過負荷',
 },
 {
 id: 'stride', label_friendly: '踏み出しの幅', label_pro: 'ストライド長(身長比)',
 metric: 'ストライド長', phase: '④前足接地',
 function: '前足までの距離・タイミング・体重移動量',
 weak_cascade: 'ストライド浅い → 体重移動不足 → 軸足からの力が前足に伝わらない → バットヘッドが鋭く出ない',
 injury_risk: '腕主体の代償打撃 → 肩・肘への過負荷',
 },
 {
 id: 'front_block', label_friendly: '前足ブロック', label_pro: '前膝屈曲(コンタクト時)',
 metric: '前膝屈曲', phase: '⑧コンタクト',
 function: '下半身回転の急停止 (stiff front leg)',
 weak_cascade: '前膝深い → ブロック弱 → 下半身回転が止まらない → 上半身回転速度低下 → バットヘッド失速',
 injury_risk: '前膝・腰部の慢性ストレス',
 },
 {
 id: 'separation', label_friendly: '体のひねり', label_pro: '腰肩分離角(ロード時)',
 metric: '腰肩分離', phase: '②ロード',
 function: 'キネマティック・シーケンスの核 — ゴム輪のような蓄積エネルギー',
 weak_cascade: '分離不足 → 上半身先行 → 腕主体打撃 → 肩・肘への代償ストレス',
 injury_risk: '肩関節後方・肘内側(野球肘)への慢性負担',
 },
 {
 id: 'trunk_balance', label_friendly: '上体の傾き', label_pro: '体幹前屈(コンタクト時)',
 metric: '体幹前屈', phase: '⑧コンタクト',
 function: '重心位置の制御 — パワーの方向性を決める',
 weak_cascade: '前傾過剰 → ヘッドが下がる/上体の突っ込み → コンタクト面が浅くなる',
 injury_risk: '腰椎への前方剪断力、頸部の慢性緊張',
 },
 {
 id: 'elbow_height', label_friendly: '後ろ肘の高さ', label_pro: 'バット側肘の高さ(コンタクト時)',
 metric: 'バット側肘の高さ', phase: '⑧コンタクト',
 function: 'バットコントロール・トップハンドパス',
 weak_cascade: '肘下がり → ヘッドが内回り → 引っ張り過多 / 肘高過ぎ → ヘッド残り',
 injury_risk: '肘内側・前腕屈筋群への代償ストレス',
 },
 ];

 // ─────────────────────────────────────────
 // 改善ロードマップ(主要ボトルネック向け)
 // ─────────────────────────────────────────
 const IMPROVEMENT_ROADMAPS = {
 'separation': {
 title: '体のひねり(腰肩分離)改善プログラム',
 goal_friendly: '上半身と下半身がちゃんと別々に動けるようにする',
 phases: [
 { week: '1-2週', label: '可動性', goal: '胸郭回旋と股関節内旋の制限を取る',
 exercises: ['胸郭回旋ストレッチ(Open book)左右各10回×2', 'Sleeper stretch 30秒×3', '90/90 hip stretch 30秒×3'],
 criteria: '胸椎回旋 ≥45° / 股関節内旋 ≥30°' },
 { week: '3-4週', label: '強化', goal: '体幹回旋筋・前鋸筋を活性化',
 exercises: ['メディシンボール・ロシアンツイスト 15回×3', 'Cable woodchop 左右10回×3', 'Pallof press 20秒×3'],
 criteria: '回旋負荷ありの動作で疲労感が出るまで継続可能' },
 { week: '5-6週', label: '統合', goal: '下肢→骨盤→体幹→上肢の連動を再学習',
 exercises: ['PNF D2 flexion 10回×3', 'Rotational throw 10球×3', 'Step + rotate 10回×3'],
 criteria: '鏡前で分離姿勢が安定して再現できる' },
 { week: '継続', label: 'フォーム再構築', goal: '実打で分離角を維持してスイングできる',
 exercises: ['シャドースイング(分離意識)20回×3', 'ティーバッティング 20球', 'Re\'forma 再解析で確認(2週ごと)'],
 criteria: 'Re\'forma 解析で分離角が典型範囲内' },
 ],
 },
 'front_block': {
 title: '前足ブロック(Stiff Front Leg)改善プログラム',
 goal_friendly: '前足でしっかり止まれるようにして、上半身に力を伝える',
 phases: [
 { week: '1-2週', label: '可動性', goal: '前足ハムストリング・大臀筋の柔軟性回復',
 exercises: ['ハムストリングストレッチ 30秒×3', '大臀筋ストレッチ 30秒×3', 'Ankle背屈 10回×2'],
 criteria: '前屈で指先が床から ≤10cm' },
 { week: '3-4週', label: '強化', goal: '下肢の急停止を支える筋力',
 exercises: ['スプリットスクワット 10回×3', 'Single leg deadlift 10回×3', 'Nordic curl 5回×3'],
 criteria: '片脚スクワットで膝が中心軸から外れない' },
 { week: '5-6週', label: '統合', goal: '下肢急停止+上肢加速の連動',
 exercises: ['Step + freeze 10回×3', 'メディシンボール lateral throw 10回×3', 'Plyo skater 10回×3'],
 criteria: '踏み込み後に上半身がぶれず回旋できる' },
 { week: '継続', label: 'フォーム再構築', goal: '実打で前膝が伸展位を保てる',
 exercises: ['前足ブロック意識のティー打ち 20球×3', 'Re\'forma 解析で前膝屈曲 ≤15° を確認'],
 criteria: 'コンタクト時の前膝屈曲 0-15°' },
 ],
 },
 'stride': {
 title: '踏み出し(ストライド)改善プログラム',
 goal_friendly: '前足までの距離を適切にして、体重を前に乗せる',
 phases: [
 { week: '1-2週', label: '可動性', goal: '股関節屈曲・伸展可動域',
 exercises: ['Hip flexor stretch 30秒×3', 'Glute bridge 15回×3', 'Hip hinge 10回×3'],
 criteria: 'ヒップヒンジで腰椎を反らずに前傾できる' },
 { week: '3-4週', label: '強化', goal: '下肢パワーと体重移動',
 exercises: ['ブルガリアンスクワット 10回×3', 'Lateral lunge 10回×3', 'ステップアップ 10回×3'],
 criteria: '片脚で全体重を支えられる(3秒静止)' },
 { week: '5-6週', label: '統合', goal: 'ストライド長と体重移動の連動学習',
 exercises: ['Step toss 10球×3', 'Stride length drill 20回'],
 criteria: '目標幅で踏み出してブレずに振れる' },
 { week: '継続', label: 'フォーム再構築', goal: '実打で適正ストライド長を維持',
 exercises: ['ティーバッティング 20球', 'Re\'forma 解析で身長比 60-80% 確認'],
 criteria: 'ストライド長が身長比 60-80%' },
 ],
 },
 'load_leg': {
 title: '軸足の沈み込み改善プログラム',
 goal_friendly: '後ろ足にしっかり力を溜める',
 phases: [
 { week: '1-2週', label: '可動性', goal: '足関節背屈と膝屈曲可動域',
 exercises: ['足関節背屈ストレッチ 30秒×3', '膝屈曲ROM 10回×2'],
 criteria: '完全屈曲で痛みなく可能' },
 { week: '3-4週', label: '強化', goal: '軸足の支持筋力と等尺性保持',
 exercises: ['Single leg squat 10回×3', 'Wall sit 60秒×3'],
 criteria: '片脚スクワットで膝が踵より前に出すぎない' },
 { week: '5-6週', label: '統合', goal: 'ロード姿勢の安定保持',
 exercises: ['ロード保持(3秒)→ スイング 10回×3'],
 criteria: 'ロード姿勢がブレない' },
 { week: '継続', label: 'フォーム再構築', goal: '実打で適切なロード',
 exercises: ['シャドースイング・ティー打ちでロード意識'],
 criteria: '軸足膝屈曲が典型範囲内' },
 ],
 },
 'trunk_balance': {
 title: '上体の傾き(体幹バランス)改善プログラム',
 goal_friendly: '上半身が突っ込みすぎない/反りすぎないようにする',
 phases: [
 { week: '1-2週', label: '可動性', goal: '胸椎可動性と腰椎中立位',
 exercises: ['Cat-cow 10回', 'Bird dog 10回×3', 'Dead bug 10回×3'],
 criteria: '中立位を保ったまま体幹動作可能' },
 { week: '3-4週', label: '強化', goal: '体幹深層筋(腹横筋・多裂筋)',
 exercises: ['プランク 60秒×3', 'Side plank 30秒×3', 'Pallof press 20秒×3'],
 criteria: '抗回旋負荷下で中立保持' },
 { week: '5-6週', label: '統合', goal: 'スイング中の体幹安定',
 exercises: ['メディシンボールツイスト 10回×3'],
 criteria: '回旋動作で姿勢崩れない' },
 { week: '継続', label: 'フォーム再構築', goal: '実打で体幹中立位を維持',
 exercises: ['撮影確認 → Re\'forma 再解析'],
 criteria: '体幹前屈/側屈が典型範囲内' },
 ],
 },
 'elbow_height': {
 title: '後ろ肘の高さ改善プログラム',
 goal_friendly: 'バットを振る肘の位置を整える',
 phases: [
 { week: '1-2週', label: '可動性', goal: '肩関節可動域・肩甲帯柔軟性',
 exercises: ['Sleeper stretch', 'Cross body stretch', 'Shoulder dislocates 10回'],
 criteria: '肩外旋・内旋ROM 左右差 ≤10%' },
 { week: '3-4週', label: '強化', goal: '肩甲帯安定性',
 exercises: ['Y-raise / T-raise 10回×3', 'Prone row 10回×3'],
 criteria: '肩甲骨の動きが安定' },
 { week: '5-6週', label: '統合', goal: '肘高さを保持したままスイング',
 exercises: ['シャドースイング(肘高さ意識)20回×3'],
 criteria: '肘高さが典型範囲内' },
 { week: '継続', label: 'フォーム再構築', goal: '実打で適切な肘高さ',
 exercises: ['ティー打ち+撮影確認'],
 criteria: 'Re\'forma 解析で肘高さが典型範囲内' },
 ],
 },
 };

 global.ReformaBattingData = {
 PHASE_NAMES: PHASE_NAMES,
 PHASE_COLORS: PHASE_COLORS,
 BATTING_EVAL_DB: BATTING_EVAL_DB,
 evaluateMetric: evaluateMetric,
 KINETIC_CHAIN_BATTING: KINETIC_CHAIN_BATTING,
 IMPROVEMENT_ROADMAPS: IMPROVEMENT_ROADMAPS,
 };
})(window);
