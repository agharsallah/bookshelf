"""`narrate` job: voice an `audio_summary` script (`app.audio.render`).

Bound to the process-wide VibeVoice runner. The API runs these jobs on a slot of their own
(`app.jobs.narration`), since one narration holds the whole speech model in memory.
"""

from app.audio.render import narrate
from app.audio.runner import SpeechRunner, VibeVoiceRunner
from app.jobs.registry import HandlerResult, JobContext, handler
from app.models.enums import JobKind

_runner: SpeechRunner | None = None


def default_speech_runner() -> SpeechRunner:
    global _runner
    if _runner is None:
        _runner = VibeVoiceRunner()
    return _runner


@handler(JobKind.NARRATE)
def run_narrate(ctx: JobContext) -> HandlerResult:
    return narrate(ctx.session, ctx.job, runner=default_speech_runner())
