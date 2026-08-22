/**
 * 題庫整理與擴充：保留實用詞，移除較冷門角色／招式，總數整理為 380 題。
 * 正式題目語音依 id 由 assets/audio/questions/manifest.json 對應。
 */
(() => {
  const CATEGORY_OPTIONS = [
    ["all", "全部類別"],
    ["daily", "日常會話"],
    ["action", "動作"],
    ["school_work", "學校與工作"],
    ["food", "飲食"],
    ["household", "家庭與用品"],
    ["clothing", "服飾"],
    ["health", "身體與健康"],
    ["places_transport", "地點與交通"],
    ["shopping_numbers", "購物與數字"],
    ["time_nature", "時間與自然"],
    ["animals", "動物"],
    ["description", "形容與感受"],
    ["loanword", "外來語／片假名"],
    ["anime", "動漫"],
    ["fantasy_battle", "奇幻與戰鬥"],
  ].map(([value, label]) => ({ value, label }));

  const REMOVED_IDS = new Set([
    "custom_star", "custom_thunder", "custom_moon", "custom_flame", "custom_ice",
    "custom_wind", "custom_void", "custom_dragon", "custom_light", "custom_shadow",
    "sakura", "ashitaka", "chihiro", "howl", "genos", "ram",
    "hado31", "detroit", "expulsion", "seriouspunch", "malevolent", "shikai",
  ]);

  const BASE_CATEGORY_IDS = {
    daily: ["ohayou", "konnichiwa", "konbanwa", "arigatou", "sumimasen", "onegaishimasu", "hai", "iie", "daijoubu", "wakarimashita", "wakarimasen", "yoroshiku", "namae", "doko", "dare", "nani", "itsu"],
    action: ["taberu", "nomu", "miru", "kiku", "hanasu", "yomu", "kaku", "iku", "kuru", "tatakau", "mamoru", "nigeru", "katsu", "makeru"],
    school_work: ["gakkou", "sensei", "tomodachi", "benkyou", "jugyou", "kyoukasho", "enpitsu"],
    food: ["gohan", "mizu", "ocha", "niku", "sakana", "yasai", "kudamono", "pan", "ringo", "mikan", "ichigo_fruit", "banana", "suika", "budou", "momo", "nashi"],
    household: ["pasokon", "terebi", "denwa", "jitensha"],
    places_transport: ["densha", "basu", "kuruma", "hikouki"],
    time_nature: ["kyou", "ashita", "kinou", "ima", "asa", "hiru", "yoru", "mainichi", "sora", "umi", "yama", "kawa", "mori", "ame", "yuki", "kaze", "hi", "tsuki", "hoshi", "kumo", "taiyou"],
    description: ["ookii", "chiisai", "hayai", "osoi", "atsui", "samui", "omoshiroi", "tanoshii", "muzukashii", "yasashii", "kawaii", "kakkoii", "suki", "kirai", "jouzu", "heta", "genki"],
    animals: ["inu", "neko", "tori", "sakana_animal"],
    fantasy_battle: ["ken", "yumi", "tate", "yoroi", "mahou", "yuusha", "maou", "yuuki", "kibou", "yume", "ai", "heiwa", "sensou", "shouri", "haiboku", "chikara", "inochi", "kokoro", "tamashii"],
  };

  const categoryById = new Map();
  Object.entries(BASE_CATEGORY_IDS).forEach(([category, ids]) => ids.forEach((id) => categoryById.set(id, category)));

  const SMALL_KANA = new Set(["ゃ", "ゅ", "ょ", "ぁ", "ぃ", "ぅ", "ぇ", "ぉ", "ゎ", "ャ", "ュ", "ョ", "ァ", "ィ", "ゥ", "ェ", "ォ", "ヮ"]);
  function kanaCells(reading) {
    const cells = [];
    for (const char of reading) {
      if (SMALL_KANA.has(char) && cells.length) cells[cells.length - 1] += char;
      else cells.push(char);
    }
    return cells;
  }

  const groups = {
    household: [
      ["ie", "いえ", "家", "家"], ["heya", "へや", "部屋", "房間"], ["daidokoro", "だいどころ", "台所", "廚房"], ["ofuro", "おふろ", "お風呂", "浴室／洗澡"], ["toire", "トイレ", null, "廁所"],
      ["doa", "ドア", null, "門"], ["mado", "まど", "窓", "窗戶"], ["tsukue", "つくえ", "机", "書桌"], ["isu", "いす", "椅子", "椅子"], ["beddo", "ベッド", null, "床"],
      ["reizouko", "れいぞうこ", "冷蔵庫", "冰箱"], ["sentakuki", "せんたくき", "洗濯機", "洗衣機"], ["soujiki", "そうじき", "掃除機", "吸塵器"], ["eakon", "エアコン", null, "冷氣"], ["denki", "でんき", "電気", "電／電燈"],
      ["kagi", "かぎ", "鍵", "鑰匙"], ["kasa", "かさ", "傘", "雨傘"], ["kaban", "かばん", "鞄", "包包"], ["saifu", "さいふ", "財布", "錢包"], ["tokei", "とけい", "時計", "時鐘／手錶"],
      ["kagami", "かがみ", "鏡", "鏡子"], ["taoru", "タオル", null, "毛巾"], ["koppu", "コップ", null, "杯子"], ["sara", "さら", "皿", "盤子"], ["hashi_chopsticks", "はし", "箸", "筷子"],
    ],
    clothing: [
      ["fuku", "ふく", "服", "衣服"], ["shatsu", "シャツ", null, "襯衫"], ["tishatsu", "ティーシャツ", null, "T 恤"], ["zubon", "ズボン", null, "褲子"], ["sukaato", "スカート", null, "裙子"],
      ["wanpiisu", "ワンピース", null, "洋裝"], ["kooto", "コート", null, "大衣"], ["jaketto", "ジャケット", null, "夾克"], ["seetaa", "セーター", null, "毛衣"], ["kutsushita", "くつした", "靴下", "襪子"],
      ["kutsu", "くつ", "靴", "鞋子"], ["suniikaa", "スニーカー", null, "運動鞋"], ["boushi", "ぼうし", "帽子", "帽子"], ["tebukuro", "てぶくろ", "手袋", "手套"], ["megane", "めがね", "眼鏡", "眼鏡"],
      ["udedokei", "うでどけい", "腕時計", "手錶"], ["nekutai", "ネクタイ", null, "領帶"], ["beruto", "ベルト", null, "皮帶"], ["pajama", "パジャマ", null, "睡衣"], ["uwagi", "うわぎ", "上着", "外套"],
    ],
    health: [
      ["karada", "からだ", "体", "身體"], ["atama", "あたま", "頭", "頭"], ["kao", "かお", "顔", "臉"], ["me_eye", "め", "目", "眼睛"], ["mimi", "みみ", "耳", "耳朵"],
      ["hana_nose", "はな", "鼻", "鼻子"], ["kuchi", "くち", "口", "嘴巴"], ["ha_tooth", "は", "歯", "牙齒"], ["te_hand", "て", "手", "手"], ["ashi_body", "あし", "足", "腳"],
      ["onaka", "おなか", "お腹", "肚子"], ["senaka", "せなか", "背中", "背部"], ["nodo", "のど", "喉", "喉嚨"], ["netsu", "ねつ", "熱", "發燒"], ["byouki", "びょうき", "病気", "生病"],
      ["kusuri", "くすり", "薬", "藥"], ["byouin", "びょういん", "病院", "醫院"], ["isha", "いしゃ", "医者", "醫生"], ["itai", "いたい", "痛い", "痛"], ["kenkou", "けんこう", "健康", "健康"],
      ["kega", "けが", "怪我", "受傷"], ["seki", "せき", "咳", "咳嗽"], ["hanamizu", "はなみず", "鼻水", "鼻水"], ["zutsuu", "ずつう", "頭痛", "頭痛"], ["hakike", "はきけ", "吐き気", "噁心"],
    ],
    places_transport: [
      ["eki", "えき", "駅", "車站"], ["mise", "みせ", "店", "店家"], ["suupaa", "スーパー", null, "超市"], ["konbini", "コンビニ", null, "便利商店"], ["depaato", "デパート", null, "百貨公司"],
      ["ginkou", "ぎんこう", "銀行", "銀行"], ["yuubinkyoku", "ゆうびんきょく", "郵便局", "郵局"], ["toshokan", "としょかん", "図書館", "圖書館"], ["kouen", "こうえん", "公園", "公園"], ["resutoran", "レストラン", null, "餐廳"],
      ["hoteru", "ホテル", null, "飯店"], ["kuukou", "くうこう", "空港", "機場"], ["yakkyoku", "やっきょく", "薬局", "藥局"], ["kouban", "こうばん", "交番", "派出所"], ["kissaten", "きっさてん", "喫茶店", "咖啡店"],
      ["migi", "みぎ", "右", "右邊"], ["hidari", "ひだり", "左", "左邊"], ["mae", "まえ", "前", "前面"], ["ushiro", "うしろ", "後ろ", "後面"], ["naka", "なか", "中", "裡面"],
      ["soto", "そと", "外", "外面"], ["ue", "うえ", "上", "上面"], ["shita", "した", "下", "下面"], ["chikai", "ちかい", "近い", "近"], ["massugu", "まっすぐ", "真っ直ぐ", "直走"],
    ],
    shopping_numbers: [
      ["okane", "おかね", "お金", "錢"], ["en", "えん", "円", "日圓"], ["nedan", "ねだん", "値段", "價格"], ["ikura", "いくら", null, "多少錢"], ["kaimasu", "かいます", "買います", "購買"],
      ["urimasu", "うります", "売ります", "販售"], ["haraimasu", "はらいます", "払います", "付款"], ["genkin", "げんきん", "現金", "現金"], ["kaado", "カード", null, "卡片"], ["otsuri", "おつり", "お釣り", "找零"],
      ["reshiito", "レシート", null, "收據"], ["fukuro", "ふくろ", "袋", "袋子"], ["kaimono", "かいもの", "買い物", "購物"], ["seeru", "セール", null, "特賣"], ["waribiki", "わりびき", "割引", "折扣"],
      ["zeikin", "ぜいきん", "税金", "稅金"], ["muryou", "むりょう", "無料", "免費"], ["shouhin", "しょうひん", "商品", "商品"], ["irimasu", "いります", "要ります", "需要"], ["erabimasu", "えらびます", "選びます", "選擇"],
      ["ichi", "いち", "一", "一"], ["ni", "に", "二", "二"], ["san", "さん", "三", "三"], ["yon", "よん", "四", "四"], ["go_number", "ご", "五", "五"],
      ["roku", "ろく", "六", "六"], ["nana", "なな", "七", "七"], ["hachi", "はち", "八", "八"], ["kyuu", "きゅう", "九", "九"], ["juu", "じゅう", "十", "十"],
      ["hyaku", "ひゃく", "百", "百"], ["sen_number", "せん", "千", "千"], ["man_number", "まん", "万", "萬"], ["hitotsu", "ひとつ", "一つ", "一個"], ["futatsu", "ふたつ", "二つ", "兩個"],
      ["mittsu", "みっつ", "三つ", "三個"], ["yottsu", "よっつ", "四つ", "四個"], ["itsutsu", "いつつ", "五つ", "五個"], ["hitori", "ひとり", "一人", "一個人"], ["futari", "ふたり", "二人", "兩個人"],
    ],
    school_work: [
      ["gakusei", "がくせい", "学生", "學生"], ["kaishain", "かいしゃいん", "会社員", "公司職員"], ["kyoushi", "きょうし", "教師", "教師"], ["kangoshi", "かんごし", "看護師", "護理師"], ["keisatsukan", "けいさつかん", "警察官", "警察"],
      ["shouboushi", "しょうぼうし", "消防士", "消防員"], ["tenin", "てんいん", "店員", "店員"], ["ryourinin", "りょうりにん", "料理人", "廚師"], ["untenshu", "うんてんしゅ", "運転手", "駕駛"], ["enjinia", "エンジニア", null, "工程師"],
      ["dezainaa", "デザイナー", null, "設計師"], ["puroguramaa", "プログラマー", null, "程式設計師"], ["bengoshi", "べんごし", "弁護士", "律師"], ["nouka", "のうか", "農家", "農夫"], ["kaisha", "かいしゃ", "会社", "公司"],
      ["shigoto", "しごと", "仕事", "工作"], ["kaigi", "かいぎ", "会議", "會議"], ["jimusho", "じむしょ", "事務所", "辦公室"], ["shukudai", "しゅくだい", "宿題", "作業"], ["shiken", "しけん", "試験", "考試"],
    ],
    loanword: [
      ["camera_word", "カメラ", null, "相機"], ["rajio", "ラジオ", null, "收音機"], ["nyuusu", "ニュース", null, "新聞／消息"], ["intaanetto", "インターネット", null, "網路"], ["sumaho", "スマホ", null, "智慧型手機"],
      ["apuri", "アプリ", null, "應用程式"], ["meeru", "メール", null, "電子郵件"], ["pasuwaado", "パスワード", null, "密碼"], ["geemu", "ゲーム", null, "遊戲"], ["anime_word", "アニメ", null, "動畫"],
      ["manga_word", "マンガ", null, "漫畫"], ["supootsu", "スポーツ", null, "運動"], ["sakkaa", "サッカー", null, "足球"], ["tenisu", "テニス", null, "網球"], ["basuketto", "バスケット", null, "籃球"],
      ["bareebooru", "バレーボール", null, "排球"], ["piano", "ピアノ", null, "鋼琴"], ["gitaa", "ギター", null, "吉他"], ["konsaato", "コンサート", null, "演唱會"], ["dorama", "ドラマ", null, "戲劇"],
      ["chansu", "チャンス", null, "機會"], ["memo", "メモ", null, "筆記"], ["nooto", "ノート", null, "筆記本"], ["pen", "ペン", null, "筆"], ["purezento", "プレゼント", null, "禮物"],
      ["paatii", "パーティー", null, "派對"], ["ryukkusakku", "リュックサック", null, "後背包"], ["petto", "ペット", null, "寵物"], ["dokutaa", "ドクター", null, "醫生"], ["sukejuuru", "スケジュール", null, "行程表"],
    ],
    action: [
      ["okiru", "おきる", "起きる", "起床"], ["neru", "ねる", "寝る", "睡覺"], ["aruku", "あるく", "歩く", "走路"], ["hashiru", "はしる", "走る", "跑步"], ["oyogu", "およぐ", "泳ぐ", "游泳"],
      ["noru", "のる", "乗る", "搭乘"], ["oriru", "おりる", "降りる", "下車"], ["au", "あう", "会う", "見面"], ["matsu", "まつ", "待つ", "等待"], ["tsukau", "つかう", "使う", "使用"],
      ["tsukuru", "つくる", "作る", "製作"], ["kaeru", "かえる", "帰る", "回去"], ["hairu", "はいる", "入る", "進入"], ["deru", "でる", "出る", "出去"], ["akeru", "あける", "開ける", "打開"],
      ["shimeru", "しめる", "閉める", "關上"], ["aru", "ある", null, "有（無生命）"], ["iru", "いる", null, "有（生命）"], ["wasureru", "わすれる", "忘れる", "忘記"], ["oboeru", "おぼえる", "覚える", "記住"],
    ],
    daily: [
      ["yukkuri", "ゆっくり", null, "慢慢地"], ["hayaku", "はやく", "早く", "快點／早點"], ["sugu", "すぐ", null, "馬上"], ["mata", "また", null, "再／又"], ["mada", "まだ", null, "還沒／仍然"],
      ["mou", "もう", null, "已經"], ["itsumo", "いつも", null, "總是"], ["yoku", "よく", null, "經常／很好地"], ["tokidoki", "ときどき", "時々", "有時候"], ["amari", "あまり", null, "不太"],
      ["zenzen", "ぜんぜん", "全然", "完全不"], ["issho", "いっしょ", "一緒", "一起"], ["hitoride", "ひとりで", "一人で", "一個人"], ["chotto", "ちょっと", null, "一點／稍微"], ["motto", "もっと", null, "更／再多一些"],
    ],
  };

  const labels = new Map(CATEGORY_OPTIONS.map(({ value, label }) => [value, label]));
  const added = Object.entries(groups).flatMap(([category, rows]) => rows.map(([id, reading, kanji, zh]) => ({
    id,
    contentType: "vocab",
    displayName: reading,
    kanaSequence: kanaCells(reading),
    kanji,
    zh,
    speakText: reading,
    rewardMode: "celebrate",
    category,
    tags: category === "loanword" ? [labels.get(category), "片仮名"] : [labels.get(category)],
  })));

  const base = (window.KANA_QUESTIONS || [])
    .filter((question) => !REMOVED_IDS.has(question.id))
    .map((question) => ({
      ...question,
      category: question.contentType === "character" || question.contentType === "skill" || question.contentType === "custom_skill"
        ? "anime"
        : categoryById.get(question.id) || "daily",
    }));

  window.KANA_CATEGORY_OPTIONS = CATEGORY_OPTIONS;
  window.KANA_QUESTIONS = [...base, ...added];
})();
