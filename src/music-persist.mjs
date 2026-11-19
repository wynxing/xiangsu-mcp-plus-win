// Read-only evidence that a saved project still has one Douyin track.
// effect.dyehpj soundID is the saved id. Assets/main.scene must contain one
// object named 抖音音乐 with an AudioComponent. MusicInfo.json for that id
// must be a regular file inside the project. Nothing here writes or saves.
import fs from 'node:fs';
import path from 'node:path';

function scalarName(line) {
  const match = line.match(/^\s*name:\s*(.*)$/);
  if (!match) return null;
  let value = match[1].replace(/^!<str>\s*/, '').trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  return value;
}

function documents(text) {
  return String(text).split(/^---\s+/m).map((part) => {
    const lines = part.split(/\r?\n/);
    const head = lines[0] || '';
    const tag = head.match(/^(!\S+)\s+&(\d+)/);
    return {
      tag: tag ? tag[1].slice(1) : null,
      id: tag ? tag[2] : null,
      body: (tag ? lines.slice(1) : lines).join('\n'),
    };
  });
}

function inlineDouyinAudioCount(body) {
  const lines = body.split(/\r?\n/);
  let count = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (!/__class:\s*Entity\b/.test(lines[i])) continue;
    const indent = lines[i].match(/^\s*/)[0].length;
    const chunk = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j];
      if (line.trim() && line.match(/^\s*/)[0].length <= indent && /__class:\s*Entity\b/.test(line)) break;
      chunk.push(line);
    }
    const nameLine = chunk.find((line) => line.match(/^\s*/)[0].length === indent + 2 && /^\s*name:/.test(line));
    const name = nameLine ? scalarName(nameLine) : null;
    if (name === '抖音音乐' && /__class:\s*AudioComponent\b/.test(chunk.join('\n'))) count += 1;
  }
  return count;
}

export function officialDouyinAudioCount(value) {
  let count = 0;
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node.name === '抖音音乐' && Array.isArray(node.componentTypes) && node.componentTypes.includes('AudioComponent')) count += 1;
    Object.values(node).forEach(visit);
  };
  visit(value);
  return count;
}

export function sceneDouyinAudioCount(text) {
  const docs = documents(text);
  const byId = new Map(docs.filter((doc) => doc.id).map((doc) => [doc.id, doc]));
  let count = 0;
  for (const doc of docs) {
    if (doc.tag !== 'Entity') {
      count += inlineDouyinAudioCount(doc.body);
      continue;
    }
    const nameLine = doc.body.split(/\r?\n/).find((line) => /^\s*name:/.test(line));
    if (scalarName(nameLine || '') !== '抖音音乐') continue;
    const linked = [...doc.body.matchAll(/localId:\s*(\d+)/g)].some((match) => byId.get(match[1])?.tag === 'AudioComponent');
    if (linked || /__class:\s*AudioComponent\b/.test(doc.body)) count += 1;
  }
  return count;
}

function contained(root, target) {
  const realRoot = fs.realpathSync(root);
  const realTarget = fs.realpathSync(target);
  const rel = path.relative(realRoot, realTarget);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function failed(reason, extra = {}) {
  return {
    ok: false,
    reason,
    imported: false,
    sound_id: extra.sound_id ?? null,
    scene_objects: extra.scene_objects ?? null,
  };
}

export function assessSavedMusic(projectPath, expected) {
  const dyePath = path.join(projectPath, 'effect.dyehpj');
  let dyeStat;
  try {
    dyeStat = fs.lstatSync(dyePath);
  } catch {
    return failed('DYEHPJ_UNREADABLE');
  }
  if (dyeStat.isSymbolicLink()) return failed('DYEHPJ_UNREADABLE');
  let dye;
  try {
    if (!contained(projectPath, dyePath)) return failed('DYEHPJ_UNREADABLE');
    dye = JSON.parse(fs.readFileSync(dyePath, 'utf8'));
  } catch {
    return failed('DYEHPJ_UNREADABLE');
  }
  if (!dye || typeof dye !== 'object' || Array.isArray(dye)) return failed('DYEHPJ_UNREADABLE');
  const sound = typeof dye.soundID === 'string' ? dye.soundID : '';
  const projectField = ['projectID', 'projectId', 'project_id'].map((key) => dye[key]).find((value) => typeof value === 'string');
  if (typeof projectField === 'string' && projectField !== expected.projectId) return failed('PROJECT_ID_MISMATCH', { sound_id: sound });
  if (sound !== expected.musicId) return failed('SOUND_ID_MISMATCH', { sound_id: sound });

  const infoPath = path.join(projectPath, 'Assets', 'NoImportAsset', expected.musicId, 'MusicInfo.json');
  let dirStat;
  let fileStat;
  try {
    dirStat = fs.lstatSync(path.dirname(infoPath));
    fileStat = fs.lstatSync(infoPath);
  } catch {
    return failed('ASSET_MISSING', { sound_id: sound });
  }
  if (dirStat.isSymbolicLink() || fileStat.isSymbolicLink()) return failed('ASSET_UNTRUSTED', { sound_id: sound });
  let info;
  try {
    if (!contained(projectPath, infoPath)) return failed('ASSET_UNTRUSTED', { sound_id: sound });
    info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
  } catch {
    return failed('ASSET_UNREADABLE', { sound_id: sound });
  }
  const title = info && typeof info.title === 'string' ? info.title : '';
  const author = info && typeof info.author === 'string' ? info.author : '';
  const duration = info && typeof info.duration === 'number' ? info.duration : null;
  if (title !== expected.title || author !== expected.author || duration !== expected.durationSec) {
    return failed('METADATA_MISMATCH', { sound_id: sound });
  }

  const scenePath = path.join(projectPath, 'Assets', 'main.scene');
  let sceneStat;
  try {
    sceneStat = fs.lstatSync(scenePath);
  } catch {
    return failed('SCENE_MISMATCH', { sound_id: sound, scene_objects: 0 });
  }
  if (sceneStat.isSymbolicLink()) return failed('SCENE_MISMATCH', { sound_id: sound, scene_objects: 0 });
  let sceneText;
  try {
    if (!contained(projectPath, scenePath)) return failed('SCENE_MISMATCH', { sound_id: sound, scene_objects: 0 });
    sceneText = fs.readFileSync(scenePath, 'utf8');
  } catch {
    return failed('SCENE_MISMATCH', { sound_id: sound, scene_objects: 0 });
  }
  const scene_objects = sceneDouyinAudioCount(sceneText);
  if (scene_objects !== 1) return failed('SCENE_MISMATCH', { sound_id: sound, scene_objects });
  return { ok: true, reason: 'PERSISTED', imported: false, sound_id: sound, scene_objects: 1 };
}
