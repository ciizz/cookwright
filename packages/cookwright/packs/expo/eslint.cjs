// packs/expo/eslint.cjs — the expo pack's ESLint export (stage-4 plan §4.4): flat
// config blocks a repo spreads into its own eslint.config.js, after Expo's config,
// with `...require('cookwright/packs/expo/eslint.cjs'),`. CommonJS, so Expo's CJS
// config template requires it on Node 20.
//
// Static: it reads no cookwright.json (disposition 24). A rule switched off in
// `packs` still shows in the editor; the standards engine drops its findings. The
// blocks carry rules only (and the i18next plugin): the parser is the repo's own,
// which is why the export is spread into the repo's config and never run alone.
// Each block is named `cookwright/expo/<pack rule>[/<part>]`, so a reader of the
// effective config sees whose block it is. A finding of a shared ESLint id
// (no-restricted-syntax) carries the pack rule's tag in its message, which is how
// the engine tells it from a user's own selector.
//
// The strings block is left out when eslint-plugin-i18next does not resolve: the
// rule then reads "skipped, needs …" on the hook's line, never a broken config.

'use strict';

/** Paths no pack rule reads: the harness's own links, dependencies and tests (disposition 19). */
const IGNORES = ['.claude/**', '.agents/**', '.codex/**', 'node_modules/**', '**/*.test.*', '**/__tests__/**'];

const TOKENS_TAG = '[cookwright expo tokens]';
const COLOUR = '^(#[0-9A-Fa-f]{3,8}|rgb\\(.*\\)|rgba\\(.*\\)|hsl\\(.*\\)|hsla\\(.*\\))$';
const SPACING_KEYS = [
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginStart', 'marginEnd',
  'marginHorizontal', 'marginVertical', 'padding', 'paddingTop', 'paddingBottom', 'paddingLeft',
  'paddingRight', 'paddingStart', 'paddingEnd', 'paddingHorizontal', 'paddingVertical', 'gap',
  'rowGap', 'columnGap',
].join('|');

// JSX attributes whose string is never user-facing text. eslint-plugin-i18next
// replaces its own list when given one, so its defaults come first. Measured on
// the origin app's tree (disposition 44): with the defaults alone, jsx-only mode
// reported 1404 attribute strings in 183 files; with this list, 50 in 31 files,
// every one an app-specific prop. Labels, hints, placeholders, titles and values
// stay measured.
const NOT_TEXT = [
  // the plugin's defaults
  'className', 'styleName', 'style', 'type', 'key', 'id', 'width', 'height',
  // styles, colours and spacing (the tokens rule measures their literals)
  '.*Style', 'color', 'colors', '.*Color', '(margin|padding)[A-Za-z]*', 'gap', 'rowGap', 'columnGap',
  // design-system variants
  'variant', 'size', 'tone', 'align', 'mode',
  // icons, images and SVG
  'name', 'source', 'resizeMode', 'contentFit', 'fill', 'stroke', 'stroke[A-Z].*', 'viewBox', 'd',
  // identifiers, routes, translation keys and handlers
  'testID', 'nativeID', 'href', '.*Key', 'on[A-Z].*',
  // React Native's enumerated props
  'accessibilityRole', 'accessibilityState', 'accessibilityLiveRegion', 'importantForAccessibility',
  'autoCapitalize', 'autoComplete', 'textContentType', 'keyboardType', 'returnKeyType', 'enterKeyHint',
  'inputMode', 'keyboardShouldPersistTaps', 'keyboardDismissMode', 'pointerEvents', 'behavior',
  'animationType', 'display', 'textAlignVertical', 'snapToAlignment', 'decelerationRate',
  'ellipsizeMode', 'dataDetectorType', 'overScrollMode',
];

/** eslint-plugin-i18next, or null when it does not resolve from here. */
function i18nextPlugin(resolve = require.resolve) {
  try {
    return require(resolve('eslint-plugin-i18next'));
  } catch {
    return null;
  }
}

const strings = (plugin) => ({
  name: 'cookwright/expo/strings',
  files: ['**/*.{tsx,jsx}'],
  ignores: [...IGNORES, '**/*.config.*', '**/locales/**', '**/theme/**'],
  plugins: { i18next: plugin },
  rules: { 'i18next/no-literal-string': ['error', { mode: 'jsx-only', 'jsx-attributes': { exclude: NOT_TEXT } }] },
});

const tokens = {
  name: 'cookwright/expo/tokens',
  files: ['**/components/**/*.{ts,tsx,js,jsx}'],
  ignores: [...IGNORES, '**/theme/**', '**/palette.*', '**/tokens.*'],
  rules: {
    'no-restricted-syntax': [
      'error',
      { selector: `Literal[value=/${COLOUR}/]`, message: `${TOKENS_TAG} use a theme colour token, not a colour literal` },
      {
        selector: `Property[key.name=/^(${SPACING_KEYS})$/] > Literal[raw=/^[0-9]+(\\.[0-9]+)?$/]`,
        message: `${TOKENS_TAG} use a theme spacing token, not a numeric spacing literal`,
      },
    ],
  },
};

const sizeRule = (max) => ['error', { max, skipBlankLines: true, skipComments: true, IIFEs: true }];
const size = [
  { name: 'cookwright/expo/size/components', files: ['**/*.{tsx,jsx}'], ignores: IGNORES, rules: { 'max-lines-per-function': sizeRule(150) } },
  { name: 'cookwright/expo/size', files: ['**/*.{ts,js}'], ignores: IGNORES, rules: { 'max-lines-per-function': sizeRule(40) } },
];

/** The blocks, the strings block only when `plugin` is there. */
function blocks(plugin) {
  return [...(plugin ? [strings(plugin)] : []), tokens, ...size];
}

module.exports = blocks(i18nextPlugin());
// The tests' seam: the same blocks with another plugin resolver. Not a block, so
// a spread never sees it.
Object.defineProperty(module.exports, 'withResolver', { value: (resolve) => blocks(i18nextPlugin(resolve)) });
