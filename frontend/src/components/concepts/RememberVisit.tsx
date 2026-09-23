/** Records a visited concept for the concept index's "recently visited" list. Renders nothing. */
import { useEffect } from 'react';
import { RECENT_CONCEPTS_KEY, saveRecent } from '../search/recent';

export function RememberVisit({ label, href }: { label: string; href: string }) {
  useEffect(() => {
    saveRecent(RECENT_CONCEPTS_KEY, { label, href });
  }, [label, href]);
  return null;
}

export default RememberVisit;
