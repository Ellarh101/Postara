// Which AI helper to use, and its key. Set from the Settings screen (stored on this device only);
// keys in the .env file still work as a fallback.
export const PROVIDERS = {
  gemini: { label: 'Google Gemini (free tier)', keyUrl: 'https://aistudio.google.com/app/apikey' },
  claude: { label: 'Claude (paid)', keyUrl: 'https://console.anthropic.com' },
};

export function createAiConfig(store, config) {
  const defaults = { gemini: config.geminiModel, claude: config.claudeModel };
  const envKeys = { gemini: config.geminiKey, claude: config.anthropicKey };

  function read() {
    try {
      return JSON.parse(store.getKv('ai') || '{}');
    } catch {
      return {};
    }
  }

  function get() {
    const s = read();
    const provider = PROVIDERS[s.provider] ? s.provider : (envKeys.gemini ? 'gemini' : envKeys.claude ? 'claude' : 'gemini');
    return {
      provider,
      key: (s.keys && s.keys[provider]) || envKeys[provider] || '',
      model: (s.models && s.models[provider]) || defaults[provider],
    };
  }

  // What the screen is allowed to see: never the keys themselves.
  function publicView() {
    const s = read();
    const cur = get();
    return {
      provider: cur.provider,
      model: cur.model,
      hasKey: { gemini: !!((s.keys && s.keys.gemini) || envKeys.gemini), claude: !!((s.keys && s.keys.claude) || envKeys.claude) },
      defaults,
      providers: Object.fromEntries(Object.entries(PROVIDERS).map(([k, v]) => [k, v])),
    };
  }

  function save({ provider, key, model } = {}) {
    const s = read();
    const p = PROVIDERS[provider] ? provider : get().provider;
    s.provider = p;
    s.keys = s.keys || {};
    s.models = s.models || {};
    if (typeof key === 'string' && key.trim()) s.keys[p] = key.trim();
    if (typeof model === 'string') {
      if (model.trim()) s.models[p] = model.trim().slice(0, 80);
      else delete s.models[p];
    }
    store.setKv('ai', JSON.stringify(s));
    return publicView();
  }

  return { get, publicView, save };
}
