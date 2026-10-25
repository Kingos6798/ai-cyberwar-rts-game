// Asks the player for their own API key (and the model) before a match against a cloud General (D-020).
// The key is typed into a password field and handed to the caller; it is never put in the URL or shown again.
// Only the official API is used from the browser: a base URL from a link could send a saved key elsewhere.
export interface KeyAnswer { key: string; model: string; remember: boolean }

export function promptForKey(model: string, needKey: boolean): Promise<KeyAnswer | null> {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.id = 'key-prompt';
    const form = document.createElement('form');
    form.innerHTML = `
      <h2>Play the cloud General</h2>
      <p>This match uses the OpenAI API with <b>your own API key</b>. The key stays in this browser and is sent only
      to api.openai.com. It is never added to the game, the URL or any file. Each turn costs a little on your account.</p>
      <label>Model <input name="model" autocomplete="off" spellcheck="false" required placeholder="a model your key can use"></label>
      <label ${needKey ? '' : 'hidden'}>API key <input type="password" name="key" autocomplete="off" spellcheck="false" ${needKey ? 'required' : ''} placeholder="sk-..."></label>
      <label class="remember" ${needKey ? '' : 'hidden'}><input type="checkbox" name="remember"> Remember the key on this device</label>
      <div class="actions"><button type="submit">Start</button> <button type="button" name="skip">Play the scripted AI instead</button></div>`;
    const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
    field('model').value = model;
    el.append(form);
    document.body.append(el);
    const done = (answer: KeyAnswer | null) => { el.remove(); resolve(answer); };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const m = field('model').value.trim().replace(/[^\w.:/-]/g, '');
      if (m) done({ key: field('key').value.trim(), model: m, remember: field('remember').checked });
    });
    form.querySelector('button[name="skip"]')!.addEventListener('click', () => done(null));
    (model ? field(needKey ? 'key' : 'model') : field('model')).focus();
  });
}
