#!/usr/bin/env python3
"""Rebuild the project from an LLM reply (or the master document) that uses ===== FILE: path ===== blocks.
Usage: python3 unpack.py reply.txt [target-dir]"""
import os, re, sys, stat
src = open(sys.argv[1], encoding='utf-8').read()
out = sys.argv[2] if len(sys.argv) > 2 else 'curiosity-atelier'
n = 0
for m in re.finditer(r'^===== FILE: (.+?) =====\n(.*?)^===== END FILE =====', src, re.S | re.M):
    rel, body = m.group(1).strip(), m.group(2)
    p = os.path.normpath(os.path.join(out, rel))
    if rel.startswith('/') or '..' in rel.split('/') or not p.startswith(os.path.normpath(out)):
        print('skipping unsafe path', rel); continue
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, 'w', encoding='utf-8').write(body)
    if rel.endswith('.sh'): os.chmod(p, os.stat(p).st_mode | stat.S_IXUSR)
    n += 1; print('wrote', p)
os.makedirs(os.path.join(out, 'data', 'editions'), exist_ok=True)
print(f'{n} files written to {out}/. Next: cd {out} && GEMINI_API_KEY=... ./bootstrap.sh')
