# Task: Online Sichuan Mahjong (血战到底, "Blood Battle to the End") web game. Plan A: GitHub Pages + PeerJS P2P, host-authoritative

You are working in an empty Git repository (djzts/SichuanMahjong-Online). Build from scratch a 4-player online Sichuan Mahjong web game (血战到底 variant) that can be deployed to GitHub Pages. Each room also has 2 spectator slots. It is for friends who know each other: no backend, no accounts, no real money.

Language: the UI is in Simplified Chinese; code identifiers and comments are in English. Chinese terms appear in parentheses. Use exactly those terms in the UI (see the glossary at the end).

## 0. Design first. Wait for my confirmation before writing code
Write docs/DESIGN.md and give me a short summary covering:
- directory layout and module boundaries;
- the per-hand state machine (deal → exchange three → declare void suit → play → settlement → next hand), with the allowed actions and timeout behavior in each state;
- the network protocol (TypeScript types), protocol version, and handshake (the handshake tells players and spectators apart);
- exactly which fields each kind of recipient receives (the player themselves, other players, spectators);
- the rule ambiguities you found and the defaults you plan to use.
Start step 1 only after I confirm.

## 1. Tech stack & architecture
- Frontend: Vite + TypeScript (strict). Build the UI with vanilla DOM or Preact, not a heavy framework. The build output is static files only.
- Use hash routing (or a single page with no router) so that refreshing a page on GitHub Pages never returns a 404.
- Set Vite `base` to `/SichuanMahjong-Online/` (overridable via an env var) so assets load both locally and on Pages.
- Networking: PeerJS (WebRTC P2P). Use the free official PeerJS cloud signaling server by default, and make the signaling host/port/path configurable.
- Prefix peer IDs to avoid collisions with other users, e.g. host ID = `scmj-<roomCode>`.
- ICE: use public STUN servers by default, and reserve TURN fields (urls / username / credential) in src/config. The README must point out that TURN credentials shipped in a static site are public.
- Host-authoritative: the host's browser shuffles, deals, enforces the rules, scores, and advances the game state. Other players only send intents (discard, pung, kong, hu, pass, exchange-three pick, void-suit choice). The host validates each intent and broadcasts the result. Illegal or stale messages are rejected, and an error is sent back to that client.
- The host's own actions go through the same intent → validate → broadcast path (local loopback, no network), so single-player and online modes share one code path.
- Information hiding: every piece of data sent to a client must be produced by one pure function, viewFor(state, viewer), which builds it for that recipient. This is the only way data leaves the host.
  - To players: only their own hand. For the other players, only public info: discards, exposed melds, hand size, void suit, a has-won flag, and tiles left in the wall. Tiles passed during the exchange and the tiles of a concealed kong stay hidden from other players.
  - To spectators: see "Spectator slots" in section 2.
- Randomness: shuffle with a seedable PRNG (the host generates the seed). Record an action log for every hand so that it can be replayed from seed + log.
- Keep all UI strings in a single file.

## 2. Room flow
- Home screen: enter a nickname, then either "Create room" (generates a 6-digit numeric room code that is easy to type on a phone; regenerate it if the peer ID is taken) or "Join with room code". When joining, choose "Take a seat" (入座) or "Watch" (观战).
- Lobby: show 4 player seats and 2 spectator slots. The host can fill empty player seats with computer AIs or remove them, and presses "Start" once all 4 player seats are filled (spectator slots may stay empty). Show the room code plus "Copy invite link" and "Copy spectator link" buttons (the links carry the room code and go straight into the seat or watch flow).
- Support multiple consecutive hands, with each player's running score and a per-hand history. The host can end the session, which shows a final ranking.
- Dealer (default, configurable): random (or the host) for the first hand. After that, the first player who won in the previous hand deals next. If that first win was a multiple-winner discard (一炮多响), the discarder deals. After an exhaustive draw, the dealer stays the same.
- Identity & reconnection:
  - On first visit, each client generates a playerId (UUID) and stores it in localStorage. The host maps playerId → slot (player seat or spectator slot). The nickname is used for display and as a fallback match.
  - After a refresh or a disconnect, the client reconnects automatically with the same room code and returns to its player seat or spectator slot. The host then sends it a full state snapshot built for its role.
  - While a player is disconnected, an AI plays for them (shown as "托管中"). The player takes back control when they reconnect.
  - If the host disconnects, every other client (spectators included) shows "房主已断开，游戏暂停" and keeps trying to reconnect.
  - (Optional bonus) The host saves a snapshot of the game state in localStorage. After refreshing, the host can restore the room and the hand under the same room code. The PeerJS server may keep the old ID reserved for a short while, so retry.

### Spectator slots
- Besides the 4 player seats, each room has [2] spectator slots (configurable). When the player seats are full, a newcomer can only watch. When the spectator slots are full too, show "房间已满".
- Spectators can join before the game starts or in the middle of a hand. On a mid-hand join, the host sends a spectator snapshot of the current state.
- Spectators see only the four discard piles (牌河), in discard order and shown the same way players see them, plus status that reveals no tiles: seats and nicknames, whose turn it is, tiles left in the wall, who has won, each player's running score, and the score changes from each settlement.
- Spectators never see any player's hand (including hands revealed when someone wins or at an exhaustive draw) or the tiles passed in the exchange. This is a hard rule, not a config switch.
- The following are also hidden from spectators by default, each with its own config switch [all off]: exposed melds, void suits, hand sizes, and the hand pattern and fan breakdown in settlements.
- Hiding must happen on the host: the host must never send this data to spectators at all. Hiding it only in the frontend is not enough, because in P2P a spectator can see everything they receive in the browser's developer tools.
- Spectators cannot send any game action; the host rejects anything they send. Spectators don't score, are never replaced by an AI, and their disconnects neither affect the hand nor pause the game.
- Before the game starts, a client can switch between a player seat and a spectator slot. Once the game starts, spectators can only watch and cannot take a seat mid-game. The host can remove spectators.
- The players' UI shows how many spectators are watching and their nicknames.

## 3. Rules (all in one rules config object; defaults in brackets)
### Tiles & dealing
- 108 tiles: characters (万), bamboo (条), and dots (筒), ranks 1–9, 4 copies of each. No honor tiles, no flower tiles.
- The dealer gets 14 tiles and everyone else gets 13. Turn order is counter-clockwise: your next player (下家) sits on your right.
- After a kong, the replacement tile is drawn from the tail of the wall. No kongs are allowed once the wall is empty.

### Exchange three (换三张) [on]
- After the deal, each player picks 3 tiles of the same suit. The pass direction is random: clockwise, counter-clockwise, or across.
- The swap happens at the same time once everyone has picked. On timeout [20]s, the game auto-picks 3 tiles from the shortest suit that still has at least 3 tiles.

### Declare void suit (定缺)
- After the exchange, each player chooses one suit as their void suit (缺门). The choices are revealed at the same time. On timeout, the game picks the player's shortest suit.
- While you hold any void-suit tiles, you must discard them first.
- You cannot win while holding any void-suit tile.
- You cannot pung or kong a void-suit tile.

### Pung & kong (no chow)
- Kong types: exposed kong (明杠/直杠, made on someone's discard), concealed kong (暗杠, four tiles you drew yourself), and added kong (补杠/加杠, a drawn 4th tile added to your own pung).
- Instant kong payments (刮风下雨) [on], in units of the base score:
  - exposed kong: the player who discarded the tile pays 2;
  - added kong: every other player who has not won yet pays 1;
  - concealed kong: every other player who has not won yet pays 2;
  - if an added kong is robbed (抢杠胡), the kong does not count and collects nothing.
- Kong-payment transfer (呼叫转移) [on]: if a player kongs, draws the replacement tile, and then discards a tile that someone wins on (杠上炮), the money that kong collected goes to the winner. Document how you handle multiple winners in the README.

### Winning (胡)
- A winning hand is either 4 sets (triplets or sequences, exposed melds included) plus 1 pair, or seven pairs (only when the player has no exposed melds).
- Ways to win: self-draw (自摸), on a discard (点炮), or by robbing an added kong (抢杠胡). Concealed kongs cannot be robbed.
- Multiple winners on one discard (一炮多响) [allowed]: everyone who claims the win wins, and the discarder pays each winner separately.
- Pass-hu lock (过水不胡) [on]: after you decline to win on a discard, you cannot win on anyone's discard until your next draw. Self-draw is not affected.
- 血战到底: a player who wins leaves the hand (their hand is revealed to the other players and they stop drawing and discarding). The others keep playing until three players have won or the wall runs out.
- Players who have already won pay nothing afterwards (no kong payments, no self-draw payments) and keep what they have won.

### Fan (番) table, configurable
- 平胡 0, 对对胡 1, 清一色 2, 七对 2, 龙七对 3, 清对 3, 清七对 4, 清龙七对 5, 金钩钓 1, 带幺九 2, 将对 3.
- Stacking: a combined pattern replaces its components and is not counted twice (e.g. 清对 = 3, not 清一色 2 + 对对胡 1). Count only the highest pattern, then add the bonuses below.
- Root (根): +1 fan for each set of 4 identical tiles (both kongs and four concealed copies count). The four tiles that form the "dragon" in 龙七对 do not count again as a root.
- Bonuses: 杠上花 +1, 杠上炮 +1, 抢杠胡 +1, 海底捞月 +1, 海底炮 +1.
- 天胡 / 地胡: score the cap immediately.
- If you are unsure how a pattern is defined (e.g. whether 金钩钓 also counts as 对对胡, or how to check 带幺九), use the most common Chengdu rules and list your choice under "Rule assumptions" in the README.

### Scoring
- Each payer pays: base × 2^min(fan, cap [3]).
- Self-draw bonus [add base] (can be configured to "add fan"): with add base, each payer pays 1 extra base after the cap is applied. With add fan, add 1 fan before the cap is applied.
- On a self-draw, every other player who has not won yet pays. On a discard win, only the discarder pays.
- Every settlement and every hand must sum to zero.

### Exhaustive draw (流局)
- Settle only among players who have not won [default, configurable]:
  - Flower pig (查花猪): a player still holding void-suit tiles is a flower pig and pays the capped amount to each player who is not a flower pig.
  - Ready-hand check (查大叫): each player who is not ready (and is not a flower pig) pays each ready player that ready player's maximum possible fan. Count roots, leave out bonuses such as self-draw or 杠上花, and apply the cap.
  - Tax refund (退税) [on]: players who are not ready, and flower pigs, give back all the kong money they collected this hand to the players who paid it.

### Priority & timers
- Hu > kong / pung. After a discard, the host collects responses from every player allowed to respond (or waits for the timeout) and then decides. It is not first-come, first-served.
- Response window after a discard: [10]s. Timeout = pass.
- Your own turn: [20]s. On timeout, the game discards for you automatically: a void-suit tile if you have one, otherwise the rightmost tile.
- All timers are configurable and can be turned off for local debugging.

## 4. Computer AI (runs on the host)
- Simple but sensible: for the exchange, pick from the shortest suit; void the shortest suit; discard void-suit tiles first; choose discards by shanten (and number of useful tiles); always win when possible.
- Basic pung/kong decisions: don't break a pure-suit (清一色) hand; once ready, pung or kong only if it doesn't make the wait worse; never pung a void-suit tile.
- The AI uses the same intent → validate interface as humans and cannot see other players' hands.
- Add a random 0.5–1.5s delay before AI actions so humans can follow along.

## 5. UI
- Top-down table: you at the bottom, next player (下家) on the right, the player across at the top, previous player (上家) on the left. For the other players, show the number of face-down tiles, exposed melds, discards, a void-suit marker, a won marker, and AI-takeover or disconnected status. In the center, show tiles left, whose turn it is, and a countdown.
- Spectator view: the four discard piles are laid out around the table by seat, each labeled with the player's nickname, with no hand areas. By default the host sits at the bottom, and spectators can rotate the view. A "观战中" banner at the top; no action buttons at all.
- Draw tile faces with SVG or CSS (no copyrighted assets). 万, 条 and 筒 must be easy to tell apart. Void-suit tiles, tiles you can discard, and the tile you just drew should each look clearly different.
- Highlight the available action buttons: 碰, 杠, 胡, 过 (let the player choose when more than one kong is possible). Discard either by tapping a tile to select it and tapping again to confirm, or by dragging it.
- Settlement popup: for each win, show the winner, hand pattern, fan breakdown, and every player's gain or loss. At the end of a hand, show a summary for that hand and the running totals. Spectators' popups show only the gains and losses (unless the matching config switch is on).
- Playable on phones in both portrait and landscape (landscape first) and touch-friendly; also works on desktop.
- Debug mode: with ?debug=1 you can set the seed and show all hands (single-player only).

## 6. Code structure & quality
- The rules engine (tile representation, win detection, ready check and shanten, fan calculation, scoring, exhaustive-draw settlement) is a set of pure functions with no dependency on the UI or networking, in its own directory (e.g. src/engine).
- Game progression is a pure reducer: (state, action) → new state + events, shared by the host and single-player mode.
- Write thorough Vitest unit tests for the engine, covering at least:
  - every win pattern and fan; seven pairs, 龙七对, 清龙七对; root counting (kongs count; no double counting in 龙七对);
  - no win while holding void-suit tiles; no pung of a void-suit tile;
  - robbing the kong (the added kong collects nothing), multiple winners, pass-hu lock, 杠上炮 kong-payment transfer;
  - flower pig, ready-hand check, tax refund, cap, self-draw add-base / add-fan;
  - in 血战, players who have already won do not pay.
- Write unit tests for viewFor that check every phase of a hand (exchange, void-suit choice, play, after someone wins, settlement, exhaustive draw):
  - a player's view contains only their own hand, with no other hands and no exchanged tiles;
  - once a spectator's view is serialized to JSON, the only tiles in it are discards, and their count equals the total number of discards. With the switches off, it contains no exposed melds, void suits, hand sizes or fan breakdowns;
  - any game action sent by a spectator is rejected.
- Invariant tests: 4 AIs self-play at least 1000 hands with fixed seeds. No exceptions, every hand sums to zero, and at every moment the tiles across all locations add up to exactly 108.
- Network messages have explicit TypeScript types and a protocol version. If versions don't match, prompt the user to refresh.
- Set up ESLint + Prettier. `npm run test`, `npm run build` and `npm run lint` must all pass.
- README: local development; deployment (including setting Settings → Pages → Source to "GitHub Actions"); how to configure TURN and a custom PeerJS server; a reference for the rules config; a reference for the spectator visibility config; and the list of rule assumptions.

## 7. Development order (after each step: run the tests and build, make a commit, and report progress and your plan for the next step)
1. Rules engine + viewFor + tests. Done when all tests pass and cover the scenarios above.
2. Single-player: me against 3 AIs, playing several full hands with correct running totals. Done when I can play at least 2 full hands myself and the 1000-hand self-play test passes.
3. PeerJS online play: create, join, watch, AI fill-in, sync, information hiding, reconnection, AI takeover. Done when 6 browser tabs on one machine (4 players + 2 spectators) can finish a hand; the spectator tabs show only discards, and the messages they receive (checked in developer tools) contain no hands; a 7th person gets "房间已满"; and a refreshed player or spectator gets their place back.
4. UI polish and mobile layout (including the spectator view).
5. GitHub Actions deployment: on push to main, build and publish to GitHub Pages (using the official actions/configure-pages, actions/upload-pages-artifact and actions/deploy-pages).

If any rule is ambiguous, implement the defaults above first and list your assumptions in the README.

## Glossary (show the Chinese term in the UI)
万 characters · 条 bamboo · 筒 dots · 牌河 discard pile · 入座 take a seat · 观战/观战者 watch/spectator · 换三张 exchange three · 定缺/缺门 void suit · 碰 pung · 杠 kong (明杠/直杠 exposed, 暗杠 concealed, 补杠/加杠 added) · 刮风下雨 instant kong payments · 自摸 self-draw · 点炮 win on a discard · 抢杠胡 robbing the kong · 一炮多响 multiple winners on one discard · 过水不胡 pass-hu lock · 呼叫转移 kong-payment transfer · 花猪 flower pig · 查大叫 ready-hand check · 退税 tax refund · 根 root · 托管 AI takeover · 平胡 basic win · 对对胡 all pungs · 清一色 pure one suit · 七对 seven pairs · 龙七对 seven pairs with a set of four · 清对 pure all pungs · 清七对 pure seven pairs · 清龙七对 pure 龙七对 · 金钩钓 single wait with 4 exposed melds · 带幺九 every set contains a 1 or 9 · 将对 all pungs of 2/5/8 · 杠上花 win on the kong replacement tile · 杠上炮 win on the discard right after a kong · 海底捞月 self-draw on the last tile · 海底炮 win on the last discard · 天胡 dealer wins on the initial deal · 地胡 non-dealer wins on their first tile
