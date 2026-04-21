/* =============================================
   CF GetRating — Content Script
   - Replaces the native CF tags section in the
     right sidebar with a custom widget
   - Rating is ALWAYS visible in the sidebar
   - UI matches CF's native styling
   ============================================= */

(function () {
  'use strict';

  const url = window.location.href;
  const patterns = [
    /codeforces\.com\/problemset\/problem\/(\d+)\/([A-Za-z]\d*)/,
    /codeforces\.com\/contest\/(\d+)\/problem\/([A-Za-z]\d*)/,
    /codeforces\.com\/gym\/(\d+)\/problem\/([A-Za-z]\d*)/,
  ];

  let contestId, index;
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      contestId = parseInt(match[1]);
      index = match[2].toUpperCase();
      break;
    }
  }

  if (!contestId || !index) return;

  fetchProblemData(contestId, index)
    .then((problem) => {
      if (!problem) return;
      replaceTagsSection(problem);
    })
    .catch((err) => console.error('[CF GetRating]', err));

  /* ── Fetch with fallback ────────────────── */
  async function fetchProblemData(cId, idx) {
    try {
      const res = await fetch(
        `https://codeforces.com/api/contest.standings?contestId=${cId}&from=1&count=1&showUnofficial=false`
      );
      const data = await res.json();
      if (data.status === 'OK') {
        const p = data.result.problems.find(
          (pr) => pr.index.toUpperCase() === idx.toUpperCase()
        );
        if (p) return p;
      }
    } catch (_) {}

    try {
      const res = await fetch(
        'https://codeforces.com/api/problemset.problems'
      );
      const data = await res.json();
      if (data.status === 'OK') {
        return data.result.problems.find(
          (p) =>
            p.contestId === cId &&
            p.index.toUpperCase() === idx.toUpperCase()
        );
      }
    } catch (_) {}

    return null;
  }

  /* ── Rating color ───────────────────────── */
  function getRatingColor(rating) {
    if (!rating) return '#808080';
    if (rating < 1200) return '#808080';
    if (rating < 1400) return '#008000';
    if (rating < 1600) return '#03a89e';
    if (rating < 1900) return '#0000ff';
    if (rating < 2100) return '#aa00aa';
    if (rating < 2400) return '#ff8c00';
    return '#ff0000';
  }

  /* ── Replace native CF tags section ─────── */
  function replaceTagsSection(problem) {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    // Find the native tags section — look for the roundbox
    // that contains "Tags" in its caption
    let nativeTagsBox = null;
    const sideboxes = sidebar.querySelectorAll('.roundbox.sidebox');
    for (const box of sideboxes) {
      const caption = box.querySelector('.caption.titled');
      if (caption && caption.textContent.toLowerCase().includes('tag')) {
        nativeTagsBox = box;
        break;
      }
    }

    // Also try finding by the tag-box class (CF's tag container)
    if (!nativeTagsBox) {
      const tagBox = sidebar.querySelector('.tag-box');
      if (tagBox) {
        nativeTagsBox = tagBox.closest('.roundbox.sidebox') || tagBox.closest('.roundbox');
      }
    }

    // Build the replacement widget using CF's native HTML structure
    const widget = document.createElement('div');
    widget.className = 'roundbox sidebox';
    widget.style.cssText = 'padding: 0.5em; border-radius: 0;';

    // Caption — matches CF's "→ Tags" style exactly
    const caption = document.createElement('div');
    caption.className = 'caption titled';
    caption.innerHTML = '→ Get Rating';
    widget.appendChild(caption);

    // Inner container
    const inner = document.createElement('div');
    inner.className = 'sidebox-inner';
    inner.style.padding = '0.5em 0';

    // Tag style — matches CF native
    const tagStyle = `
      display: inline-block;
      padding: 2px 8px;
      margin: 2px;
      border-radius: 5px;
      border: 1px solid #b0b0b0;
      background-color: #e8e8e8;
      font-size: 12px;
      cursor: default;
    `;

    // Rating — ALWAYS visible, inline with tags
    if (problem.rating) {
      const ratingTag = document.createElement('span');
      ratingTag.style.cssText = tagStyle;
      ratingTag.textContent = `*${problem.rating}`;
      inner.appendChild(ratingTag);
    }

    // Tags — hidden by default, shown inline next to rating
    const tagsSpan = document.createElement('span');
    tagsSpan.style.display = 'none';

    if (problem.tags && problem.tags.length > 0) {
      problem.tags.forEach((tag) => {
        const tagEl = document.createElement('span');
        tagEl.style.cssText = tagStyle;
        tagEl.textContent = tag;
        tagsSpan.appendChild(tagEl);
      });
    }

    inner.appendChild(tagsSpan);

    // Buttons container — both buttons side by side, centered
    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = 'margin-top: 0.5em; text-align: center;';

    const btnStyle = `
      display: inline-block;
      padding: 4px 16px;
      margin: 2px 4px;
      border: 1px solid #888;
      background: #f0f0f0;
      color: #333;
      font-size: 12px;
      text-decoration: none;
      cursor: pointer;
    `;

    // "Show All Tags" toggle
    if (problem.tags && problem.tags.length > 0) {
      const toggleLink = document.createElement('a');
      toggleLink.href = 'javascript:void(0)';
      toggleLink.style.cssText = btnStyle;
      toggleLink.textContent = 'Show All Tags';

      let visible = false;
      toggleLink.addEventListener('click', (e) => {
        e.preventDefault();
        visible = !visible;
        tagsSpan.style.display = visible ? 'block' : 'none';
        toggleLink.textContent = visible ? 'Hide Tags' : 'Show All Tags';
      });

      btnContainer.appendChild(toggleLink);
    }

    // "Contest Standings" button
    const standingsLink = document.createElement('a');
    standingsLink.href = `/contest/${contestId}/standings`;
    standingsLink.target = '_blank';
    standingsLink.style.cssText = btnStyle;
    standingsLink.textContent = 'Contest Standings';
    btnContainer.appendChild(standingsLink);

    inner.appendChild(btnContainer);

    widget.appendChild(inner);

    // Replace native tags box at its original position,
    // or append to end of sidebar (NOT top)
    if (nativeTagsBox) {
      nativeTagsBox.parentNode.replaceChild(widget, nativeTagsBox);
    } else {
      // Append at the END of sidebar, not the top
      sidebar.appendChild(widget);
    }
  }
})();
