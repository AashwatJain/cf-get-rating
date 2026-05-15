/* =============================================
   CF GetRating — Content Script
   - Replaces the native CF tags section in the
     right sidebar with a custom widget
   - Rating is ALWAYS visible in the sidebar
   - UI matches CF's native styling
   - Requests a rate-limit slot from background
     before making any API call
   - Responds to popup messages with cached data
   ============================================= */

(function () {
  'use strict';

  const FETCH_TIMEOUT_MS = 10000;

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

  // Store fetched data so popup can request it without extra API calls
  let cachedProblemData = null;
  let fetchInProgress = false;
  let fetchPromise = null;

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_PROBLEM_DATA') {
      if (cachedProblemData) {
        sendResponse({ success: true, data: cachedProblemData });
      } else if (fetchInProgress && fetchPromise) {
        fetchPromise
          .then((problem) => {
            sendResponse({
              success: !!problem,
              data: problem || null,
              error: problem ? null : 'Problem not found',
            });
          })
          .catch((err) => {
            sendResponse({ success: false, error: err.message });
          });
      } else {
        // Trigger a new fetch
        fetchInProgress = true;
        fetchPromise = fetchProblemData(contestId, index);
        fetchPromise
          .then((problem) => {
            cachedProblemData = problem;
            fetchInProgress = false;
            sendResponse({
              success: !!problem,
              data: problem || null,
              error: problem ? null : 'Problem not found',
            });
          })
          .catch((err) => {
            fetchInProgress = false;
            sendResponse({ success: false, error: err.message });
          });
      }
      return true;
    }
  });

  // Start initial fetch
  fetchInProgress = true;
  fetchPromise = fetchProblemData(contestId, index);
  fetchPromise
    .then((problem) => {
      cachedProblemData = problem;
      fetchInProgress = false;
      if (problem) {
        replaceTagsSection(problem);
      }
    })
    .catch((err) => {
      fetchInProgress = false;
      console.error('[CF GetRating]', err);
    });

  /* ── Request a rate-limit slot from background ── */
  function requestSlot() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'REQUEST_SLOT' }, (response) => {
        if (chrome.runtime.lastError) {
          // Background not available — proceed anyway (best effort)
          resolve();
          return;
        }
        resolve();
      });
    });
  }

  /* ── Check background cache ─────────────────── */
  function checkCache(cId, idx) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'CHECK_CACHE', contestId: cId, index: idx },
        (response) => {
          if (chrome.runtime.lastError || !response || !response.hit) {
            resolve(null);
            return;
          }
          resolve(response.data);
        }
      );
    });
  }

  /* ── Save to background cache ───────────────── */
  function saveCache(cId, idx, data) {
    chrome.runtime.sendMessage({
      type: 'SAVE_CACHE',
      contestId: cId,
      index: idx,
      data,
    });
  }

  /* ── Fetch with timeout ────────────────────── */
  function fetchWithTimeout(fetchUrl, timeoutMs = FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    return fetch(fetchUrl, { signal: controller.signal })
      .then((res) => {
        clearTimeout(timer);
        return res;
      })
      .catch((err) => {
        clearTimeout(timer);
        throw err;
      });
  }

  /* ── Sleep helper ──────────────────────────── */
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /* ── Fetch with rate-limited slot ──────────── */
  async function fetchProblemData(cId, idx) {
    // Step 1: Check background cache first (no API call needed)
    const cached = await checkCache(cId, idx);
    if (cached) return cached;

    // Step 2: Request a slot (waits for rate limit gap)
    await requestSlot();

    // Step 3: Try contest.standings (full standings since extra params no longer supported for non-admins)
    try {
      const res = await fetchWithTimeout(
        `https://codeforces.com/api/contest.standings?contestId=${cId}`
      );
      const data = await res.json();
      if (data.status === 'OK') {
        const p = data.result.problems.find(
          (pr) => pr.index.toUpperCase() === idx.toUpperCase()
        );
        if (p) {
          saveCache(cId, idx, p);
          return p;
        }
      } else {
        console.warn('[CF GetRating] contest.standings:', data.comment || 'Unknown error');
      }
    } catch (err) {
      console.warn('[CF GetRating] contest.standings error:', err.message);
    }

    // Step 4: Request another slot for the fallback call
    await requestSlot();

    // Step 5: Fallback to problemset.problems
    try {
      const res = await fetchWithTimeout(
        'https://codeforces.com/api/problemset.problems',
        FETCH_TIMEOUT_MS + 5000
      );
      const data = await res.json();
      if (data.status === 'OK') {
        const found = data.result.problems.find(
          (p) =>
            p.contestId === cId &&
            p.index.toUpperCase() === idx.toUpperCase()
        );
        if (found) {
          saveCache(cId, idx, found);
          return found;
        }
      } else {
        console.warn('[CF GetRating] problemset.problems:', data.comment || 'Unknown error');
      }
    } catch (err) {
      console.warn('[CF GetRating] problemset.problems error:', err.message);
    }

    return null;
  }

  /* ── Rating color ───────────────────────────── */
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

  /* ── Replace native CF tags section ─────────── */
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

    // Rating — ALWAYS visible; show "N/A" if not available (live contest)
    const ratingTag = document.createElement('span');
    ratingTag.style.cssText = tagStyle;
    if (problem.rating) {
      ratingTag.textContent = `*${problem.rating}`;
    } else {
      ratingTag.textContent = '*N/A';
      ratingTag.title = 'Rating not available yet (live contest)';
      ratingTag.style.cssText = tagStyle + 'color: #999; font-style: italic;';
    }
    inner.appendChild(ratingTag);

    // Tags — hidden by default, shown inline next to rating
    const tagsSpan = document.createElement('span');
    tagsSpan.style.display = 'none';

    const hasTags = problem.tags && problem.tags.length > 0;

    if (hasTags) {
      problem.tags.forEach((tag) => {
        const tagEl = document.createElement('span');
        tagEl.style.cssText = tagStyle;
        tagEl.textContent = tag;
        tagsSpan.appendChild(tagEl);
      });
    } else {
      const noTagEl = document.createElement('span');
      noTagEl.style.cssText = tagStyle + 'color: #999; font-style: italic;';
      noTagEl.textContent = 'Tags not available';
      noTagEl.title = 'Tags are hidden during live contests';
      tagsSpan.appendChild(noTagEl);
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

    // "Show All Tags" toggle — always show the button
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
