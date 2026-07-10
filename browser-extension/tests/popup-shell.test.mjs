import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('manifest loads the accessibility shell', async () => {
  const manifest = JSON.parse(await read('manifest.json'));
  assert.equal(manifest.action.default_popup, 'popup-shell.html');
});

test('shell preserves the existing popup and has an accessible title', async () => {
  const html = await read('popup-shell.html');
  assert.match(html, /src="popup\.html"/);
  assert.match(html, /title="SalesNav Exporter controls"/);
  assert.match(html, /src="popup-shell\.js"/);
});

test('skip-stuck pulse animation is restored', async () => {
  const js = await read('popup-shell.js');
  assert.match(js, /@keyframes resurrectPulse/);
});

test('tabs, toggles, and dialogs receive keyboard accessibility', async () => {
  const js = await read('popup-shell.js');
  for (const expected of [
    "setAttribute('role', 'tab')",
    "setAttribute('role', 'tabpanel')",
    "setAttribute('aria-labelledby'",
    "setAttribute('aria-modal', 'true')",
    "event.key === 'ArrowRight'",
    "event.key === 'Escape'",
    "event.key !== 'Tab'",
    'MutationObserver'
  ]) assert.ok(js.includes(expected), `missing accessibility behavior: ${expected}`);
});
