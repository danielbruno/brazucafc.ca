/*
 * Brazuca FC — stats page.
 * Renders data/stats.json: club totals, all-time scorers by season and the
 * detailed Spring 2026 table. Kept separate from site.js so the page only
 * loads it where it is needed.
 */
(() => {
  'use strict';

  const SPRING_FIELDS = [
    ['mp', 'MP', 'Matches played'],
    ['gs', 'GS', 'Games started'],
    ['min', 'MIN', 'Minutes played'],
    ['mpg', 'MPG', 'Minutes per game'],
    ['g', 'G', 'Goals'],
    ['as', 'AS', 'Assists'],
    ['ga', 'GA', 'Goals against (goalkeepers)'],
    ['yc', 'YC', 'Yellow cards'],
    ['rc', 'RC', 'Red cards'],
    ['plusMinus', '+/-', 'Score difference while on the field'],
    ['mvp', 'MVP', 'Most valuable player awards'],
  ];

  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  let request = null;
  const loadStats = () => (request ??= fetch('data/stats.json', { cache: 'no-cache' }).then(res => {
    if (!res.ok) throw new Error(`stats.json: HTTP ${res.status}`);
    return res.json();
  }));

  function playerCell(player) {
    const photo = player.photo
      ? `<img src="${esc(player.photo)}" alt="" loading="lazy" width="36" height="36">`
      : `<span class="player-chip-initial" aria-hidden="true">${esc(player.name.charAt(0))}</span>`;
    const number = player.number ? `<span class="player-chip-number">#${player.number}</span>` : '';
    const tag = player.current ? '' : '<span class="tag">Former</span>';
    return `<div class="player-chip">${photo}<span class="player-chip-name">${esc(player.name)}${number}</span>${tag}</div>`;
  }

  async function renderSummary(el) {
    try {
      const data = await loadStats();
      const scorers = data.players.filter(p => p.goals > 0);
      const top = scorers[0];
      const cards = [
        [data.allTimeGoals, 'Goals all time'],
        [scorers.length, 'Players scored'],
        [`${top.goals}`, `Top scorer · ${top.name.split(' ')[0]}`],
        [data.seasons.filter(s => s.type === 'league').length, 'Seasons played'],
      ];
      el.innerHTML = cards.map(([value, label]) =>
        `<div class="stat"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`).join('');
    } catch (err) {
      console.error(err);
      el.innerHTML = '<div class="empty-state">We couldn’t load the stats right now.</div>';
    }
  }

  async function renderScorers(el) {
    try {
      const data = await loadStats();
      const buttons = $$('[data-stats-filter]');
      const matches = {
        all: () => true,
        squad: p => p.current,
        former: p => !p.current,
      };
      const draw = filter => {
        const rows = data.players.filter(matches[filter]);
        el.innerHTML = `
          <div class="table-wrap">
            <table class="standings stats-table">
              <caption class="visually-hidden">Goals by season for every Brazuca FC player</caption>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col" class="col-team">Player</th>
                  ${data.seasons.map(s => `<th scope="col"><abbr title="${esc(s.label)}">${esc(s.short)}</abbr></th>`).join('')}
                  <th scope="col"><abbr title="Goals in all competitions">Total</abbr></th>
                </tr>
              </thead>
              <tbody>
                ${rows.map((p, i) => `
                  <tr${p.current ? ' class="is-us"' : ''}>
                    <td><span class="pos">${i + 1}</span></td>
                    <td class="col-team">${playerCell(p)}</td>
                    ${data.seasons.map(s => {
                      const goals = p.goalsBySeason[s.id];
                      if (goals === null || goals === undefined) return '<td class="is-empty">–</td>';
                      return `<td${goals ? '' : ' class="is-zero"'}>${goals}</td>`;
                    }).join('')}
                    <td class="col-pts">${p.goals}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <p class="data-note">A dash means the player was not with the club that season. ${rows.length} players shown.</p>`;
        buttons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.statsFilter === filter)));
      };
      buttons.forEach(b => b.addEventListener('click', () => draw(b.dataset.statsFilter)));
      draw('all');
    } catch (err) {
      console.error(err);
      el.innerHTML = '<div class="empty-state">We couldn’t load the stats right now.</div>';
    }
  }

  async function renderSpring(el) {
    try {
      const data = await loadStats();
      const players = data.players
        .filter(p => p.spring)
        .sort((a, b) => b.spring.g - a.spring.g || b.spring.min - a.spring.min || a.name.localeCompare(b.name));
      const totals = data.springTotals;
      el.innerHTML = `
        <div class="table-wrap">
          <table class="standings stats-table">
            <caption class="visually-hidden">Detailed player statistics for the Spring 2026 season</caption>
            <thead>
              <tr>
                <th scope="col" class="col-team">Player</th>
                ${SPRING_FIELDS.map(([, short, long]) => `<th scope="col"><abbr title="${esc(long)}">${esc(short)}</abbr></th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${players.map(p => `
                <tr${p.current ? ' class="is-us"' : ''}>
                  <td class="col-team">${playerCell(p)}</td>
                  ${SPRING_FIELDS.map(([field]) => {
                    const value = p.spring[field];
                    const cls = field === 'plusMinus' && value !== 0 ? (value > 0 ? ' class="is-positive"' : ' class="is-negative"') : (value ? '' : ' class="is-zero"');
                    const shown = field === 'plusMinus' && value > 0 ? `+${value}` : value;
                    return `<td${cls}>${shown}</td>`;
                  }).join('')}
                </tr>`).join('')}
            </tbody>
            <tfoot>
              <tr>
                <td class="col-team">${totals.players} players</td>
                ${SPRING_FIELDS.map(([field]) => {
                  if (field === 'mpg') return '<td>–</td>';
                  const value = totals[field];
                  return `<td>${field === 'plusMinus' && value > 0 ? `+${value}` : value}</td>`;
                }).join('')}
              </tr>
            </tfoot>
          </table>
        </div>`;
    } catch (err) {
      console.error(err);
      el.innerHTML = '<div class="empty-state">We couldn’t load the stats right now.</div>';
    }
  }

  function renderLegend(el) {
    el.innerHTML = SPRING_FIELDS.map(([, short, long]) =>
      `<div><dt>${esc(short)}</dt><dd>${esc(long)}</dd></div>`).join('');
  }

  $$('[data-stats-summary]').forEach(renderSummary);
  $$('[data-stats-scorers]').forEach(renderScorers);
  $$('[data-stats-spring]').forEach(renderSpring);
  $$('[data-stats-legend]').forEach(renderLegend);
})();
