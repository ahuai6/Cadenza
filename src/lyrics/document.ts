import { parse, parseLyrics } from './parse';
import { ttmlTime } from './ttml';

const TT = 'http://www.w3.org/ns/ttml';
const XML = 'http://www.w3.org/XML/1998/namespace';
const ITUNES = 'http://music.apple.com/lyric-ttml-internal';
const TTM = 'http://www.w3.org/ns/ttml#metadata';
export const emptyTtml =
  '<tt xmlns="' +
  TT +
  '" xmlns:itunes="' +
  ITUNES +
  '"><head/><body><div><p begin="0s" end="3s"></p></div></body></tt>';

export function openTtml(text: string) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.doctype || doc.querySelector('parsererror') || doc.documentElement.localName !== 'tt') return null;
  return doc;
}
function save(doc: Document, original: string) {
  const prefix = original.match(/^\s*(?:<\?xml[^>]*\?>\s*)?/)?.[0] || '';
  const suffix = original.match(/\s*$/)?.[0] || '';
  return prefix + new XMLSerializer().serializeToString(doc) + suffix;
}
const elements = (root: Document | Element, name: string) => Array.from(root.getElementsByTagNameNS('*', name));
const child = (node: Element, name: string) => Array.from(node.children).find((item) => item.localName === name);
const attr = (p: Element, name: string) => Array.from(p.attributes).find((item) => item.localName === name)?.value;
const role = (p: Element) => p.getAttributeNS(TTM, 'role') || attr(p, 'role');

function textSlots(root: Element, body: boolean) {
  const slots: Text[] = [];
  function visit(node: Node) {
    if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
      slots.push(node as Text);
      return;
    }
    if (
      node instanceof Element &&
      body &&
      ['x-bg', 'x-translation', 'x-roman', 'x-reading', 'x-transliteration'].includes(role(node) || '')
    )
      return;
    for (const child of node.childNodes) visit(child);
  }
  visit(root);
  return slots;
}
function paragraphs(doc: Document) {
  const body = child(doc.documentElement, 'body');
  return body ? elements(body, 'p').filter((p) => p.namespaceURI === body.namespaceURI) : [];
}
function editableRows(doc: Document) {
  const paragraphsInBody = paragraphs(doc);
  return [
    ...paragraphsInBody.map((node) => ({ node, kind: 'main' as const, lang: '', owner: null })),
    ...['translation', 'transliteration'].flatMap((kind) =>
      elements(doc, kind).flatMap((track) =>
        Array.from(track.children)
          .filter((node) => node.hasAttribute('for'))
          .map((node) => ({ node, kind, lang: track.getAttributeNS(XML, 'lang') || '', owner: track })),
      ),
    ),
    ...paragraphsInBody.flatMap((p) =>
      elements(p, 'span').flatMap((node) => {
        const value = role(node);
        const kind =
          value === 'x-translation'
            ? 'translation'
            : value === 'x-roman' || value === 'x-reading' || value === 'x-transliteration'
              ? 'transliteration'
              : value === 'x-bg'
                ? 'background'
                : null;
        return kind ? [{ node, kind, lang: node.getAttributeNS(XML, 'lang') || '', owner: null }] : [];
      }),
    ),
  ];
}
export function readableTtml(text: string) {
  const doc = openTtml(text);
  if (!doc) return null;
  return editableRows(doc).map(({ node, kind, lang }) => ({
    kind,
    lang,
    begin: node.getAttribute('begin'),
    end: node.getAttribute('end'),
    label: attr(node, 'key') || node.getAttribute('for'),
    slots: textSlots(node, kind === 'main').map((slot) => ({
      value: slot.data,
      begin: slot.parentElement?.getAttribute('begin'),
      end: slot.parentElement?.getAttribute('end'),
      timing:
        !!slot.parentElement &&
        slot.parentElement !== node &&
        (slot.parentElement.hasAttribute('begin') || slot.parentElement.hasAttribute('end')),
    })),
  }));
}
export function updateTtml(
  text: string,
  row: number,
  change: { slot: number; value: string } | { time: 'begin' | 'end'; value: string; word?: number },
) {
  const doc = openTtml(text);
  if (!doc) return text;
  const item = editableRows(doc)[row];
  const node = item?.node;
  if (!node) return text;
  if ('time' in change) {
    if (change.value !== '' && ttmlTime(change.value) === null) return text;
    const anchor = change.word == null ? node : textSlots(node, item.kind === 'main')[change.word]?.parentElement;
    if (!anchor || (change.word != null && anchor === node)) return text;
    if (change.value) anchor.setAttribute(change.time, change.value);
    else anchor.removeAttribute(change.time);
  } else {
    const slots = textSlots(node, item.kind === 'main');
    if (!slots.length && !node.hasChildNodes() && change.slot === 0) node.append(doc.createTextNode(change.value));
    else if (slots[change.slot]) slots[change.slot].data = change.value;
    else return text;
  }
  return save(doc, text);
}

export function timedTtmlText(text: string) {
  return (
    readableTtml(text)
      ?.filter((row) => row.kind === 'main')
      .map(
        (row) =>
          '[' + (row.begin ?? '') + ' --> ' + (row.end ?? '') + ']' + row.slots.map((slot) => slot.value).join(''),
      )
      .join('\n') ?? ''
  );
}
export function applyTimedTtmlText(original: string, scratch: string) {
  const doc = openTtml(original);
  if (!doc) return null;
  const rows = paragraphs(doc);
  const lines = scratch.split('\n');
  if (rows.length !== lines.length) return null;
  for (const [index, node] of rows.entries()) {
    const match = /^\[([^\]]*) --> ([^\]]*)\](.*)$/s.exec(lines[index]);
    if (!match) return null;
    const [, begin, end, text] = match;
    if ((begin && ttmlTime(begin) === null) || (end && ttmlTime(end) === null)) return null;
    for (const [name, value] of [
      ['begin', begin],
      ['end', end],
    ]) {
      if (value) node.setAttribute(name, value);
      else node.removeAttribute(name);
    }
    const slots = textSlots(node, true);
    const before = slots.map((slot) => slot.data).join('');
    if (before === text) continue;
    if (!slots.length) {
      node.insertBefore(doc.createTextNode(text), node.firstChild);
      continue;
    }
    let prefix = 0;
    while (prefix < Math.min(text.length, before.length) && text[prefix] === before[prefix]) prefix++;
    let suffix = 0;
    while (
      suffix < Math.min(text.length, before.length) - prefix &&
      text[text.length - suffix - 1] === before[before.length - suffix - 1]
    )
      suffix++;
    let start = 0;
    const slot = slots.find((node) => {
      const end = start + node.length;
      if (prefix >= start && before.length - suffix <= end) return true;
      start = end;
      return false;
    });
    // A replacement across timed text nodes has no unique association with existing word anchors.
    if (!slot) return null;
    slot.replaceData(prefix - start, before.length - suffix - prefix, text.slice(prefix, text.length - suffix));
  }
  return save(doc, original);
}
export function replaceTtmlTrack(text: string, kind: string, lang: string, search: string, replacement: string) {
  const doc = openTtml(text);
  if (!doc || !search) return text;
  let changed = false;
  for (const item of editableRows(doc)) {
    if (item.kind !== kind || item.lang !== lang) continue;
    for (const slot of textSlots(item.node, kind === 'main')) {
      if (slot.data.includes(search)) {
        slot.data = slot.data.replaceAll(search, replacement);
        changed = true;
      }
    }
  }
  return changed ? save(doc, text) : text;
}
export function appendTtmlLine(text: string, begin: string) {
  const doc = openTtml(text);
  const last = doc && paragraphs(doc).at(-1);
  const body = doc && child(doc.documentElement, 'body');
  if (!doc || !body || ttmlTime(begin) === null) return text;
  const section =
    last?.parentElement || child(body, 'div') || body.appendChild(doc.createElementNS(body.namespaceURI, 'div'));
  const line = doc.createElementNS(section.namespaceURI, 'p');
  line.setAttribute('begin', begin);
  section.append(line);
  return save(doc, text);
}
export function removeTtmlLanguage(text: string, kind: string, lang: string) {
  const doc = openTtml(text);
  if (!doc || !['translation', 'transliteration'].includes(kind)) return text;
  // Delete a whole language only by matching its explicit track/role and language.
  for (const { node, kind: name, lang: locale } of editableRows(doc)) {
    if (kind === name && lang === locale) node.remove();
  }
  return save(doc, text);
}
export function keepTtmlLanguage(text: string, kind: string, lang: string) {
  const doc = openTtml(text);
  if (!doc) return text;
  for (const row of editableRows(doc)) {
    if (row.kind === kind && row.lang !== lang) row.node.remove();
  }
  return save(doc, text);
}
const normalized = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{Z}\s]/gu, '');
function similarity(a: string, b: string) {
  if (a === b) return 1;
  if (a.length < 5 || b.length < 5) return 0;
  const bigrams = (value: string) => new Set(Array.from({ length: value.length - 1 }, (_, i) => value.slice(i, i + 2)));
  const x = bigrams(a),
    y = bigrams(b);
  return (2 * [...x].filter((gram) => y.has(gram)).length) / (x.size + y.size);
}
export function translationPlan(ttml: string, original: string, auxiliary?: string) {
  const doc = openTtml(ttml);
  const anchors = doc
    ? paragraphs(doc).map((node) => ({
        time: ttmlTime(attr(node, 'begin')),
        text: textSlots(node, true)
          .map((slot) => slot.data)
          .join(''),
      }))
    : [];
  const indices = new Map<string, number[]>();
  anchors.forEach((anchor, index) => {
    const key = normalized(anchor.text);
    if (key) indices.set(key, [...(indices.get(key) || []), index]);
  });
  const lines = (auxiliary === undefined ? parse(original) : parseLyrics(original)).lines;
  if (auxiliary !== undefined) {
    const translations = parseLyrics(auxiliary).lines;
    function uniqueNear(rows: typeof lines, time: number) {
      let low = 0;
      let high = rows.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (rows[mid].t < time - 0.12) low = mid + 1;
        else high = mid;
      }
      return rows[low]?.t <= time + 0.12 && !(rows[low + 1]?.t <= time + 0.12) ? rows[low] : null;
    }
    for (const line of lines) {
      const candidate = uniqueNear(translations, line.t);
      // Several close or simultaneous anchors require manual resolution.
      line.subs = candidate && uniqueNear(lines, candidate.t) === line ? [candidate.text, ...candidate.subs] : [];
    }
  }
  const offsets = lines
    .flatMap((line) => {
      const hits = indices.get(normalized(line.text));
      const time = hits?.length === 1 ? anchors[hits[0]].time : null;
      return time == null ? [] : [time - line.t];
    })
    .sort((a, b) => a - b);
  const offset = offsets[Math.floor(offsets.length / 2)] ?? 0;
  const ordered = new Set<number>();
  let previous = -1;
  const rows = lines
    .filter((line) => line.subs.length)
    .map((line) => {
      const candidates = (indices.get(normalized(line.text)) || [])
        .flatMap((row) => {
          const time = anchors[row].time;
          return time == null || row <= previous || ordered.has(row)
            ? []
            : [{ row, delta: Math.abs(time - line.t - offset) }];
        })
        .sort((a, b) => a.delta - b.delta);
      const best = candidates[0];
      const row =
        best && (candidates.length === 1 ? best.delta <= 6 : best.delta <= 3 && candidates[1].delta - best.delta >= 0.6)
          ? best.row
          : null;
      if (row !== null) {
        ordered.add(row);
        previous = row;
      }
      return { line: line.text, time: line.t, translation: line.subs.join('\n'), row };
    });
  return {
    anchors,
    rows: rows.map((row) => ({
      ...row,
      suggested:
        row.row === null
          ? anchors.flatMap((anchor, i) => {
              const delta = anchor.time === null ? Infinity : Math.abs(anchor.time - row.time - offset);
              return delta <= 5 && similarity(normalized(row.line), normalized(anchor.text)) >= 0.55 ? [i] : [];
            })
          : [],
    })),
  };
}
/** Add absent entries and optionally replace plain text in the requested language track. */
export function addTranslations(
  text: string,
  language: string,
  matches: { row: number | null; translation: string }[],
  kind: 'translation' | 'transliteration' = 'translation',
  replacePlain = false,
) {
  const doc = openTtml(text);
  if (!doc || !/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(language)) return null;
  const root = doc.documentElement;
  const ensure = (parent: Element, name: string, ns: string | null) => {
    const existing = Array.from(parent.children).find(
      (element) => element.namespaceURI === ns && element.localName === name,
    );
    if (existing) return existing;
    const node = doc.createElementNS(ns, name);
    if (name === 'head') parent.prepend(node);
    else parent.append(node);
    return node;
  };
  const head = ensure(root, 'head', root.namespaceURI);
  const metadata = ensure(head, 'iTunesMetadata', ITUNES);
  const translations = ensure(metadata, kind === 'translation' ? 'translations' : 'transliterations', ITUNES);
  const normalizedLanguage = language.toLowerCase();
  let lane = Array.from(translations.children).find(
    (item) => item.localName === kind && item.getAttributeNS(XML, 'lang')?.toLowerCase() === normalizedLanguage,
  );
  if (!lane) {
    lane = doc.createElementNS(ITUNES, kind);
    lane.setAttributeNS(XML, 'xml:lang', language);
    translations.append(lane);
  }
  const body = paragraphs(doc);
  const keyCounts = new Map<string, number>();
  for (const p of body) {
    const key = attr(p, 'key');
    if (key) keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
  }
  const merged = new Map<number, string[]>();
  for (const match of matches) {
    if (match.row === null || !match.translation || !body[match.row]) continue;
    const list = merged.get(match.row) || [];
    if (!list.includes(match.translation)) list.push(match.translation);
    merged.set(match.row, list);
  }
  let added = 0;
  for (const [row, reasons] of merged) {
    const translation = reasons.join('\n');
    const p = body[row];
    const inline = elements(p, 'span').filter(
      (node) =>
        (kind === 'translation'
          ? role(node) === 'x-translation'
          : ['x-roman', 'x-reading', 'x-transliteration'].includes(role(node) || '')) &&
        node.getAttributeNS(XML, 'lang')?.toLowerCase() === normalizedLanguage,
    );
    if (inline.length) {
      const [existing] = inline;
      if (
        inline.length === 1 &&
        replacePlain &&
        !existing.childElementCount &&
        Array.from(existing.childNodes).every((node) => node.nodeType === Node.TEXT_NODE) &&
        existing.textContent !== translation
      ) {
        existing.textContent = translation;
        added++;
      }
      continue;
    }
    let key = attr(p, 'key');
    if (key && keyCounts.get(key)! > 1) continue;
    if (!key) {
      let next = row + 1;
      do {
        key = 'Cadenza-' + next++;
      } while (keyCounts.has(key));
      keyCounts.set(key, 1);
      p.setAttributeNS(ITUNES, 'itunes:key', key);
    }
    const existing = Array.from(lane.children).find((item) => item.getAttribute('for') === key);
    if (existing) {
      if (
        replacePlain &&
        !existing.childElementCount &&
        Array.from(existing.childNodes).every((node) => node.nodeType === Node.TEXT_NODE) &&
        existing.textContent !== translation
      ) {
        existing.textContent = translation;
        added++;
      }
      continue;
    }
    const node = doc.createElementNS(ITUNES, 'text');
    node.setAttribute('for', key);
    node.textContent = translation;
    lane.append(node);
    added++;
  }
  return { text: added ? save(doc, text) : text, added };
}
