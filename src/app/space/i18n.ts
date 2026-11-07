// The space's own words, in Cadenza's six languages (zh-Hant, zh-Hans, en, ja, ko, es). Words the classic settings
// already have are read from Cadenza's dictionary (tx) instead of repeated here.
import { currentLang } from '../../i18n';

const LANGS = ['zh-Hant', 'zh-Hans', 'en', 'ja', 'ko', 'es'] as const;
type Row = readonly [string, string, string, string, string, string];
const W: Record<string, Row> = {
  'mark': ['聖堂', '圣堂', 'Cathedral', '聖堂', '성당', 'Catedral'],
  'room.nave': ['中殿', '中殿', 'Nave', '身廊', '신랑', 'Nave'], 'room.nave.sub': ['專輯', '专辑', 'Albums', 'アルバム', '앨범', 'Álbumes'],
  'room.dome': ['中堂', '中堂', 'Crossing', '交差部', '교차부', 'Crucero'], 'room.dome.sub': ['全部歌曲', '全部歌曲', 'All songs', 'すべての曲', '모든 곡', 'Todas las canciones'],
  'room.lists': ['北禮拜堂', '北礼拜堂', 'North chapel', '北の礼拝堂', '북쪽 예배당', 'Capilla norte'], 'room.lists.sub': ['歌單', '歌单', 'Playlists', 'プレイリスト', '재생목록', 'Listas'],
  'room.altar': ['聖所', '圣所', 'Sanctuary', '聖所', '성소', 'Santuario'], 'room.altar.sub': ['播放中', '播放中', 'Now playing', '再生中', '재생 중', 'Sonando'],
  'room.settings': ['南禮拜堂', '南礼拜堂', 'South chapel', '南の礼拝堂', '남쪽 예배당', 'Capilla sur'], 'room.settings.sub': ['設定', '设置', 'Settings', '設定', '설정', 'Ajustes'],
  'places': ['地點', '地点', 'Places', '場所', '장소', 'Lugares'],
  'canvas': ['Cadenza 聖堂：中殿是專輯，中堂是全部歌曲，兩側禮拜堂是歌單與設定，聖所是播放中', 'Cadenza 圣堂：中殿是专辑，中堂是全部歌曲，两侧礼拜堂是歌单与设置，圣所是播放中', 'The Cadenza cathedral: albums in the nave, every song in the crossing, playlists and settings in the side chapels, what is playing in the sanctuary', 'Cadenza の聖堂：身廊にアルバム、交差部にすべての曲、両側の礼拝堂にプレイリストと設定、聖所に再生中の曲', 'Cadenza 성당: 신랑에는 앨범, 교차부에는 모든 곡, 양쪽 예배당에는 재생목록과 설정, 성소에는 재생 중인 곡', 'La catedral de Cadenza: los álbumes en la nave, todas las canciones en el crucero, listas y ajustes en las capillas, lo que suena en el santuario'],
  'loading': ['正在點亮聖堂…', '正在点亮圣堂…', 'Lighting the cathedral…', '聖堂に灯りをともしています…', '성당에 불을 밝히는 중…', 'Encendiendo la catedral…'],
  'search': ['找歌曲、專輯或歌單', '找歌曲、专辑或歌单', 'Find a song, album or playlist', '曲・アルバム・プレイリストを検索', '곡, 앨범, 재생목록 찾기', 'Busca una canción, álbum o lista'],
  'play': ['播放', '播放', 'Play', '再生', '재생', 'Reproducir'], 'pause': ['暫停', '暂停', 'Pause', '一時停止', '일시정지', 'Pausa'],
  'keep': ['繼續參觀', '继续参观', 'Keep walking', '見学を続ける', '계속 둘러보기', 'Seguir paseando'],
  'nothing': ['尚未播放', '尚未播放', 'Nothing playing', '再生していません', '재생 중인 곡 없음', 'Nada sonando'],
  'phones.on': ['已戴耳機', '已戴耳机', 'Headphones on', 'ヘッドホン着用', '헤드폰 착용', 'Con auriculares'], 'phones.off': ['已摘下耳機', '已摘下耳机', 'Headphones off', 'ヘッドホンを外した', '헤드폰 벗음', 'Sin auriculares'],
  'phones.onHelp': ['點一下摘下耳機，聽房間裡的聲音', '点一下摘下耳机，听房间里的声音', 'Take them off to hear the song in the room', '外すと部屋の響きで聴けます', '벗으면 방 안의 소리로 들립니다', 'Quítatelos para oír la canción en la sala'],
  'phones.offHelp': ['點一下戴回耳機', '点一下戴回耳机', 'Put them back on', 'もう一度着ける', '다시 쓰기', 'Vuelve a ponértelos'],
  'toAltar': ['聖所 →', '圣所 →', 'Sanctuary →', '聖所 →', '성소 →', 'Santuario →'],
  'settings': ['設定', '设置', 'Settings', '設定', '설정', 'Ajustes'], 'close': ['關閉', '关闭', 'Close', '閉じる', '닫기', 'Cerrar'],
  'tip.sit': ['坐下', '坐下', 'Sit down', '座る', '앉기', 'Sentarse'], 'tip.sitSub': ['從這裡看', '从这里看', 'See from here', 'ここから眺める', '여기서 보기', 'Mirar desde aquí'],
  'tip.again': ['再點一下播放', '再点一下播放', 'Click again to play', 'もう一度クリックで再生', '한 번 더 누르면 재생', 'Haz clic otra vez para reproducir'],
  'tip.settings': ['打開設定', '打开设置', 'Open settings', '設定を開く', '설정 열기', 'Abrir ajustes'],
  'kind.album': ['專輯', '专辑', 'Album', 'アルバム', '앨범', 'Álbum'], 'kind.song': ['歌曲', '歌曲', 'Song', '曲', '곡', 'Canción'], 'kind.list': ['歌單', '歌单', 'Playlist', 'プレイリスト', '재생목록', 'Lista'],
  'tier': ['第 {n} 層', '第 {n} 层', 'Tier {n}', '{n} 段目', '{n}층', 'Nivel {n}'],
  'favorites': ['我的最愛', '我的最爱', 'Favourites', 'お気に入り', '즐겨찾기', 'Favoritas'], 'songs': ['{n} 首', '{n} 首', '{n} songs', '{n} 曲', '{n}곡', '{n} canciones'],
  'hifi.eye': ['聲音 · Hi-Fi', '声音 · Hi-Fi', 'Sound · Hi-Fi', 'サウンド · Hi-Fi', '사운드 · Hi-Fi', 'Sonido · Hi-Fi'],
  'hifi.title': ['Hi-Fi 輸出時只能用耳機聽', 'Hi-Fi 输出时只能用耳机听', 'With Hi-Fi output, headphones only', 'Hi-Fi 出力中はヘッドホンのみ', 'Hi-Fi 출력 중에는 헤드폰만', 'Con salida Hi-Fi, solo auriculares'],
  'hifi.body': ['Hi-Fi 輸出直接送到音效卡、不經過場景，所以房間音響無法使用。要改用標準輸出嗎？', 'Hi-Fi 输出直接送到声卡、不经过场景，所以房间音响无法使用。要改用标准输出吗？', 'The Hi-Fi output goes straight to the sound card, past the scene, so the room cannot play it. Switch to the standard output?', 'Hi-Fi 出力はシーンを通らず直接サウンドカードへ送られるため、部屋の響きは使えません。標準出力に切り替えますか？', 'Hi-Fi 출력은 장면을 거치지 않고 사운드 카드로 바로 가므로 방 안의 소리를 쓸 수 없습니다. 표준 출력으로 바꿀까요?', 'La salida Hi-Fi va directa a la tarjeta de sonido, sin pasar por la escena, así que la sala no puede sonar. ¿Cambiar a la salida estándar?'],
  'hifi.use': ['改用標準輸出', '改用标准输出', 'Use standard output', '標準出力にする', '표준 출력 사용', 'Usar salida estándar'],
  // the settings page
  's.title': ['聖堂設定', '圣堂设置', 'Cathedral settings', '聖堂の設定', '성당 설정', 'Ajustes de la catedral'],
  'g.guide': ['操作與導覽', '操作与导览', 'Moving around', '操作と案内', '조작과 안내', 'Moverse'],
  'g.light': ['光與畫面', '光与画面', 'Light and picture', '光と画面', '빛과 화면', 'Luz e imagen'],
  'g.audio': ['聲音', '声音', 'Sound', 'サウンド', '사운드', 'Sonido'],
  'g.lyrics': ['歌詞', '歌词', 'Lyrics', '歌詞', '가사', 'Letras'],
  'g.look': ['介面與語言', '界面与语言', 'Interface and language', 'インターフェースと言語', '인터페이스와 언어', 'Interfaz e idioma'],
  'g.library': ['音樂庫', '音乐库', 'Library', 'ライブラリ', '보관함', 'Biblioteca'],
  'k.look': ['按住右鍵拖曳：環顧', '按住右键拖动：环顾', 'Hold the right button and drag: look around', '右ボタンを押したままドラッグ：見回す', '오른쪽 버튼을 누른 채 드래그: 둘러보기', 'Mantén el botón derecho y arrastra: mirar'],
  'k.walk': ['WASD：行走　E／Q：升降', 'WASD：行走　E／Q：升降', 'WASD: walk · E / Q: rise and sink', 'WASD：歩く　E／Q：上下', 'WASD: 걷기 · E / Q: 오르내리기', 'WASD: caminar · E / Q: subir y bajar'],
  'k.wall': ['中堂：滾輪或 PageUp／PageDown 滑動歌曲牆', '中堂：滚轮或 PageUp／PageDown 滑动歌曲墙', 'Crossing: wheel or PageUp / PageDown turns the wall of songs', '交差部：ホイールか PageUp／PageDown で曲の壁を回す', '교차부: 휠이나 PageUp / PageDown으로 곡의 벽 넘기기', 'Crucero: rueda o RePág / AvPág para el muro de canciones'],
  'k.pages': ['中殿、北禮拜堂：PageUp／PageDown 翻頁', '中殿、北礼拜堂：PageUp／PageDown 翻页', 'Nave and north chapel: PageUp / PageDown turns the page', '身廊・北の礼拝堂：PageUp／PageDown でページ送り', '신랑·북쪽 예배당: PageUp / PageDown으로 페이지 넘기기', 'Nave y capilla norte: RePág / AvPág pasa de página'],
  'k.sit': ['點沙發坐下　R：回到站立高度', '点沙发坐下　R：回到站立高度', 'Click a sofa to sit · R: stand up again', 'ソファをクリックで座る　R：立ち上がる', '소파를 누르면 앉기 · R: 다시 서기', 'Clic en un sofá para sentarte · R: levantarte'],
  'k.keys': ['空白鍵：播放／暫停　/：搜尋　,：設定', '空格键：播放／暂停　/：搜索　,：设置', 'Space: play / pause · /: search · ,: settings', 'スペース：再生／一時停止　/：検索　,：設定', '스페이스: 재생 / 일시정지 · /: 검색 · ,: 설정', 'Espacio: reproducir / pausa · /: buscar · ,: ajustes'],
  'immersive': ['沉浸模式', '沉浸模式', 'Immersive mode', '没入モード', '몰입 모드', 'Modo inmersivo'],
  'immersive.help': ['點畫面鎖定視角，用準星點選；Alt 放開鼠標，空白／Shift 升降', '点画面锁定视角，用准星点选；Alt 放开鼠标，空格／Shift 升降', 'Click the picture to lock the view and pick with the reticle; Alt lets the pointer go, Space / Shift rise and sink', '画面をクリックで視点を固定し、照準で選ぶ。Alt でマウスを解放、スペース／Shift で上下', '화면을 누르면 시점이 고정되고 조준점으로 고릅니다. Alt로 마우스 해제, 스페이스 / Shift로 오르내리기', 'Haz clic en la imagen para fijar la vista y elegir con la mira; Alt suelta el puntero, Espacio / Mayús suben y bajan'],
  'follow': ['跟隨歌詞', '跟随歌词', 'Follow the lyrics', '歌詞を追う', '가사 따라가기', 'Seguir la letra'],
  'follow.help': ['新的一句出現時，視角輕輕轉過去', '新的一句出现时，视角轻轻转过去', 'The view turns gently to each new line', '新しい行が現れると視点がそっと向く', '새 줄이 나타나면 시점이 살며시 돌아갑니다', 'La vista gira suavemente hacia cada verso nuevo'],
  'walk': ['步行速度', '步行速度', 'Walking speed', '歩く速さ', '걷는 속도', 'Velocidad al caminar'], 'lookSpeed': ['視角靈敏度', '视角灵敏度', 'Look sensitivity', '視点の感度', '시점 감도', 'Sensibilidad de la vista'],
  'reduced': ['減少動態', '减少动态', 'Reduce motion', '動きを減らす', '움직임 줄이기', 'Reducir movimiento'],
  'reduced.help': ['移動改為淡入淡出，光點、光束與場景不再隨節奏變化', '移动改为淡入淡出，光点、光束与场景不再随节奏变化', 'Moves become fades; motes, beams and the room stop answering the rhythm', '移動はフェードに。光の粒・光線・空間はリズムに反応しなくなる', '이동은 페이드로 바뀌고 빛 알갱이·빛줄기·공간이 리듬에 반응하지 않습니다', 'Los desplazamientos se vuelven fundidos; motas, haces y la sala dejan de seguir el ritmo'],
  'beams': ['光束', '光束', 'Light beams', '光線', '빛줄기', 'Haces de luz'],
  'beatBeams': ['重音時光束加亮', '重音时光束加亮', 'Beams brighten on accents', 'アクセントで光線が明るく', '강세에 빛줄기 밝아짐', 'Los haces brillan en los acentos'],
  'pulse': ['場景隨節拍輕微明暗', '场景随节拍轻微明暗', 'The room breathes with the beat', '空間が拍に合わせてわずかに明滅', '공간이 박자에 맞춰 살짝 밝아짐', 'La sala respira con el pulso'],
  'pulse.help': ['亮度變化最多 4%，遠低於光敏性癲癇以 10% 計的閃光', '亮度变化最多 4%，远低于光敏性癫痫以 10% 计的闪光', 'At most 4 % brighter, well under the 10 % a flash counts as for photosensitivity', '明るさの変化は最大 4%。光過敏の目安（10%）を大きく下回ります', '밝기 변화는 최대 4%로, 광과민성 기준인 10%보다 훨씬 낮습니다', 'Como mucho un 4 % más de brillo, muy por debajo del 10 % que cuenta como destello'],
  'tint': ['色調', '色调', 'Colour', '色調', '색조', 'Color'], 'tint.cover': ['跟隨封面', '跟随封面', 'From the cover', 'ジャケットに合わせる', '표지 색 따르기', 'Según la portada'], 'tint.fixed': ['固定色彩', '固定色彩', 'Fixed colour', '固定色', '고정 색', 'Color fijo'],
  'tint.help': ['整個空間的氛圍跟著播放中歌曲的封面變色，連光束和光點也一起', '整个空间的氛围跟着播放中歌曲的封面变色，连光束和光点也一起', 'The whole room takes the playing song\'s cover colour, beams and motes too', '空間全体が再生中の曲のジャケットの色に染まる。光線や光の粒も', '공간 전체가 재생 중인 곡의 표지 색으로 물듭니다. 빛줄기와 빛 알갱이까지', 'Toda la sala toma el color de la portada, haces y motas incluidos'],
  'tint.pick': ['選擇顏色', '选择颜色', 'Pick a colour', '色を選ぶ', '색 고르기', 'Elegir color'],
  'dream': ['夢境（曝光、霧氣、光暈）', '梦境（曝光、雾气、光晕）', 'Dream (exposure, haze, glow)', '夢（露出・霧・光暈）', '꿈 (노출·안개·빛번짐)', 'Sueño (exposición, bruma, halo)'],
  'line': ['墨線', '墨线', 'Ink lines', '墨線', '먹선', 'Líneas de tinta'], 'line.thin': ['細', '细', 'Thin', '細い', '가늘게', 'Finas'], 'line.mid': ['中', '中', 'Medium', '中', '보통', 'Medias'], 'line.bold': ['粗', '粗', 'Bold', '太い', '굵게', 'Gruesas'],
  'shadow': ['陰影品質', '阴影品质', 'Shadow quality', '影の品質', '그림자 품질', 'Calidad de sombras'], 'q.high': ['高', '高', 'High', '高', '높음', 'Alta'], 'q.mid': ['中', '中', 'Medium', '中', '보통', 'Media'], 'q.low': ['低', '低', 'Low', '低', '낮음', 'Baja'],
  'ambient': ['背景音樂', '背景音乐', 'Background music', 'BGM', '배경 음악', 'Música de fondo'],
  'ambient.help': ['沒有歌在播時，從中堂的水池淡入', '没有歌在播时，从中堂的水池淡入', 'Fades in from the crossing\'s pool when no song plays', '曲が流れていないとき、交差部の水盤から聞こえてくる', '곡이 없을 때 교차부의 연못에서 들려옵니다', 'Entra desde el estanque del crucero cuando no suena nada'],
  'ambientVol': ['背景音量', '背景音量', 'Background volume', 'BGM の音量', '배경 음량', 'Volumen de fondo'],
  'lyricSize': ['聖所歌詞大小', '圣所歌词大小', 'Lyric size in the sanctuary', '聖所の歌詞の大きさ', '성소 가사 크기', 'Tamaño de la letra en el santuario'],
  'size.s': ['小', '小', 'Small', '小', '작게', 'Pequeña'], 'size.m': ['中', '中', 'Medium', '中', '보통', 'Mediana'], 'size.l': ['大', '大', 'Large', '大', '크게', 'Grande'],
};

/** A space word in the interface's language (English where a language lacks it), with {n}-style values filled in. */
export function ts(key: string, vars?: Record<string, string | number>): string {
  const row = W[key]; if (!row) return key;
  const k = LANGS.indexOf(currentLang() as (typeof LANGS)[number]), w = row[k < 0 ? 2 : k] || row[2];
  return vars ? w.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')) : w;
}
export const SPACE_WORDS = W;
