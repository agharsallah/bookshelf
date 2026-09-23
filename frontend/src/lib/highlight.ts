/**
 * Code highlighting with Shiki's fine-grained core: the JavaScript regex engine (no
 * WASM), one theme built on CSS variables (colors live in CSS tokens, so one output
 * serves both themes), and a curated set of lazily imported grammars. Used at
 * SSR/build time by `prepareBlocks`, and lazily on the client as a fallback.
 */
import type { HighlighterCore, LanguageRegistration } from 'shiki/core';

interface Grammar {
  default: LanguageRegistration[];
}

/** Curated grammars, each its own lazy chunk. Extend deliberately. */
const GRAMMARS: Record<string, () => Promise<Grammar>> = {
  python: () => import('shiki/langs/python.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  bash: () => import('shiki/langs/bash.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  haskell: () => import('shiki/langs/haskell.mjs'),
  r: () => import('shiki/langs/r.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
};

const ALIASES: Record<string, string> = {
  py: 'python',
  ts: 'typescript',
  js: 'javascript',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  yml: 'yaml',
  'c++': 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  rs: 'rust',
  golang: 'go',
  kt: 'kotlin',
  md: 'markdown',
  hs: 'haskell',
};

/** Canonical grammar id for a block's `language`, or null when it isn't supported. */
export function resolveLanguage(language: string | undefined): string | null {
  if (!language) return null;
  const key = language.trim().toLowerCase();
  const id = ALIASES[key] ?? key;
  return id in GRAMMARS ? id : null;
}

let highlighter: Promise<HighlighterCore> | undefined;

async function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= (async () => {
    const [{ createHighlighterCore, createCssVariablesTheme }, { createJavaScriptRegexEngine }] =
      await Promise.all([import('shiki/core'), import('shiki/engine/javascript')]);
    return createHighlighterCore({
      themes: [createCssVariablesTheme({ name: 'bookshelf', variablePrefix: '--shiki-', fontStyle: true })],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    });
  })();
  return highlighter;
}

/**
 * Highlighted `<pre class="shiki">` HTML, or null for unsupported languages (callers
 * then render a plain `<pre>`). Shiki escapes the source, so the HTML is safe to inject.
 */
export async function highlightCode(text: string, language: string | undefined): Promise<string | null> {
  const lang = resolveLanguage(language);
  if (!lang) return null;
  const core = await getHighlighter();
  if (!core.getLoadedLanguages().includes(lang)) {
    const grammar = GRAMMARS[lang];
    if (!grammar) return null;
    await core.loadLanguage(...(await grammar()).default);
  }
  return core.codeToHtml(text, { lang, theme: 'bookshelf' });
}
