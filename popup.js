/* =============================================
   CF GetRating — Popup Logic
   Strategy:
   1. Check chrome.storage.local cache (instant)
   2. Ask content script for cached data (instant)
   3. If both miss, ask background to relay to
      content script (triggers rate-limited fetch)
   ============================================= */

const OVERALL_TIMEOUT_MS = 18000;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

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

  // Overall timeout safety net
  const overallTimer = setTimeout(() => {
    if (!result.classList.contains('hidden') || !errorSection.classList.contains('hidden')) return;
    showError('Request timed out. Codeforces may be slow — try again in a few seconds.');
  }, OVERALL_TIMEOUT_MS);

  try {
    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.url) {
      clearTimeout(overallTimer);
      showError('Cannot access current tab.');
      return;
    }

    const parsed = parseCFUrl(tab.url);

    if (!parsed) {
      clearTimeout(overallTimer);
      showError('Not on a Codeforces problem page.');
      return;
    }

    let problem = null;

    // ── Step 1: Check persistent cache ──
    problem = await getFromStorage(parsed.contestId, parsed.index);

    // ── Step 2: Ask content script ──
    if (!problem) {
      problem = await askContentScript(tab.id);
      if (problem) {
        saveToStorage(parsed.contestId, parsed.index, problem);
      }
    }

    // ── Step 3: Check background cache ──
    if (!problem) {
      problem = await checkBackgroundCache(parsed.contestId, parsed.index);
    }

    clearTimeout(overallTimer);

    if (!problem) {
      showError('Could not fetch problem data. Codeforces API may be rate-limiting — wait a few seconds and try again.');
      return;
    }

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
    clearTimeout(overallTimer);
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

/* ── Ask content script for data ─────────── */
function askContentScript(tabId) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(
        tabId,
        { type: 'GET_PROBLEM_DATA' },
        (response) => {
          if (chrome.runtime.lastError) {
            console.log('[CF GetRating] Content script unavailable:', chrome.runtime.lastError.message);
            resolve(null);
            return;
          }
          if (response && response.success && response.data) {
            resolve(response.data);
          } else {
            resolve(null);
          }
        }
      );
    } catch (_) {
      resolve(null);
    }
  });
}

/* ── Check background cache ──────────────── */
function checkBackgroundCache(contestId, index) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { type: 'CHECK_CACHE', contestId, index },
        (response) => {
          if (chrome.runtime.lastError || !response || !response.hit) {
            resolve(null);
            return;
          }
          resolve(response.data);
        }
      );
    } catch (_) {
      resolve(null);
    }
  });
}

/* ── Persistent cache (chrome.storage.local) ── */
function getFromStorage(contestId, index) {
  return new Promise((resolve) => {
    const key = `cfgr_${contestId}_${index}`;
    chrome.storage.local.get(key, (result) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      const entry = result[key];
      if (!entry || !entry.data) {
        resolve(null);
        return;
      }
      // Check TTL
      if (Date.now() - entry.ts > CACHE_TTL_MS) {
        chrome.storage.local.remove(key);
        resolve(null);
        return;
      }
      resolve(entry.data);
    });
  });
}

function saveToStorage(contestId, index, data) {
  const key = `cfgr_${contestId}_${index}`;
  chrome.storage.local.set({ [key]: { data, ts: Date.now() } });
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
