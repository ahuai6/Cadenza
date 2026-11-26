const path = require('node:path');
const taglib = require('node-taglib-sharp');
const { TagTypes, Id3v2FrameClassType, Id3v2UnsynchronizedLyricsFrame, StringType, XiphComment, ByteVector } = taglib;
const xiphKeys = ['TTML', 'LYRICS', 'LYRIC', 'UNSYNCEDLYRICS'];

function family(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.mp3') return 'id3';
  if (['.ogg', '.oga', '.opus'].includes(ext)) return 'ogg';
  return null;
}

function entries(handle, kind) {
  if (kind === 'id3') {
    const tag = handle.getTag(TagTypes.Id3v2, false);
    const frames = tag?.getFramesByClassType(Id3v2FrameClassType.UnsynchronizedLyricsFrame) || [];
    const occurrence = new Map();
    return frames.map((frame) => {
      const identity = encodeURIComponent(frame.language + '\0' + frame.description);
      const i = occurrence.get(identity) || 0;
      occurrence.set(identity, i + 1);
      return {
        id: 'id3:' + identity + ':' + i,
        label: 'USLT · ' + frame.language + (frame.description ? ' · ' + frame.description : ''),
        text: frame.text,
        frame,
      };
    });
  }
  const streams = handle.tag?.comments;
  if (!Array.isArray(streams) || streams.length !== 1) throw new Error('unsupported');
  const comments = streams[0];
  return xiphKeys.flatMap((key) =>
    comments.getField(key).map((text, i) => ({
      id: 'ogg:' + key + ':' + i,
      label: key,
      text,
      comments,
      i,
    })),
  );
}

function read(file, kind) {
  const handle = taglib.File.createFromPath(file);
  try {
    return entries(handle, kind).map(({ id, label, text }) => ({ id, label, text }));
  } finally {
    handle.dispose();
  }
}

function exactXiph(original, key, values) {
  const keys = Array.from(new Set([...original.fieldNames, key]));
  const entries = keys.flatMap((name) =>
    (name === key ? values : original.getField(name)).map((value) => Buffer.from(name + '=' + value)),
  );
  const word = (size) => {
    const result = Buffer.alloc(4);
    result.writeUInt32LE(size);
    return result;
  };
  const vendor = Buffer.from(original.vendorId || '');
  const body = Buffer.concat([
    word(vendor.length),
    vendor,
    word(entries.length),
    ...entries.flatMap((entry) => [word(entry.length), entry]),
  ]);
  // The general setter trims strings and drops blanks. Preserve lyrics exactly in the comment packet.
  const comment = XiphComment.fromData(ByteVector.fromByteArray(body), true);
  comment.pictures = original.pictures;
  return comment;
}
function write(file, kind, source, text) {
  const handle = taglib.File.createFromPath(file);
  try {
    const previous = entries(handle, kind);
    const entry = previous.find((item) => item.id === source);
    if (kind === 'id3') {
      const tag = handle.getTag(TagTypes.Id3v2, text !== null);
      if (!tag) throw new Error('unsupported');
      if (entry) {
        if (text === null) tag.removeFrame(entry.frame);
        else {
          entry.frame.text = text;
          entry.frame.textEncoding = StringType.UTF16;
        }
      } else {
        if (source !== 'id3:new' || text === null) throw new Error('unsupported');
        const frame = Id3v2UnsynchronizedLyricsFrame.fromData('Cadenza', 'und', StringType.UTF16);
        frame.text = text;
        tag.addFrame(frame);
      }
    } else {
      const key = entry?.label || (source === 'ogg:new:ttml' ? 'TTML' : source === 'ogg:new:lrc' ? 'LYRICS' : null);
      const comments = handle.tag.comments[0];
      const values = key && comments.getField(key).slice();
      if (!values || (!entry && (values.length || text === null))) throw new Error('unsupported');
      if (entry) {
        if (text === null) values.splice(entry.i, 1);
        else values[entry.i] = text;
      } else values.push(text);
      handle.tag.setComment(handle.tag.serialNumbers[0], exactXiph(comments, key, values));
    }
    const expected = entries(handle, kind).map(({ id, label, text }) => ({ id, label, text }));
    handle.save();
    return expected;
  } finally {
    handle.dispose();
  }
}

module.exports = { family, read, write };
