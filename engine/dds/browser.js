// The defence the student plays against, in the browser.
//
// Load order in every exercise page:
//   <script>var Module = {};</script>
//   <script src="engine/dds/libdds.js"></script>
//   <script src="engine/dds/browser.js"></script>
//
// It sees exactly what a defender sees: his own thirteen cards, dummy, and every
// card already played. Partner's hand and declarer's hand are hidden, so it
// deals the unseen cards out at random into those two hands, solves THAT deal
// with the double dummy solver, and repeats. The card with the best average
// wins. The random deals respect what the play has shown - a seat that failed to
// follow a suit never gets a card of it.
//
// Two rules it never needed to be taught, because the solver knows them: which
// cards are equivalent, and what a card is worth. Playing the Jack under
// partner's Ten cannot happen here - the solver reports the two as equal and the
// cheapest of an equal family is the one played.
//
// Measured 2026-08-20 on finesse.html seed 1422, eight sampled deals per
// decision: 5.3 ms per solve, 0.6 s for a whole hand. Declarer took 10 tricks
// against the old defence, 9 against this one, 7 against a solver that cheats
// and looks at all four hands.
(function () {
  var SUITS = ["S", "H", "D", "C"];
  var SUIT_NUM = { S: 0, H: 1, D: 2, C: 3 };
  var NAME = { 14: "A", 13: "K", 12: "Q", 11: "J", 10: "T" };
  var RANK = { A: 14, K: 13, Q: 12, J: 11, T: 10 };

  var solveBoard = Module.cwrap("solve", "string", ["string", "string", "number", "number"]);

  function packPlays(plays) {
    var buf = Module._malloc(8 * plays.length);
    for (var i = 0; i < plays.length; i++) {
      Module.setValue(buf + i * 8, SUIT_NUM[plays[i][1]], "i32");
      Module.setValue(buf + i * 8 + 4, RANK[plays[i][0]] || Number(plays[i][0]), "i32");
    }
    return buf;
  }

  function cardName(c) { return (NAME[c.rank] || String(c.rank)) + c.suit; }
  function cardKey(c) { return c.suit + c.rank; }
  function rankOf(r) { return RANK[r] || Number(r); }

  function toPbn(hands, firstSeat) {
    var seats = ["N", "E", "S", "W"];
    var i = seats.indexOf(firstSeat), order = [], k;
    for (k = 0; k < 4; k++) order.push(seats[(i + k) % 4]);
    return firstSeat + ":" + order.map(function (seat) {
      return SUITS.map(function (suit) {
        return hands[seat].filter(function (c) { return c.suit === suit; })
          .sort(function (a, b) { return b.rank - a.rank; })
          .map(function (c) { return NAME[c.rank] || String(c.rank); }).join("");
      }).join(".");
    }).join(" ");
  }

  function solvePlays(hands, strain, leader, plays) {
    var out = JSON.parse(solveBoard(toPbn(hands, leader),
      strain === "NT" ? "N" : strain, plays.length, packPlays(plays)));
    return out && out.plays ? out.plays : null;
  }

  // ---- what the defender is allowed to know ---------------------------------
  function voidsFrom(state) {
    var out = { N: {}, E: {}, S: {}, W: {} };
    var tricks = state.completedTricks.slice();
    if (state.currentTrick.plays.length) tricks.push({ plays: state.currentTrick.plays });
    tricks.forEach(function (t) {
      var led = t.plays[0].card.suit;
      t.plays.forEach(function (p) { if (p.card.suit !== led) out[p.seat][led] = true; });
    });
    return out;
  }

  function sampleHidden(state, seat, dummy, declarer, voids, rnd) {
    var partner = seat === "E" ? "W" : "E";
    var seen = {};
    state.hands[seat].forEach(function (c) { seen[cardKey(c)] = true; });
    state.hands[dummy].forEach(function (c) { seen[cardKey(c)] = true; });
    var unseen = [];
    ["N", "E", "S", "W"].forEach(function (s) {
      if (s === seat || s === dummy) return;
      state.hands[s].forEach(function (c) { if (!seen[cardKey(c)]) unseen.push(c); });
    });
    // Sorted, and that is not tidiness. The shuffle below walks this array, so
    // its ORDER decides which layouts get sampled - and a hand read out of a bank
    // is sorted while the same hand fresh from a generator is in construction
    // order. Same cards, different array, different card from the defence. The
    // page has to sample the same way the filter that built the board did.
    unseen.sort(function (x, y) {
      return x.suit === y.suit ? y.rank - x.rank : (x.suit < y.suit ? -1 : 1);
    });
    var need = {};
    need[partner] = state.hands[partner].length;
    need[declarer] = state.hands[declarer].length;

    for (var attempt = 0; attempt < 40; attempt++) {
      var pool = unseen.slice();
      for (var i = pool.length - 1; i > 0; i--) {
        var j = Math.floor(rnd() * (i + 1));
        var tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
      }
      var give = {}; give[partner] = []; give[declarer] = [];
      var ok = true;
      for (var n = 0; n < pool.length; n++) {
        var card = pool[n];
        var canP = give[partner].length < need[partner] && !voids[partner][card.suit];
        var canD = give[declarer].length < need[declarer] && !voids[declarer][card.suit];
        if (canP && canD) give[rnd() < 0.5 ? partner : declarer].push(card);
        else if (canP) give[partner].push(card);
        else if (canD) give[declarer].push(card);
        else { ok = false; break; }
      }
      if (ok && give[partner].length === need[partner] && give[declarer].length === need[declarer]) {
        var deal = {};
        deal[dummy] = state.hands[dummy].slice();
        deal[seat] = state.hands[seat].slice();
        deal[partner] = give[partner];
        deal[declarer] = give[declarer];
        // The cards already on the table this trick are face up, so they go back
        // to the seats that played them instead of being dealt again.
        state.currentTrick.plays.forEach(function (p) { deal[p.seat] = deal[p.seat].concat([p.card]); });
        return deal;
      }
    }
    return null;
  }

  // ---- can this contract be made at all -------------------------------------
  // One question, asked before the opening lead so the defence still gets to
  // choose it: with both sides perfect, how many tricks does declarer take.
  //
  // Every other filter in a generator judges a deal by PLAYING it against a
  // defence that samples a few hidden layouts, and a sampled defence can miss
  // the suit that beats the contract. finesse.html seed 1237 passed all eight
  // filters and could not be made at all - its ceiling was 8, and the teacher found
  // that by playing it. This is the question none of them was asking.
  //
  // Returns null when the solver is not there or refuses the position, so the
  // caller can tell "no opinion" from a real number.
  var LHO = { N: "E", E: "S", S: "W", W: "N" };
  self.ddCeiling = function (hands, strain, declarer) {
    try {
      var leader = LHO[declarer || "S"];
      var options = solvePlays(hands, strain || "NT", leader, []);
      if (!options || !options.length) return null;
      // The solver scores from the point of view of the side on lead, and the
      // seat on lead here is a defender - so this is the defence's best result.
      var best = -Infinity;
      for (var i = 0; i < options.length; i++) {
        if (options[i].score > best) best = options[i].score;
      }
      if (best === -Infinity) return null;
      return 13 - best;
    } catch (err) {
      return null;
    }
  };

  // ---- the card ---------------------------------------------------------------
  // `legal` is the module's own legalPlays result, used only as the fallback and
  // as the list the chosen card must come from.
  // `self`, not `window`: this file has to work inside a Worker too, where the
  // deal generation runs so the screen never freezes. In a page self === window.
  self.ddsDefenceCard = function (state, seat, opts) {
    opts = opts || {};
    var strain = opts.strain || "NT";
    var dummy = opts.dummy || "N";
    var declarer = opts.declarer || "S";
    var samples = opts.samples || 8;
    var legal = opts.legal || state.hands[seat];
    var rnd = opts.rng || Math.random;
    if (legal.length === 1) return legal[0];

    var voids = voidsFrom(state);
    var plays = state.currentTrick.plays.map(function (p) { return cardName(p.card); });
    var total = {}, equals = {};
    var got = 0;
    for (var i = 0; i < samples; i++) {
      var deal = sampleHidden(state, seat, dummy, declarer, voids, rnd);
      if (!deal) continue;
      var options = solvePlays(deal, strain, state.currentTrick.leader, plays);
      if (!options) continue;
      got++;
      options.forEach(function (o) {
        var k = o.suit + o.rank;
        total[k] = (total[k] || 0) + o.score;
        if (!equals[k]) equals[k] = o.equals || [];
      });
    }
    if (!got) return null; // caller falls back to its own policy

    var bestKey = null, bestScore = -Infinity;
    for (var k in total) if (total[k] > bestScore) { bestScore = total[k]; bestKey = k; }
    var suit = bestKey.charAt(0);
    var family = [rankOf(bestKey.slice(1))];
    (equals[bestKey] || []).forEach(function (r) { family.push(rankOf(r)); });

    var candidates = legal.filter(function (c) {
      return c.suit === suit && family.indexOf(c.rank) !== -1;
    });
    if (!candidates.length) {
      candidates = legal.filter(function (c) { return c.suit === suit; });
    }
    if (!candidates.length) return null;
    // Cheapest of an equal family. This is the whole of "do not throw the Jack
    // under partner's Ten", and it is not a rule anyone had to write.
    return candidates.reduce(function (lo, c) { return c.rank < lo.rank ? c : lo; }, candidates[0]);
  };
})();
