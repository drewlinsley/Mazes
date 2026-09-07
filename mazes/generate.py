"""Maze generation with controlled solvability.

This is a line-by-line port of web/maze.js. Both consume the seeded PRNG in
exactly the same order, so ``generate_pair(seed=s, ...)`` here and
``MazeGen.generatePair({seed: s, ...})`` in the browser give identical mazes
(checked by tests/test_parity.py).

Construction (see web/maze.js for the rationale):

1. random spanning tree T over a W x H grid (a perfect maze);
2. place start S and goal G;
3. pick an edge e on the unique S->G path; removing it splits the tree into
   a component A (with S) and B (with G);
4. choose ``loops`` extra passages X and one more passage w, all joining two
   cells of the same component;

   solvable   = T + X
   unsolvable = T - e + X + w

Both members of a pair have the same number of passages, the same S and G,
and differ at exactly two wall segments.
"""
from dataclasses import dataclass, field, asdict
import math

from .prng import Mulberry32, normalize_seed

VERSION = "1.0.0"

DEFAULTS = {
    "width": 10,
    "height": 10,
    "seed": 0,
    "algorithm": "backtracker",   # backtracker | kruskal | prim
    "placement": "random",        # random | border | corners | far
    "minDistance": None,          # min Manhattan distance for 'random' (default: half the larger side)
    "cut": "balanced",            # balanced | random | float in [0, 1]
    "loops": 3,                   # extra passages added to BOTH members of a pair
}

PRESETS = {
    "easy":    {"width": 6,  "height": 6,  "loops": 1,  "cut": "random",   "placement": "random", "algorithm": "backtracker"},
    "medium":  {"width": 10, "height": 10, "loops": 3,  "cut": "balanced", "placement": "random", "algorithm": "backtracker"},
    "hard":    {"width": 16, "height": 16, "loops": 6,  "cut": "balanced", "placement": "far",    "algorithm": "backtracker"},
    "extreme": {"width": 24, "height": 24, "loops": 12, "cut": "balanced", "placement": "far",    "algorithm": "backtracker"},
}

PLACEMENTS = ("random", "border", "corners", "far")


# --------------------------------------------------------------------------
# Flat grid helpers (right[i]: opening between i and i+1; down[i]: i and i+W)
# --------------------------------------------------------------------------
class _Grid:
    __slots__ = ("W", "H", "N", "right", "down")

    def __init__(self, W, H, right=None, down=None):
        self.W, self.H, self.N = W, H, W * H
        self.right = bytearray(right) if right is not None else bytearray(W * H)
        self.down = bytearray(down) if down is not None else bytearray(W * H)

    def copy(self):
        return _Grid(self.W, self.H, self.right, self.down)


def _set_edge(g, a, b, value):
    if b == a + 1:
        g.right[a] = value
    elif b == a - 1:
        g.right[b] = value
    elif b == a + g.W:
        g.down[a] = value
    elif b == a - g.W:
        g.down[b] = value
    else:
        raise ValueError(f"cells {a} and {b} are not adjacent")


def _carve(g, a, b):
    _set_edge(g, a, b, 1)


def _is_open(g, a, b):
    if b == a + 1:
        return g.right[a] == 1
    if b == a - 1:
        return g.right[b] == 1
    if b == a + g.W:
        return g.down[a] == 1
    if b == a - g.W:
        return g.down[b] == 1
    return False


def _grid_neighbors(W, H, i):
    """Grid neighbours in the fixed order up, right, down, left."""
    x = i % W
    y = i // W
    out = []
    if y > 0:
        out.append(i - W)
    if x < W - 1:
        out.append(i + 1)
    if y < H - 1:
        out.append(i + W)
    if x > 0:
        out.append(i - 1)
    return out


def _open_neighbors(g, i):
    W = g.W
    x = i % W
    y = i // W
    out = []
    if y > 0 and g.down[i - W]:
        out.append(i - W)
    if x < W - 1 and g.right[i]:
        out.append(i + 1)
    if y < g.H - 1 and g.down[i]:
        out.append(i + W)
    if x > 0 and g.right[i - 1]:
        out.append(i - 1)
    return out


def _all_edges(W, H):
    out = []
    for y in range(H):
        for x in range(W):
            i = y * W + x
            if x < W - 1:
                out.append([i, i + 1])
            if y < H - 1:
                out.append([i, i + W])
    return out


def _manhattan(W, a, b):
    return abs(a % W - b % W) + abs(a // W - b // W)


# --------------------------------------------------------------------------
# Spanning trees
# --------------------------------------------------------------------------
def _tree_backtracker(g, rnd):
    visited = bytearray(g.N)
    stack = [rnd.int(g.N)]
    visited[stack[0]] = 1
    while stack:
        cur = stack[-1]
        nb = [j for j in _grid_neighbors(g.W, g.H, cur) if not visited[j]]
        if not nb:
            stack.pop()
            continue
        nxt = nb[rnd.int(len(nb))]
        visited[nxt] = 1
        _carve(g, cur, nxt)
        stack.append(nxt)


def _tree_kruskal(g, rnd):
    edges = rnd.shuffle(_all_edges(g.W, g.H))
    parent = list(range(g.N))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for a, b in edges:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
            _carve(g, a, b)


def _tree_prim(g, rnd):
    in_tree = bytearray(g.N)
    start = rnd.int(g.N)
    in_tree[start] = 1
    frontier = [[start, j] for j in _grid_neighbors(g.W, g.H, start)]
    while frontier:
        k = rnd.int(len(frontier))
        a, b = frontier[k]
        frontier[k] = frontier[-1]
        frontier.pop()
        if in_tree[b]:
            continue
        in_tree[b] = 1
        _carve(g, a, b)
        for j in _grid_neighbors(g.W, g.H, b):
            if not in_tree[j]:
                frontier.append([b, j])


TREE_ALGORITHMS = {"backtracker": _tree_backtracker, "kruskal": _tree_kruskal, "prim": _tree_prim}


# --------------------------------------------------------------------------
# Graph utilities
# --------------------------------------------------------------------------
def _bfs(g, src):
    dist = [-1] * g.N
    parent = [-1] * g.N
    order = [src]
    dist[src] = 0
    head = 0
    while head < len(order):
        cur = order[head]
        head += 1
        for j in _open_neighbors(g, cur):
            if dist[j] < 0:
                dist[j] = dist[cur] + 1
                parent[j] = cur
                order.append(j)
    return dist, parent, order


def _path_from(parent, dist, src, dst):
    if dist[dst] < 0:
        return None
    p = []
    c = dst
    while c != -1:
        p.append(c)
        if c == src:
            break
        c = parent[c]
    p.reverse()
    return p


def _component_labels(g):
    comp = [-1] * g.N
    sizes = []
    c = 0
    for i in range(g.N):
        if comp[i] >= 0:
            continue
        q = [i]
        comp[i] = c
        h = 0
        while h < len(q):
            u = q[h]
            h += 1
            for j in _open_neighbors(g, u):
                if comp[j] < 0:
                    comp[j] = c
                    q.append(j)
        sizes.append(len(q))
        c += 1
    return comp, sizes


def _subtree_sizes(tree, root):
    _dist, parent, order = _bfs(tree, root)
    size = [1] * tree.N
    for k in range(len(order) - 1, 0, -1):
        v = order[k]
        size[parent[v]] += size[v]
    return size


# --------------------------------------------------------------------------
# Endpoints and cut selection
# --------------------------------------------------------------------------
def _place_endpoints(tree, placement, rnd, min_distance):
    W, H, N = tree.W, tree.H, tree.N
    if placement == "corners":
        return 0, N - 1
    if placement == "border":
        side = rnd.int(4)  # 0 left->right, 1 right->left, 2 top->bottom, 3 bottom->top
        span = H if side < 2 else W
        a = rnd.int(span)
        b = rnd.int(span)
        if side == 0:
            return a * W, b * W + (W - 1)
        if side == 1:
            return a * W + (W - 1), b * W
        if side == 2:
            return a, (H - 1) * W + b
        return (H - 1) * W + a, b
    if placement == "far":
        s = rnd.int(N)
        dist = _bfs(tree, s)[0]
        best, t = -1, -1
        for i in range(N):
            if dist[i] > best:
                best, t = dist[i], i
        return s, t
    if placement == "random":
        for _ in range(10000):
            s = rnd.int(N)
            t = rnd.int(N)
            if s != t and _manhattan(W, s, t) >= min_distance:
                return s, t
        raise RuntimeError(f"could not satisfy minDistance={min_distance}")
    raise ValueError(f"unknown placement: {placement}")


def _choose_cut(path_cells, size, N, cut, rnd):
    L = len(path_cells) - 1
    if L <= 0:
        raise RuntimeError("start and goal coincide")
    if cut == "random":
        return rnd.int(L)
    if isinstance(cut, (int, float)) and not isinstance(cut, bool):
        k = int(cut * L)
        return max(0, min(L - 1, k))
    if cut == "balanced":
        def score(k):
            return min(size[path_cells[k]], N - size[path_cells[k]])
        idx = sorted(range(L), key=lambda k: (-score(k), k))
        return idx[rnd.int(min(3, L))]
    raise ValueError(f"unknown cut: {cut}")


# --------------------------------------------------------------------------
# Public API
# --------------------------------------------------------------------------
def normalize_params(user_params=None, **kwargs):
    p = dict(DEFAULTS)
    p.update(user_params or {})
    p.update(kwargs)
    # accept snake_case alias for the one camelCase key
    if "min_distance" in p:
        p["minDistance"] = p.pop("min_distance")
    p["width"] = int(p["width"])
    p["height"] = int(p["height"])
    if not (3 <= p["width"] <= 100 and 3 <= p["height"] <= 100):
        raise ValueError("width and height must be integers between 3 and 100")
    if p["algorithm"] not in TREE_ALGORITHMS:
        raise ValueError(f"unknown algorithm: {p['algorithm']}")
    if p["placement"] not in PLACEMENTS:
        raise ValueError(f"unknown placement: {p['placement']}")
    cut = p["cut"]
    if isinstance(cut, str):
        try:
            cut = float(cut) if cut not in ("balanced", "random") else cut
        except ValueError:
            pass
    if isinstance(cut, bool):
        raise ValueError("cut must be 'balanced', 'random' or a float in [0, 1]")
    if isinstance(cut, (int, float)):
        cut = float(cut)
        if not (0.0 <= cut <= 1.0):
            raise ValueError("numeric cut must lie in [0, 1]")
    elif cut not in ("balanced", "random"):
        raise ValueError(f"unknown cut: {cut}")
    p["cut"] = cut
    p["loops"] = max(0, int(p["loops"]))
    md = p["minDistance"]
    p["minDistance"] = (max(2, math.ceil(max(p["width"], p["height"]) / 2))
                        if md is None or md == "" else int(md))
    p["seed"] = normalize_seed(p["seed"])
    return p


def _xy(W, i):
    return [i % W, i // W]


def _edge_xy(W, e):
    return [_xy(W, e[0]), _xy(W, e[1])]


def _rows(flat, W, H):
    return [[int(flat[y * W + x]) for x in range(W)] for y in range(H)]


@dataclass
class Maze:
    """A maze with a known solvability label. Field names match the JS JSON."""
    version: str
    width: int
    height: int
    seed: int
    params: dict
    solvable: bool
    start: list
    goal: list
    right: list   # right[y][x] == 1: opening between (x, y) and (x+1, y)
    down: list    # down[y][x]  == 1: opening between (x, y) and (x, y+1)
    meta: dict = field(default_factory=dict)

    def to_dict(self):
        return asdict(self)

    @classmethod
    def from_dict(cls, d):
        return cls(**{k: d[k] for k in cls.__dataclass_fields__ if k in d})

    @property
    def cells(self):
        return self.width * self.height


def _build_maze(g, s, t, solvable, p, meta):
    return Maze(
        version=VERSION,
        width=g.W,
        height=g.H,
        seed=p["seed"],
        params={
            "width": p["width"], "height": p["height"], "seed": p["seed"], "algorithm": p["algorithm"],
            "placement": p["placement"], "minDistance": p["minDistance"], "cut": p["cut"], "loops": p["loops"],
        },
        solvable=solvable,
        start=_xy(g.W, s),
        goal=_xy(g.W, t),
        right=_rows(g.right, g.W, g.H),
        down=_rows(g.down, g.W, g.H),
        meta=meta,
    )


def _generate_pair_internal(user_params=None, **kwargs):
    p = normalize_params(user_params, **kwargs)
    W, H = p["width"], p["height"]
    N = W * H
    rnd = Mulberry32(p["seed"])

    # 1. spanning tree
    tree = _Grid(W, H)
    TREE_ALGORITHMS[p["algorithm"]](tree, rnd)

    # 2. endpoints and the unique tree path between them
    s, t = _place_endpoints(tree, p["placement"], rnd, p["minDistance"])
    dist, parent, _order = _bfs(tree, s)
    path_cells = _path_from(parent, dist, s, t)
    L = len(path_cells) - 1

    # 3. cut edge
    size = _subtree_sizes(tree, t)
    k = _choose_cut(path_cells, size, N, p["cut"], rnd)
    cut_a, cut_b = path_cells[k], path_cells[k + 1]
    start_side = size[cut_a]
    component_sizes = [start_side, N - start_side]

    # 4. within-component candidate passages
    _set_edge(tree, cut_a, cut_b, 0)
    comp, _sizes = _component_labels(tree)
    _set_edge(tree, cut_a, cut_b, 1)
    candidates = [e for e in _all_edges(W, H) if not _is_open(tree, e[0], e[1]) and comp[e[0]] == comp[e[1]]]
    rnd.shuffle(candidates)
    loops = min(p["loops"], max(0, len(candidates) - 1))
    X = candidates[:loops]
    w = candidates[loops] if len(candidates) > loops else None

    # 5. assemble both members of the pair
    pos = tree.copy()
    neg = tree.copy()
    _set_edge(neg, cut_a, cut_b, 0)
    for e in X:
        _carve(pos, e[0], e[1])
        _carve(neg, e[0], e[1])
    if w:
        _carve(neg, w[0], w[1])

    dist_p, parent_p, _ = _bfs(pos, s)
    solution = _path_from(parent_p, dist_p, s, t)
    passages = N - 1 + len(X)

    shared = {
        "algorithm": p["algorithm"],
        "placement": p["placement"],
        "cut": p["cut"],
        "loopsRequested": p["loops"],
        "loops": len(X),
        "treePathLength": L,
        "treePath": [_xy(W, i) for i in path_cells],
        "cutEdge": _edge_xy(W, [cut_a, cut_b]),
        "cutIndex": k,
        "openedEdge": _edge_xy(W, w) if w else None,
        "loopEdges": [_edge_xy(W, e) for e in X],
        "componentSizes": component_sizes,
        "pocketFrac": min(component_sizes) / N,
        "passages": passages,
        "wallsBalanced": bool(w),
    }
    meta_pos = dict(shared, solutionLength=len(solution) - 1, solution=[_xy(W, i) for i in solution])
    meta_neg = dict(shared, solutionLength=None, solution=None, passages=passages if w else passages - 1)
    return _build_maze(pos, s, t, True, p, meta_pos), _build_maze(neg, s, t, False, p, meta_neg), rnd


def generate_pair(params=None, **kwargs):
    """Return ``(positive, negative)``: the minimal pair for these params."""
    pos, neg, _rnd = _generate_pair_internal(params, **kwargs)
    return pos, neg


def generate(params=None, solvable=None, **kwargs):
    """Return one maze. ``solvable`` may be True, False or None (fair coin
    drawn from the same seeded stream, so the label is reproducible)."""
    if params and "solvable" in params:
        params = dict(params)
        solvable = params.pop("solvable") if solvable is None else solvable
    pos, neg, rnd = _generate_pair_internal(params, **kwargs)
    if solvable is None or solvable == "":
        solvable = rnd.random() < 0.5
    elif isinstance(solvable, str):
        solvable = solvable.lower() in ("true", "1", "yes")
    return pos if solvable else neg


# --------------------------------------------------------------------------
# Analysis helpers on Maze objects
# --------------------------------------------------------------------------
def _grid_from_maze(maze):
    g = _Grid(maze.width, maze.height)
    for y in range(maze.height):
        for x in range(maze.width):
            g.right[y * maze.width + x] = 1 if maze.right[y][x] else 0
            g.down[y * maze.width + x] = 1 if maze.down[y][x] else 0
    return g


def solve(maze):
    """BFS from start; also labels connected components."""
    g = _grid_from_maze(maze)
    W = g.W
    s = maze.start[1] * W + maze.start[0]
    t = maze.goal[1] * W + maze.goal[0]
    dist, parent, _ = _bfs(g, s)
    path = _path_from(parent, dist, s, t)
    comp, sizes = _component_labels(g)
    return {
        "solvable": path is not None,
        "path": [_xy(W, i) for i in path] if path else None,
        "pathLength": len(path) - 1 if path else None,
        "dist": _rows(dist, g.W, g.H),
        "components": _rows(comp, g.W, g.H),
        "componentSizes": sizes,
        "startComponent": comp[s],
        "goalComponent": comp[t],
    }


def count_passages(maze):
    return sum(int(bool(v)) for row in maze.right for v in row) + sum(int(bool(v)) for row in maze.down for v in row)


def to_block_grid(maze):
    """(2H+1) x (2W+1) grid, 1 = wall, 0 = open. Cell (x, y) is block (2x+1, 2y+1)."""
    W, H = maze.width, maze.height
    rows = [[1] * (2 * W + 1) for _ in range(2 * H + 1)]
    for y in range(H):
        for x in range(W):
            rows[2 * y + 1][2 * x + 1] = 0
            if maze.right[y][x]:
                rows[2 * y + 1][2 * x + 2] = 0
            if maze.down[y][x]:
                rows[2 * y + 2][2 * x + 1] = 0
    return rows


def to_ascii(maze, wall="#", floor=".", start="S", goal="G", path=None):
    """ASCII block rendering; ``path`` (a character) overlays the solution."""
    blocks = to_block_grid(maze)
    chars = [[wall if v else floor for v in row] for row in blocks]
    if path and maze.meta.get("solution"):
        sol = maze.meta["solution"]
        for k, (x, y) in enumerate(sol):
            chars[2 * y + 1][2 * x + 1] = path
            if k + 1 < len(sol):
                nx, ny = sol[k + 1]
                chars[y + ny + 1][x + nx + 1] = path
    chars[2 * maze.start[1] + 1][2 * maze.start[0] + 1] = start
    chars[2 * maze.goal[1] + 1][2 * maze.goal[0] + 1] = goal
    return "\n".join("".join(row) for row in chars)
