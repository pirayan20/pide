import argparse
import sys
import time

p = argparse.ArgumentParser()
p.add_argument('--seconds', type=float, default=20)
p.add_argument('--hz', type=float, default=120)
p.add_argument('--rows', type=int, default=24)
p.add_argument('--title', action='store_true')
a = p.parse_args()
start = time.monotonic()
frame = 0
while time.monotonic() - start < a.seconds:
    frame += 1
    content = '\x1b[H' + ''.join(f'\x1b[2Krow {row:02d}: terminal profiling frame {frame:06d} ' + 'x' * 64 + '\r\n' for row in range(a.rows))
    if a.title:
        content += f'\x1b]2;{chr(0x2801 + frame % 8)} Claude Code profiling\x07'
    sys.stdout.write(content)
    sys.stdout.flush()
    time.sleep(max(0, start + frame / a.hz - time.monotonic()))
print('\r\nPIDE PROFILE COMPLETE', frame, 'frames', flush=True)
