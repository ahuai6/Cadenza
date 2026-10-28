import numpy as np, wave, json, sys
sr=44100
def kick(a):
    t=np.arange(int(0.35*sr))/sr; f=50+90*np.exp(-t*30); return a*np.sin(2*np.pi*np.cumsum(f)/sr)*np.exp(-t*9)
def snare(a,rng):
    t=np.arange(int(0.25*sr))/sr; return a*(rng.standard_normal(len(t))*np.exp(-t*18)*0.7+np.sin(2*np.pi*190*t)*np.exp(-t*25)*0.4)
def hat(a,rng):
    t=np.arange(int(0.06*sr))/sr; n=rng.standard_normal(len(t)); n=np.diff(n,prepend=0); return a*n*np.exp(-t*70)
def crash(a,rng):
    t=np.arange(int(1.5*sr))/sr; n=rng.standard_normal(len(t)); n=np.diff(n,prepend=0); return a*n*np.exp(-t*2.5)*0.6
def pad(dur,a,f0):
    t=np.arange(int(dur*sr))/sr; return a*sum(np.sin(2*np.pi*f*t) for f in [f0,f0*1.5,f0*2.01])/3
def build(bpm,plan,seed,swing=0.0,jitter=0.004):
    rng=np.random.default_rng(seed); beat=60/bpm; total=sum(b for _,b in plan)*beat+2
    y=np.zeros(int(total*sr)); truth={'beats':[],'downbeats':[],'sections':[],'accents':[]}
    def add(x,t):
        i=int(t*sr); j=min(len(y),i+len(x)); 
        if i<len(y): y[i:j]+=x[:j-i]
    tb=0.5
    for kind,nb in plan:
        truth['sections'].append([kind,tb,tb+nb*beat])
        lvl={'intro':0.25,'verse':0.35,'pre':0.55,'chorus':1.0,'break':0.15,'drop':1.0}[kind]
        add(pad(nb*beat,0.05*lvl+0.01,110 if kind!='chorus' else 147),tb)
        for k in range(nb):
            t=tb+k*beat+rng.normal(0,jitter); truth['beats'].append(t)
            down=(k%4==0)
            if down: truth['downbeats'].append(t)
            if kind in('chorus','drop'):
                add(kick(0.9),t); 
                if k%4 in(1,3): add(snare(0.6,rng),t)
                if down and k%8==0: add(crash(0.5,rng),t); truth['accents'].append(t)
                for h in range(2): add(hat(0.18,rng),t+h*beat/2+(swing*beat/2 if h else 0))
            elif kind=='pre':
                if k%2==0: add(kick(0.55),t)
                if k%4==2: add(snare(0.35,rng),t)
                add(hat(0.12,rng),t)
            elif kind in('verse','intro'):
                if down or k%4==2: add(kick(0.32*lvl/0.35),t)
                if k%4==2 and kind=='verse': add(snare(0.18,rng),t+0.0)
                if k%8==6: add(kick(0.45),t)    # an occasional heavier hit inside a quiet part: must NOT trigger
                add(hat(0.06,rng),t)
            elif kind=='break':
                if down: add(kick(0.2),t)
        tb+=nb*beat
    y=y/np.max(np.abs(y))*0.9
    return y,truth
def save(name,y,truth,bpm):
    w=wave.open(name+'.wav','wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes((y*32767).astype(np.int16).tobytes()); w.close()
    truth['bpm']=bpm; json.dump(truth,open(name+'.json','w'))
def main():
  A=[('intro',8),('verse',32),('pre',16),('chorus',32),('break',8),('verse',16),('chorus',32)]
  y,tr=build(97,A,1,swing=0.1); save('song97',y,tr,97)
  B=[('intro',16),('verse',32),('pre',8),('drop',32),('break',16),('drop',32)]
  y,tr=build(138,B,2); save('song138',y,tr,138)
  C=[('verse',16),('chorus',16),('verse',16),('chorus',24)]
  y,tr=build(74,C,3,jitter=0.008); save('song74',y,tr,74)
  print('ok')
# half-time: kick on 1, snare on 3, hats in eighths; 140 BPM felt as 70
def build_half(bpm,bars,seed):
    rng=np.random.default_rng(seed); beat=60/bpm; total=bars*4*beat+2; y=np.zeros(int(total*sr)); truth={'beats':[],'downbeats':[],'sections':[['chorus',0.5,0.5+bars*4*beat]],'accents':[]}
    def add(x,t):
        i=int(t*sr); j=min(len(y),i+len(x))
        if i<len(y): y[i:j]+=x[:j-i]
    for k in range(bars*4):
        t=0.5+k*beat; truth['beats'].append(t)
        if k%4==0: truth['downbeats'].append(t); add(kick(0.9),t)
        if k%4==2: add(snare(0.8,rng),t)
        if k%8==7: add(kick(0.5),t+beat/2)
        for h in range(2): add(hat(0.15,rng),t+h*beat/2)
    y=y/np.max(np.abs(y))*0.9; return y,truth
def main_half():
  y,tr=build_half(140,32,9); save('songhalf',y,tr,140)
if __name__=='__main__':
  main(); main_half()
