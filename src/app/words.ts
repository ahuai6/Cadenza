// Words the Cadenza interface adds to the shared dictionary: [zh-Hant, zh-Hans, en, ja, ko, es].
import { add } from '../i18n';
add({
  'edit.mode': ['編輯模式', '编辑模式', 'Edit mode', '編集モード', '편집 모드', 'Modo de edición'],
  'edit.required': ['啟用編輯模式即可修改。', '开启编辑模式即可修改。', 'Turn on Edit mode to make changes.'],
  'edit.draftKept': [
    '草稿已保留在目前的工作階段。',
    '草稿已保留在本次会话。',
    'Your drafts are kept for this session.',
  ],
  'edit.failed': [
    '尚未切換編輯模式，請重試。',
    '编辑模式尚未切换，请重试。',
    'Edit mode did not change. Please try again.',
  ],
  'edit.saving': [
    '正在儲存，請稍後再關閉編輯模式。',
    '正在保存，请稍后再关闭编辑模式。',
    'An edit is saving. Try again when it finishes.',
  ],
  'edit.saveFailed': [
    '未能儲存變更，請重試。',
    '未能保存修改，请重试。',
    'The changes could not be saved. Please try again.',
  ],
  'edit.discard': ['放棄草稿', '放弃草稿', 'Discard draft'],

  'p.amount': ['數量', '数量', 'Amount', '量', '양', 'Cantidad'],
  'p.contrast': ['對比', '对比', 'Contrast', 'コントラスト', '대비', 'Contraste'],
  'np.queue': ['播放佇列', '播放队列', 'Queue', '再生キュー', '재생 대기열', 'Cola'],
  'np.loadingTrack': [
    '正在載入歌曲…',
    '正在加载歌曲…',
    'Loading track…',
    '曲を読み込み中…',
    '곡을 불러오는 중…',
    'Cargando pista…',
  ],
  's.album.timeline': ['節拍線', '节拍线', 'Beat line', 'ビートライン', '박자선', 'Línea de ritmo'],
});
