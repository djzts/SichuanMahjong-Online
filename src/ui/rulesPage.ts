/** The English "Rules" page: a full explanation of Sichuan Mahjong for new players. */
import { DEFAULT_RULES } from '../engine/rules';
import { parseTiles } from '../engine/tiles';
import { tileHtml } from './tileArt';

const F = DEFAULT_RULES.fan;
const CAP = DEFAULT_RULES.capFan;
const T = DEFAULT_RULES.timers;

/** Renders tile groups like "123m 456m" as small tile images, one group per cluster. */
function tiles(groups: string): string {
  return `<span class="r-tiles">${groups
    .split(/\s+/)
    .map(
      (g) =>
        `<span class="r-group">${parseTiles(g)
          .map((t) => tileHtml(t, 'r-tile'))
          .join('')}</span>`,
    )
    .join('')}</span>`;
}

function suitRow(label: string, suit: 'm' | 's' | 'p', note: string): string {
  return `<div class="r-suit"><div><b>${label}</b><span class="muted"> · ${note}</span></div>${tiles(`123456789${suit}`)}</div>`;
}

const FAN_ROWS: [string, string, number, string, string][] = [
  [
    '平胡',
    'Basic hand',
    F.pinghu,
    'Any winning hand with nothing special.',
    '123m 456m 789m 345s 99s',
  ],
  ['对对胡', 'All pungs', F.duiduihu, 'Every set is a pung (or kong).', '111m 333m 777s 999s 22s'],
  [
    '清一色',
    'Pure one suit',
    F.qingyise,
    'Every tile is from one suit.',
    '123m 345m 567m 789m 99m',
  ],
  ['七对', 'Seven pairs', F.qidui, 'Seven pairs, no exposed sets.', '11m 33m 55m 22s 44s 66s 88s'],
  [
    '龙七对',
    'Dragon seven pairs',
    F.longqidui,
    'Seven pairs where four identical tiles count as two pairs.',
    '1111m 33m 55m 22s 44s 66s',
  ],
  ['清对', 'Pure all pungs', F.qingdui, 'All pungs, all one suit.', '111s 333s 555s 777s 99s'],
  [
    '清七对',
    'Pure seven pairs',
    F.qingqidui,
    'Seven pairs, all one suit.',
    '11p 22p 44p 55p 66p 88p 99p',
  ],
  [
    '清龙七对',
    'Pure dragon seven pairs',
    F.qinglongqidui,
    'Dragon seven pairs, all one suit.',
    '1111p 22p 44p 55p 66p 88p',
  ],
  [
    '带幺九',
    'Terminals in every set',
    F.daiyaojiu,
    'Every set and the pair contain a 1 or a 9.',
    '123m 789m 111s 789s 99s',
  ],
  [
    '将对',
    '2-5-8 pungs',
    F.jiangdui,
    'All pungs, and every tile is a 2, 5 or 8.',
    '222m 555m 888m 222s 55s',
  ],
];

const BONUS_ROWS: [string, string, number, string][] = [
  [
    '根',
    'Root',
    F.gen,
    'Each set of four identical tiles you hold (a kong, or four in your hand). In dragon seven pairs the “dragon” itself does not count again.',
  ],
  [
    '金钩钓',
    'Golden hook',
    F.jingoudiao,
    'You exposed four sets and won on a single tile for the pair (added on top of All pungs).',
  ],
  [
    '杠上花',
    'Win on kong draw',
    F.gangshanghua,
    'You win with the replacement tile drawn after your kong.',
  ],
  [
    '杠上炮',
    'Win on kong discard',
    F.gangshangpao,
    'You win on the tile someone discarded right after their kong.',
  ],
  ['抢杠胡', 'Robbing the kong', F.qiangganghu, 'You win on the tile someone adds to their pung.'],
  [
    '海底捞月',
    'Last tile self-draw',
    F.haidilaoyue,
    'You win by drawing the very last tile of the wall.',
  ],
  [
    '海底炮',
    'Last tile discard',
    F.haidipao,
    'You win on the discard after the last tile was drawn.',
  ],
];

const GLOSSARY: [string, string, string][] = [
  ['血战到底', 'xuèzhàn dàodǐ', 'Blood Battle: play goes on after someone wins'],
  ['万 / 萬', 'wàn', 'Characters suit'],
  ['条', 'tiáo', 'Bamboo suit'],
  ['筒', 'tǒng', 'Dots suit'],
  ['换三张', 'huàn sān zhāng', 'Pass three tiles'],
  ['定缺', 'dìng quē', 'Choose your void suit'],
  ['碰', 'pèng', 'Pung: claim a discard to make three of a kind'],
  ['杠', 'gàng', 'Kong: four of a kind'],
  ['胡', 'hú', 'Win'],
  ['自摸', 'zìmō', 'Self-draw: win with a tile you drew'],
  ['点炮', 'diǎn pào', 'Deal in: discard the tile someone wins on'],
  ['番', 'fān', 'Fan: scoring units of a hand'],
  ['刮风下雨', 'guā fēng xià yǔ', '“Wind and rain”: kong payments made at once'],
  ['呼叫转移', 'hūjiào zhuǎnyí', 'Kong-payment transfer'],
  ['花猪', 'huā zhū', 'Flower pig: still holds void-suit tiles at a draw'],
  ['查大叫', 'chá dà jiào', 'Ready-hand check at a draw'],
  ['退税', 'tuì shuì', 'Refund of kong money at a draw'],
  ['庄', 'zhuāng', 'Dealer'],
  ['临时观察', 'línshí guānchá', 'Temporary observer: a player sitting out this hand'],
  ['观战', 'guānzhàn', 'Spectator'],
];

export function renderRulesPage(): string {
  const capPay = DEFAULT_RULES.baseScore * 2 ** CAP;
  return `<div class="rules-page" role="dialog" aria-modal="true" aria-labelledby="rules-title">
  <div class="rules-bar">
    <h1 id="rules-title">How to play Sichuan Mahjong</h1>
    <button class="btn" data-act="rules-close">Close</button>
  </div>
  <article class="rules-body">
    <p class="lead">Sichuan Mahjong, played here as <b>Blood Battle</b> (血战到底), is a fast four-player game with only three suits.
    Everyone tries to complete a hand first, but a win does not end the hand: the winner steps aside and the others keep playing.</p>

    <section>
      <h2>1. The tiles</h2>
      <p>There are 108 tiles: three suits numbered 1 to 9, four copies of each. There are no winds, dragons or flowers.</p>
      ${suitRow('Characters (萬 / 万)', 'm', 'the small number in the corner tells you the value')}
      ${suitRow('Bamboo (条)', 's', 'the 1 of Bamboo is drawn as a bird')}
      ${suitRow('Dots (筒)', 'p', 'count the circles')}
    </section>

    <section>
      <h2>2. A winning hand</h2>
      <p>You need <b>four sets and one pair</b>. A set is either a <b>pung</b> (three identical tiles) or a <b>chow</b> (three in a row of the same suit).
      A kong (four identical tiles) also counts as a set.</p>
      ${tiles('123m 456m 789m 345s 99s')}
      <p>The other winning shape is <b>seven pairs</b>, allowed only if you have not exposed any set:</p>
      ${tiles('11m 33m 55m 22s 44s 66s 88s')}
      <p>Because every player gives up one suit (see <i>Void suit</i>), a winning hand never uses more than two suits.</p>
    </section>

    <section>
      <h2>3. How a hand is played</h2>
      <ol>
        <li><b>Deal.</b> The dealer gets 14 tiles and the others 13. The dealer starts by discarding.</li>
        <li><b>Pass three tiles</b> (换三张). Everyone picks 3 tiles of one suit and passes them at the same time: clockwise, counter-clockwise or across, chosen at random.</li>
        <li><b>Void suit</b> (定缺). Everyone picks one suit to get rid of. While you still hold tiles of that suit you must discard them first, you cannot pung or kong them, and <b>you cannot win</b>.</li>
        <li><b>Turns.</b> Play goes counter-clockwise: the player on your right is next. On your turn you draw one tile and discard one.</li>
        <li><b>Claiming a discard.</b> Any player may <b>pung</b> (holding two matching tiles) or <b>kong</b> (holding three). There is <b>no chow</b> from discards.
        Any player whose hand is complete with that tile may <b>win</b>. A win beats a pung or kong, and several players can win on the same discard.</li>
        <li><b>Passing a win.</b> If you pass on a winning discard, you cannot win on any discard until your next draw. Winning by self-draw is still allowed.</li>
        <li><b>Blood battle.</b> A winner reveals their hand and stops playing. The others continue until three players have won or the wall is empty.</li>
      </ol>
      <p class="muted">Timers: ${T.turnSec} seconds for your turn and ${T.claimSec} seconds to answer a discard. When time runs out the game discards for you (void-suit tiles first) or passes.</p>
    </section>

    <section>
      <h2>4. Scoring</h2>
      <p>A hand is worth some <b>fan</b>. Each player who pays you pays <b>base × 2<sup>fan</sup></b>, with fan capped at ${CAP} (so at most ${capPay} base).</p>
      <ul>
        <li><b>Win on a discard:</b> only the player who discarded pays.</li>
        <li><b>Self-draw:</b> every player still in the hand pays, plus 1 extra base each.</li>
        <li>Players who already won never pay again in that hand.</li>
      </ul>
      <p>Take the single best hand pattern below, then add roots and bonuses. Combined patterns replace their parts: Pure all pungs is 3 fan, not 2 + 1.</p>
      <div class="table-wrap"><table class="r-table">
        <thead><tr><th>Pattern</th><th>Fan</th><th>What it is</th></tr></thead>
        <tbody>${FAN_ROWS.map(
          ([cn, enName, fan, desc, ex]) =>
            `<tr><td><b>${enName}</b><br><span class="muted">${cn}</span></td><td class="num">${fan}</td><td>${desc}${tiles(ex)}</td></tr>`,
        ).join('')}</tbody>
      </table></div>
      <div class="table-wrap"><table class="r-table">
        <thead><tr><th>Bonus</th><th>Fan</th><th>When</th></tr></thead>
        <tbody>${BONUS_ROWS.map(
          ([cn, enName, fan, desc]) =>
            `<tr><td><b>${enName}</b><br><span class="muted">${cn}</span></td><td class="num">+${fan}</td><td>${desc}</td></tr>`,
        ).join('')}
        <tr><td><b>Heavenly / Earthly hand</b><br><span class="muted">天胡 / 地胡</span></td><td class="num">${CAP}</td><td>The dealer wins with the starting 14 tiles, or another player wins on their very first draw before anyone has claimed a tile. Scores the cap.</td></tr>
        </tbody>
      </table></div>
      <p class="example">Example: you self-draw a Pure one suit hand (2 fan). Each of the three others pays 2<sup>2</sup> + 1 = 5 base, so you collect 15.</p>
    </section>

    <section>
      <h2>5. Kongs pay right away</h2>
      <p>Kong money (刮风下雨) is paid the moment the kong is made:</p>
      <ul>
        <li><b>Exposed kong</b> (from someone’s discard): the discarder pays 2 base.</li>
        <li><b>Added kong</b> (adding the 4th tile to your pung): every other player still in pays 1 base.</li>
        <li><b>Concealed kong</b> (four drawn tiles): every other player still in pays 2 base.</li>
      </ul>
      <p>Two added kongs <b>still count as kongs</b> (you draw a replacement tile and they count as a root) but <b>collect nothing</b>:</p>
      <ul>
        <li>You held three of a tile, someone discarded the fourth, and you chose to <b>pung it first</b> and kong later.</li>
        <li>You drew the 4th tile for your pung but did <b>not add it in that same turn</b>.</li>
      </ul>
      <p><b>Robbing the kong:</b> when you add a tile to your pung, another player can win on that tile. The kong then does not happen and you pay that player as if you had discarded it.</p>
      <p><b>Kong-payment transfer</b> (呼叫转移): if you kong, then discard a tile that someone wins on, all the money that kong collected goes to the player who won on your discard (the first one, if several won).</p>
    </section>

    <section>
      <h2>6. When the wall runs out</h2>
      <p>If tiles run out before three players have won, the players still in settle up:</p>
      <ul>
        <li><b>Flower pig</b> (花猪): still holding void-suit tiles. Pays ${capPay} base to every player who is not a flower pig.</li>
        <li><b>Ready-hand check</b> (查大叫): a player who is not one tile away from winning pays each ready player the most that player could have won (pattern and roots, no bonuses, capped).</li>
        <li><b>Refund</b> (退税): players who are not ready, and flower pigs, give back all the kong money they collected this hand.</li>
      </ul>
    </section>

    <section>
      <h2>7. Games with 5 to 7 players</h2>
      <p>Only four people play each hand. The others are <b>temporary observers</b>: they see the discards only, keep their score, and always play the next hand.
      <b>Spectators</b> are different: they only watch, have no score and never play.</p>
      <ul>
        <li><b>5 players:</b> the first player to deal in sits out next hand (if the first win was a self-draw, the winner’s opposite sits out). The observer takes that seat.</li>
        <li><b>6 players:</b> that player and the last player without a win sit out. The two observers take the seats in random order.</li>
        <li><b>7 players:</b> only the first winner stays. The three observers take the other seats in random order.</li>
      </ul>
      <p>The scoreboard on the table shows everyone’s live total, including people sitting out.</p>
    </section>

    <section>
      <h2>8. Words you will see</h2>
      <div class="table-wrap"><table class="r-table glossary">
        <thead><tr><th>Chinese</th><th>Pinyin</th><th>Meaning</th></tr></thead>
        <tbody>${GLOSSARY.map(([cn, py, meaning]) => `<tr><td>${cn}</td><td class="muted">${py}</td><td>${meaning}</td></tr>`).join('')}</tbody>
      </table></div>
    </section>
  </article>
</div>`;
}
