/** The whole UI: routing, rendering from a ClientView, and input handling. */
import type { Action } from '../engine/game';
import { makeRules } from '../engine/rules';
import { createRoom, PLAYER_COUNTS, type PlayerCount, type Role } from '../engine/room';
import { suitOf, type Suit } from '../engine/tiles';
import type { ClientView, GameView, MeldView, SettlementView } from '../engine/view';
import { getName, getPlayerId, lastHostCode, loadHostRoom, setName } from '../net/storage';
import { LocalSession, randomRoomCode, RemoteSession, type Session } from './session';
import { displayName, lang, S, setLang } from './i18n';
import { renderRulesPage } from './rulesPage';
import { backHtml, tileHtml } from './tileArt';

/** Single-player preview build (no online play), e.g. for hosts that block WebRTC. */
const SOLO_ONLY = import.meta.env.VITE_SOLO_ONLY === '1';

type Dialog = { kind: 'leave' } | { kind: 'copy'; text: string };

type Route =
  | { page: 'home'; code?: string }
  | { page: 'solo'; debug: boolean; seed?: number; n: PlayerCount }
  | { page: 'host'; code: string }
  | { page: 'join'; code: string; role: Role };

function parseRoute(): Route {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, query] = h.split('?');
  const params = new URLSearchParams(query ?? '');
  const [a, b] = path.split('/');
  if (a === 'solo') {
    const seed = params.get('seed');
    const n = Number(params.get('n'));
    return {
      page: 'solo',
      debug: params.get('debug') === '1',
      seed: seed ? Number(seed) : undefined,
      n: (PLAYER_COUNTS as readonly number[]).includes(n) ? (n as PlayerCount) : 4,
    };
  }
  if (a === 'host' && /^\d{6}$/.test(b ?? '')) return { page: 'host', code: b };
  if ((a === 'join' || a === 'watch') && /^\d{6}$/.test(b ?? ''))
    return { page: 'join', code: b, role: a === 'watch' ? 'spectator' : 'player' };
  return { page: 'home' };
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** A player's name, escaped, with bot names shown in the current language. */
const nm = (name: string) => esc(displayName(name));
/** Parenthesised note in the current language's punctuation. */
const paren = (x: string) => (lang === 'en' ? ` (${x})` : `（${x}）`);
const listSep = () => (lang === 'en' ? ', ' : '、');

/** Language switch, plus the Rules page button in English. */
function langButtons(): string {
  const rules =
    lang === 'en' ? `<button class="btn small" data-act="rules">${S.rulesPage}</button>` : '';
  return `<button class="btn small ghost" data-act="lang" lang="${lang === 'en' ? 'zh-CN' : 'en'}">${S.langToggle}</button>${rules}`;
}

function meldHtml(m: MeldView, cls: string): string {
  const n = m.kind === 'pung' ? 3 : 4;
  let inner = '';
  for (let i = 0; i < n; i++) {
    const hidden = m.tile === null || (m.kind === 'kong-concealed' && (i === 0 || i === 3));
    inner += hidden || m.tile === null ? backHtml(cls) : tileHtml(m.tile, cls);
  }
  return `<div class="meld">${inner}</div>`;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function deltaCls(n: number): string {
  return n > 0 ? 'pos' : n < 0 ? 'neg' : 'zero';
}

interface UIState {
  sel: number | null;
  exSel: number[];
  handSig: string;
  lastEventSeq: number;
  viewBase: number;
  showLog: boolean;
  dialog: Dialog | null;
  boardOpen: boolean;
  showRules: boolean;
  soloCount: PlayerCount;
  hideResult: boolean;
  deadlineAt: number | null;
  toastMsg: string;
}

export class App {
  private screen: HTMLElement;
  private toasts: HTMLElement;
  private session: Session | null = null;
  private sessionKey = '';
  private unsub: (() => void) | null = null;
  private ui: UIState = this.freshUI();
  private dragging = false;
  private renderQueued = false;
  private suppressClick = false;

  constructor(root: HTMLElement) {
    root.innerHTML = `<div id="screen"></div><div id="toasts"></div>`;
    this.screen = root.querySelector('#screen')!;
    this.toasts = root.querySelector('#toasts')!;
    this.screen.addEventListener('click', (e) => this.onClick(e));
    this.screen.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.screen.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (e.key === 'Enter' && t.dataset.enter) {
        e.preventDefault();
        this.handle(t.dataset.enter, t);
      }
    });
    window.addEventListener('hashchange', () => this.route());
    setInterval(() => this.tickCountdown(), 250);
    this.route();
  }

  private freshUI(): UIState {
    return {
      sel: null,
      exSel: [],
      handSig: '',
      lastEventSeq: 0,
      viewBase: 0,
      showLog: false,
      dialog: null,
      boardOpen: true,
      showRules: false,
      soloCount: this.ui?.soloCount ?? 4,
      hideResult: false,
      deadlineAt: null,
      toastMsg: '',
    };
  }

  // -------------------------------------------------------------------------
  // Routing and sessions

  private setSession(key: string, make: () => Session | null): void {
    if (this.sessionKey === key && this.session) return;
    this.unsub?.();
    this.session?.dispose();
    this.session = null;
    this.ui = this.freshUI();
    this.sessionKey = key;
    this.session = make();
    if (this.session) this.unsub = this.session.subscribe(() => this.requestRender());
  }

  private clearSession(): void {
    this.unsub?.();
    this.unsub = null;
    this.session?.dispose();
    this.session = null;
    this.sessionKey = '';
  }

  private route(): void {
    const r = parseRoute();
    const name = getName();
    const pid = getPlayerId();
    switch (r.page) {
      case 'home':
        this.clearSession();
        break;
      case 'solo':
        this.setSession(`solo:${r.debug}:${r.seed ?? ''}:${r.n}`, () =>
          LocalSession.solo(name || (lang === 'en' ? 'Me' : '我'), pid, {
            debug: r.debug,
            seed: r.seed,
            playerCount: r.n,
          }),
        );
        break;
      case 'host':
        this.setSession(`host:${r.code}`, () => {
          const saved = loadHostRoom(r.code);
          if (!saved) return null;
          const hostId = saved.members[0]?.playerId ?? pid;
          return new LocalSession(saved, hostId, { online: true });
        });
        break;
      case 'join':
        if (!name) {
          this.clearSession();
          break;
        }
        this.setSession(
          `join:${r.code}:${r.role}`,
          () => new RemoteSession(r.code, { playerId: pid, name, role: r.role }),
        );
        break;
    }
    this.render();
  }

  private requestRender(): void {
    if (this.dragging) {
      this.renderQueued = true;
      return;
    }
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      if (!this.dragging) this.render();
      else this.renderQueued = true;
    });
  }

  // -------------------------------------------------------------------------
  // Rendering

  private render(): void {
    const r = parseRoute();
    const s = this.session;
    let html: string;
    if (r.page === 'home' || (r.page === 'join' && !getName())) {
      html = this.renderHome(r.page === 'join' ? r : undefined);
    } else if (!s) {
      html = this.renderMessage(S.hostMissing);
    } else {
      const status = s.status();
      const view = s.view();
      if (status.kind === 'fatal') html = this.renderMessage(status.text);
      else if (!view) html = this.renderMessage(status.text || S.connecting, true);
      else {
        html = this.renderView(view, s);
        if (status.kind !== 'ok' || status.text)
          html = `<div class="banner ${status.kind}">${esc(status.text)}</div>` + html;
      }
    }
    const rules = this.ui.showRules && lang === 'en' ? renderRulesPage() : '';
    this.screen.innerHTML = html + rules + this.renderDialog();
    const v = s?.view();
    if (v?.game) this.showEventToasts(v);
  }

  private renderHome(join?: { code: string; role: Role }): string {
    const name = getName();
    const restore = lastHostCode();
    return `
    <div class="home">
      <div class="home-card">
        <div class="card-top">${langButtons()}</div>
        <div class="logo">${tileHtml(4, 'logo-tile')}${tileHtml(13, 'logo-tile')}${tileHtml(22, 'logo-tile')}</div>
        <h1>${S.appTitle}</h1>
        <p class="tagline">${S.tagline}</p>
        <label class="field"><span>${S.nickname}</span>
          <input id="name" maxlength="12" value="${esc(name)}" placeholder="${S.nicknamePlaceholder}" autocomplete="nickname" data-enter="${join ? (join.role === 'spectator' ? 'join-watch' : 'join-seat') : 'create'}">
        </label>
        ${
          join
            ? `<p class="hint">${S.roomCode} ${join.code}</p>
               <div class="row"><button class="btn primary" data-act="${join.role === 'spectator' ? 'join-watch' : 'join-seat'}" data-code="${join.code}">${join.role === 'spectator' ? S.joinWatch : S.joinSeat}</button>
               <button class="btn" data-act="go-home">${S.back}</button></div>`
            : SOLO_ONLY
              ? `<button class="btn primary wide" data-act="solo">${S.solo}</button>
                 <div class="count-picker" role="group" aria-label="${S.playerCount}">
          <span class="muted">${S.soloCount}</span>
          ${PLAYER_COUNTS.map((n) => `<button class="btn small ${this.ui.soloCount === n ? 'on' : ''}" data-act="solo-count" data-n="${n}">${S.modeLabel(n)}</button>`).join('')}
        </div>
                 <p class="hint center">${S.soloOnlyNote}</p>`
              : `
        <button class="btn primary wide" data-act="solo">${S.solo}</button>
        <div class="count-picker" role="group" aria-label="${S.playerCount}">
          <span class="muted">${S.soloCount}</span>
          ${PLAYER_COUNTS.map((n) => `<button class="btn small ${this.ui.soloCount === n ? 'on' : ''}" data-act="solo-count" data-n="${n}">${S.modeLabel(n)}</button>`).join('')}
        </div>
        <button class="btn primary wide" data-act="create">${S.createRoom}</button>
        ${restore ? `<button class="btn wide" data-act="restore" data-code="${restore}">${S.restoreRoom(restore)}</button>` : ''}
        <div class="join-row">
          <input id="code" inputmode="numeric" maxlength="6" placeholder="${S.roomCodePlaceholder}" data-enter="join-seat">
          <button class="btn" data-act="join-seat">${S.joinSeat}</button>
          <button class="btn" data-act="join-watch">${S.joinWatch}</button>
        </div>`
        }
        <p class="error" id="home-error">${esc(this.ui.toastMsg)}</p>
        <details class="rules"><summary>${S.rulesTitle}</summary><ul>${S.rulesBody.map((l) => `<li>${l}</li>`).join('')}</ul></details>
      </div>
    </div>`;
  }

  private renderDialog(): string {
    const d = this.ui.dialog;
    if (!d) return '';
    const body =
      d.kind === 'leave'
        ? `<p>${S.leaveConfirm}</p>
           <div class="row end"><button class="btn" data-act="dialog-close">${S.cancel}</button>
           <button class="btn primary" data-act="leave-yes">${S.leave}</button></div>`
        : `<p>${S.copyManually}</p>
           <input id="copy-text" class="copy-text" readonly value="${esc(d.text)}">
           <div class="row end"><button class="btn primary" data-act="dialog-close">${S.close}</button></div>`;
    return `<div class="modal-bg dialog-bg"><div class="modal dialog">${body}</div></div>`;
  }

  private renderMessage(text: string, spinner = false): string {
    return `<div class="home"><div class="home-card msg">
      ${spinner ? '<div class="spinner"></div>' : ''}
      <p>${esc(text)}</p>
      <button class="btn" data-act="go-home">${S.back}</button>
    </div></div>`;
  }

  private renderView(v: ClientView, s: Session): string {
    if (v.phase === 'lobby') return this.renderLobby(v, s);
    if (v.phase === 'finished') return this.renderFinal(v);
    return this.renderTable(v, s);
  }

  private inviteLink(code: string, watch: boolean): string {
    return `${location.origin}${location.pathname}#/${watch ? 'watch' : 'join'}/${code}`;
  }

  private renderLobby(v: ClientView, s: Session): string {
    const host = s.host;
    const n = v.playerCount;
    const seats = v.members
      .map((m, i) => {
        const me = v.myMember === i;
        let body: string;
        if (m.kind === 'empty') body = `<div class="seat-name empty">${S.emptySeat}</div>`;
        else
          body = `<div class="seat-name">${nm(m.name)}${me ? S.meSuffix : ''}</div>
          <div class="seat-tags">${i === 0 ? `<span class="chip host">${S.hostTag}</span>` : ''}${m.kind === 'ai' ? `<span class="chip">${S.ai}</span>` : ''}${m.kind === 'human' && !m.connected ? `<span class="chip warn">${S.offline}</span>` : ''}</div>`;
        const first =
          n > 4
            ? `<span class="chip ${i < 4 ? 'ok' : 'bench'}">${i < 4 ? S.firstPlays : S.firstBench}</span>`
            : '';
        let ctl = '';
        if (host && i > 0) {
          if (m.kind === 'empty')
            ctl = `<button class="btn small" data-act="ai" data-seat="${i}" data-on="1">${S.addAI}</button>`;
          else if (m.kind === 'ai')
            ctl = `<button class="btn small" data-act="ai" data-seat="${i}" data-on="0">${S.removeAI}</button>`;
        }
        return `<div class="lobby-seat ${me ? 'is-me' : ''}"><div class="seat-no">${S.seat(i + 1)} ${first}</div>${body}${ctl}</div>`;
      })
      .join('');
    const specs: string[] = [];
    for (let i = 0; i < v.spectatorSlots; i++) {
      const sp = v.spectators[i];
      specs.push(
        `<div class="spec-slot">${sp ? nm(sp.name) + (sp.connected ? '' : paren(S.offline)) : `<span class="muted">${S.emptySeat}</span>`}
        ${host && sp ? `<button class="btn small" data-act="kick" data-index="${i}">${S.kick}</button>` : ''}</div>`,
      );
    }
    const full = v.members.every((x) => x.kind !== 'empty');
    const modes = host
      ? `<div class="count-picker">${PLAYER_COUNTS.map((c) => {
          const ok = host.canSetPlayerCount(c);
          return `<button class="btn small ${c === n ? 'on' : ''}" data-act="count" data-n="${c}" ${ok || c === n ? '' : `disabled title="${S.countBlocked}"`}>${S.modeLabel(c)}</button>`;
        }).join('')}</div>`
      : `<div class="count-picker"><span class="chip on">${S.modeLabel(n)}</span></div>`;
    let bottom: string;
    if (host) {
      bottom = `<button class="btn primary big" data-act="start" ${full ? '' : 'disabled'}>${S.start}</button>
        ${full ? '' : `<p class="hint">${S.needFull(n)}</p>`}`;
    } else {
      bottom = `<p class="hint">${S.waitStart}</p>
        ${v.role === 'player' ? `<button class="btn" data-act="switch" data-role="spectator">${S.toWatch}</button>` : `<button class="btn" data-act="switch" data-role="player">${S.toSeat}</button>`}`;
    }
    return `<div class="lobby">
      <div class="lobby-head">
        <div><div class="muted">${S.roomCode}</div><div class="code">${v.code}</div></div>
        <div class="row">
          ${langButtons()}
          <button class="btn" data-act="copy" data-text="${esc(this.inviteLink(v.code, false))}">${S.copyInvite}</button>
          <button class="btn" data-act="copy" data-text="${esc(this.inviteLink(v.code, true))}">${S.copyWatch}</button>
          <button class="btn ghost" data-act="leave">${S.leave}</button>
        </div>
      </div>
      <div class="mode">
        <h3>${S.playerCount}</h3>
        ${modes}
        <p class="hint">${S.modeRule[n]}</p>
      </div>
      <div class="lobby-seats n${n}">${seats}</div>
      <h3>${S.spectators}${paren(`${v.spectators.length}/${v.spectatorSlots}`)}<span class="muted small-note">${S.spectatorVsBench}</span></h3>
      <div class="spec-slots">${specs.join('')}</div>
      <div class="lobby-foot">${bottom}</div>
      <details class="rules"><summary>${S.rulesTitle}</summary><ul>${S.rulesBody.map((l) => `<li>${l}</li>`).join('')}</ul></details>
    </div>`;
  }

  private renderScoreboard(v: ClientView): string {
    const rows = v.members
      .map((m, i) => ({ ...m, i }))
      .filter((m) => m.kind !== 'empty')
      .sort((a, b) => b.total - a.total || a.no - b.no);
    const items = rows
      .map(
        (m, rank) => `<li class="${m.status} ${v.myMember === m.i ? 'me' : ''}">
          <span class="rk">${rank + 1}</span>
          <span class="nm">${nm(m.name)}</span>
          ${m.status === 'bench' ? `<span class="tag">${S.benchShort}</span>` : ''}
          <b class="${deltaCls(m.total)}">${signed(m.total)}</b>
          ${m.handDelta ? `<small class="${deltaCls(m.handDelta)}">${signed(m.handDelta)}</small>` : ''}
        </li>`,
      )
      .join('');
    return `<div class="scoreboard ${this.ui.boardOpen ? '' : 'closed'}">
      <button class="sb-head" data-act="board" aria-expanded="${this.ui.boardOpen}">${S.scoreboard}<span>${this.ui.boardOpen ? '▴' : '▾'}</span></button>
      <ol>${items}</ol>
    </div>`;
  }

  private posOf(v: ClientView, seat: number): number {
    const base = v.mySeat ?? this.ui.viewBase;
    return (seat - base + 4) % 4;
  }

  private plate(v: ClientView, g: GameView, seat: number): string {
    const info = v.seats[seat];
    const p = g.players[seat];
    const chips: string[] = [];
    if (p.isDealer) chips.push(`<span class="chip dealer">${S.dealer}</span>`);
    if (p.voidSuit !== undefined && p.voidSuit !== null)
      chips.push(`<span class="chip void">${S.voidChip(S.suitsShort[p.voidSuit])}</span>`);
    if (p.won) chips.push(`<span class="chip won">${S.won(p.won.order, p.won.selfDraw)}</span>`);
    if (p.ready) chips.push(`<span class="chip ok">${S.ready}</span>`);
    if (info.kind === 'ai') chips.push(`<span class="chip">${S.ai}</span>`);
    else if (!info.connected)
      chips.push(`<span class="chip warn">${S.offline}·${S.autoplay}</span>`);
    const turn = g.turn === seat && g.phase === 'play';
    const waiting = g.waiting.includes(seat);
    return `<div class="plate ${turn ? 'turn' : ''} ${waiting ? 'waiting' : ''}">
      <span class="nm">${nm(info.name)}</span>
      <span class="score ${deltaCls(info.total)}">${signed(info.total)}</span>
      <span class="chips">${chips.join('')}</span>
    </div>`;
  }

  private otherSeat(v: ClientView, g: GameView, seat: number, pos: number): string {
    const p = g.players[seat];
    const melds = (p.melds ?? []).map((m) => meldHtml(m, 'mini')).join('');
    let handPart = '';
    if (p.revealed) {
      const winAt = p.revealed.tile === null ? -1 : p.revealed.hand.lastIndexOf(p.revealed.tile);
      handPart = `<div class="tiles revealed">${p.revealed.hand
        .map((t, i) => tileHtml(t, `mini ${i === winAt ? 'win' : ''}`))
        .join('')}</div>`;
    } else if (p.debugHand) {
      handPart = `<div class="tiles debug">${p.debugHand.map((t) => tileHtml(t, 'mini')).join('')}</div>`;
    } else if (p.handCount !== undefined && !p.won) {
      const n = p.handCount;
      handPart =
        pos === 2
          ? `<div class="tiles backs">${Array.from({ length: n }, () => backHtml('mini')).join('')}</div>`
          : `<div class="tiles backs vertical"><span class="count">${n}</span>${backHtml('mini')}</div>`;
    }
    return `<div class="seat pos-${pos}">
      ${this.plate(v, g, seat)}
      <div class="seat-body">${handPart}<div class="melds">${melds}</div></div>
      <div class="toast-anchor" data-seat="${seat}"></div>
    </div>`;
  }

  private river(g: GameView, seat: number, pos: number): string {
    const p = g.players[seat];
    const claim = g.claimTile && !g.claimTile.rob && g.claimTile.seat === seat;
    const lastDiscard = g.events.length ? g.events[g.events.length - 1] : null;
    const highlightLast =
      claim || (lastDiscard?.kind === 'discard' && lastDiscard.seat === seat && g.turn === seat);
    return `<div class="river pos-${pos}">${p.discards
      .map((t, i) =>
        tileHtml(t, `river-tile ${highlightLast && i === p.discards.length - 1 ? 'last' : ''}`),
      )
      .join('')}</div>`;
  }

  private renderTable(v: ClientView, s: Session): string {
    const g = v.game!;
    const me = g.me;
    if (v.mySeat === null && this.ui.viewBase >= 4) this.ui.viewBase = 0;
    const seatAt = (pos: number) => ((v.mySeat ?? this.ui.viewBase) + pos) % 4;
    const others = [1, 2, 3].map((pos) => this.otherSeat(v, g, seatAt(pos), pos)).join('');
    const rivers = [0, 1, 2, 3].map((pos) => this.river(g, seatAt(pos), pos)).join('');
    const deadlineAt = g.deadlineMs !== null ? Date.now() + g.deadlineMs : null;
    this.ui.deadlineAt = deadlineAt;
    const turnSeat = g.turn;
    const center = `<div class="info">
      <div class="info-line">${S.hand(v.handNo)} · ${S.wall(g.wallCount)}</div>
      ${g.exchangeDir && g.phase !== 'ended' ? `<div class="info-line small">${S.exchangeDir[g.exchangeDir]}</div>` : ''}
      <div class="countdown" id="countdown"></div>
      <div class="info-line small">${turnSeat !== null && g.phase === 'play' ? `▶ ${nm(v.seats[turnSeat].name)}` : ''}</div>
      ${v.spectators.length ? `<div class="info-line small muted">${S.spectatorsLine(v.spectators.map((x) => nm(x.name)).join(listSep()))}</div>` : ''}
    </div>`;

    const bottomSeat = seatAt(0);
    const bottom = me ? this.renderMine(v, g) : this.renderSpectatorBottom(v, g, bottomSeat);
    const roleChip =
      v.role === 'spectator'
        ? `<span class="chip watch">${S.watching}</span>`
        : v.role === 'bench'
          ? `<span class="chip bench">${S.benchChip}</span>`
          : '';
    const peek =
      v.phase === 'handEnd' && this.ui.hideResult
        ? `<button class="btn small primary" data-act="show-result">${S.viewResult}</button>`
        : '';
    const top = `<div class="topbar">
      <span class="muted">${v.code === 'solo' ? S.soloTag : `${S.roomCode} ${v.code}`}</span>
      ${roleChip}
      ${me ? '' : `<button class="btn small" data-act="rotate">${S.rotate}</button>`}
      <button class="btn small" data-act="log">${S.log}</button>
      ${langButtons()}
      <button class="btn small ghost" data-act="leave">${S.leave}</button>
      ${peek}
    </div>`;
    let modal = '';
    if (v.phase === 'handEnd' && !this.ui.hideResult) modal = this.renderResult(v, s);
    else if (this.ui.showLog) modal = this.renderLog(v);
    return `<div class="table ${v.role}">
      ${top}
      ${this.renderScoreboard(v)}
      ${others}
      <div class="center">${rivers}${center}</div>
      ${bottom}
      ${modal}
    </div>`;
  }

  private renderSpectatorBottom(v: ClientView, g: GameView, seat: number): string {
    const p = g.players[seat];
    const melds = (p.melds ?? []).map((m) => meldHtml(m, 'mini')).join('');
    return `<div class="mine spectator-bottom">
      ${this.plate(v, g, seat)}
      <div class="melds">${melds}</div>
      <div class="hint">${v.role === 'bench' ? S.benchNote : S.spectatorNote}</div>
      <div class="toast-anchor" data-seat="${seat}"></div>
    </div>`;
  }

  private renderMine(v: ClientView, g: GameView): string {
    const me = g.me!;
    const seat = v.mySeat!;
    const legal = me.legal;
    const sig = me.hand.join(',') + '|' + (me.drawn ?? '');
    if (sig !== this.ui.handSig) {
      this.ui.handSig = sig;
      this.ui.sel = null;
      if (!legal.exchange) this.ui.exSel = [];
    }
    // Hand display order: sorted, with the drawn tile pulled out to the right.
    let order = me.hand.map((_, i) => i);
    let drawnIdx = -1;
    if (me.drawn !== null) {
      drawnIdx = me.hand.lastIndexOf(me.drawn);
      order = order.filter((i) => i !== drawnIdx);
    }
    const allowed = new Set(legal.discard ?? []);
    const acting = !!legal.discard;
    const tileFor = (i: number) => {
      const t = me.hand[i];
      const cls = ['hand-tile'];
      if (me.voidSuit !== null && suitOf(t) === me.voidSuit) cls.push('void');
      if (acting && !allowed.has(t)) cls.push('disabled');
      if (this.ui.sel === i) cls.push('selected');
      if (this.ui.exSel.includes(i)) cls.push('selected');
      if (me.exchangePick && legal.exchange === undefined && g.phase === 'exchange')
        cls.push('dim');
      return tileHtml(t, cls.join(' '), `data-act="tile" data-i="${i}"`);
    };
    const handHtml =
      order.map(tileFor).join('') +
      (drawnIdx >= 0 ? `<div class="gap"></div>${tileFor(drawnIdx)}` : '');
    const melds = me.melds.map((m) => meldHtml(m, 'meld-tile')).join('');
    const won = g.players[seat].won;
    const revealed = g.players[seat].revealed;
    const shown =
      won && revealed
        ? revealed.hand
            .map((t, i) =>
              tileHtml(
                t,
                `hand-tile ${revealed.tile !== null && i === revealed.hand.lastIndexOf(revealed.tile) ? 'win' : ''}`,
              ),
            )
            .join('')
        : handHtml;
    return `<div class="mine">
      <div class="mine-top">${this.plate(v, g, seat)}<div class="actions">${this.renderActions(v, g)}</div></div>
      <div class="mine-row">
        <div class="melds mine-melds">${melds}</div>
        <div class="hand ${won ? 'won' : ''}">${shown}</div>
      </div>
      <div class="toast-anchor" data-seat="${seat}"></div>
    </div>`;
  }

  private renderActions(v: ClientView, g: GameView): string {
    const me = g.me!;
    const legal = me.legal;
    const btn = (act: string, label: string, cls = '', extra = '') =>
      `<button class="btn act ${cls}" data-act="${act}" ${extra}>${label}</button>`;
    const parts: string[] = [];
    let hint = '';
    if (legal.exchange) {
      hint = S.exchangeHint;
      parts.push(btn('ex-suggest', S.exchangeSuggest, 'ghost'));
      parts.push(
        btn(
          'ex-confirm',
          S.exchangeConfirm,
          'primary',
          this.ui.exSel.length === 3 ? '' : 'disabled',
        ),
      );
    } else if (g.phase === 'exchange') {
      hint = S.exchangeWaiting;
    } else if (legal.void) {
      hint = S.voidHint;
      for (const s of [0, 1, 2] as Suit[])
        parts.push(
          btn(
            'void',
            S.voidBtn(S.suits[s]),
            me.suggestedVoid === s ? 'primary' : '',
            `data-suit="${s}"`,
          ),
        );
    } else if (g.phase === 'void') {
      hint = S.voidWaiting;
    } else if (legal.rob) {
      parts.push(tileHtml(legal.rob.tile, 'claim-tile'));
      parts.push(btn('hu', S.rob, 'hu'));
      parts.push(btn('pass', S.pass, 'ghost'));
    } else if (legal.claim) {
      const c = legal.claim;
      parts.push(tileHtml(c.tile, 'claim-tile'));
      if (c.hu) parts.push(btn('hu', S.hu, 'hu'));
      if (c.kong) parts.push(btn('kong', S.kong, 'kong'));
      if (c.pung) parts.push(btn('pung', S.pung, 'pung'));
      parts.push(btn('pass', S.pass, 'ghost'));
    } else if (legal.discard) {
      if (legal.selfHu) parts.push(btn('hu', S.zimo, 'hu'));
      for (const t of legal.kongs ?? [])
        parts.push(
          btn(
            'kong',
            `${S.kong}${tileHtml(t, 'inline-tile')}${legal.unpaidKongs?.includes(t) ? `<small>${S.kongNoPay}</small>` : ''}`,
            'kong',
            `data-tile="${t}"`,
          ),
        );
      const voidLeft = me.voidSuit !== null && me.hand.some((t) => suitOf(t) === me.voidSuit);
      hint = voidLeft ? S.mustVoid : S.yourTurn;
    } else if (g.phase === 'play' && g.turn !== null) {
      const waiting = g.waiting.filter((s) => s !== v.mySeat);
      if (waiting.length)
        hint = S.waitingFor(waiting.map((s) => displayName(v.seats[s].name)).join(listSep()));
    }
    if (me.huLocked && g.phase === 'play') hint = (hint ? hint + ' · ' : '') + S.huLocked;
    const err = this.session?.lastError();
    return `${parts.length ? `<div class="btns">${parts.join('')}</div>` : ''}${hint ? `<div class="hint">${esc(hint)}</div>` : ''}${err ? `<div class="hint err">${esc(err)}</div>` : ''}`;
  }

  private settlementLabel(v: ClientView, s: SettlementView): string {
    const n = (seat: number | null | undefined) =>
      seat === null || seat === undefined ? '' : nm(v.seats[seat].name);
    let label: string;
    switch (s.kind) {
      case 'zimo':
        label = S.settle.zimo(n(s.seat));
        break;
      case 'dianpao':
        label = S.settle.dianpao(n(s.seat), n(s.from));
        break;
      case 'qianggang':
        label = S.settle.qianggang(n(s.seat), n(s.from));
        break;
      case 'kong':
        label =
          S.settle.kong(n(s.seat), s.meldKind ? S.meldName[s.meldKind] : S.kong) +
          (s.unpaid ? paren(S.kongUnpaid[s.unpaid]) : '');
        break;
      case 'transfer':
        label = S.settle.transfer(n(s.seat), n(s.deltas.findIndex((d) => d > 0)));
        break;
      case 'huazhu':
        label = S.settle.huazhu(n(s.seat));
        break;
      case 'dajiao':
        label = S.settle.dajiao(n(s.seat));
        break;
      case 'refund':
        label = S.settle.refund(n(s.seat));
        break;
    }
    let fan = '';
    if (s.fan) {
      const items = s.fan.items.map(
        (i) =>
          `${S.fanNames[i.key] ?? i.key}${i.count && i.count > 1 ? `×${i.count}` : ''}${i.fan ? ` ${i.fan}` : ''}`,
      );
      fan = `<div class="fan">${items.join(' · ')} = <b>${s.fan.fan}${S.fanUnit}</b>${s.fan.capped ? paren(S.capped) : ''}</div>`;
    }
    const tile = s.tile !== undefined ? tileHtml(s.tile, 'inline-tile') : '';
    return `<div class="s-label">${label} ${tile}${fan}</div>`;
  }

  private deltaRow(v: ClientView, deltas: number[]): string {
    return `<div class="deltas">${deltas
      .map(
        (d, i) => `<span class="${deltaCls(d)}"><i>${nm(v.seats[i].name)}</i>${signed(d)}</span>`,
      )
      .join('')}</div>`;
  }

  private renderSettlements(v: ClientView): string {
    const g = v.game!;
    if (!g.settlements.length) return `<p class="muted">${S.noSettlement}</p>`;
    return g.settlements
      .map(
        (s) =>
          `<div class="settle-row">${this.settlementLabel(v, s)}${this.deltaRow(v, s.deltas)}</div>`,
      )
      .join('');
  }

  private renderLog(v: ClientView): string {
    return `<div class="modal-bg" data-act="log"><div class="modal" data-stop="1">
      <h2>${S.log}</h2>
      ${this.renderSettlements(v)}
      <div class="settle-row total"><div class="s-label">${S.thisHand}</div>${this.deltaRow(v, v.game!.handDeltas)}</div>
      <div class="row end"><button class="btn" data-act="log">${S.close}</button></div>
    </div></div>`;
  }

  private renderResult(v: ClientView, s: Session): string {
    const g = v.game!;
    const host = s.host;
    return `<div class="modal-bg"><div class="modal result">
      <h2>${S.handOver(v.handNo)} <small>${g.endReason === 'wall-exhausted' ? S.exhausted : S.threeWon}</small></h2>
      ${this.renderRotation(v)}
      <div class="settle-list">${this.renderSettlements(v)}</div>
      <div class="settle-row total"><div class="s-label">${S.thisHand}</div>${this.deltaRow(v, g.handDeltas)}</div>
      <div class="settle-row total"><div class="s-label">${S.total}</div>${this.memberRow(v)}</div>
      <div class="row end">
        <button class="btn ghost" data-act="hide-result">${S.viewTable}</button>
        ${host ? `<button class="btn" data-act="end-session">${S.endSession}</button><button class="btn primary" data-act="next-hand">${S.nextHand}</button>` : `<span class="muted">${S.waitNext}</span>`}
      </div>
    </div></div>`;
  }

  /** Running totals of every member (4–7 people). */
  private memberRow(v: ClientView): string {
    return `<div class="deltas members n${v.playerCount}">${v.members
      .map(
        (m) =>
          `<span class="${deltaCls(m.total)} ${m.status}"><i>${nm(m.name)}</i>${signed(m.total)}</span>`,
      )
      .join('')}</div>`;
  }

  private renderRotation(v: ClientView): string {
    const r = v.rotation;
    if (!r) return '';
    const name = (m: number) => nm(v.members[m].name);
    const lines: string[] = [];
    if (r.stayer) lines.push(S.stayLine(name(r.stayer.member), r.stayer.reason));
    for (const o of r.out) lines.push(S.outLine(name(o.member), S.outReason[o.reason]));
    for (const i of r.in) {
      const left = r.out.find((o) => v.members[o.member].seat === i.seat);
      lines.push(S.inLine(name(i.member), left ? name(left.member) : ''));
    }
    return `<div class="rotation"><h3>${S.rotationTitle}</h3><ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul></div>`;
  }

  private renderFinal(v: ClientView): string {
    const ranking = v.members
      .filter((m) => m.kind !== 'empty')
      .sort((a, b) => b.total - a.total || a.no - b.no);
    return `<div class="home"><div class="home-card final">
      <h1>${S.final}</h1>
      <ol class="ranking">${ranking.map((r) => `<li><span>${nm(r.name)}</span><b class="${deltaCls(r.total)}">${signed(r.total)}</b></li>`).join('')}</ol>
      <h3>${S.history}</h3>
      <div class="history-wrap"><table class="history"><tr><th></th>${v.members.map((m) => `<th>${nm(m.name)}</th>`).join('')}</tr>
      ${v.history
        .map(
          (h) =>
            `<tr><td>${S.hand(h.handNo)}</td>${h.deltas
              .map((d) =>
                d === null
                  ? `<td class="muted" title="${S.benchChip}">—</td>`
                  : `<td class="${deltaCls(d)}">${signed(d)}</td>`,
              )
              .join('')}</tr>`,
        )
        .join('')}
      </table></div>
      <button class="btn primary" data-act="go-home">${S.back}</button>
    </div></div>`;
  }

  // -------------------------------------------------------------------------
  // Toasts and countdown

  private showEventToasts(v: ClientView): void {
    const g = v.game!;
    const fresh = g.events.filter((e) => e.seq > this.ui.lastEventSeq);
    if (this.ui.lastEventSeq === 0) {
      // First render of this hand/session: don't replay old events.
      this.ui.lastEventSeq = g.events.length ? g.events[g.events.length - 1].seq : 0;
      return;
    }
    if (!fresh.length) {
      if (g.events.length && g.events[g.events.length - 1].seq < this.ui.lastEventSeq)
        this.ui.lastEventSeq = g.events[g.events.length - 1].seq; // new hand
      return;
    }
    this.ui.lastEventSeq = fresh[fresh.length - 1].seq;
    for (const e of fresh) {
      let text: string;
      let cls: string;
      switch (e.kind) {
        case 'pung':
          text = S.pung;
          cls = 'pung';
          break;
        case 'kong':
          text = S.kong;
          cls = 'kong';
          break;
        case 'hu':
          text = S.hu;
          cls = 'hu';
          break;
        case 'zimo':
          text = S.zimo;
          cls = 'hu';
          break;
        case 'qianggang':
          text = S.rob;
          cls = 'hu';
          break;
        case 'exchange':
          if (g.exchangeDir) this.centerToast(S.exchangeDir[g.exchangeDir]);
          continue;
        default:
          continue;
      }
      this.seatToast(v, e.seat, text, cls);
    }
  }

  private seatToast(v: ClientView, seat: number, text: string, cls: string): void {
    const pos = this.posOf(v, seat);
    const el = document.createElement('div');
    el.className = `toast seat-toast pos-${pos} ${cls}`;
    el.textContent = text;
    this.toasts.appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }

  private centerToast(text: string): void {
    const el = document.createElement('div');
    el.className = 'toast center-toast';
    el.textContent = text;
    this.toasts.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  private tickCountdown(): void {
    const el = this.screen.querySelector<HTMLElement>('#countdown');
    if (!el) return;
    if (this.ui.deadlineAt === null) {
      el.textContent = '';
      return;
    }
    const sec = Math.max(0, Math.ceil((this.ui.deadlineAt - Date.now()) / 1000));
    el.textContent = String(sec);
    el.classList.toggle('urgent', sec <= 5);
  }

  // -------------------------------------------------------------------------
  // Input

  private onClick(e: MouseEvent): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    const target = e.target as HTMLElement;
    const stop = target.closest('[data-stop]');
    const el = target.closest<HTMLElement>('[data-act]');
    if (!el) return;
    if (stop && el.classList.contains('modal-bg')) return;
    this.handle(el.dataset.act!, el);
  }

  private flash(msg: string): void {
    this.ui.toastMsg = msg;
    const err = this.screen.querySelector('#home-error');
    if (err) err.textContent = msg;
    else this.centerToast(msg);
  }

  private readName(): string | null {
    const input = this.screen.querySelector<HTMLInputElement>('#name');
    const name = (input?.value ?? getName()).trim().slice(0, 12);
    if (!name) {
      this.flash(S.needName);
      input?.focus();
      return null;
    }
    setName(name);
    return name;
  }

  private readCode(el: HTMLElement): string | null {
    const code =
      el.dataset.code ?? this.screen.querySelector<HTMLInputElement>('#code')?.value.trim() ?? '';
    if (!/^\d{6}$/.test(code)) {
      this.flash(S.badCode);
      return null;
    }
    return code;
  }

  private intent(a: Action): void {
    this.session?.intent(a);
  }

  private handle(act: string, el: HTMLElement): void {
    const s = this.session;
    const v = s?.view();
    const g = v?.game;
    switch (act) {
      case 'solo': {
        const name = this.readName();
        const n = this.ui.soloCount;
        if (name) location.hash = n === 4 ? '#solo' : `#solo?n=${n}`;
        break;
      }
      case 'solo-count': {
        const input = this.screen.querySelector<HTMLInputElement>('#name');
        if (input) setName(input.value.trim().slice(0, 12));
        this.ui.soloCount = Number(el.dataset.n) as PlayerCount;
        this.render();
        break;
      }
      case 'count':
        s?.host?.setPlayerCount(Number(el.dataset.n) as PlayerCount);
        break;
      case 'lang': {
        const input = this.screen.querySelector<HTMLInputElement>('#name');
        if (input) setName(input.value.trim().slice(0, 12));
        setLang(lang === 'en' ? 'zh' : 'en');
        this.render();
        break;
      }
      case 'rules':
        this.ui.showRules = true;
        this.render();
        break;
      case 'rules-close':
        this.ui.showRules = false;
        this.render();
        break;
      case 'board':
        this.ui.boardOpen = !this.ui.boardOpen;
        this.render();
        break;
      case 'create': {
        const name = this.readName();
        if (!name) return;
        const code = randomRoomCode();
        const pid = getPlayerId();
        const room = createRoom(code, makeRules(), { playerId: pid, name });
        this.setSession(`host:${code}`, () => new LocalSession(room, pid, { online: true }));
        location.hash = `#/host/${code}`;
        break;
      }
      case 'restore':
        location.hash = `#/host/${el.dataset.code}`;
        break;
      case 'join-seat':
      case 'join-watch': {
        const name = this.readName();
        const code = name ? this.readCode(el) : null;
        if (!name || !code) return;
        const target = `#/${act === 'join-watch' ? 'watch' : 'join'}/${code}`;
        if (location.hash === target) this.route();
        else location.hash = target;
        break;
      }
      case 'go-home':
        this.ui.toastMsg = '';
        this.goHome();
        break;
      case 'leave':
        this.ui.dialog = { kind: 'leave' };
        this.render();
        break;
      case 'leave-yes':
        this.ui.dialog = null;
        this.goHome();
        break;
      case 'dialog-close':
        this.ui.dialog = null;
        this.render();
        break;
      case 'copy': {
        const text = el.dataset.text!;
        const manual = () => {
          this.ui.dialog = { kind: 'copy', text };
          this.render();
          this.screen.querySelector<HTMLInputElement>('#copy-text')?.select();
        };
        if (navigator.clipboard)
          navigator.clipboard.writeText(text).then(() => this.centerToast(S.copied), manual);
        else manual();
        break;
      }
      case 'ai':
        s?.host?.setSeatAI(Number(el.dataset.seat), el.dataset.on === '1');
        break;
      case 'kick':
        s?.host?.kickSpectator(Number(el.dataset.index));
        break;
      case 'start':
      case 'next-hand':
        this.ui.hideResult = false;
        s?.host?.start();
        break;
      case 'end-session':
        s?.host?.endSession();
        break;
      case 'switch':
        s?.switchRole(el.dataset.role as Role);
        break;
      case 'rotate':
        this.ui.viewBase = (this.ui.viewBase + 1) % 4;
        this.render();
        break;
      case 'log':
        this.ui.showLog = !this.ui.showLog;
        this.render();
        break;
      case 'hide-result':
        this.ui.hideResult = true;
        this.render();
        break;
      case 'show-result':
        this.ui.hideResult = false;
        this.render();
        break;
      case 'tile':
        if (g?.me) this.onTile(g, Number(el.dataset.i));
        break;
      case 'ex-suggest':
        if (g?.me?.suggestedExchange) {
          const hand = g.me.hand;
          const picks: number[] = [];
          for (const t of g.me.suggestedExchange) {
            const i = hand.findIndex((x, idx) => x === t && !picks.includes(idx));
            if (i >= 0) picks.push(i);
          }
          this.ui.exSel = picks;
          this.render();
        }
        break;
      case 'ex-confirm':
        if (g?.me && this.ui.exSel.length === 3) {
          this.intent({ type: 'exchange', tiles: this.ui.exSel.map((i) => g.me!.hand[i]) });
          this.ui.exSel = [];
        }
        break;
      case 'void':
        this.intent({ type: 'void', suit: Number(el.dataset.suit) as Suit });
        break;
      case 'hu':
        this.intent({ type: 'hu' });
        break;
      case 'pung':
        this.intent({ type: 'pung' });
        break;
      case 'kong':
        this.intent(
          el.dataset.tile !== undefined
            ? { type: 'kong', tile: Number(el.dataset.tile) }
            : { type: 'kong' },
        );
        break;
      case 'pass':
        this.intent({ type: 'pass' });
        break;
    }
  }

  private goHome(): void {
    this.ui.dialog = null;
    if (parseRoute().page === 'home') this.route();
    else location.hash = '';
  }

  private onTile(g: GameView, i: number): void {
    const me = g.me!;
    const t = me.hand[i];
    if (me.legal.exchange) {
      const sel = this.ui.exSel;
      if (sel.includes(i)) this.ui.exSel = sel.filter((x) => x !== i);
      else if (sel.length && suitOf(me.hand[sel[0]]) !== suitOf(t)) this.ui.exSel = [i];
      else if (sel.length < 3) this.ui.exSel = [...sel, i];
      this.render();
      return;
    }
    if (!me.legal.discard?.includes(t)) return;
    if (this.ui.sel === i) {
      this.ui.sel = null;
      this.intent({ type: 'discard', tile: t });
    } else {
      this.ui.sel = i;
      this.render();
    }
  }

  /** Drag a hand tile upwards to discard it. */
  private onPointerDown(e: PointerEvent): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.hand-tile');
    if (!el || e.button > 0) return;
    const g = this.session?.view()?.game;
    const me = g?.me;
    if (!me?.legal.discard) return;
    const i = Number(el.dataset.i);
    const t = me.hand[i];
    if (!me.legal.discard.includes(t)) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    this.dragging = true;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
      moved = true;
      el.style.transform = `translate(${dx}px, ${Math.min(dy, 0)}px)`;
      el.classList.add('dragging');
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      this.dragging = false;
      if (moved) {
        this.suppressClick = true;
        setTimeout(() => (this.suppressClick = false), 50);
        el.style.transform = '';
        el.classList.remove('dragging');
        if (startY - ev.clientY > 50) {
          this.ui.sel = null;
          this.intent({ type: 'discard', tile: t });
        }
      }
      if (this.renderQueued) {
        this.renderQueued = false;
        this.requestRender();
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }
}
