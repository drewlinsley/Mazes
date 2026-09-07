"""Render mazes to images with PIL, using the same geometry as web/render.js.

    pitch = cell_px + wall_px
    cell (x, y) -> square at (margin + wall_px + x*pitch, margin + wall_px + y*pitch), size cell_px
    wall slots are wall_px wide; lattice pillars are wall_px squares
"""
from dataclasses import dataclass, replace
from typing import Optional

from PIL import Image, ImageDraw, ImageFont

from .generate import solve

THEMES = {
    "light": {"bg": (255, 255, 255), "wall": (0, 0, 0), "start": (44, 160, 44), "goal": (214, 39, 40), "dot": (31, 119, 180), "gray": (110, 110, 110)},
    "dark": {"bg": (0, 0, 0), "wall": (255, 255, 255), "start": (94, 230, 94), "goal": (255, 107, 107), "dot": (255, 209, 102), "gray": (154, 154, 154)},
}


@dataclass
class RenderOptions:
    style: str = "lines"         # lines | blocks
    cell_px: int = 24
    wall_px: int = 4
    margin: int = 12
    theme: str = "light"         # light | dark
    markers: str = "sg"          # sg | dots | letters
    marker_scale: float = 0.6
    grayscale: bool = False      # gray markers and an 8-bit 'L' output image
    overlay: Optional[str] = None  # None | solution | components
    supersample: int = 2         # anti-aliasing factor for discs (1 = pixel exact)

    def scaled(self, k):
        return replace(self, cell_px=self.cell_px * k, wall_px=self.wall_px * k, margin=self.margin * k, supersample=1)


def measure(maze, o: RenderOptions):
    pitch = o.cell_px + o.wall_px
    return 2 * o.margin + o.wall_px + maze.width * pitch, 2 * o.margin + o.wall_px + maze.height * pitch


def wall_slots(maze):
    """h[j][x]: wall above cell (x, j) (j == H: below last row); v[y][i]: wall left of cell (i, y)."""
    W, H = maze.width, maze.height
    h = [[j == 0 or j == H or not maze.down[j - 1][x] for x in range(W)] for j in range(H + 1)]
    v = [[i == 0 or i == W or not maze.right[y][i - 1] for i in range(W + 1)] for y in range(H)]
    return h, v


def _cell_origin(o, pitch, x, y):
    return o.margin + o.wall_px + x * pitch, o.margin + o.wall_px + y * pitch


def _rgba(rgb, alpha):
    return (rgb[0], rgb[1], rgb[2], int(round(alpha * 255)))


def _blend_rect(img, box, rgba):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).rectangle(box, fill=rgba)
    img.alpha_composite(layer)


def _render_at(maze, o: RenderOptions):
    t = THEMES.get(o.theme, THEMES["light"])
    width, height = measure(maze, o)
    W, H = maze.width, maze.height
    pitch = o.cell_px + o.wall_px
    img = Image.new("RGBA", (width, height), t["bg"] + (255,))
    draw = ImageDraw.Draw(img)

    if o.overlay == "components":
        r = solve(maze)
        colors = {r["startComponent"]: _rgba((44, 160, 44), 0.28), r["goalComponent"]: _rgba((214, 39, 40), 0.28)}
        tint = Image.new("RGBA", img.size, (0, 0, 0, 0))
        td = ImageDraw.Draw(tint)
        for y in range(H):
            for x in range(W):
                c = colors.get(r["components"][y][x], _rgba((128, 128, 128), 0.18))
                x0, y0 = _cell_origin(o, pitch, x, y)
                td.rectangle([x0, y0, x0 + o.cell_px - 1, y0 + o.cell_px - 1], fill=c)
                if x < W - 1 and maze.right[y][x]:
                    td.rectangle([x0 + o.cell_px, y0, x0 + o.cell_px + o.wall_px - 1, y0 + o.cell_px - 1], fill=c)
                if y < H - 1 and maze.down[y][x]:
                    td.rectangle([x0, y0 + o.cell_px, x0 + o.cell_px - 1, y0 + o.cell_px + o.wall_px - 1], fill=c)
        if not r["solvable"] and maze.meta.get("cutEdge"):
            a, b = maze.meta["cutEdge"]
            x0, y0 = _cell_origin(o, pitch, min(a[0], b[0]), min(a[1], b[1]))
            if a[1] == b[1]:
                td.rectangle([x0 + o.cell_px - o.wall_px, y0, x0 + o.cell_px + 2 * o.wall_px - 1, y0 + o.cell_px - 1], fill=(255, 140, 0, 242))
            else:
                td.rectangle([x0, y0 + o.cell_px - o.wall_px, x0 + o.cell_px - 1, y0 + o.cell_px + 2 * o.wall_px - 1], fill=(255, 140, 0, 242))
        img.alpha_composite(tint)
        draw = ImageDraw.Draw(img)

    # walls
    h, v = wall_slots(maze)
    wall = t["wall"] + (255,)
    for j in range(H + 1):
        for x in range(W):
            if h[j][x]:
                x0 = o.margin + o.wall_px + x * pitch
                y0 = o.margin + j * pitch
                draw.rectangle([x0, y0, x0 + o.cell_px - 1, y0 + o.wall_px - 1], fill=wall)
    for y in range(H):
        for i in range(W + 1):
            if v[y][i]:
                x0 = o.margin + i * pitch
                y0 = o.margin + o.wall_px + y * pitch
                draw.rectangle([x0, y0, x0 + o.wall_px - 1, y0 + o.cell_px - 1], fill=wall)
    for j in range(H + 1):
        for i in range(W + 1):
            fill = o.style == "blocks"
            if not fill:
                fill = ((i > 0 and h[j][i - 1]) or (i < W and h[j][i]) or (j > 0 and v[j - 1][i]) or (j < H and v[j][i]))
            if fill:
                x0 = o.margin + i * pitch
                y0 = o.margin + j * pitch
                draw.rectangle([x0, y0, x0 + o.wall_px - 1, y0 + o.wall_px - 1], fill=wall)

    # solution overlay
    if o.overlay == "solution":
        sol = maze.meta.get("solution") or solve(maze)["path"]
        if sol and len(sol) > 1:
            pts = []
            for x, y in sol:
                x0, y0 = _cell_origin(o, pitch, x, y)
                pts.append((x0 + o.cell_px / 2, y0 + o.cell_px / 2))
            layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
            ld = ImageDraw.Draw(layer)
            lw = max(2, int(round(o.cell_px * 0.3)))
            ld.line(pts, fill=(30, 144, 255, 191), width=lw, joint="curve")
            for px, py in (pts[0], pts[-1]):
                ld.ellipse([px - lw / 2, py - lw / 2, px + lw / 2, py + lw / 2], fill=(30, 144, 255, 191))
            img.alpha_composite(layer)
            draw = ImageDraw.Draw(img)

    # markers
    r = o.cell_px * o.marker_scale / 2
    sx, sy = _cell_origin(o, pitch, *maze.start)
    gx, gy = _cell_origin(o, pitch, *maze.goal)
    cs = (sx + o.cell_px / 2, sy + o.cell_px / 2)
    cg = (gx + o.cell_px / 2, gy + o.cell_px / 2)
    if o.markers == "letters":
        size = max(6, int(round(o.cell_px * 0.75)))
        try:
            font = ImageFont.truetype("DejaVuSans-Bold.ttf", size)
        except OSError:
            font = ImageFont.load_default()
        for txt, c in (("S", cs), ("G", cg)):
            draw.text(c, txt, fill=wall, font=font, anchor="mm")
    elif o.markers == "dots":
        col = (t["gray"] if o.grayscale else t["dot"]) + (255,)
        for c in (cs, cg):
            draw.ellipse([c[0] - r, c[1] - r, c[0] + r, c[1] + r], fill=col)
    else:
        col_s = (t["gray"] if o.grayscale else t["start"]) + (255,)
        draw.ellipse([cs[0] - r, cs[1] - r, cs[0] + r, cs[1] + r], fill=col_s)
        if o.grayscale:
            lw = max(2, int(round(r * 0.45)))
            draw.ellipse([cg[0] - r, cg[1] - r, cg[0] + r, cg[1] + r], outline=t["gray"] + (255,), width=lw)
        else:
            draw.ellipse([cg[0] - r, cg[1] - r, cg[0] + r, cg[1] + r], fill=t["goal"] + (255,))
    return img


def render_image(maze, options: Optional[RenderOptions] = None, **kwargs):
    """Render a maze to a PIL image ('RGB', or 'L' when grayscale)."""
    o = options or RenderOptions()
    if kwargs:
        o = replace(o, **kwargs)
    k = max(1, int(o.supersample))
    if k > 1:
        big = _render_at(maze, o.scaled(k))
        img = big.resize((big.width // k, big.height // k), Image.LANCZOS)
    else:
        img = _render_at(maze, o)
    img = img.convert("RGB")
    return img.convert("L") if o.grayscale else img


def save_png(maze, path, options: Optional[RenderOptions] = None, **kwargs):
    img = render_image(maze, options, **kwargs)
    img.save(path, format="PNG", optimize=True)
    return img
