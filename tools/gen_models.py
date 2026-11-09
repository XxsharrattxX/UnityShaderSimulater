"""Generate the small preset OBJ models used by the preview pane."""
import math
import os

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models")
os.makedirs(OUT, exist_ok=True)


def write_obj(name, verts, faces):
    """verts: list of (pos3, normal3, uv2); faces: list of index triples/quads (0-based)."""
    lines = ["# unity-shader-lab preset model", "o " + name]
    for p, _, _ in verts:
        lines.append("v %.6f %.6f %.6f" % p)
    for _, _, uv in verts:
        lines.append("vt %.6f %.6f" % uv)
    for _, n, _ in verts:
        lines.append("vn %.6f %.6f %.6f" % n)
    for f in faces:
        lines.append("f " + " ".join("%d/%d/%d" % (i + 1, i + 1, i + 1) for i in f))
    path = os.path.join(OUT, name + ".obj")
    with open(path, "w", encoding="ascii", newline="\n") as fh:
        fh.write("\n".join(lines) + "\n")
    print("%-12s %6d verts %6d faces %7.1f KB" % (name, len(verts), len(faces), os.path.getsize(path) / 1024))


def normalize(v):
    l = math.sqrt(sum(c * c for c in v)) or 1.0
    return tuple(c / l for c in v)


def sub(a, b):
    return tuple(x - y for x, y in zip(a, b))


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def cube():
    # 6 faces x 4 corners, flat normals, simple planar UVs
    faces_def = [
        ((0, 0, 1), [(-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]),
        ((0, 0, -1), [(1, -1, -1), (-1, -1, -1), (-1, 1, -1), (1, 1, -1)]),
        ((1, 0, 0), [(1, -1, 1), (1, -1, -1), (1, 1, -1), (1, 1, 1)]),
        ((-1, 0, 0), [(-1, -1, -1), (-1, -1, 1), (-1, 1, 1), (-1, 1, -1)]),
        ((0, 1, 0), [(-1, 1, 1), (1, 1, 1), (1, 1, -1), (-1, 1, -1)]),
        ((0, -1, 0), [(-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1)]),
    ]
    verts, faces = [], []
    for n, corners in faces_def:
        base = len(verts)
        for k, p in enumerate(corners):
            uv = ((0, 0), (1, 0), (1, 1), (0, 1))[k]
            verts.append((tuple(c * 0.75 for c in p), n, uv))
        faces.append((base, base + 1, base + 2))
        faces.append((base, base + 2, base + 3))
    write_obj("cube", verts, faces)


def sphere(rings=20, segs=32):
    verts, faces = [], []
    for i in range(rings + 1):
        phi = math.pi * i / rings
        for j in range(segs + 1):
            theta = 2 * math.pi * j / segs
            n = (math.sin(phi) * math.cos(theta), math.cos(phi), math.sin(phi) * math.sin(theta))
            verts.append(((n[0], n[1], n[2]), n, (j / segs, 1 - i / rings)))
    row = segs + 1
    for i in range(rings):
        for j in range(segs):
            a = i * row + j
            b, c, d = a + 1, a + row, a + row + 1
            faces.append((a, c, b))
            faces.append((b, c, d))
    write_obj("sphere", verts, faces)


def torus(major=40, minor=18, R=0.85, r=0.34):
    verts, faces = [], []
    for i in range(major + 1):
        u = 2 * math.pi * i / major
        for j in range(minor + 1):
            v = 2 * math.pi * j / minor
            p = ((R + r * math.cos(v)) * math.cos(u), r * math.sin(v), (R + r * math.cos(v)) * math.sin(u))
            n = (math.cos(v) * math.cos(u), math.sin(v), math.cos(v) * math.sin(u))
            verts.append((p, n, (i / major, j / minor)))
    row = minor + 1
    for i in range(major):
        for j in range(minor):
            a = i * row + j
            b, c, d = a + 1, a + row, a + row + 1
            faces.append((a, c, b))
            faces.append((b, c, d))
    write_obj("torus", verts, faces)


def gem():
    t = (1 + math.sqrt(5)) / 2
    raw = [(-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0), (0, -1, t), (0, 1, t),
           (0, -1, -t), (0, 1, -t), (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1)]
    scale = 1.0 / math.sqrt(1 + t * t)
    pts = [normalize(p) for p in raw]
    tri = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4),
           (11, 10, 2), (10, 7, 6), (7, 1, 8), (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8),
           (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
    verts, faces = [], []
    for a, b, c in tri:
        pa, pb, pc = pts[a], pts[b], pts[c]
        n = normalize(cross(sub(pb, pa), sub(pc, pa)))
        base = len(verts)
        for p in (pa, pb, pc):
            uv = (0.5 + 0.5 * math.atan2(p[2], p[0]) / math.pi, 0.5 - 0.5 * math.asin(max(-1, min(1, p[1]))) / math.pi)
            verts.append((tuple(v * 0.9 for v in p), n, uv))
        faces.append((base, base + 1, base + 2))
    write_obj("gem", verts, faces)


cube()
sphere()
torus()
gem()
print("done ->", OUT)