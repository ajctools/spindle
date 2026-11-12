const PAGE_SIZE = 100;
const MAX_EXCERPT = 4000;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const textFile = /\.(?:txt|md|markdown|csv|tsv|json|jsonl|log)$/i;
const commonWords = new Set('a an about and are can could did do does document file for from how i in is it me of on or please say says summarize summary tell that the this to was what when where which who why with would you'.split(' '));

function indexed(source) {
  return source.finalized === true && Array.isArray(source.entry_ids) && source.entry_ids.length > 0;
}

function sourceOffset(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Choose a valid Vault document page.');
  return value;
}

async function sourcePage(read, offset) {
  const page = await read('/kb/sources/files?' + new URLSearchParams({limit: PAGE_SIZE, offset}));
  if (!Array.isArray(page?.items)) throw new Error('Tiiny did not return a Vault document list.');
  const sources = page.items.filter(source => typeof source?.source_id === 'string' && source.source_id &&
    typeof source.filename === 'string' && source.filename &&
    (indexed(source) || textFile.test(source.filename) || source.chunks?.some?.(chunk => chunk?.preview)));
  const next = offset + page.items.length;
  return {sources, nextOffset: page.items.length && next < page.total ? next : null};
}

export async function vaultDocuments(read, offset) {
  const {sources, nextOffset} = await sourcePage(read, sourceOffset(offset));
  return {documents: sources.map(({source_id, filename}) => ({id: source_id, name: filename.slice(0, 250)})), nextOffset};
}

export async function readVaultText(response) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', {fatal: true});
  let bytes = 0;
  let text = '';
  try {
    if (Number(response.headers.get('content-length')) > MAX_TEXT_BYTES) return '';
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_TEXT_BYTES) return '';
      text += decoder.decode(value, {stream: true});
    }
    text += decoder.decode();
    return text.includes('\0') ? '' : text;
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function documentPassages(text, source) {
  if (!text.trim()) return (Array.isArray(source.chunks) ? source.chunks : [])
    .map(chunk => chunk?.preview).filter(preview => typeof preview === 'string' && preview.trim());

  const passages = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + MAX_EXCERPT);
    const newline = text.lastIndexOf('\n', end - 1);
    if (end < text.length && newline > start + MAX_EXCERPT / 2) end = newline + 1;
    if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    const passage = text.slice(start, end);
    if (passage.trim()) passages.push(passage);
    if (end === text.length) break;
    start = end - 160;
    if (/[\uDC00-\uDFFF]/.test(text[start])) start--;
  }
  return passages;
}

function words(text) {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function matchingPassages(passages, query, terms) {
  const phrase = query.toLowerCase();
  const exact = passages.filter(text => text.toLowerCase().includes(phrase));
  if (exact.length) return exact;
  return passages.filter(text => {
    const vocabulary = new Set(words(text));
    return terms.every(term => vocabulary.has(term));
  });
}

function preview(text) {
  const excerpt = text.slice(0, MAX_EXCERPT).replace(/[\uD800-\uDBFF]$/, '');
  return {text: excerpt, shortened: excerpt.length < text.length};
}

export async function vaultExcerpts(read, body, readFile) {
  const {offset, sourceId, query} = body ?? {};
  if (typeof query !== 'string' || query.length > 500) throw new Error('Enter a Vault search query of up to 500 characters.');
  if (typeof sourceId !== 'string' || !sourceId || sourceId.length > 250) throw new Error('Choose a Vault document.');
  const {sources} = await sourcePage(read, sourceOffset(offset));
  const source = sources.find(item => item.source_id === sourceId);
  if (!source) throw new Error('This Vault document is unavailable. Reopen Attach from Vault to refresh the list.');

  const result = (method, passages, searchUnavailable = false) => ({
    name: source.filename.slice(0, 250), method, excerpts: passages.slice(0, 5).map(preview), searchUnavailable,
  });
  let text = '';
  if (textFile.test(source.filename) && !(source.size_bytes > MAX_TEXT_BYTES)) {
    text = await readFile('/kb/files/' + encodeURIComponent(sourceId)).catch(() => '');
  }
  const passages = documentPassages(text, source);
  const question = query.trim();
  if (!question) return result('browse', passages);

  const terms = [...new Set(words(question).filter(word => !commonWords.has(word)))];
  const matches = terms.length ? matchingPassages(passages, question, terms) : [];
  if (matches.length) return result('keyword', matches);
  if (indexed(source) && terms.length) {
    try {
      const response = await read('/kb/retrieve', {method: 'POST', body: {
        question, fast_mode: true, include_memory_context: false,
      }});
      if (response?.success !== true || !Array.isArray(response.results)) throw new Error('Tiiny did not return Vault excerpts.');
      const ids = new Set(source.entry_ids);
      const selected = new Map();
      for (const hit of response.results) {
        if (!ids.has(hit?.entry_id) || selected.has(hit.entry_id) || typeof hit.lossless_restatement !== 'string' || !hit.lossless_restatement.trim()) continue;
        selected.set(hit.entry_id, hit.lossless_restatement);
        if (selected.size === 5) break;
      }
      if (selected.size) return result('semantic', [...selected.values()]);
    } catch (error) {
      if (!passages.length) throw error;
      return result('browse', passages, true);
    }
  }
  return result('browse', passages);
}

export function validateVaultReference(value) {
  const {name, text, connectionId} = value ?? {};
  if (typeof name !== 'string' || !name.trim() || name.length > 250 ||
      typeof text !== 'string' || !text.trim() || text.length > MAX_EXCERPT ||
      typeof connectionId !== 'string' || !/^[a-f0-9]{20}$/.test(connectionId)) {
    throw new Error('Choose a valid Vault excerpt to attach.');
  }
  return {name, text, connectionId};
}
