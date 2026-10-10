/*
 * Brazuca FC — e-sports page.
 * Renders data/esports.json (EA Sports FC Pro Clubs, refreshed hourly by
 * .github/workflows/update-esports.yml).
 */
(() => {
  'use strict';

  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const COLUMNS = [
    ['gamesPlayed', 'GP', 'Games played'],
    ['goals', 'G', 'Goals'],
    ['assists', 'A', 'Assists'],
    ['rating', 'RAT', 'Average match rating'],
    ['motm', 'MOTM', 'Player of the match awards'],
    ['winRate', 'WIN%', 'Win rate'],
    ['passSuccess', 'PASS%', 'Pass success rate'],
    ['tackleSuccess', 'TKL%', 'Tackle success rate'],
    ['shotSuccess', 'SHOT%', 'Shot success rate'],
  ];
  const PERCENT = new Set(['winRate', 'passSuccess', 'tackleSuccess', 'shotSuccess']);

  const fmtDate = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Vancouver', weekday: 'short', month: 'short', day: 'numeric' });
  const fmtTime = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Vancouver', hour: 'numeric', minute: '2-digit' });
  const fmtStamp = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Vancouver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  let request = null;
  const loadData = () => (request ??= fetch('data/esports.json', { cache: 'no-cache' }).then(res => {
    if (!res.ok) throw new Error(`esports.json: HTTP ${res.status}`);
    return res.json();
  }));
  const failed = el => { el.innerHTML = '<div class="empty-state">We couldn’t load the Pro Clubs data right now.</div>'; };

  const titleCase = text => (text ? text.charAt(0).toUpperCase() + text.slice(1) : '—');

  async function renderSummary(el) {
    try {
      const { record } = await loadData();
      const cards = [
        [record.skillRating, 'Skill rating'],
        [`${record.wins}-${record.ties}-${record.losses}`, 'Win / draw / loss'],
        [`${record.goals}-${record.goalsAgainst}`, 'Goals for / against'],
        [`${record.winRate}%`, `Win rate · ${record.gamesPlayed} games`],
      ];
      el.innerHTML = cards.map(([value, label]) =>
        `<div class="stat"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`).join('');
    } catch (err) { console.error(err); failed(el); }
  }

  async function renderClub(el) {
    try {
      const { club, record, members, positionCount } = await loadData();
      const rows = [
        ['Club', club.name],
        ['Platform', club.platformLabel],
        ['Stadium', club.stadium || '—'],
        ['Members', `${members.length} (${Object.entries(positionCount).filter(([, n]) => n).map(([pos, n]) => `${n} ${pos}`).join(', ') || '—'})`],
        ['Goal difference', record.goalDifference > 0 ? `+${record.goalDifference}` : record.goalDifference],
        ['Promotions', `${record.promotions} up · ${record.relegations} down`],
      ];
      el.innerHTML = `
        <h2 class="card-title">${esc(club.name)}</h2>
        <dl class="club-facts">
          ${rows.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}
        </dl>`;
    } catch (err) { console.error(err); failed(el); }
  }

  async function renderForm(el) {
    try {
      const { form, matches, record } = await loadData();
      const labels = { W: 'Win', D: 'Draw', L: 'Loss' };
      el.innerHTML = `
        <div class="form-guide">
          ${form.map(r => `<span class="form-chip form-chip--${r}" title="${labels[r]}">${r}</span>`).join('')}
        </div>
        <p class="form-note">${form.length
          ? `Last ${form.length} league matches, most recent first. ${esc(matches[0].result === 'W' ? 'Latest: won' : matches[0].result === 'D' ? 'Latest: drew' : 'Latest: lost')} ${matches[0].goalsFor}-${matches[0].goalsAgainst} against ${esc(matches[0].opponent)}.`
          : 'No matches recorded yet.'}</p>
        ${record.winStreak ? `<p class="form-note">Current win streak: ${record.winStreak}.</p>` : ''}`;
    } catch (err) { console.error(err); failed(el); }
  }

  async function renderMembers(el) {
    try {
      const { members } = await loadData();
      el.innerHTML = `
        <div class="table-wrap">
          <table class="standings stats-table">
            <caption class="visually-hidden">eBrazuca FC Pro Clubs member statistics</caption>
            <thead>
              <tr>
                <th scope="col" class="col-team">Player</th>
                <th scope="col">Pos</th>
                ${COLUMNS.map(([, short, long]) => `<th scope="col"><abbr title="${esc(long)}">${esc(short)}</abbr></th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${members.map(m => `
                <tr>
                  <td class="col-team"><div class="player-chip"><span class="player-chip-initial" aria-hidden="true">${esc(m.name.charAt(0).toUpperCase())}</span><span class="player-chip-name">${esc(m.name)}</span></div></td>
                  <td>${esc(titleCase(m.position))}</td>
                  ${COLUMNS.map(([field]) => {
                    const value = m[field];
                    const shown = PERCENT.has(field) ? `${value}%` : value;
                    return `<td${value ? '' : ' class="is-zero"'}>${esc(shown)}</td>`;
                  }).join('')}
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
    } catch (err) { console.error(err); failed(el); }
  }

  async function renderMatches(el) {
    try {
      const { matches } = await loadData();
      if (!matches.length) {
        el.innerHTML = '<li class="empty-state">No matches recorded yet.</li>';
        return;
      }
      const names = { W: 'Win', D: 'Draw', L: 'Loss' };
      el.innerHTML = matches.map(m => {
        const played = Date.parse(m.playedAt);
        const scorers = m.scorers.map(s => `${esc(s.name)}${s.goals > 1 ? ` ×${s.goals}` : ''}`).join(', ');
        return `
          <li class="fixture is-past">
            <div class="fixture-date">
              <span class="fixture-day">${esc(fmtDate.format(played).split(',')[0])}</span>
              <span class="fixture-dm">${esc(fmtDate.format(played).split(', ')[1])}</span>
              <span class="fixture-time">${esc(fmtTime.format(played))}</span>
            </div>
            <div class="fixture-body">
              <span class="fixture-round">League match</span>
              <span class="fixture-teams"><b>eBrazuca FC</b><em>vs</em>${esc(m.opponent)}</span>
              <span class="fixture-field">${scorers ? `⚽ ${scorers}` : 'No goals'}${m.motm ? ` · MOTM ${esc(m.motm)}` : ''}</span>
            </div>
            <div class="fixture-side">
              <span class="result result--${m.result}"><span class="result-badge" aria-label="${names[m.result]}">${m.result}</span>${m.goalsFor}–${m.goalsAgainst}</span>
            </div>
          </li>`;
      }).join('');
    } catch (err) { console.error(err); el.innerHTML = '<li class="empty-state">We couldn’t load the results right now.</li>'; }
  }

  async function renderNote(el) {
    try {
      const { updatedAt, source, club } = await loadData();
      el.innerHTML = `<p class="data-note">Live from <a href="${esc(source.url)}" target="_blank" rel="noopener">${esc(source.name)}</a> · club ${esc(club.id)} · updated ${esc(fmtStamp.format(Date.parse(updatedAt)))}, refreshed hourly.</p>`;
    } catch (err) { console.error(err); }
  }

  $$('[data-esports-summary]').forEach(renderSummary);
  $$('[data-esports-club]').forEach(renderClub);
  $$('[data-esports-form]').forEach(renderForm);
  $$('[data-esports-members]').forEach(renderMembers);
  $$('[data-esports-matches]').forEach(renderMatches);
  $$('[data-esports-note]').forEach(renderNote);
})();
