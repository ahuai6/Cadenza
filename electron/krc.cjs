const { deflateSync, inflateSync } = require('node:zlib');
const maxDecoded = 8 * 1024 * 1024;
const magic = Buffer.from('krc1');
const mask = Buffer.from('404761775e3274475136312dced26e69', 'hex');

function transform(bytes) {
  return bytes.map((value, index) => value ^ mask[index % mask.length]);
}

function isKrc(bytes) {
  return bytes.subarray(0, magic.length).equals(magic);
}

function decodeKrc(bytes, maxOutputLength = maxDecoded) {
  if (!isKrc(bytes)) throw new Error('invalid KRC');
  return inflateSync(transform(bytes.subarray(magic.length)), { maxOutputLength }).toString('utf8');
}

function encodeKrc(text) {
  return Buffer.concat([magic, transform(deflateSync(Buffer.from(text, 'utf8')))]);
}

module.exports = { isKrc, decodeKrc, encodeKrc };
