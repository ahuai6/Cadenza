# a pop arrangement with the accents a listener actually hears, and the loud-but-not-accents a naive detector catches
import numpy as np, json, sys
import os; sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from synth import kick,snare,hat,crash,pad,save,sr
def bass(a,f0,dur):
    t=np.arange(int(dur*sr))/sr; return a*np.sin(2*np.pi*f0*t)*np.exp(-t*3)
def song(bpm,seed,name,stop=True,push=True):
    rng=np.random.default_rng(seed); beat=60/bpm
    plan=[('intro',8),('verse',32),('pre',16),('chorus',32),('chorus2',32),('break',16),('chorus3',32)]
    total=sum(n for _,n in plan)*beat+3; y=np.zeros(int(total*sr))
    T={'beats':[],'downbeats':[],'sections':[],'accents':[],'decoys':[]}
    def add(x,t):
        i=int(t*sr); j=min(len(y),i+len(x))
        if i<len(y): y[i:j]+=x[:j-i]
    tb=0.5
    for kind,nb in plan:
        T['sections'].append([kind,tb,tb+nb*beat]); lvl={'intro':.25,'verse':.35,'pre':.55,'break':.15}.get(kind,1.0)
        add(pad(nb*beat,0.05*lvl+0.01,110 if lvl<1 else 147),tb)
        for k in range(nb):
            t=tb+k*beat+rng.normal(0,0.004); T['beats'].append(t); down=k%4==0
            if down: T['downbeats'].append(t)
            if kind=='intro': add(hat(0.05,rng),t)
            elif kind=='verse':
                if k%2==0: add(kick(0.33),t)
                if k%4 in(1,3): add(snare(0.2,rng),t)
                if k%8==6: add(kick(0.5),t); T['decoys'].append(t)      # heavier, but the passage is quiet
                add(hat(0.06,rng),t)
            elif kind=='pre':
                add(kick(0.4+0.3*k/nb),t)
                if k%4 in(1,3) and k<12: add(snare(0.35,rng),t)
                if k>=12:                                               # a snare fill into the chorus: busy, not an accent
                    for s in range(4): add(snare(0.2+0.1*s+0.1*(k-12),rng),t+s*beat/4)
                    T['decoys'].append(t)
                add(hat(0.12,rng),t)
            elif kind.startswith('chorus'):
                last=k==nb-1
                if stop and kind=='chorus' and last: continue          # a one-beat stop before the next chorus
                add(kick(0.85),t); T['decoys'].append(t) if (k%4 in (1,2,3) and k not in(0,16)) else None
                if k%4 in(1,3): add(snare(0.6,rng),t)
                for h in range(2): add(hat(0.16,rng),t+h*beat/2)
                if k in(0,16):
                    if not (push and kind=='chorus3' and k==0):
                        add(crash(0.55,rng),t); add(bass(0.5,55,beat*2),t); T['accents'].append(t)
            elif kind=='break':
                if down: add(kick(0.2),t)
                if push and k==nb-1:                                   # the chorus is anticipated by an eighth
                    tp=t+beat/2; add(crash(0.55,rng),tp); add(kick(0.9),tp); add(bass(0.5,55,beat*2),tp); T['accents'].append(tp)
        tb+=nb*beat
    y=y/np.max(np.abs(y))*0.9; save(name,y,T,bpm)
if __name__=="__main__": song(112,5,'songpop'); song(86,6,'songpop86'); song(150,7,'songpop150')

