import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { verifyPersistedMusic } from '../src/music.mjs';
import { assessSavedMusic, sceneDouyinAudioCount } from '../src/music-persist.mjs';
import { Projects } from '../src/projects.mjs';
import { tmpdir } from '../support/tmp.mjs';

const MUSIC = 'm-current';
const OLD = 'm-old';
const PROJECT = 'pid-current';

function entity(name, classes) {
  const components = classes.map((type) => `    - __class: ${type}\n      name: !<str> ""`).join('\n');
  return `  - __class: Entity\n    name: !<str> ${name}\n    components:\n${components}`;
}

function scene(blocks) {
  return ['%YAML 1.1', '--- !Scene &1', 'entities:', ...blocks, ''].join('\n');
}

function project(options = {}) {
  const dir = tmpdir('xs-persist-');
  const assets = path.join(dir, 'Assets', 'NoImportAsset', options.assetId ?? MUSIC);
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'effect.dyehpj'),
    JSON.stringify({
      soundID: options.soundID === undefined ? MUSIC : options.soundID,
      projectID: options.projectID === undefined ? PROJECT : options.projectID,
      name: 'probe',
    }),
  );
  if (options.asset !== false) {
    const info = path.join(assets, 'MusicInfo.json');
    const body = JSON.stringify({
      title: options.title ?? 'Track',
      author: options.author ?? 'HD',
      duration: options.duration === undefined ? 30 : options.duration,
    });
    if (options.symlink) {
      const outside = path.join(tmpdir('xs-persist-out-'), 'MusicInfo.json');
      fs.mkdirSync(path.dirname(outside), { recursive: true });
      fs.writeFileSync(outside, body);
      fs.symlinkSync(outside, info);
    } else {
      fs.writeFileSync(info, body);
    }
  }
  const blocks = options.scene === false ? [] : [entity(options.objectName ?? '抖音音乐', options.components ?? ['Transform', 'AudioComponent'])];
  if (options.secondObject) blocks.push(entity('抖音音乐', ['Transform', 'AudioComponent']));
  fs.writeFileSync(path.join(dir, 'Assets', 'main.scene'), options.sceneText ?? scene(blocks));
  return dir;
}

const expected = { musicId: MUSIC, title: 'Track', author: 'HD', durationSec: 30, projectId: PROJECT };

test('a saved sound id, matching asset, and one scene object count as persisted', () => {
  const found = assessSavedMusic(project(), expected);
  assert.equal(found.ok, true);
  assert.equal(found.sound_id, MUSIC);
  assert.equal(found.scene_objects, 1);
  assert.equal(found.imported, false);
});

test('an unsaved flag is not this module, and an old sound id or old asset is not persisted', () => {
  const oldSound = assessSavedMusic(project({ soundID: OLD }), expected);
  assert.equal(oldSound.ok, false);
  assert.equal(oldSound.reason, 'SOUND_ID_MISMATCH');
  assert.equal(oldSound.sound_id, OLD);

  const oldAsset = assessSavedMusic(project({ assetId: OLD, asset: false, soundID: OLD }), expected);
  assert.equal(oldAsset.ok, false);
  assert.notEqual(oldAsset.reason, 'PERSISTED');

  const titled = assessSavedMusic(project({ title: 'Other' }), expected);
  assert.equal(titled.ok, false);
  assert.equal(titled.reason, 'METADATA_MISMATCH');

  const linked = assessSavedMusic(project({ symlink: true }), expected);
  assert.equal(linked.ok, false);
  assert.equal(linked.reason, 'ASSET_UNTRUSTED');

  const switched = assessSavedMusic(project({ projectID: 'pid-other' }), expected);
  assert.equal(switched.ok, false);
  assert.equal(switched.reason, 'PROJECT_ID_MISMATCH');

  const noAudio = assessSavedMusic(project({ components: ['Transform'] }), expected);
  assert.equal(noAudio.ok, false);
  assert.equal(noAudio.reason, 'SCENE_MISMATCH');
  assert.equal(noAudio.scene_objects, 0);

  const two = assessSavedMusic(project({ secondObject: true }), expected);
  assert.equal(two.ok, false);
  assert.equal(two.reason, 'SCENE_MISMATCH');
  assert.equal(two.scene_objects, 2);
});

test('scene text counts one named object with AudioComponent', () => {
  assert.equal(sceneDouyinAudioCount(scene([entity('抖音音乐', ['Transform', 'AudioComponent'])])), 1);
  assert.equal(sceneDouyinAudioCount(scene([entity('其他', ['AudioComponent']), entity('抖音音乐', ['Transform'])])), 0);
  const separate = [
    '%YAML 1.1',
    '--- !Entity &5',
    'name: !<str> 抖音音乐',
    'components:',
    '- {localId: 9}',
    '--- !AudioComponent &9',
    'name: !<str> ""',
    '',
  ].join('\n');
  assert.equal(sceneDouyinAudioCount(separate), 1);
});

function host(dir, { status = {}, projectPathFor } = {}) {
  const calls = [];
  let statusReads = 0;
  const d = {
    official: {
      callJson: async (name) => {
        calls.push(name);
        if (name === 'list_instances') return { instances: [{ instance_id: '1', generation: '9-abc', project_path: dir }] };
        if (name === 'project_status') {
          return {
            path: dir,
            project_id: PROJECT,
            is_saved: true,
            is_changed: false,
            scene_dirty: false,
            ...status,
          };
        }
        if (name === 'get_scene') return { sceneObjects: [{ name: '抖音音乐', componentTypes: ['Transform', 'AudioComponent'] }] };
        throw Error(`unexpected ${name}`);
      },
    },
    callPlugin: async (method) => {
      calls.push(method);
      if (method === 'status') {
        statusReads += 1;
        const projectPath = projectPathFor ? projectPathFor(statusReads) : dir;
        return { projectPath };
      }
      if (method === 'project_state') return { project_path: dir, changed: false, scene_ready: true };
      throw Error(`unexpected plugin ${method}`);
    },
    listInstances: () => [{ pid: 9 }],
    allow: [os.tmpdir()],
    sleep: async () => {},
  };
  return { projects: new Projects(d), calls };
}

const query = { music_id: MUSIC, project_id: PROJECT, title: 'Track', author: 'HD', duration_sec: 30 };

test('music_verify confirms a clean saved project and does not save or apply', async () => {
  const dir = project();
  const { projects, calls } = host(dir);
  const out = await verifyPersistedMusic(projects, { ...query, project_path: dir });
  assert.equal(out.persisted, true);
  assert.equal(out.confirmed, true);
  assert.equal(out.bound, true);
  assert.equal(out.imported, false);
  assert.equal(out.saved, true);
  assert.equal(out.binding, 'persisted');
  assert.equal(out.sound_id, MUSIC);
  assert.equal(out.apply_calls, 0);
  assert.equal(out.save_calls, 0);
  assert.equal(calls.includes('save_project'), false);
  assert.equal(calls.includes('music_apply'), false);
  assert.equal(calls.filter((name) => name === 'get_scene').length, 1);
});

test('music_verify does not confirm unsaved state, an old sound id, or a switched project', async () => {
  const dirtyDir = project();
  const dirty = host(dirtyDir, { status: { is_changed: true, scene_dirty: true, is_saved: false } });
  const unsaved = await verifyPersistedMusic(dirty.projects, { ...query, project_path: dirtyDir });
  assert.equal(unsaved.persisted, false);
  assert.equal(unsaved.confirmed, false);
  assert.equal(unsaved.bound, false);
  assert.equal(unsaved.imported, false);
  assert.equal(unsaved.reason, 'UNSAVED');
  assert.equal(dirty.calls.includes('get_scene'), false);
  assert.equal(dirty.calls.includes('save_project'), false);

  const oldDir = project({ soundID: OLD });
  const old = host(oldDir);
  const mismatch = await verifyPersistedMusic(old.projects, { ...query, project_path: oldDir });
  assert.equal(mismatch.persisted, false);
  assert.equal(mismatch.reason, 'SOUND_ID_MISMATCH');
  assert.equal(mismatch.sound_id, OLD);
  assert.equal(old.calls.includes('get_scene'), false);

  const other = path.join(tmpdir('xs-persist-other-'), 'elsewhere');
  const movedDir = project();
  const moved = host(movedDir, { projectPathFor: (read) => (read < 2 ? movedDir : other) });
  const switched = await verifyPersistedMusic(moved.projects, { ...query, project_path: movedDir });
  assert.equal(switched.persisted, false);
  assert.equal(switched.confirmed, false);
  assert.equal(switched.reason, 'PROJECT_SWITCHED');
  assert.equal(moved.calls.includes('save_project'), false);
});
