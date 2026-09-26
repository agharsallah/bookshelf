"""Audio summaries: voicing `audio_summary` scripts (skills/write-audio-summary).

voices     the voice catalogue: VibeVoice's samples and your own recordings
speech     script → what the speech model reads (one clip per speaker)
runner     the speech runtime seam (VibeVoice in an isolated `uv run --script` env)
store      renders on disk: the MP3 and its timeline manifest
narration  which cast voices which script: `narrate` job specs
render     the `narrate` job body
"""
