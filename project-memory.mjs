import path from 'node:path';
import fs from 'node:fs/promises';
import {randomUUID, createHash} from 'node:crypto';

export const BRIEF_LIMIT = 2800;
const MATCH_LIMIT = 2;
const CONTEXT_LIMIT = 3200;
const MAX_VECTOR_SIZE = 4096;
const STOP = new Set('a an and are as at be but by can could did do does for from get had has have how i in is it its me my of on or our please should so than that the their them there these they this those to use was we were what when where which who why will with would you your'.split(' '));

function terms(text) {
  return new Set((text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}+#]*/gu) ?? [])
    .filter(word => word.length > 1 && !STOP.has(word)));
}

function label(value, limit) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, limit) : '';
}

function initialBrief(result) {
  result = result.trim();
  if (result.length <= BRIEF_LIMIT) return result;
  const excerpt = result.slice(0, BRIEF_LIMIT - 1);
  const end = excerpt.lastIndexOf('\n\n');
  return (end > BRIEF_LIMIT / 2 ? excerpt.slice(0, end) : excerpt).trimEnd() + '…';
}

export function checkpointSources(sources) {
  return (Array.isArray(sources) ? sources : []).slice(0, 12).flatMap(source => {
    try {
      const url = new URL(source.url);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 2048) return [];
      return [{title: label(source.title, 240) || url.hostname, url: url.href}];
    } catch { return []; }
  });
}

export function memoryContext(matches) {
  let remaining = CONTEXT_LIMIT;
  return matches.flatMap(({checkpoint, mode}) => {
    const text = mode === 'result' ? checkpoint.result : checkpoint.brief.slice(0, remaining);
    remaining -= text.length;
    return text ? [{title: checkpoint.title, text}] : [];
  });
}

export function normalizeVector(values) {
  if (!Array.isArray(values) || !values.length || values.length > MAX_VECTOR_SIZE || !values.every(Number.isFinite)) return null;
  const norm = Math.hypot(...values);
  return norm > 0 && Number.isFinite(norm) ? Float32Array.from(values, value => value / norm) : null;
}

function similarity(left, right) {
  if (!left || !right || left.length !== right.length) return 0;
  let score = 0;
  for (let i = 0; i < left.length; i++) score += left[i] * right[i];
  return score;
}

export function rankCheckpoints(checkpoints, prompt, queryVector, vectors = new Map()) {
  const query = terms(prompt);
  if (!query.size) return [];
  return checkpoints.map(checkpoint => {
    const title = terms(checkpoint.title);
    const brief = terms(checkpoint.brief);
    const common = [...query].filter(word => title.has(word) || brief.has(word));
    const lexical = common.length / query.size;
    const exact = (common.length >= 2 && lexical >= 0.35) ||
      (common.length === 1 && (/\d{3}|[a-z]\d+[a-z]/i.test(common[0]) || query.size === 1 && title.has(common[0])));
    const semantic = similarity(queryVector, vectors.get(checkpoint.id));
    return {checkpoint, score: Math.max(exact ? lexical + 0.15 : 0, semantic >= 0.78 ? semantic : 0)};
  }).filter(match => match.score > 0).sort((a, b) => b.score - a.score)
    .slice(0, MATCH_LIMIT).map(({checkpoint}) => ({checkpoint, mode: 'brief'}));
}

export function embeddingRows(response, count) {
  const rows = response?.data;
  if (!Array.isArray(rows) || rows.length !== count) return null;
  const ordered = Array(count).fill(null);
  for (const [position, row] of rows.entries()) {
    const index = row?.index ?? position;
    if (!Number.isInteger(index) || index < 0 || index >= count || ordered[index]) return null;
    ordered[index] = normalizeVector(row?.embedding);
    if (!ordered[index]) return null;
  }
  return ordered.every(row => row.length === ordered[0].length) ? ordered : null;
}

export function createProjectMemory({directory, readJSON, writeJSON}) {
  let opening, mutations = Promise.resolve();
  const open = () => opening ??= (async () => {
    const flatProjects = await readJSON('projects.json', null);
    const sqlite = await import('node:sqlite').catch(error => {
      if (error.code !== 'ERR_UNKNOWN_BUILTIN_MODULE') throw error;
    });
    const filename = path.join(directory, 'projects.sqlite');
    if (flatProjects || !sqlite) {
      if (!flatProjects && await fs.stat(filename).then(() => true, error => {
        if (error.code !== 'ENOENT') throw error;
        return false;
      })) throw Error('Reopen your projects with Node 22.13 or newer.');
      const projects = flatProjects ?? [];
      const vectors = await readJSON('project-vectors.json', {});
      return {
        list: () => projects.map(summary),
        byId: id => projects.find(project => project.id === id),
        write: async project => {
          const next = [...projects.filter(item => item.id !== project.id), project];
          await writeJSON('projects.json', next);
          projects.splice(0, projects.length, ...next);
        },
        writeVectors: async entries => {
          const next = {...vectors};
          for (const [id, key, vector] of entries) next[id] = {key, vector: [...vector]};
          await writeJSON('project-vectors.json', next);
          Object.assign(vectors, next);
        },
        readEntry: (id, key) => vectors[id]?.key === key ? Float32Array.from(vectors[id].vector) : null,
        deleteVector: async id => {
          if (!Object.hasOwn(vectors, id)) return;
          const next = {...vectors};
          delete next[id];
          await writeJSON('project-vectors.json', next);
          delete vectors[id];
        },
      };
    }
    await fs.appendFile(filename, '', {mode: 0o600});
    if (process.platform !== 'win32') await fs.chmod(filename, 0o600);
    const db = new sqlite.DatabaseSync(filename);
    db.exec(`PRAGMA secure_delete=ON;
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS vectors (id TEXT PRIMARY KEY, cache_key TEXT NOT NULL, value BLOB NOT NULL)`);
    const list = db.prepare("SELECT id, data ->> '$.name' AS name, json_array_length(data, '$.checkpoints') AS count FROM projects ORDER BY rowid");
    const get = db.prepare('SELECT data FROM projects WHERE id=?');
    const write = db.prepare('INSERT INTO projects VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data');
    const readVector = db.prepare('SELECT value FROM vectors WHERE id=? AND cache_key=?');
    const writeVector = db.prepare('INSERT INTO vectors VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET cache_key=excluded.cache_key, value=excluded.value');
    const del = db.prepare('DELETE FROM vectors WHERE id=?');
    return {
      list: () => list.all(),
      byId: id => {
        const row = get.get(id);
        return row && JSON.parse(row.data);
      },
      write: project => write.run(project.id, JSON.stringify(project)),
      readEntry: (id, key) => {
        const blob = readVector.get(id, key)?.value;
        return blob ? new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength)) : null;
      },
      writeVectors: entries => {
        db.exec('BEGIN');
        try {
          for (const [id, key, vector] of entries) writeVector.run(id, key, Buffer.from(vector.buffer));
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      },
      deleteVector: id => del.run(id),
    };
  })();
  const mutate = fn => {
    const done = mutations.then(async () => fn(await open()));
    mutations = done.catch(() => {});
    return done;
  };
  const find = (store, id) => {
    const project = store.byId(id);
    if (!project) throw Error('Choose an existing project.');
    return project;
  };
  const summary = ({id, name, checkpoints}) => ({id, name, count: checkpoints.length});
  const cacheKey = (model, checkpoint) => createHash('sha256').update(JSON.stringify([model, checkpoint.title, checkpoint.brief])).digest('hex');

  return {
    async list() { return (await open()).list(); },
    async get(id) { return find(await open(), id); },
    create(name) {
      return mutate(async store => {
        name = label(name, 120);
        if (!name) throw Error('Enter a project name.');
        if (store.list().some(project => project.name.toLowerCase() === name.toLowerCase())) throw Error('A project already has that name.');
        const project = {id: randomUUID(), name, checkpoints: []};
        await store.write(project);
        return summary(project);
      });
    },
    save(projectId, source) {
      return mutate(async store => {
        const project = find(store, projectId);
        const existing = project.checkpoints.find(checkpoint => source.runId && checkpoint.runId === source.runId);
        if (existing) return existing;
        const result = source.result;
        const brief = initialBrief(result);
        const title = label(source.title, 100) || label(brief, 100);
        const checkpoint = {...source, title, brief, id: randomUUID(), savedAt: new Date().toISOString()};
        await store.write({...project, checkpoints: [checkpoint, ...project.checkpoints]});
        return checkpoint;
      });
    },
    edit(projectId, id, fields) {
      return mutate(async store => {
        const project = find(store, projectId);
        const checkpoint = project.checkpoints.find(item => item.id === id);
        if (!checkpoint) throw Error('Checkpoint is unavailable.');
        const title = label(fields.title, 100);
        const brief = typeof fields.brief === 'string' ? fields.brief.trim() : '';
        if (!title || !brief || brief.length > BRIEF_LIMIT) throw Error('Enter a title and a brief up to '+BRIEF_LIMIT+' characters.');
        const updated = {...checkpoint, title, brief};
        await store.deleteVector(id);
        await store.write({...project, checkpoints: project.checkpoints.map(item => item.id === id ? updated : item)});
        return updated;
      });
    },
    remove(projectId, id) {
      return mutate(async store => {
        const project = find(store, projectId);
        await store.deleteVector(id);
        await store.write({...project, checkpoints: project.checkpoints.filter(item => item.id !== id)});
        return {ok:true};
      });
    },
    import(bundle) {
      return mutate(async store => {
        const name = label(bundle?.name, 120);
        if (bundle?.format !== 'spindle-project' || bundle.version !== 1 || !name || !Array.isArray(bundle.checkpoints) || bundle.checkpoints.length > 2000) throw Error('Choose a valid Spindle project export.');
        if (store.list().some(project => project.name.toLowerCase() === name.toLowerCase())) throw Error('A project already has that name. Rename the exported project before importing it.');
        const checkpoints = bundle.checkpoints.map(item => {
          const title = label(item?.title, 100);
          const {brief, result, savedAt} = item ?? {};
          if (!title || typeof brief !== 'string' || !brief.trim() || brief.length > BRIEF_LIMIT || typeof result !== 'string' || !result.trim()) throw Error('The export contains an invalid checkpoint.');
          return {id: randomUUID(), title, brief, result, sources: checkpointSources(item.sources),
            savedAt: typeof savedAt === 'string' && Number.isFinite(Date.parse(savedAt)) ? new Date(savedAt).toISOString() : new Date().toISOString()};
        });
        const project = {id: randomUUID(), name, checkpoints};
        await store.write(project);
        return summary(project);
      });
    },
    async recall({projectId, checkpointId, mode, exclude = [], prompt, model, embed}) {
      const store = await open();
      const project = find(store, projectId);
      if (checkpointId) {
        const checkpoint = project.checkpoints.find(item => item.id === checkpointId);
        return checkpoint ? [{checkpoint, mode}] : [];
      }
      const checkpoints = project.checkpoints.filter(item => !exclude.includes(item.id));
      if (!model || !checkpoints.length || !terms(prompt).size) return rankCheckpoints(checkpoints, prompt);
      const keys = new Map(checkpoints.map(item => [item.id, cacheKey(model, item)]));
      const vectors = new Map(checkpoints.map(item => [item.id, store.readEntry(item.id, keys.get(item.id))]));
      // Keep one turn's device work bounded. Later turns fill the remaining cache.
      const missing = checkpoints.filter(item => !vectors.get(item.id)).slice(0, 8);
      const rows = await embed([prompt.slice(0, BRIEF_LIMIT), ...missing.map(item => `${item.title}\n${item.brief}`)]);
      if (rows) await mutate(async current => {
        const live = new Map(find(current, projectId).checkpoints.map(item => [item.id, item]));
        const entries = missing.flatMap((item, i) => {
          const currentItem = live.get(item.id);
          if (!currentItem || cacheKey(model, currentItem) !== keys.get(item.id)) return [];
          const vector = rows[i + 1];
          if (vector?.length !== rows[0]?.length) return [];
          vectors.set(item.id, vector);
          return [[item.id, keys.get(item.id), vector]];
        });
        if (entries.length) await current.writeVectors(entries);
      });
      const current = find(store, projectId).checkpoints.filter(item => !exclude.includes(item.id));
      for (const item of current) if (cacheKey(model, item) !== keys.get(item.id)) vectors.delete(item.id);
      return rankCheckpoints(current, prompt, rows?.[0], vectors);
    },
  };
}
