// Upstream this module finds a track's beats (Beat This!, stems…). In Cadenza the beats come from
// the rhythm map (src/folia/engines/beats.ts installs them into the vendored beat clock); only the
// type the clock reports survives.
export type BeatFxSourceKind = 'beat_this' | 'none';
