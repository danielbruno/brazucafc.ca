/*
 * Brazuca FC — site behaviour.
 *
 * Pages opt in with data-* hooks:
 *   [data-next-match]        next fixture card (data/schedule.json)
 *   [data-standings]         division table, "compact" or "full" (data/standings.json)
 *   [data-schedule]          full fixture list with filters (data/schedule.json)
 *   [data-squad]             coach and players by position (data/team.json)
 *   [data-gallery]           albums with a lightbox (data/gallery.json)
 *
 * schedule.json and standings.json are refreshed by
 * .github/workflows/update-league-data.yml; "next match" is worked out here
 * against the viewer's clock, so it moves on even between data updates.
 */
(() => {
  'use strict';

  const TEAM = 'Brazuca FC';
  const TIME_ZONE = 'America/Vancouver';
  const LEAGUE_URL = 'https://fraservalleysoccer.spappz.com/';
  // A fixture stays "next" until two hours after kick-off, so it reads as live on the night.
  const MATCH_WINDOW_MS = 2 * 60 * 60 * 1000;

  const BYE_MESSAGES = [
    'No match this round. Legs up, boots cleaned — the Brazucas are back next week.',
    'Bye week! The pitch is quiet, but the group chat definitely isn’t.',
    'Rest round for the squad. Ice the knees, fire up the churrasco, see you next round.',
    'No game this week — even the toucan needs a day off.',
  ];

  const svg = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const ICONS = {
    calendar: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    pin: svg('<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>'),
    moon: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
    trophy: svg('<path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>'),
  };

  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  const requests = new Map();
  function loadJson(path) {
    if (!requests.has(path)) {
      requests.set(path, fetch(path, { cache: 'no-cache' }).then(res => {
        if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
        return res.json();
      }));
    }
    return requests.get(path);
  }

  // ------------------------------------------------------------ dates

  const formatter = options => new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, ...options });
  const fmt = {
    weekday: formatter({ weekday: 'short' }),
    dayMonth: formatter({ month: 'short', day: 'numeric' }),
    time: formatter({ hour: 'numeric', minute: '2-digit' }),
    long: formatter({ weekday: 'long', month: 'long', day: 'numeric' }),
    short: formatter({ weekday: 'short', month: 'short', day: 'numeric' }),
    stamp: formatter({ month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }),
  };
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
  const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  function calendarDaysUntil(fromMs, toMs) {
    const [a, b] = [fromMs, toMs].map(ms => {
      const [y, m, d] = dayKey.format(ms).split('-').map(Number);
      return Date.UTC(y, m - 1, d);
    });
    return Math.round((b - a) / 86_400_000);
  }

  function kickoffLabel(game, now) {
    if (now >= game.start) return 'Happening now — vamo Brazuca!';
    const days = calendarDaysUntil(now, game.start);
    if (days === 0) {
      const minutes = Math.round((game.start - now) / 60_000);
      return `Today · kick-off ${minutes < 60 ? relative.format(minutes, 'minute') : relative.format(Math.round(minutes / 60), 'hour')}`;
    }
    if (days === 1) return 'Tomorrow';
    return `In ${days} days`;
  }

  // --------------------------------------------------------- schedule

  function prepareGames(schedule) {
    return schedule.games
      .filter(game => game.kickoff)
      .map(game => ({ ...game, start: Date.parse(game.kickoff) }))
      .sort((a, b) => a.start - b.start)
      .map((game, i) => ({ ...game, round: i + 1 }));
  }

  const isOver = (game, now) => game.result !== null || game.start + MATCH_WINDOW_MS <= now;
  const findNext = (games, now) => games.find(game => !isOver(game, now)) ?? null;
  const byeMessage = game => BYE_MESSAGES[(game.round - 1) % BYE_MESSAGES.length];

  function initials(name) {
    return name.split(/\s+/).filter(word => word && word.toUpperCase() !== 'FC')
      .map(word => word[0]).join('').slice(0, 3).toUpperCase();
  }

  function teamBlock(name, side) {
    const us = name === TEAM;
    const badge = us
      ? '<span class="team-badge team-badge--us"><img src="assets/img/crest-128.png" alt=""></span>'
      : `<span class="team-badge" aria-hidden="true">${esc(initials(name))}</span>`;
    return `<div class="team${us ? ' team--us' : ''}">${badge}<span class="team-name">${esc(name)}</span><span class="team-side">${side}</span></div>`;
  }

  function dataNote(data) {
    const updated = data.updatedAt ? ` · updated ${esc(fmt.stamp.format(Date.parse(data.updatedAt)))}` : '';
    return `<p class="data-note">From the <a href="${LEAGUE_URL}" target="_blank" rel="noopener">Fraser Valley Soccer League</a>${updated}</p>`;
  }

  function errorState(message) {
    return `<div class="empty-state">${esc(message)} Check the <a href="${LEAGUE_URL}" target="_blank" rel="noopener">FVSL site</a> in the meantime.</div>`;
  }

  function matchCard(game, now) {
    const live = now >= game.start;
    return `
      <article class="card match-card">
        <div class="match-meta">
          <span class="pill ${live ? 'pill--green' : 'pill--yellow'}">${live ? 'Live now' : 'Next match'}</span>
          <span class="match-round">Round ${game.round} · ${esc(game.division)}</span>
        </div>
        <div class="match-teams">
          ${teamBlock(game.home, 'Home')}
          <span class="match-vs">VS</span>
          ${teamBlock(game.away, 'Away')}
        </div>
        <ul class="match-details">
          <li>${ICONS.calendar}<span>${esc(fmt.long.format(game.start))}</span></li>
          <li>${ICONS.clock}<span>${esc(fmt.time.format(game.start))}</span></li>
          <li>${ICONS.pin}<span>${esc(game.field)}</span></li>
        </ul>
        <p class="match-countdown">${esc(kickoffLabel(game, now))}</p>
      </article>`;
  }

  function byeCard(bye, after) {
    return `
      <article class="card match-card">
        <div class="match-meta">
          <span class="pill pill--yellow">Bye week</span>
          <span class="match-round">Round ${bye.round} · ${esc(fmt.long.format(bye.start))}</span>
        </div>
        <div class="bye">
          <span class="bye-icon">${ICONS.moon}</span>
          <h3 class="bye-title">No game this round</h3>
          <p class="bye-text">${esc(byeMessage(bye))}</p>
        </div>
        ${after ? `
        <div class="match-after">
          <span>Back in action</span>
          <strong>${esc(fmt.short.format(after.start))} · ${after.isHome ? 'vs' : '@'} ${esc(after.opponent)}</strong>
        </div>` : ''}
      </article>`;
  }

  function seasonOverCard() {
    return `
      <article class="card match-card">
        <div class="bye">
          <span class="bye-icon">${ICONS.trophy}</span>
          <h3 class="bye-title">That’s a wrap</h3>
          <p class="bye-text">The regular season is done. Thanks for following the Brazucas — next season’s fixtures land here as soon as the league publishes them.</p>
        </div>
      </article>`;
  }

  async function renderNextMatch(el) {
    try {
      const schedule = await loadJson('data/schedule.json');
      const games = prepareGames(schedule);
      const now = Date.now();
      const next = findNext(games, now);
      let html;
      if (!next) html = seasonOverCard();
      else if (next.isBye) html = byeCard(next, games.find(g => g.start > next.start && !g.isBye));
      else html = matchCard(next, now);
      el.innerHTML = html + dataNote(schedule);
    } catch (err) {
      console.error(err);
      el.innerHTML = errorState('We couldn’t load the next match right now.');
    }
  }

  async function renderStandings(el) {
    const compact = el.dataset.standings === 'compact';
    const columns = compact ? ['gp', 'gd', 'pts'] : ['gp', 'w', 'd', 'l', 'gf', 'ga', 'gd', 'pts'];
    const headings = {
      gp: ['GP', 'Games played'], w: ['W', 'Wins'], d: ['D', 'Draws'], l: ['L', 'Losses'],
      gf: ['GF', 'Goals for'], ga: ['GA', 'Goals against'], gd: ['GD', 'Goal difference'], pts: ['PTS', 'Points'],
    };
    try {
      const data = await loadJson('data/standings.json');
      const played = data.rows.some(row => row.gp > 0);
      el.innerHTML = `
        <div class="table-wrap">
          <table class="standings">
            <caption class="visually-hidden">${esc(data.division)} — Pool ${esc(data.pool)} standings</caption>
            <thead>
              <tr>
                <th scope="col"><abbr title="Position">#</abbr></th>
                <th scope="col" class="col-team">Team</th>
                ${columns.map(c => `<th scope="col"><abbr title="${headings[c][1]}">${headings[c][0]}</abbr></th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${data.rows.map(row => `
                <tr${row.team === TEAM ? ' class="is-us"' : ''}>
                  <td><span class="pos">${row.pos}</span></td>
                  <td class="col-team">${esc(row.team)}</td>
                  ${columns.map(c => `<td class="col-${c}">${c === 'gd' && row.gd > 0 ? `+${row.gd}` : row[c]}</td>`).join('')}
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${played ? '' : '<p class="data-note">No results yet — the table fills in once the first scores are posted.</p>'}
        ${compact ? '' : dataNote(data)}`;
    } catch (err) {
      console.error(err);
      el.innerHTML = errorState('We couldn’t load the standings right now.');
    }
  }

  function fixtureRow(game, now, next) {
    const over = isOver(game, now);
    const classes = ['fixture', game.isBye && 'is-bye', over && 'is-past', game === next && 'is-next'].filter(Boolean).join(' ');
    const date = `
      <div class="fixture-date">
        <span class="fixture-day">${esc(fmt.weekday.format(game.start))}</span>
        <span class="fixture-dm">${esc(fmt.dayMonth.format(game.start))}</span>
        ${game.isBye ? '' : `<span class="fixture-time">${esc(fmt.time.format(game.start))}</span>`}
      </div>`;

    if (game.isBye) {
      return `
        <li class="${classes}">
          ${date}
          <div class="fixture-body">
            <span class="fixture-round">Round ${game.round} · Bye</span>
            <span class="fixture-teams">Bye week</span>
            <span class="fixture-field">${esc(byeMessage(game))}</span>
          </div>
          <div class="fixture-side"><span class="pill">Rest</span></div>
        </li>`;
    }

    const name = team => (team === TEAM ? `<b>${esc(team)}</b>` : esc(team));
    let side;
    if (game.result) {
      side = `<span class="result result--${game.result}"><span class="result-badge" aria-label="${{ W: 'Win', D: 'Draw', L: 'Loss' }[game.result]}">${game.result}</span>${game.homeScore}–${game.awayScore}</span>`;
    } else if (over) {
      side = '<span class="pill">Result pending</span>';
    } else if (game === next) {
      side = `<span class="pill pill--yellow">${now >= game.start ? 'Live now' : 'Next up'}</span>`;
    } else {
      side = `<span class="pill">${game.isHome ? 'Home' : 'Away'}</span>`;
    }

    return `
      <li class="${classes}">
        ${date}
        <div class="fixture-body">
          <span class="fixture-round">Round ${game.round} · ${game.isHome ? 'Home' : 'Away'}</span>
          <span class="fixture-teams">${name(game.home)}<em>vs</em>${name(game.away)}</span>
          <span class="fixture-field">${ICONS.pin}${esc(game.field)}</span>
        </div>
        <div class="fixture-side">${side}</div>
      </li>`;
  }

  function seasonSummary(games) {
    const matches = games.filter(g => !g.isBye);
    const played = matches.filter(g => g.result);
    const count = r => played.filter(g => g.result === r).length;
    return [
      [matches.length, 'Matches'],
      [matches.filter(g => g.isHome).length, 'At home'],
      [games.length - matches.length, 'Bye weeks'],
      [played.length ? `${count('W')}-${count('D')}-${count('L')}` : '—', 'W-D-L'],
    ].map(([value, label]) => `<div class="stat"><strong>${esc(value)}</strong><span>${label}</span></div>`).join('');
  }

  async function renderSchedule(el) {
    const list = el.querySelector('[data-fixtures]');
    const buttons = $$('[data-filter]', el);
    try {
      const schedule = await loadJson('data/schedule.json');
      const games = prepareGames(schedule);
      const now = Date.now();
      const next = findNext(games, now);
      const filters = {
        all: () => true,
        upcoming: game => !isOver(game, now),
        results: game => !game.isBye && isOver(game, now),
      };
      const empty = {
        all: 'No fixtures published yet.',
        upcoming: 'No more fixtures this season.',
        results: 'No results yet — the season is just getting started.',
      };
      const draw = filter => {
        const shown = games.filter(filters[filter]);
        list.innerHTML = shown.length
          ? shown.map(game => fixtureRow(game, now, next)).join('')
          : `<li class="empty-state">${empty[filter]}</li>`;
        buttons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filter === filter)));
      };
      buttons.forEach(b => b.addEventListener('click', () => draw(b.dataset.filter)));
      draw('all');

      const summary = document.querySelector('[data-season-summary]');
      if (summary) summary.innerHTML = seasonSummary(games);
      const note = el.querySelector('[data-schedule-note]');
      if (note) note.innerHTML = dataNote(schedule);
    } catch (err) {
      console.error(err);
      list.innerHTML = `<li>${errorState('We couldn’t load the schedule right now.')}</li>`;
    }
  }

  // ------------------------------------------------------------ squad

  function portrait(person, className, fallback, alt) {
    return `
      <div class="${className}${person.photo ? ' has-photo' : ''}">
        ${person.photo ? `<img src="${esc(person.photo)}" alt="${esc(alt)}" loading="lazy">` : ''}
        <span class="portrait-fallback" aria-hidden="true">${esc(fallback)}</span>
      </div>`;
  }

  function playerCard(player, group) {
    return `
      <article class="player${player.photo ? ' has-photo' : ''}">
        <div class="player-photo${player.photo ? ' has-photo' : ''}">
          ${player.photo ? `<img src="${esc(player.photo)}" alt="${esc(player.name)}, number ${player.number}" loading="lazy">` : ''}
          <span class="portrait-fallback" aria-hidden="true">${player.number}</span>
          ${player.captain ? '<span class="player-captain" title="Captain">C</span>' : ''}
        </div>
        <div class="player-info">
          <div>
            <h3 class="player-name">${esc(player.name)}</h3>
            ${player.aka ? `<span class="player-aka">${esc(player.aka)}</span>` : ''}
            <span class="player-role">${player.captain ? 'Captain · ' : ''}${esc(group.role)}</span>
          </div>
          <span class="player-number" aria-hidden="true">${player.number}</span>
        </div>
      </article>`;
  }

  async function renderSquad(el) {
    try {
      const team = await loadJson('data/team.json');
      const { coach } = team;
      el.innerHTML = `
        <article class="card coach-card">
          ${portrait(coach, 'coach-photo', coach.name.charAt(0), `Coach ${coach.name}`)}
          <div>
            <p class="eyebrow">${esc(coach.role)}</p>
            <h2 class="coach-name">${esc(coach.name)}</h2>
            ${coach.bio ? `<p class="coach-text">${esc(coach.bio)}</p>` : ''}
          </div>
        </article>
        ${team.groups.map(group => `
          <section class="squad-group" aria-labelledby="group-${esc(group.id)}">
            <header class="squad-group-head">
              <h2 id="group-${esc(group.id)}">${esc(group.title)}</h2>
              <span class="squad-count">${group.players.length} ${group.players.length === 1 ? 'player' : 'players'}</span>
            </header>
            <div class="players">${group.players.map(p => playerCard(p, group)).join('')}</div>
          </section>`).join('')}`;

      // A missing photo file falls back to the number badge.
      $$('.has-photo img', el).forEach(img => img.addEventListener('error', () => {
        img.closest('.player')?.classList.remove('has-photo');
        img.parentElement.classList.remove('has-photo');
        img.remove();
      }, { once: true }));
    } catch (err) {
      console.error(err);
      el.innerHTML = '<div class="empty-state">We couldn’t load the squad right now.</div>';
    }
  }

  // ---------------------------------------------------------- gallery

  async function renderGallery(el) {
    const dialog = document.querySelector('[data-lightbox]');
    try {
      const data = await loadJson('data/gallery.json');
      const photos = [];
      el.innerHTML = data.albums.map(album => `
        <section class="album" aria-labelledby="album-${esc(album.id)}">
          <div class="section-head">
            <div>
              <h2 class="album-title" id="album-${esc(album.id)}">${esc(album.title)}</h2>
              ${album.description ? `<p class="section-lead">${esc(album.description)}</p>` : ''}
            </div>
            <span class="pill">${album.photos.length} ${album.photos.length === 1 ? 'photo' : 'photos'}</span>
          </div>
          <div class="gallery-grid">
            ${album.photos.map((photo, i) => {
              const index = photos.push(photo) - 1;
              return `
                <figure class="gallery-item${i === 0 ? ' gallery-item--feature' : ''}">
                  <button type="button" data-photo="${index}" aria-label="Open photo: ${esc(photo.alt)}">
                    <img src="${esc(photo.thumb || photo.src)}" alt="${esc(photo.alt)}" loading="lazy">
                  </button>
                  ${photo.caption ? `<figcaption>${esc(photo.caption)}</figcaption>` : ''}
                </figure>`;
            }).join('')}
            <div class="gallery-slot">
              <strong>More moments coming</strong>
              <span>Got a great shot from matchday? Send it to <a href="mailto:tech@brazucafc.ca">tech@brazucafc.ca</a>.</span>
            </div>
          </div>
        </section>`).join('');

      $$('.gallery-item img', el).forEach(img => img.addEventListener('error', () => {
        img.closest('.gallery-item').classList.add('is-missing');
      }, { once: true }));

      if (!dialog || photos.length === 0) return;
      const image = dialog.querySelector('img');
      const caption = dialog.querySelector('[data-lightbox-caption]');
      const counter = dialog.querySelector('[data-lightbox-count]');
      const navButtons = $$('[data-lightbox-prev], [data-lightbox-next]', dialog);
      let current = 0;

      const show = index => {
        current = (index + photos.length) % photos.length;
        const photo = photos[current];
        image.src = photo.src;
        image.alt = photo.alt;
        caption.textContent = photo.caption || photo.alt;
        counter.textContent = `${current + 1} / ${photos.length}`;
        navButtons.forEach(b => { b.hidden = photos.length < 2; });
      };

      el.addEventListener('click', event => {
        const trigger = event.target.closest('[data-photo]');
        if (!trigger) return;
        show(Number(trigger.dataset.photo));
        dialog.showModal();
      });
      dialog.querySelector('[data-lightbox-prev]').addEventListener('click', () => show(current - 1));
      dialog.querySelector('[data-lightbox-next]').addEventListener('click', () => show(current + 1));
      dialog.querySelector('[data-lightbox-close]').addEventListener('click', () => dialog.close());
      dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
      dialog.addEventListener('keydown', event => {
        if (event.key === 'ArrowLeft') show(current - 1);
        if (event.key === 'ArrowRight') show(current + 1);
      });
    } catch (err) {
      console.error(err);
      el.innerHTML = '<div class="empty-state">We couldn’t load the gallery right now.</div>';
    }
  }

  // ------------------------------------------------------------- page

  function initNav() {
    const toggle = document.querySelector('.nav-toggle');
    const nav = document.getElementById('site-nav');
    if (!toggle || !nav) return;
    const setOpen = open => {
      toggle.setAttribute('aria-expanded', String(open));
      nav.classList.toggle('is-open', open);
    };
    toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && nav.classList.contains('is-open')) {
        setOpen(false);
        toggle.focus();
      }
    });
  }

  // Static images that may not exist yet (e.g. the squad photo) show a placeholder instead.
  function initImageFallbacks() {
    $$('img[data-fallback]').forEach(img => {
      const mark = () => img.parentElement.classList.add('is-missing');
      if (img.complete && img.naturalWidth === 0) mark();
      else img.addEventListener('error', mark, { once: true });
    });
  }

  initNav();
  initImageFallbacks();
  $$('[data-year]').forEach(node => { node.textContent = new Date().getFullYear(); });
  $$('[data-next-match]').forEach(renderNextMatch);
  $$('[data-standings]').forEach(renderStandings);
  $$('[data-schedule]').forEach(renderSchedule);
  $$('[data-squad]').forEach(renderSquad);
  $$('[data-gallery]').forEach(renderGallery);
})();
