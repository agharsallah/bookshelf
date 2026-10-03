/** The encouragement moments that play out in script: a celebration toast and the burst. */
import { burst } from '../cheer/burst';
import { pick, chapterDone } from '../cheer/lines';
import { toast } from '../document/toast';

const LINE = chapterDone('Rule 2 · Embrace Boredom', null);

export function CheerDemo() {
  return (
    <div className="cheer-demo">
      <button type="button" className="btn" onClick={() => toast(pick(LINE, 'quiet'), 'good')}>
        Quiet toast
      </button>
      <button type="button" className="btn" onClick={() => toast(pick(LINE, 'playful'), 'good')}>
        Playful toast
      </button>
      <button type="button" className="btn btn-primary" onClick={() => burst(window, Math.random, { force: true })}>
        Burst
      </button>
    </div>
  );
}

export default CheerDemo;
