// 聽力中心裡的閒聊：走過身邊的每個人都可以按 E 跟他說話。
// 這裡不是臨床內容，是診間以外的日常：午餐、小道具、熟悉的同事，偶爾有人關心聽力師。
//
// 每個人：
//   name, role                 對話框的名牌：`${role}${name}`
//   faces                      assets/game/char/ 裡可以挑的立繪；沒有圖的人不寫
//   lines                      { text, when?, gift?, pri? }
//     when(s)                  s 是 { morning, afternoon, late, hungry, tired, needLoo }
//                              morning＝中午以前，afternoon＝中午到 15:30，late＝15:30 以後
//     gift                     { full?, energy?, bladder?, toast } -- 每位同事一天只給一次
//     pri                      符合條件時優先說（肚子餓的聽力師會先聽到食物的事）
// 同一個人的句子輪完才會重複。每個人的第一句不要加 when 和 gift：沒有別的符合時就說這句。

export const CHATTER = {
  pinyu: {
    name: '品妤', role: '跟診護士', faces: ['nurse_worried', 'nurse_neutral'],
    lines: [
      { text: '學姊說，診間最重要的三件事：核對姓名、解釋清楚、記得喝水。' },
      { text: '聽力師你還沒吃午餐對不對？我多買了一個飯糰，給你！', when: s => s.hungry, pri: true,
        gift: { full: 20, toast: '你吃掉了品妤給的飯糰，肚子飽了一點。' } },
    ],
  },
  shuhan: {
    name: '書涵', role: '跟診護士', faces: ['nurse_caring', 'nurse_holding_laugh'],
    lines: [
      { text: '噓——千萬不要說「今天好像很閒」，說了一定會突然排滿。' },
      { text: '聽力師你眼睛都紅了。趁現在沒人，去辦公室小憩一下，有事我叫你。', when: s => s.tired, pri: true },
    ],
  },
  akai: {
    name: '阿凱', role: '助聽器廠商', faces: ['akai_coffee'],
    lines: [
      { text: '我們的新款電池可以多撐兩天，不過每個人用起來都不一樣，要看個人的使用情況。' },
      { text: '聽力師，我下樓買咖啡，順便幫你帶一杯？……來，熱的。',
        gift: { energy: 6, bladder: 12, toast: '你喝了阿凱帶的咖啡，比較有精神了，不過等一下可能要跑廁所。' } },
    ],
  },
  azhu: {
    name: '阿珠姨', role: '清潔人員', faces: ['azhu_smile'],
    lines: [
      { text: '隔音室的地板我拖得很小心，怕有聲音影響檢查。' },
      { text: '你吃飯了沒？沒吃不行啦，便當冷了也要吃。', when: s => s.hungry, pri: true },
    ],
  },
  shufen: {
    name: '淑芬學姊', role: '資深聽力師', faces: ['nurse_stern', 'nurse_caring', 'nurse_neutral'],
    lines: [
      { text: '每個人聽到的世界都不一樣，我們的工作就是幫他把聽到的東西調到剛剛好。' },
      { text: '你一直盯著數字，記得抬頭看看病人的臉。表情有時比聽力圖更誠實。', when: s => s.afternoon },
    ],
  },
  yaqi: {
    name: '雅琪', role: '櫃檯行政', faces: ['nurse_holding_laugh', 'nurse_neutral'],
    lines: [
      { text: '我在排下午的預約，有人要改時間，電話一直響。' },
      { text: '聽力師，廁所在走廊東邊，你不要憋喔，我們看過憋到泌尿道發炎的。', when: s => s.needLoo, pri: true },
    ],
  },
  azhe: {
    name: '阿哲', role: '耳鼻喉科醫師', faces: ['chief_approve', 'chief_tired'],
    lines: [
      { text: '遇到你覺得需要馬上看的病人，直接打給我，不用客氣。' },
      { text: '午餐時間要吃飯，不是偷懶。你也坐一下。', when: s => s.afternoon },
    ],
  },
  jingyi: {
    name: '敏心', role: '實習聽力師', faces: ['nurse_neutral', 'nurse_caring'],
    lines: [
      { text: '學姊，我有個問題：小朋友不肯戴耳機的時候，您都怎麼辦呢？' },
      { text: '我發現如果先讓他玩一下玩具，他就比較願意坐下來。', when: s => s.late },
    ],
  },
  // the assistant who called the audiologist to a room, once that patient is settled; name is filled in
  bed: {
    name: '', role: '跟診護士', faces: ['nurse_thankful', 'nurse_caring', 'nurse_sleepy'],
    lines: [
      { text: '剛剛那位謝謝你，聽力師。有你來看，我比較安心。' },
      { text: '快下班了，剩下的我來收，你先喝口水。', when: s => s.late },
    ],
  },
};
