import * as Blockly from 'blockly/core';
import {generate} from './generate';

const KEY_STORAGE = 'openrouterApiKey';

const byId = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`element #${id} not found`);
  return el as T;
};

/** Wires the description box and Generate button to the workspace. */
export function initPanel(ws: Blockly.Workspace) {
  const keyInput = byId<HTMLInputElement>('apiKey');
  const description = byId<HTMLTextAreaElement>('description');
  const button = byId<HTMLButtonElement>('generate');
  const status = byId<HTMLDivElement>('status');

  keyInput.value = window.localStorage?.getItem(KEY_STORAGE) ?? '';

  const show = (message: string, isError = false) => {
    status.textContent = message;
    status.classList.toggle('error', isError);
  };

  button.addEventListener('click', async () => {
    const apiKey = keyInput.value.trim();
    const text = description.value.trim();
    if (!apiKey) return show('Enter an OpenRouter API key.', true);
    if (!text) return show('Describe what you want to build.', true);
    window.localStorage?.setItem(KEY_STORAGE, apiKey);

    button.disabled = true;
    try {
      show(await generate(text, apiKey, ws, show));
    } catch (e) {
      show(e instanceof Error ? e.message : String(e), true);
    } finally {
      button.disabled = false;
    }
  });
}
