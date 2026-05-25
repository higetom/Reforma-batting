/**
 * Re'forma Web版 — タイプ別アドバイスDB(JavaScript版)
 *
 * Python版 RMP/type_advice_db.py からの忠実移植
 * 各タイプの特性・強み・弱点・スイング時の意識・日常トレーニング・怪我リスク注意
 */

(function (global) {
 'use strict';

 const TYPE_ADVICE_DB = {
 'リーチ型': {
 animal_emoji: '',
 animal_jp: '鷲',
 type_color: '#60a5fa',
 characteristic: '腕の使い方と上肢のコントロールでスイングを完結させる傾向',
 characteristic_friendly: '腕の動きが器用で、ボールに対する微調整が得意なタイプです',
 strength_default: 'コンタクト能力・上肢の繊細さ・スイング軌道の自由度',
 weakness_default: '下半身のパワー伝達不足・腕に頼った打撃',
 swing_focus: '下半身始動を意識し、上半身の力みを抜く',
 swing_focus_friendly: '後ろ足から動き始めて、腕の力を抜くことを意識しましょう',
 daily_training: [
 'Hip hinge pattern(下半身始動の体得)',
 'Squat jump(下半身パワー強化)',
 'Pallof press(抗回旋、コア安定)',
 'メディシンボール下から上スロー(下から始動)',
 ],
 injury_caution: '肘内側・肩関節後方への代償ストレス。腕主体打撃が続くと野球肘リスク',
 },
 'ドライブ型': {
 animal_emoji: '',
 animal_jp: 'サイ',
 type_color: '#f59e0b',
 characteristic: '下半身始動の体重移動と地面反力でスイングを駆動する傾向',
 characteristic_friendly: '下半身の力強さで打つタイプ。地面を蹴る力が強いのが特徴です',
 strength_default: 'パワー・長打力・大ストライド・力強い体重移動',
 weakness_default: '上半身が振り遅れがち・繊細さに欠ける',
 swing_focus: '上半身のしなりを意識し、下半身と上半身の連動を高める',
 swing_focus_friendly: '下半身の力を上半身まで伝えるしなりを意識しましょう',
 daily_training: [
 '胸郭回旋ストレッチ Open book(分離角の獲得)',
 'Sleeper stretch(後方関節包の柔軟性)',
 'Pallof press(抗回旋・突っ込み防止)',
 'メディシンボール woodchop(体幹回旋出力)',
 ],
 injury_caution: '腰椎への前方剪断力・前膝への過負荷。突っ込み型のフォームが続くと腰痛リスク',
 },
 'ウィップ型': {
 animal_emoji: '',
 animal_jp: '蛇',
 type_color: '#a855f7',
 characteristic: '体幹の回旋速度としなりでスイングを駆動する。kinetic chain の理想形',
 characteristic_friendly: '体のしなりとひねりで打つタイプ。ムチのような連動が武器です',
 strength_default: '回旋速度・分離角・全身の連動性・効率の良いエネルギー伝達',
 weakness_default: '胸郭可動性が低下するとパフォーマンスが急落・繊細すぎる',
 swing_focus: '胸郭可動性と肩甲帯機能の維持に最優先で取り組む',
 swing_focus_friendly: '胸まわりの柔らかさを常にキープすることが大事です',
 daily_training: [
 'Open book ストレッチ(毎日継続必須)',
 'Sleeper stretch(肩後方の柔軟性)',
 'Cable woodchop(体幹回旋出力強化)',
 'PNF D2 flexion(体幹-上肢連動)',
 ],
 injury_caution: '胸郭可動性低下時の上肢への負荷集中・肩関節後方のインピンジメント',
 },
 'フロー型': {
 animal_emoji: '',
 animal_jp: '猫',
 type_color: '#10b981',
 characteristic: '場面に応じて打ち方を使い分けられる。万能型・適応型',
 characteristic_friendly: 'いろいろな打ち方に対応できる万能タイプです',
 strength_default: '柔軟性・適応力・場面対応・バランス',
 weakness_default: '特化した強みがない・突出した武器がない',
 swing_focus: '自分の状態を観察し、その日のコンディションに最適なスタイルを選ぶ',
 swing_focus_friendly: '今日の自分の状態を確認して、合ったスタイルで打ちましょう',
 daily_training: [
 '全身バランストレーニング(片脚立位+動作課題)',
 'Functional Movement Screen 系のドリル',
 '様々なスイングシナリオ素振り(高低・内外角)',
 '中強度の有酸素+筋力バランスの良いトレーニング',
 ],
 injury_caution: '特に偏った怪我リスクはないが、過度な特化トレーニングで他タイプ化するリスク',
 },
 };

 global.ReformaTypeAdvice = {
 TYPE_ADVICE_DB: TYPE_ADVICE_DB,
 getAdvice: function (rmpType) {
 return TYPE_ADVICE_DB[rmpType] || TYPE_ADVICE_DB['フロー型'];
 },
 };
})(window);
