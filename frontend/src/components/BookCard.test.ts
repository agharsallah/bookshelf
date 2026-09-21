import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { expect, test } from 'vitest';
import BookCard from './BookCard.astro';

test('renders title, author and slotted notes', async () => {
  const container = await AstroContainer.create();
  const result = await container.renderToString(BookCard, {
    props: { title: 'The Pragmatic Programmer', author: 'Hunt & Thomas' },
    slots: { default: 'Distilled: fix broken windows early.' },
  });

  expect(result).toContain('The Pragmatic Programmer');
  expect(result).toContain('Hunt &amp; Thomas');
  expect(result).toContain('Distilled: fix broken windows early.');
});
