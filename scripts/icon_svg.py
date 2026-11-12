"""Writes build/icon.svg: an astrolabe whose sighting rule is a telescope aimed at a bright star."""
import math, random

S = 1024
CX, CY = 500, 536          # instrument centre, slightly low-left so the telescope has sky to point into
R = 292                    # outer limb radius
ANGLE = -38                # telescope tilt, degrees (negative = up to the right)
random.seed(7)

def polar(r, deg, cx=CX, cy=CY):
    a = math.radians(deg)
    return cx + r * math.cos(a), cy + r * math.sin(a)

out = []
w = out.append
w(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="{S}" height="{S}">')
w('''<defs>
  <linearGradient id="sky" x1="0" y1="1" x2="1" y2="0">
    <stop offset="0" stop-color="#03060C"/><stop offset="0.55" stop-color="#081428"/><stop offset="1" stop-color="#0F3A78"/>
  </linearGradient>
  <radialGradient id="dawn" cx="0.82" cy="0.17" r="0.75">
    <stop offset="0" stop-color="#3FD8FF" stop-opacity="0.42"/><stop offset="0.35" stop-color="#3F7BFF" stop-opacity="0.14"/><stop offset="1" stop-color="#3F7BFF" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="brass" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#FBE7A6"/><stop offset="0.5" stop-color="#E2B95B"/><stop offset="1" stop-color="#A8792B"/>
  </linearGradient>
  <linearGradient id="tube" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#FFF1C2"/><stop offset="0.45" stop-color="#E6BE62"/><stop offset="1" stop-color="#8E6321"/>
  </linearGradient>
  <filter id="glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="14"/></filter>
  <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5"/></filter>
  <clipPath id="tile"><rect x="100" y="100" width="824" height="824" rx="186"/></clipPath>
</defs>''')
w('<g clip-path="url(#tile)">')
w('<rect x="100" y="100" width="824" height="824" fill="url(#sky)"/>')
w('<rect x="100" y="100" width="824" height="824" fill="url(#dawn)"/>')
# pinprick stars
for _ in range(90):
    x, y = random.uniform(110, 914), random.uniform(110, 914)
    if math.hypot(x - CX, y - CY) < R + 20: continue
    w(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{random.uniform(0.9, 2.4):.1f}" fill="#fff" opacity="{random.uniform(0.25, 0.8):.2f}"/>')

# ---- astrolabe ----
w(f'<circle cx="{CX}" cy="{CY}" r="{R}" fill="#060C1A" fill-opacity="0.6"/>')
# throne and shackle at the top
tx, ty = polar(R + 6, -90)
w(f'<path d="M{tx-46},{ty+10} Q{tx},{ty-58} {tx+46},{ty+10}" fill="url(#brass)"/>')
w(f'<circle cx="{tx}" cy="{ty-58}" r="26" fill="none" stroke="url(#brass)" stroke-width="11"/>')
# limb: two rings with a degree scale between them
w(f'<circle cx="{CX}" cy="{CY}" r="{R}" fill="none" stroke="url(#brass)" stroke-width="16"/>')
w(f'<circle cx="{CX}" cy="{CY}" r="{R-46}" fill="none" stroke="url(#brass)" stroke-width="5"/>')
for d in range(0, 360, 5):
    long = d % 15 == 0
    x1, y1 = polar(R - 10, d); x2, y2 = polar(R - (40 if long else 26), d)
    w(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="#E8C56F" stroke-width="{4 if long else 2.2}" stroke-linecap="round" opacity="{0.95 if long else 0.6}"/>')
# plate: almucantars (nested altitude circles) rising toward the zenith, clipped to the plate
w(f'<clipPath id="plate"><circle cx="{CX}" cy="{CY}" r="{R-52}"/></clipPath><g clip-path="url(#plate)" fill="none" stroke="#8FC4FF" stroke-opacity="0.34" stroke-width="2.4">')
for i, r in enumerate([52, 96, 142, 192, 248, 312]):
    w(f'<circle cx="{CX}" cy="{CY - 150 + r * 0.72:.1f}" r="{r}"/>')
w(f'<line x1="{CX-R}" y1="{CY+62}" x2="{CX+R}" y2="{CY+62}" stroke-opacity="0.45"/>')   # horizon
w(f'<line x1="{CX}" y1="{CY-R}" x2="{CX}" y2="{CY+R}" stroke-opacity="0.3"/>')
w('</g>')
# rete: the off-centre ecliptic ring with star pointers
ex, ey, er = CX - 8, CY - 74, 150
w(f'<circle cx="{ex}" cy="{ey}" r="{er}" fill="none" stroke="url(#brass)" stroke-width="9"/>')
for d, ln in [(200, 62), (250, 44), (300, 70), (20, 52), (95, 86), (150, 58)]:
    x1, y1 = polar(er, d, ex, ey); x2, y2 = polar(er + ln, d + 14, ex, ey)
    mx, my = polar(er + ln * 0.55, d - 6, ex, ey)
    w(f'<path d="M{x1:.1f},{y1:.1f} Q{mx:.1f},{my:.1f} {x2:.1f},{y2:.1f}" fill="none" stroke="url(#brass)" stroke-width="6" stroke-linecap="round"/>')
    w(f'<circle cx="{x2:.1f}" cy="{y2:.1f}" r="6.5" fill="#FFF3CC"/>')

# ---- the star it is aimed at, with the sight line ----
sx, sy = polar(R + 122, ANGLE)
ax, ay = polar(R + 8, ANGLE)
w(f'<line x1="{ax:.1f}" y1="{ay:.1f}" x2="{sx:.1f}" y2="{sy:.1f}" stroke="#3FD8FF" stroke-width="5" stroke-dasharray="2 17" stroke-linecap="round" opacity="0.9"/>')
w(f'<circle cx="{sx:.1f}" cy="{sy:.1f}" r="54" fill="#3FD8FF" filter="url(#glow)" opacity="0.95"/>')
def star(cx, cy, long, short):
    pts = []
    for k in range(8):
        r = long if k % 2 == 0 else short
        a = math.radians(k * 45 - 90)
        pts.append(f'{cx + r * math.cos(a):.1f},{cy + r * math.sin(a):.1f}')
    return ' '.join(pts)
w(f'<polygon points="{star(sx, sy, 62, 11)}" fill="#EFFCFF"/>')
w(f'<circle cx="{sx:.1f}" cy="{sy:.1f}" r="13" fill="#fff"/>')

# ---- telescope across the pivot, objective toward the star ----
w(f'<g transform="translate({CX},{CY}) rotate({ANGLE})">')
w('<g filter="url(#soft)" opacity="0.5"><rect x="-246" y="-6" width="560" height="64" rx="20" fill="#02040C"/></g>')
w('<path d="M-262,-17 L-118,-23 L-118,23 L-262,17 Z" fill="url(#tube)"/>')                     # eyepiece draw tube
w('<path d="M-126,-30 L96,-39 L96,39 L-126,30 Z" fill="url(#tube)"/>')                          # main tube
w('<path d="M88,-46 L300,-56 L300,56 L88,46 Z" fill="url(#tube)"/>')                           # objective tube
for x, h in [(-126, 34), (88, 50), (292, 60)]:                                                  # collars
    w(f'<rect x="{x-9}" y="{-h}" width="20" height="{2*h}" rx="6" fill="#FFF0BF"/><rect x="{x-9}" y="{h*0.2:.0f}" width="20" height="{h*0.8:.0f}" rx="6" fill="#8E6321" opacity="0.45"/>')
w('<rect x="-280" y="-21" width="22" height="42" rx="7" fill="#FFF0BF"/>')                      # eyecup
w('<ellipse cx="302" cy="0" rx="10" ry="52" fill="#3FD8FF" opacity="0.85"/>')                   # lit objective lens
w('</g>')
# pivot pin
w(f'<circle cx="{CX}" cy="{CY}" r="24" fill="#060C1A"/><circle cx="{CX}" cy="{CY}" r="24" fill="none" stroke="#FFF0BF" stroke-width="8"/><circle cx="{CX}" cy="{CY}" r="7" fill="#FFF0BF"/>')
w('</g>')
# a hairline edge so the tile holds its shape on dark docks
w('<rect x="101.5" y="101.5" width="821" height="821" rx="184.5" fill="none" stroke="#fff" stroke-opacity="0.10" stroke-width="3"/>')
w('</svg>')
open('build/icon.svg', 'w').write('\n'.join(out))
print('wrote build/icon.svg', sum(len(x) for x in out), 'bytes')
