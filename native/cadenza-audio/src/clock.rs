//! Convert stream-relative WASAPI units to the frame domain used by the submitted PCM ledger.

const HNS_PER_SECOND: u64 = 10_000_000;

#[derive(Clone, Copy)]
pub struct Observation {
    pub units: u64,
    pub frequency: u64,
    pub qpc_100ns: u64,
    pub now_100ns: u64,
    pub simulated: bool,
}

pub struct Reading {
    pub frame: u64,
    pub source: &'static str,
    pub qpc_100ns: Option<u64>,
}

#[derive(Default)]
pub struct StreamClock {
    last_valid: Option<Observation>,
    still_since: Option<u64>,
    heard: u64,
    rejected: bool,
}

impl StreamClock {
    pub fn read(&mut self, obs: Option<Observation>, written: u64, padding: usize, rate: u32) -> Reading {
        let consumed = written.saturating_sub(padding as u64);
        let mut reading = Reading { frame: consumed, source: "padding", qpc_100ns: None };
        if let Some((obs, age)) = obs.filter(|_| !self.rejected).and_then(|obs| {
            let age = obs.now_100ns.checked_sub(obs.qpc_100ns)?;
            (age <= HNS_PER_SECOND / 10 && obs.frequency != 0 && obs.qpc_100ns != 0).then_some((obs, age))
        }) {
            if let Some(prev) = self.last_valid {
                if obs.qpc_100ns > prev.qpc_100ns && obs.frequency == prev.frequency {
                    if obs.units == prev.units {
                        self.still_since.get_or_insert(prev.qpc_100ns);
                    } else {
                        self.still_since = None;
                    }
                }
            }
            if let Some(frame) = self.valid_frame(obs, age, written, consumed, rate) {
                self.last_valid = Some(obs);
                reading = Reading {
                    frame,
                    source: if obs.simulated { "simulated" } else { "wasapi" },
                    qpc_100ns: Some(obs.qpc_100ns),
                };
            } else if self.last_valid.is_some_and(|prev| obs.units < prev.units && obs.qpc_100ns > prev.qpc_100ns
                && obs.frequency == prev.frequency) {
                // A reset has no valid absolute origin until another stream is opened.
                self.rejected = true;
            }
        }
        reading.frame = reading.frame.max(self.heard).min(written);
        self.heard = reading.frame;
        reading
    }

    fn valid_frame(&self, obs: Observation, age: u64, written: u64, consumed: u64, rate: u32) -> Option<u64> {
        let frames = |units: u64| u64::try_from(units as u128 * rate as u128 / obs.frequency as u128).ok();
        let frame = frames(obs.units)?;
        let tolerance = rate as u64 / 10; // accommodates endpoint buffering and a coarse device period
        if frame > written || frame.abs_diff(consumed) > tolerance {
            return None;
        }
        if let Some(prev) = self.last_valid {
            if self.still_since.is_some_and(|since| obs.units == prev.units
                && obs.qpc_100ns.saturating_sub(since) >= 750_000 && consumed > frame) {
                return None;
            }
            let moved = frames(obs.units.checked_sub(prev.units)?)?;
            let elapsed = obs.qpc_100ns.checked_sub(prev.qpc_100ns)?;
            let expected = (elapsed as u128 * rate as u128 / HNS_PER_SECOND as u128) as u64;
            if prev.frequency != obs.frequency || moved > expected.saturating_add(tolerance / 2) {
                return None;
            }
        }
        // QPC advances the observation only a fraction of one device period; never beyond queued PCM.
        let nudge = (age.min(HNS_PER_SECOND / 100) * rate as u64) / HNS_PER_SECOND;
        Some(frame.saturating_add(nudge).min(written).min(consumed.saturating_add(nudge)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rate_conversion_and_reset_fallback() {
        let mut c = StreamClock::default();
        let sample = Observation { units: 10_000_000, frequency: 10_000_000, qpc_100ns: 22_000_000, now_100ns: 22_000_000, simulated: false };
        let a = c.read(Some(sample), 48_600, 500, 48_000);
        assert_eq!((a.frame, a.source), (48_000, "wasapi"));
        let reset = Observation { units: 0, qpc_100ns: 22_100_000, now_100ns: 22_100_000, ..sample };
        let b = c.read(Some(reset), 49_100, 500, 48_000);
        assert_eq!((b.frame, b.source), (48_600, "padding"));
        assert_eq!(c.read(Some(sample), 49_100, 100, 48_000).source, "padding");
    }

    #[test]
    fn stale_observation_cannot_move_past_the_submitted_tail() {
        let mut c = StreamClock::default();
        let s = Observation { units: u64::MAX, frequency: 48_000, qpc_100ns: 1, now_100ns: 2_000_000, simulated: true };
        assert_eq!(c.read(Some(s), 700, 200, 48_000).frame, 500);
        assert_eq!(c.read(None, 700, 250, 48_000).frame, 500);
    }

    #[test]
    fn fresh_zero_clock_uses_advancing_padding_and_recovers() {
        let mut c = StreamClock::default();
        let s = Observation { units: 0, frequency: 48_000, qpc_100ns: 10_000_000, now_100ns: 10_000_000, simulated: false };
        assert_eq!(c.read(Some(s), 1_000, 1_000, 48_000).source, "wasapi");
        let later = Observation { qpc_100ns: 10_800_000, now_100ns: 10_800_000, ..s };
        assert_eq!(c.read(Some(later), 4_000, 1_000, 48_000).source, "padding");
        let advancing = Observation { units: 4_000, qpc_100ns: 11_000_000, now_100ns: 11_000_000, ..s };
        assert_eq!(c.read(Some(advancing), 5_000, 1_000, 48_000).source, "wasapi");
        assert_eq!(c.read(Some(s), 5_100, 1_000, 48_000).source, "padding");
        let future = Observation { units: 0, qpc_100ns: 30_000_000, now_100ns: 11_100_000, ..s };
        assert_eq!(c.read(Some(future), 5_200, 1_000, 48_000).source, "padding");
        let next = Observation { units: 4_800, qpc_100ns: 11_200_000, now_100ns: 11_200_000, ..s };
        assert_eq!(c.read(Some(next), 5_800, 1_000, 48_000).source, "wasapi");
    }
}
