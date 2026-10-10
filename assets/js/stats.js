/*
 * Brazuca FC — stats page.
 * Renders data/stats.json (built by scripts/build-stats.py) as two tables:
 * the current season and every player's club career. Kept out of site.js so
 * it only loads on this page.
 */
(() => {
  'use strict';

  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  let request = null;
  const loadStats = () => (request ??= fetch('data/stats.json', { cache: 'no-cache' }).then(res => {
    if (!res.ok) throw new Error(`stats.json: HTTP ${res.status}`);
    return res.json();
  }));

  const failed = el => { el.innerHTML = '<div class="empty-state">We couldn’t load the stats right now.</div>'; };

  function playerCell(player) {
    const photo = player.photo
      ? `<img src="${esc(player.photo)}" alt="" loading="lazy" width="36" height="36">`
      : `<span class="player-chip-initial" aria-hidden="true">${esc(player.nickname.charAt(0))}</span>`;
    const number = player.number ? `<span class="player-chip-number">#${player.number}</span>` : '';
    const tag = player.current ? '' : '<span class="tag">Former</span>';
    return `<div class="player-chip">${photo}<span class="player-chip-name">${esc(player.name)}${number}</span>${tag}</div>`;
  }

  // A player with no detailed record shows dashes rather than misleading zeroes.
  function cell(player, field) {
    if (field === 'seasons') return `<td>${player.seasons}</td>`;
    const value = player.stats[field];
    if (!player.hasDetail && field !== 'g') return '<td class="is-empty">–</td>';
    if (field === 'plusMinus') {
      const cls = value > 0 ? 'is-positive' : value < 0 ? 'is-negative' : 'is-zero';
      return `<td class="${cls}">${value > 0 ? `+${value}` : value}</td>`;
    }
    if (field === 'g' && value) return `<td class="col-pts">${value}</td>`;
    return `<td${value ? '' : ' class="is-zero"'}>${value}</td>`;
  }

  function table(players, columns, labels, caption, totals) {
    const head = columns.map(field => {
      const [short, long] = field === 'seasons' ? ['S', 'Seasons played'] : labels[field];
      return `<th scope="col"><abbr title="${esc(long)}">${esc(short)}</abbr></th>`;
    }).join('');
    const body = players.map(p => `
      <tr${p.current ? ' class="is-us"' : ''}>
        <td class="col-team">${playerCell(p)}</td>
        ${columns.map(field => cell(p, field)).join('')}
      </tr>`).join('');
    const foot = totals ? `
      <tfoot>
        <tr>
          <td class="col-team">${totals.players} players</td>
          ${columns.map(field => (
            // Seasons, minutes per game and plus-minus don't add up into a team number.
            ['seasons', 'mpg', 'plusMinus'].includes(field) ? '<td>–</td>' : `<td>${totals[field]}</td>`
          )).join('')}
        </tr>
      </tfoot>` : '';
    return `
      <div class="table-wrap">
        <table class="standings stats-table">
          <caption class="visually-hidden">${esc(caption)}</caption>
          <thead><tr><th scope="col" class="col-team">Player</th>${head}</tr></thead>
          <tbody>${body}</tbody>
          ${foot}
        </table>
      </div>`;
  }

  async function renderSummary(el) {
    try {
      const data = await loadStats();
      const season = data.currentSeason;
      const career = data.allTime;
      const top = [...career.players].sort((a, b) => b.stats.g - a.stats.g)[0];
      const cards = [
        [season.totals.g, `Goals · ${season.label}`],
        [season.matches.length, 'Matches this season'],
        [career.totals.g, 'Goals all time'],
        [`${top.stats.g}`, `Top scorer · ${top.nickname}`],
      ];
      el.innerHTML = cards.map(([value, label]) =>
        `<div class="stat"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`).join('');
    } catch (err) { console.error(err); failed(el); }
  }

  async function renderSeason(el) {
    try {
      const data = await loadStats();
      const season = data.currentSeason;
      el.innerHTML = table(season.players, season.columns, data.labels,
        `Player statistics for ${season.label}`, season.totals);

      const eyebrow = document.querySelector('[data-stats-season-eyebrow]');
      if (eyebrow) eyebrow.textContent = `${season.label} · ${season.competition}`;
      const lead = document.querySelector('[data-stats-season-lead]');
      if (lead && season.matches.length) {
        const last = season.matches[season.matches.length - 1];
        lead.textContent = `${season.matches.length} matches played so far, most recently against ${last.opponent}.`;
      }
    } catch (err) { console.error(err); failed(el); }
  }

  async function renderAllTime(el) {
    try {
      const data = await loadStats();
      const career = data.allTime;
      const buttons = $$('[data-stats-filter]');
      const matches = { all: () => true, squad: p => p.current, former: p => !p.current };
      const draw = filter => {
        const rows = career.players.filter(matches[filter]);
        el.innerHTML = table(rows, career.columns, data.labels, 'Club career statistics', null)
          + `<p class="data-note">${rows.length} players · ${career.seasons.length} seasons: ${esc(career.seasons.join(', '))}.</p>`;
        buttons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.statsFilter === filter)));
      };
      buttons.forEach(b => b.addEventListener('click', () => draw(b.dataset.statsFilter)));
      draw('all');
    } catch (err) { console.error(err); failed(el); }
  }

  async function renderLegend(el) {
    try {
      const data = await loadStats();
      el.innerHTML = data.legend.map(([short, long]) =>
        `<div><dt>${esc(short)}</dt><dd>${esc(long)}</dd></div>`).join('');
    } catch (err) { console.error(err); failed(el); }
  }

  $$('[data-stats-summary]').forEach(renderSummary);
  $$('[data-stats-season]').forEach(renderSeason);
  $$('[data-stats-alltime]').forEach(renderAllTime);
  $$('[data-stats-legend]').forEach(renderLegend);
})();
