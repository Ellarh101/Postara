import test from 'node:test';
import assert from 'node:assert/strict';
import { AiTemporaryError, createAi, systemPrompt } from '../src/ai.js';
import { createAiConfig } from '../src/aiconfig.js';
import { createStore } from '../src/db.js';

const reply = { is_underwear: false, item_type: 'hoodie set', title: 'T', colours: 'pink', sizes: '1-7 years', details: '', description: 'D', prices: [{ label: '', amount: 17800 }, { label: 'Buy 3 or more', amount: 16500 }] };
const respond = (status, body) => async () => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const make = (cfg, fetchImpl) => createAi({ getConfig: () => cfg, fetchImpl });

test('Gemini: sends pictures and instructions, reads the JSON answer', async () => {
  let call;
  const ai = make({ provider: 'gemini', key: 'KEY', model: 'gemini-3.5-flash' }, async (url, init) => {
    call = { url, init, body: JSON.parse(init.body) };
    return respond(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] })();
  });
  const out = await ai.analyze({ caption: 'Price: 17,800', thumbs: ['AAA', 'BBB'], prefs: { language: 'English' } });
  assert.match(call.url, /models\/gemini-3\.5-flash:generateContent$/);
  assert.equal(call.init.headers['x-goog-api-key'], 'KEY');
  assert.equal(call.body.contents[0].parts.filter((p) => p.inline_data).length, 2);
  assert.match(call.body.systemInstruction.parts[0].text, /original words/);
  assert.deepEqual(out.entries, [{ label: '', amount: 17800 }, { label: 'Buy 3 or more', amount: 16500 }]);
  assert.equal(out.sizes, '1-7 years');
});

test('Claude: same job through the Claude API', async () => {
  let call;
  const ai = make({ provider: 'claude', key: 'K2', model: 'claude-haiku-5-5' }, async (url, init) => {
    call = { url, init, body: JSON.parse(init.body) };
    return respond(200, { content: [{ type: 'text', text: 'Here you go: ' + JSON.stringify(reply) }] })();
  });
  const out = await ai.analyze({ caption: 'x', thumbs: ['AAA'] });
  assert.match(call.url, /api\.anthropic\.com/);
  assert.equal(call.init.headers['x-api-key'], 'K2');
  assert.equal(call.body.messages[0].content[0].type, 'image');
  assert.equal(out.title, 'T');
});

test('busy service is retried later, a wrong key gets a plain message', async () => {
  const busy = make({ provider: 'gemini', key: 'K', model: 'm' }, respond(429, {}));
  await assert.rejects(busy.analyze({ caption: '' }), AiTemporaryError);
  const bad = make({ provider: 'gemini', key: 'K', model: 'm' }, respond(400, { error: { message: 'API key not valid. Please pass a valid API key.' } }));
  await assert.rejects(bad.analyze({ caption: '' }), /key was not accepted/);
  const gone = make({ provider: 'gemini', key: 'K', model: 'nope' }, respond(404, {}));
  await assert.rejects(gone.analyze({ caption: '' }), /model name was not found/);
});

test('the prompt demands fresh wording and carries your preferences', () => {
  const p = systemPrompt({ language: 'Pidgin', emojiLevel: 'none', hashtags: true, removePhrases: ['luxury'], example: 'My style!', business: 'Ruchies' });
  assert.match(p, /original words of your own/);
  assert.match(p, /Do NOT copy the vendor's sentences/);
  assert.match(p, /Pidgin/);
  assert.match(p, /Do not use any emojis/);
  assert.match(p, /hashtags/);
  assert.match(p, /"luxury"/);
  assert.match(p, /My style!/);
});

test('keys are kept on the device and never shown back', () => {
  const store = createStore(null);
  const cfg = createAiConfig(store, { geminiKey: '', anthropicKey: 'ENVKEY', geminiModel: 'gemini-3.5-flash', claudeModel: 'claude-haiku-5-5' });
  assert.equal(cfg.get().provider, 'claude', 'falls back to a key in the .env file');
  cfg.save({ provider: 'gemini', key: ' SECRET ', model: '' });
  assert.equal(cfg.get().key, 'SECRET');
  assert.equal(cfg.get().model, 'gemini-3.5-flash');
  const shown = JSON.stringify(cfg.publicView());
  assert.doesNotMatch(shown, /SECRET|ENVKEY/);
  assert.equal(cfg.publicView().hasKey.gemini, true);
  cfg.save({ provider: 'gemini', key: '', model: 'gemini-3.6-flash' });
  assert.equal(cfg.get().key, 'SECRET', 'an empty key box keeps the saved key');
  assert.equal(cfg.get().model, 'gemini-3.6-flash');
});
