/**
 * Whether this page is the read-only demo (docs/DEMO.md), read from `<html data-demo>`
 * (layouts/BaseLayout.astro), so a browser-side module needs no build-time flag.
 */
export function isDemo(doc: Pick<Document, 'documentElement'> | undefined = globalThis.document): boolean {
  return doc?.documentElement.hasAttribute('data-demo') ?? false;
}
