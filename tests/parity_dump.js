// Prints the JSON of a maze pair (and a few PRNG draws) for tests/test_parity.py.
// usage: node tests/parity_dump.js '{"width":10,"height":8,"seed":3,...}'
const path = require('path');
const M = require(path.join(__dirname, '..', 'web', 'maze.js'));
const P = require(path.join(__dirname, '..', 'web', 'prompt.js'));
const params = JSON.parse(process.argv[2] || '{}');
const rnd = M.mulberry32(M.normalizeSeed(params.seed === undefined ? 0 : params.seed));
const draws = [];
for (let i = 0; i < 8; i++) draws.push(rnd());
const pair = M.generatePair(params);
const coin = M.generate(params).solvable;
process.stdout.write(JSON.stringify({
  seed: M.normalizeSeed(params.seed === undefined ? 0 : params.seed),
  seedHashes: { hello: M.normalizeSeed('hello'), neg: M.normalizeSeed('-7'), big: M.normalizeSeed('123456789012345'), uni: M.normalizeSeed('mäze ✓') },
  draws: draws,
  positive: pair.positive,
  negative: pair.negative,
  coin: coin,
  ascii: M.toAscii(pair.negative),
  prompts: [['image', {markers: 'sg', grayscale: false, theme: 'light'}], ['ascii', {markers: 'sg', grayscale: false, theme: 'light'}],
            ['both', {markers: 'dots', grayscale: false, theme: 'dark'}], ['image', {markers: 'sg', grayscale: true, theme: 'light'}],
            ['image', {markers: 'letters', grayscale: false, theme: 'dark'}]].map(function (x) { return P.buildPrompt(x[1], x[0]); }),
  roomPrompts: [P.buildRoomPrompt('image', {}, 'perspective'), P.buildRoomPrompt('ascii', {'W': 'wall', 'P': 'player', 'G': 'gem'}, 'top'), P.buildRoomPrompt('both', {'I': 'ice'}, 'top')],
  parsed: ['blah\nANSWER: NO', 'yes it is.\nANSWER: YES', 'I think no', 'unclear', 'ANSWER: yes\nANSWER: no', '', 'Yes and no'].map(P.parseAnswer)
}));
