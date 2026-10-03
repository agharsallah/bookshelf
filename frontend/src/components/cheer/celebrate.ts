/** A moment worth marking: a toast in the chosen voice and, for a big one, a burst. */
import { toast } from '../document/toast';
import { burst } from './burst';
import { pick, type CheerLine } from './lines';
import { cheerTone } from './prefs';

export function celebrate(line: CheerLine, { big = false } = {}): void {
  toast(pick(line, cheerTone()), 'good');
  if (big) burst();
}
