/* =============================================
   CF GetRating — Popup Logic
   Uses problemset.problems API (public, no auth)
   ============================================= */

document.addEventListener('DOMContentLoaded', async () => {
  const loading = document.getElementById('loading');
  const errorSection = document.getElementById('error');
  const errorMsg = document.getElementById('error-msg');
  const result = document.getElementById('result');

  function showError(msg) {
    loading.classList.add('hidden');
    errorSection.classList.remove('hidden');
    errorMsg.textContent = msg;
  }

  function showResult() {
    loading.classList.add('hidden');
    result.classList.remove('hidden');
  }

  try {
    // Get current tab URL
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.url) {
      showError('Cannot access current tab.');
      return;
    }

    const parsed = parseCFUrl(tab.url);

    if (!parsed) {
      showError('Not on a Codeforces problem page.');
      return;
    }

    const problem = await fetchProblemData(parsed.contestId, parsed.index);

    showResult();

    // ── Display problem name ──
    document.getElementById('problem-name').textContent =
      `${parsed.contestId}${parsed.index}. ${problem.name}`;

    // ── Display rating ──
    const ratingEl = document.getElementById('rating-value');
    const ratingCard = document.getElementById('rating-card');
    const rating = problem.rating;

    if (rating) {
      const color = getRatingColor(rating);
      ratingEl.textContent = `*${rating}`;
      ratingEl.style.color = color;
      ratingCard.style.borderLeftColor = color;
    } else {
      ratingEl.textContent = 'Unrated';
      ratingEl.style.color = '#999';
    }

    // ── Prepare tags ──
    const tagsList = document.getElementById('tags-list');
    const tags = problem.tags || [];

    if (tags.length === 0) {
      document.getElementById('toggle-tags').style.display = 'none';
    }

    // Add rating as the first tag pill
    if (rating) {
      const rTag = document.createElement('span');
      rTag.className = 'tag';
      const color = getRatingColor(rating);
      rTag.style.color = color;
      rTag.style.borderColor = color + '60';
      rTag.style.background = color + '12';
      rTag.style.fontWeight = '700';
      rTag.textContent = `*${rating}`;
      tagsList.appendChild(rTag);
    }

    tags.forEach((tag, i) => {
      const tagEl = document.createElement('span');
      tagEl.className = 'tag';
      tagEl.style.animationDelay = `${i * 0.04}s`;
      tagEl.textContent = tag;
      tagsList.appendChild(tagEl);
    });

    // ── Toggle tags button ──
    let tagsVisible = false;
    const toggleBtn = document.getElementById('toggle-tags');
    const tagsContainer = document.getElementById('tags-container');

    toggleBtn.addEventListener('click', () => {
      tagsVisible = !tagsVisible;

      if (tagsVisible) {
        tagsContainer.classList.remove('collapsed');
        toggleBtn.innerHTML = '<span class="btn-icon">🏷️</span> Hide Tags';
        toggleBtn.classList.add('active');
      } else {
        tagsContainer.classList.add('collapsed');
        toggleBtn.innerHTML = '<span class="btn-icon">🏷️</span> Show Tags';
        toggleBtn.classList.remove('active');
      }
    });

    // ── Contest standings button ──
    document.getElementById('standings').addEventListener('click', () => {
      chrome.tabs.create({
        url: `https://codeforces.com/contest/${parsed.contestId}/standings`,
      });
    });
  } catch (err) {
    showError(err.message || 'An unexpected error occurred.');
  }
});

/* ── URL Parser ───────────────────────────── */
function parseCFUrl(url) {
  const patterns = [
    /codeforces\.com\/problemset\/problem\/(\d+)\/([A-Za-z]\d*)/,
    /codeforces\.com\/contest\/(\d+)\/problem\/([A-Za-z]\d*)/,
    /codeforces\.com\/gym\/(\d+)\/problem\/([A-Za-z]\d*)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return {
        contestId: parseInt(match[1]),
        index: match[2].toUpperCase(),
      };
    }
  }
  return null;
}

/* ── API Fetcher (uses problemset.problems) ── */
async function fetchProblemData(contestId, index) {
  // Try contest.standings first (faster, returns only contest problems)
  try {
    const standingsRes = await fetch(
      `https://codeforces.com/api/contest.standings?contestId=${contestId}&from=1&count=1&showUnofficial=false`
    );
    const standingsData = await standingsRes.json();

    if (standingsData.status === 'OK') {
      const problem = standingsData.result.problems.find(
        (p) => p.index.toUpperCase() === index.toUpperCase()
      );
      if (problem) return problem;
    }
  } catch (_) {
    // Fall through to problemset.problems
  }

  // Fallback: use problemset.problems API (public, no auth required)
  const response = await fetch(
    'https://codeforces.com/api/problemset.problems'
  );

  if (!response.ok) {
    throw new Error('Codeforces API Error.');
  }

  const data = await response.json();

  if (data.status !== 'OK') {
    throw new Error(data.comment || 'Codeforces API Error.');
  }

  const problem = data.result.problems.find(
    (p) =>
      p.contestId === contestId &&
      p.index.toUpperCase() === index.toUpperCase()
  );

  if (!problem) {
    throw new Error('Problem not found.');
  }

  return problem;
}

/* ── Rating Color (matches CF rating tiers) ─ */
function getRatingColor(rating) {
  if (!rating) return '#808080';
  if (rating < 1200) return '#808080'; // Newbie
  if (rating < 1400) return '#008000'; // Pupil
  if (rating < 1600) return '#03a89e'; // Specialist
  if (rating < 1900) return '#0000ff'; // Expert
  if (rating < 2100) return '#aa00aa'; // Candidate Master
  if (rating < 2400) return '#ff8c00'; // Master
  return '#ff0000';                     // Grandmaster+
}
