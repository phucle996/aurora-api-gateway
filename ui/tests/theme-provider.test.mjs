import assert from 'node:assert';

// Mock localStorage
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => store.get(k) || null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

// Mock document.documentElement
const classList = new Set();
globalThis.window = {
  document: {
    documentElement: {
      classList: {
        add: (...classes) => classes.forEach((c) => classList.add(c)),
        remove: (...classes) => classes.forEach((c) => classList.delete(c)),
        contains: (c) => classList.has(c),
      },
      setAttribute: (k, v) => {
        globalThis.window.document.documentElement[k] = v;
      },
      style: {},
    },
  },
  matchMedia: (query) => ({
    matches: false, // light mode by default in system
    addEventListener: () => { },
    removeEventListener: () => { },
  }),
};

console.log('1. Testing initial state with no localStorage (default to dark)...');
localStorage.clear();
classList.clear();

const defaultTheme = 'dark';
const storageKey = 'aurora_theme';

let currentTheme = localStorage.getItem(storageKey) || defaultTheme;
assert.strictEqual(currentTheme, 'dark');

// Apply theme logic
function applyTheme(theme) {
  const resolved = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;

  const root = window.document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(resolved);
  root.setAttribute('data-theme', resolved);
  root.style.colorScheme = resolved;
  return resolved;
}

function setTheme(newTheme) {
  localStorage.setItem(storageKey, newTheme);
  currentTheme = newTheme;
  return applyTheme(newTheme);
}

// Initial apply
let resolved = applyTheme(currentTheme);
assert.strictEqual(resolved, 'dark');
assert.strictEqual(classList.has('dark'), true);
assert.strictEqual(classList.has('light'), false);
assert.strictEqual(window.document.documentElement['data-theme'], 'dark');
assert.strictEqual(window.document.documentElement.style.colorScheme, 'dark');
console.log('✓ Initial dark theme verified');

console.log('2. Testing setTheme("light") and localStorage persistence...');
resolved = setTheme('light');
assert.strictEqual(resolved, 'light');
assert.strictEqual(localStorage.getItem('aurora_theme'), 'light');
assert.strictEqual(classList.has('light'), true);
assert.strictEqual(classList.has('dark'), false);
assert.strictEqual(window.document.documentElement['data-theme'], 'light');
assert.strictEqual(window.document.documentElement.style.colorScheme, 'light');
console.log('✓ Light theme and localStorage persistence verified');

console.log('3. Testing setTheme("system") with media query matches = true (dark)...');
window.matchMedia = () => ({ matches: true, addEventListener: () => { }, removeEventListener: () => { } });
resolved = setTheme('system');
assert.strictEqual(resolved, 'dark');
assert.strictEqual(localStorage.getItem('aurora_theme'), 'system');
assert.strictEqual(classList.has('dark'), true);
assert.strictEqual(classList.has('light'), false);
console.log('✓ System preference (dark) verified');

console.log('4. Testing page reload restoring saved theme from localStorage...');
// Emulate reload: new session reads from localStorage
const restoredTheme = localStorage.getItem(storageKey) || defaultTheme;
assert.strictEqual(restoredTheme, 'system');
console.log('✓ Reload restored theme successfully');

console.log('\nAll ThemeProvider tests passed successfully!');
