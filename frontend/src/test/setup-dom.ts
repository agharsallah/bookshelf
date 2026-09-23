/** DOM test setup: unmount rendered trees between tests so each starts clean. */
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
