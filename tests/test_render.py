from PIL import Image

import mazes
from mazes.render import RenderOptions, measure


def center(maze, o, cell):
    pitch = o.cell_px + o.wall_px
    return (o.margin + o.wall_px + cell[0] * pitch + o.cell_px // 2,
            o.margin + o.wall_px + cell[1] * pitch + o.cell_px // 2)


def test_size_and_markers():
    m = mazes.generate(width=8, height=6, seed=1, solvable=True)
    o = RenderOptions(cell_px=20, wall_px=4, margin=10)
    img = mazes.render_image(m, o)
    assert img.size == measure(m, o) == (10 * 2 + 4 + 8 * 24, 10 * 2 + 4 + 6 * 24)
    assert img.mode == "RGB"
    assert img.getpixel((0, 0)) == (255, 255, 255)
    s = img.getpixel(center(m, o, m.start))
    g = img.getpixel(center(m, o, m.goal))
    assert s[1] > s[0] and s[1] > s[2]      # green start
    assert g[0] > g[1] and g[0] > g[2]      # red goal


def test_outer_border_is_wall():
    m = mazes.generate(width=5, height=5, seed=2)
    o = RenderOptions(cell_px=10, wall_px=2, margin=4, supersample=1)
    img = mazes.render_image(m, o)
    w, h = img.size
    for x in range(4, w - 4):
        assert img.getpixel((x, 4)) == (0, 0, 0)
        assert img.getpixel((x, h - 5)) == (0, 0, 0)
    for y in range(4, h - 4):
        assert img.getpixel((4, y)) == (0, 0, 0)
        assert img.getpixel((w - 5, y)) == (0, 0, 0)


def test_passages_and_walls_are_drawn_where_expected():
    m = mazes.generate(width=6, height=6, seed=3, loops=2)
    o = RenderOptions(cell_px=10, wall_px=2, margin=0, supersample=1)
    img = mazes.render_image(m, o)
    pitch = 12
    for y in range(6):
        for x in range(5):
            px = (2 + x * pitch + 10, 2 + y * pitch + 5)   # middle of the wall slot right of (x, y)
            assert (img.getpixel(px) == (0, 0, 0)) == (not m.right[y][x])
    for y in range(5):
        for x in range(6):
            px = (2 + x * pitch + 5, 2 + y * pitch + 10)
            assert (img.getpixel(px) == (0, 0, 0)) == (not m.down[y][x])


def test_variants_do_not_crash_and_have_expected_modes():
    pos, neg = mazes.generate_pair(width=7, height=7, seed=4)
    assert mazes.render_image(pos, grayscale=True).mode == "L"
    assert mazes.render_image(neg, theme="dark").getpixel((0, 0)) == (0, 0, 0)
    for markers in ("sg", "dots", "letters"):
        for style in ("lines", "blocks"):
            mazes.render_image(pos, markers=markers, style=style, supersample=1)
    mazes.render_image(pos, overlay="solution")
    mazes.render_image(neg, overlay="solution")   # no path: overlay is a no-op
    mazes.render_image(neg, overlay="components")
    mazes.render_image(pos, overlay="components")


def test_save_png(tmp_path):
    m = mazes.generate(width=5, height=5, seed=5)
    p = tmp_path / "m.png"
    mazes.save_png(m, p, cell_px=8)
    with Image.open(p) as img:
        assert img.size == measure(m, RenderOptions(cell_px=8))
