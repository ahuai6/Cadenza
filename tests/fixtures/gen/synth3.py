import sys; import os; sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import synth2
synth2.song(100,21,'hold100',stop=False,push=True); synth2.song(128,22,'hold128',stop=True,push=False); synth2.song(92,23,'hold92')
