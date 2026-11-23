// Keys and value spellings follow Quran Transcript's SifaOutput fields.
const qualities = {
  hams_or_jahr: ['الهمس والجهر', {hams:'breathy', jahr:'restrained'}],
  shidda_or_rakhawa: ['الشدة والتوسط والرخاوة', {shadeed:'stop',between:'partial',rikhw:'flow'}],
  tafkheem_or_taqeeq: ['التفخيم والترقيق', {mofakham:'heavy',moraqaq:'light',low_mofakham:'lessHeavy'}],
  itbaq: ['الإطباق', {monfateh:'absent',motbaq:'present'}],
  safeer: ['الصفير', {safeer:'present',no_safeer:'absent'}],
  qalqla: ['القلقلة', {moqalqal:'present',not_moqalqal:'absent'}],
  tikraar: ['التكرير', {mokarar:'present',not_mokarar:'absent'}],
  tafashie: ['التفشي', {motafashie:'present',not_motafashie:'absent'}],
  istitala: ['الاستطالة', {mostateel:'present',not_mostateel:'absent'}],
  ghonna: ['الغنة', {maghnoon:'present',not_maghnoon:'absent'}],
};
const explanations = {
  en:'How freely breath escapes during the letter.|How freely the sound flows at the articulation point.|How full or light the letter sounds.|How the tongue rises toward the roof of the mouth.|The narrow whistle of the sibilant letters.|The short release of a still letter of qalqalah.|The delicate vibration at the tip of the tongue in ر.|How the air spreads across the mouth when pronouncing ش.|The extension of the sound along the side of the tongue in ض.|The resonance of the sound through the nose.',
  ar:'جريان النفس أو انحباسه عند النطق بالحرف.|جريان الصوت أو انحباسه عند المخرج.|امتلاء الفم بصدى الحرف أو خفة صوته.|ارتفاع اللسان نحو الحنك الأعلى وانحصار الصوت بينهما.|صوت حاد يصحب حروف الصفير.|اضطراب صوت حرف القلقلة الساكن عند إطلاقه.|ارتعاد طرف اللسان ارتعادًا لطيفًا عند نطق الراء.|انتشار الهواء في الفم عند النطق بالشين.|امتداد صوت الضاد على حافة اللسان.|رنين الصوت في الخيشوم.',
  es:'Flujo del aire al pronunciar la letra.|Paso del sonido en el punto de articulación.|Carácter pleno o ligero del sonido.|Elevación de la lengua hacia el paladar.|Silbido de las consonantes sibilantes.|Breve rebote de la consonante sin vocal.|Vibración suave de la punta de la lengua en ر.|Expansión del aire en la boca al pronunciar ش.|Extensión del sonido a lo largo del lado de la lengua en ض.|Resonancia del sonido en la nariz.',
  fr:'Passage du souffle pendant la consonne.|Écoulement du son au point d’articulation.|Sonorité pleine ou légère de la lettre.|Élévation de la langue vers le palais.|Sifflement des consonnes sifflantes.|Bref rebond de la consonne sans voyelle.|Légère vibration de la pointe de la langue pour ر.|Diffusion de l’air dans la bouche pour ش.|Prolongement du son le long du bord de la langue pour ض.|Résonance du son dans le nez.',
  zh:'发音时气流是否顺畅。|声音在发音部位的通畅程度。|字母声音的厚重或轻薄。|舌面向上腭抬起的程度。|咝音字母发出的哨声。|静符弹音字母释放时的短促回声。|发 ر 时舌尖的轻微振动。|发 ش 时气流在口中的扩散。|发 ض 时声音沿舌侧延伸。|声音在鼻腔中的共鸣。',
  ur:'حرف ادا کرتے وقت سانس کا بہاؤ۔|مخرج پر آواز کے جاری رہنے کی کیفیت۔|حرف کی آواز کا بھاری یا باریک ہونا۔|زبان کا تالو کی طرف اٹھنا۔|حروف صفیر کی سیٹی جیسی آواز۔|ساکن حرف قلقلہ کی ہلکی گونج۔|ر بولتے وقت زبان کی نوک کی ہلکی لرزش۔|ش ادا کرتے وقت منہ میں ہوا کا پھیلنا۔|ض میں آواز کا زبان کے کنارے پر پھیلنا۔|ناک میں آواز کی گونج۔',
  id:'Aliran napas saat mengucapkan huruf.|Aliran suara pada tempat keluarnya huruf.|Tebal atau tipisnya bunyi huruf.|Terangkatnya lidah menuju langit-langit.|Desis pada huruf safir.|Pantulan singkat saat melepas huruf qalqalah yang sukun.|Getaran lembut ujung lidah pada ر.|Menyebarnya udara di mulut saat melafalkan ش.|Memanjangnya bunyi di sisi lidah pada ض.|Resonansi suara dalam rongga hidung.',
  bn:'বর্ণ উচ্চারণের সময় শ্বাসের প্রবাহ।|উচ্চারণস্থানে ধ্বনির প্রবাহ।|বর্ণের ধ্বনি ভারী না হালকা।|তালুর দিকে জিহ্বা ওঠা।|সাফির বর্ণের শিসের মতো ধ্বনি।|সাকিন কলকলার বর্ণ ছাড়ার হালকা প্রতিধ্বনি।|ر উচ্চারণে জিহ্বার ডগার মৃদু কম্পন।|ش উচ্চারণে মুখের মধ্যে বাতাস ছড়িয়ে পড়া।|ض উচ্চারণে জিহ্বার পাশ দিয়ে ধ্বনির বিস্তার।|নাকের ভেতর ধ্বনির অনুরণন।',
  pa:'حرف آکھن ویلے ساہ دا بہاؤ۔|مخرج تے آواز دے جاری رہن دی کیفیت۔|حرف دی آواز دا بھاری یا پتلا ہونا۔|زبان دا تالو ول اٹھنا۔|صفیر دے حرفاں دی سیٹی ورگی آواز۔|ساکن حرف قلقلہ دی ہلکی گونج۔|ر آکھن ویلے زبان دی نوک دی ہلکی لرزش۔|ش آکھن ویلے منہ وچ ہوا دا پھیلنا۔|ض وچ آواز دا زبان دے پاسے نال پھیلنا۔|نک وچ آواز دی گونج۔',
  fa:'جریان نفس هنگام ادای حرف.|میزان جریان صدا در مخرج حرف.|درشتی یا نازکی صدای حرف.|بالا آمدن زبان به سوی کام.|صدای سوت‌مانند حروف صفیر.|بازتاب کوتاه حرف ساکن قلقله.|لرزش ملایم نوک زبان در ادای ر.|پخش شدن هوا در دهان هنگام ادای ش.|امتداد صدای ض در کنارهٔ زبان.|طنین صدا در فضای بینی.',
  tr:'Harfi söylerken nefesin akışı.|Harfin mahrecinde sesin akışı.|Harfin kalın veya ince duyulması.|Dilin damağa doğru yükselmesi.|Safir harflerindeki ıslık sesi.|Sakin kalkale harfinin kısa yankısı.|ر harfinde dil ucunun hafif titreşimi.|ش söylenirken havanın ağızda yayılması.|ض sesinin dil kenarı boyunca uzaması.|Sesin genizde yankılanması.',
  ps:'د توري د ادا کولو پر مهال د ساه بهیر.|په مخرج کې د غږ بهیر.|د توري د غږ دروندوالی یا نریوالی.|د تالو پر لور د ژبې پورته کېدل.|د صفیر د تورو شپېلۍ ته ورته غږ.|د ساکن قلقله توري لنډ غبرګون.|د ر په ادا کې د ژبې د څوکې سپک رپ.|د ش په ادا کې په خوله کې د هوا خپرېدل.|د ض غږ د ژبې په اړخ اوږدېږي.|په پزه کې د غږ انګازه.',
  ha:'Yadda numfashi ke gudana yayin furta harafi.|Yadda sauti ke gudana a mafitar harafi.|Nauyi ko siririn sautin harafi.|Ɗagawar harshe zuwa ganɗa.|Sautin tsawa irin na busa a haruffan safir.|Ƙaramar amsar sauti a harafin ƙalƙala mai sukun.|Ɗan rawar ƙarshen harshe wajen furta ر.|Yaɗuwar iska a baki wajen furta ش.|Tsawon sautin ض a gefen harshe.|Amsar sauti a cikin hanci.',
};
const valueKeys = ['present','absent','breathy','restrained','stop','partial','flow','heavy','light','lessHeavy'];
const valueRows = {
 en:'Present|Absent|Flowing breath|Restrained breath|Stopped sound|Partial flow|Flowing sound|Heavy|Light|Reduced heaviness',
 ar:'موجود|غير موجود|مهموس|مجهور|شديد|متوسط|رخو|مفخم|مرقق|أقل تفخيمًا',
 es:'Presente|Ausente|Aire libre|Aire contenido|Sonido detenido|Flujo parcial|Sonido continuo|Pleno|Ligero|Menos pleno',
 fr:'Présent|Absent|Souffle libre|Souffle retenu|Son bloqué|Écoulement partiel|Son continu|Plein|Léger|Moins plein',
 zh:'有|无|气流通畅|气流受阻|阻断音|半通畅|连续音|厚重|轻薄|较轻的厚音',
 ur:'موجود|غیر موجود|بہتی سانس|رکی سانس|بند آواز|جزوی بہاؤ|جاری آواز|بھاری|باریک|کم بھاری',
 id:'Ada|Tidak ada|Napas mengalir|Napas tertahan|Suara tertahan|Aliran sebagian|Suara mengalir|Tebal|Tipis|Kurang tebal',
 bn:'আছে|নেই|শ্বাস প্রবাহিত|শ্বাস রুদ্ধ|বদ্ধ ধ্বনি|আংশিক প্রবাহ|প্রবাহিত ধ্বনি|ভারী|হালকা|কম ভারী',
 pa:'موجود|موجود نئیں|وگدا ساہ|رکیا ساہ|رکی آواز|ادھورا بہاؤ|وگدی آواز|بھاری|پتلی|گھٹ بھاری',
 fa:'وجود دارد|وجود ندارد|نفس جاری|نفس گرفته|صدای بسته|جریان میانه|صدای جاری|درشت|نازک|درشتی کمتر',
 tr:'Var|Yok|Akan nefes|Tutulan nefes|Tutulan ses|Kısmi akış|Akan ses|Kalın|İnce|Daha az kalın',
 ps:'شته|نشته|روانه ساه|بنده ساه|بند غږ|نیمګړی بهیر|روان غږ|دروند|نری|لږ دروند',
 ha:'Akwai|Babu|Numfashi mai gudana|Numfashi mai katsewa|Sauti mai tsayawa|Gudana kaɗan|Sauti mai gudana|Mai kauri|Siriri|Mai ɗan kauri',
};

export function speechQuality(issue, language) {
  if (!Object.hasOwn(qualities,issue.attribute)) return null;
  const lang = Object.hasOwn(explanations,language) ? language : 'en';
  const [name,values] = qualities[issue.attribute];
  const descriptions = explanations[lang].split('|');
  const labels = valueRows[lang].split('|');
  function label(code) {
    const key = Object.hasOwn(values,code) ? values[code] : null;
    return key ? labels[valueKeys.indexOf(key)] : null;
  }
  return {name,explanation:descriptions[Object.keys(qualities).indexOf(issue.attribute)],
    expected:label(issue.expected),heard:label(issue.heard)};
}
