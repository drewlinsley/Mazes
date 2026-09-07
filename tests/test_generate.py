"""Generator tests. Labels are verified with a union-find solver that shares
no code with the package's BFS."""
import itertools
import json

import pytest

import mazes
from mazes.prng import Mulberry32, fnv1a32, normalize_seed


def uf_connected(maze):
    """Independent connectivity check: union-find over the passage arrays."""
    W, H = maze.width, maze.height
    parent = list(range(W * H))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for y in range(H):
        for x in range(W):
            i = y * W + x
            if x < W - 1 and maze.right[y][x]:
                parent[find(i)] = find(i + 1)
            if y < H - 1 and maze.down[y][x]:
                parent[find(i)] = find(i + W)
    s = maze.start[1] * W + maze.start[0]
    g = maze.goal[1] * W + maze.goal[0]
    return find(s) == find(g)


def edge_set(maze):
    out = set()
    for y in range(maze.height):
        for x in range(maze.width):
            if maze.right[y][x]:
                out.add(((x, y), (x + 1, y)))
            if maze.down[y][x]:
                out.add(((x, y), (x, y + 1)))
    return out


ALGOS = ["backtracker", "kruskal", "prim"]
PLACEMENTS = ["random", "border", "corners", "far"]
CUTS = ["balanced", "random", 0.0, 0.5, 1.0]
SIZES = [(3, 3), (4, 7), (10, 10)]


@pytest.mark.parametrize("algorithm,placement,cut", list(itertools.product(ALGOS, PLACEMENTS, CUTS)))
def test_labels_match_independent_solver(algorithm, placement, cut):
    for (W, H) in SIZES:
        for seed in range(6):
            pos, neg = mazes.generate_pair(width=W, height=H, seed=seed, algorithm=algorithm,
                                           placement=placement, cut=cut, loops=3)
            assert pos.solvable is True and neg.solvable is False
            assert uf_connected(pos), (algorithm, placement, cut, W, H, seed)
            assert not uf_connected(neg), (algorithm, placement, cut, W, H, seed)
            assert mazes.solve(pos)["solvable"] and not mazes.solve(neg)["solvable"]


def test_pair_is_minimal():
    for seed in range(40):
        pos, neg = mazes.generate_pair(width=12, height=9, seed=seed, loops=4)
        assert pos.start == neg.start and pos.goal == neg.goal
        assert mazes.count_passages(pos) == mazes.count_passages(neg)
        ep, en = edge_set(pos), edge_set(neg)
        assert len(ep ^ en) == 2
        cut = tuple(sorted(tuple(c) for c in pos.meta["cutEdge"]))        # meta stores S-side cell first
        opened = tuple(sorted(tuple(c) for c in pos.meta["openedEdge"]))
        assert cut in ep and cut not in en
        assert opened in en and opened not in ep
        # positive = spanning tree + loops
        assert mazes.count_passages(pos) == pos.width * pos.height - 1 + pos.meta["loops"]
        assert pos.meta["loops"] == 4 and pos.meta["wallsBalanced"]


def test_negative_component_sizes_match_meta():
    for seed in range(20):
        _pos, neg = mazes.generate_pair(width=9, height=11, seed=seed, placement="far")
        r = mazes.solve(neg)
        assert len(r["componentSizes"]) == 2
        assert sorted(r["componentSizes"]) == sorted(neg.meta["componentSizes"])
        assert r["startComponent"] != r["goalComponent"]
        assert neg.meta["pocketFrac"] == pytest.approx(min(r["componentSizes"]) / neg.cells)


def test_positive_is_connected_single_component():
    for seed in range(20):
        pos, _ = mazes.generate_pair(width=9, height=11, seed=seed, algorithm="kruskal")
        r = mazes.solve(pos)
        assert r["componentSizes"] == [pos.cells]
        assert r["path"][0] == pos.start and r["path"][-1] == pos.goal
        assert r["pathLength"] == pos.meta["solutionLength"]
        assert pos.meta["solutionLength"] <= pos.meta["treePathLength"]


def test_determinism_and_seed_sensitivity():
    a = mazes.generate(width=8, height=8, seed=123)
    b = mazes.generate(width=8, height=8, seed=123)
    c = mazes.generate(width=8, height=8, seed=124)
    assert a.to_dict() == b.to_dict()
    assert a.to_dict() != c.to_dict()


def test_coin_label_is_balanced():
    labels = [mazes.generate(width=5, height=5, seed=s).solvable for s in range(600)]
    frac = sum(labels) / len(labels)
    assert 0.44 < frac < 0.56


def test_explicit_label():
    assert mazes.generate(width=5, height=5, seed=1, solvable=True).solvable
    assert not mazes.generate(width=5, height=5, seed=1, solvable=False).solvable
    assert mazes.generate({"width": 5, "height": 5, "seed": 1, "solvable": False}).solvable is False
    assert mazes.generate(width=5, height=5, seed=1, solvable="false").solvable is False


def test_numeric_cut_position():
    for seed in range(10):
        p0, _ = mazes.generate_pair(width=10, height=10, seed=seed, cut=0.0)
        p1, _ = mazes.generate_pair(width=10, height=10, seed=seed, cut=1.0)
        assert p0.meta["cutIndex"] == 0
        assert p1.meta["cutIndex"] == p1.meta["treePathLength"] - 1
        assert p0.params["cut"] == 0.0 and p1.params["cut"] == 1.0


def test_balanced_cut_gives_larger_pockets_than_random_on_average():
    bal = [mazes.generate_pair(width=14, height=14, seed=s, cut="balanced", placement="far")[1].meta["pocketFrac"] for s in range(40)]
    rnd = [mazes.generate_pair(width=14, height=14, seed=s, cut="random", placement="far")[1].meta["pocketFrac"] for s in range(40)]
    assert sum(bal) / len(bal) > sum(rnd) / len(rnd)
    assert min(bal) > 0.15


def test_random_placement_respects_min_distance():
    for seed in range(30):
        m = mazes.generate(width=9, height=6, seed=seed, placement="random", minDistance=7)
        assert abs(m.start[0] - m.goal[0]) + abs(m.start[1] - m.goal[1]) >= 7
        assert m.params["minDistance"] == 7
    m = mazes.generate(width=9, height=6, seed=1, placement="random")
    assert m.params["minDistance"] == 5  # ceil(9 / 2)


def test_far_placement_maximises_tree_distance():
    for seed in range(10):
        pos, _ = mazes.generate_pair(width=8, height=8, seed=seed, placement="far", loops=0)
        r = mazes.solve(pos)
        assert pos.meta["treePathLength"] == max(max(row) for row in r["dist"])


def test_border_and_corner_placement():
    m = mazes.generate(width=7, height=5, seed=3, placement="corners")
    assert m.start == [0, 0] and m.goal == [6, 4]
    for seed in range(20):
        m = mazes.generate(width=7, height=5, seed=seed, placement="border")
        on_border = lambda p: p[0] in (0, 6) or p[1] in (0, 4)
        assert on_border(m.start) and on_border(m.goal)
        assert m.start != m.goal


def within_component_wall_count(pos, neg):
    """Number of walls of the spanning tree whose two cells lie in the same
    component of the unsolvable maze (= the candidate pool for loops and w)."""
    loop_edges = {tuple(sorted(tuple(c) for c in e)) for e in pos.meta["loopEdges"]}
    tree = edge_set(pos) - loop_edges
    comp = mazes.solve(neg)["components"]
    n = 0
    for y in range(pos.height):
        for x in range(pos.width):
            for nb in ((x + 1, y), (x, y + 1)):
                if nb[0] >= pos.width or nb[1] >= pos.height:
                    continue
                if ((x, y), nb) not in tree and comp[y][x] == comp[nb[1]][nb[0]]:
                    n += 1
    return n


def test_loops_are_clamped_to_the_candidate_pool():
    for (W, H) in ((3, 3), (4, 4), (5, 3)):
        for seed in range(15):
            pos, neg = mazes.generate_pair(width=W, height=H, seed=seed, loops=10)
            pool = within_component_wall_count(pos, neg)
            assert pos.meta["loopsRequested"] == 10
            assert pos.meta["loops"] == max(0, min(10, pool - 1))
            assert pos.meta["wallsBalanced"] == (pool >= 1)
            if pos.meta["wallsBalanced"]:
                assert mazes.count_passages(pos) == mazes.count_passages(neg)
            else:
                assert mazes.count_passages(pos) == mazes.count_passages(neg) + 1


def test_ascii_roundtrip():
    for seed in range(10):
        m = mazes.generate(width=7, height=5, seed=seed, loops=2)
        txt = mazes.to_ascii(m)
        rows = txt.split("\n")
        assert len(rows) == 2 * m.height + 1 and all(len(r) == 2 * m.width + 1 for r in rows)
        for y in range(m.height):
            for x in range(m.width):
                assert (rows[2 * y + 1][2 * x + 2] != "#") == bool(m.right[y][x]) or x == m.width - 1
                assert (rows[2 * y + 2][2 * x + 1] != "#") == bool(m.down[y][x]) or y == m.height - 1
        assert rows[2 * m.start[1] + 1][2 * m.start[0] + 1] == "S"
        assert rows[2 * m.goal[1] + 1][2 * m.goal[0] + 1] == "G"
    pos = mazes.generate(width=7, height=5, seed=1, solvable=True)
    assert "*" in mazes.to_ascii(pos, path="*")
    neg = mazes.generate(width=7, height=5, seed=1, solvable=False)
    assert "*" not in mazes.to_ascii(neg, path="*")


def test_seed_normalisation_matches_js_constants():
    # constants produced by web/maze.js (node) for the same inputs
    assert normalize_seed("42") == 42
    assert normalize_seed(42) == 42
    assert normalize_seed(-1) == 4294967295
    assert normalize_seed("-1") == 4294967295
    assert normalize_seed("hello") == 1335831723
    assert normalize_seed("99999999999") == 1215752191
    assert normalize_seed("hello") == fnv1a32("hello")
    assert normalize_seed(2 ** 40 + 5) == 5


def test_prng_first_draws_match_js():
    r = Mulberry32(12345)
    assert [r(), r(), r()] == pytest.approx([0.9797282677609473, 0.3067522644996643, 0.484205421525985], abs=0)


def test_param_validation():
    with pytest.raises(ValueError):
        mazes.generate(width=2, height=5, seed=1)
    with pytest.raises(ValueError):
        mazes.generate(width=5, height=5, seed=1, algorithm="wilson")
    with pytest.raises(ValueError):
        mazes.generate(width=5, height=5, seed=1, cut=1.5)
    with pytest.raises(ValueError):
        mazes.generate(width=5, height=5, seed=1, placement="middle")
    assert mazes.generate(width=5, height=5, seed=1, cut="0.25").params["cut"] == 0.25


def test_presets_and_json_roundtrip():
    for name, preset in mazes.PRESETS.items():
        m = mazes.generate(preset, seed=1)
        d = json.loads(json.dumps(m.to_dict()))
        m2 = mazes.Maze.from_dict(d)
        assert m2.to_dict() == m.to_dict()
        assert uf_connected(m2) == m.solvable
