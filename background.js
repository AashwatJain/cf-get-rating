/* =============================================
   CF GetRating — Background Service Worker
   - Rate-limit coordinator: grants "slots" to
     content scripts so only one API call happens
     at a time with ≥2s gap between calls
   - Shared cache via chrome.storage.local
   ============================================= */

const RATE_LIMIT_GAP_MS = 2100; // slightly over 2s to be safe
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

let lastApiCallTime = 0;
let slotQueue = [];
let processingSlots = false;

/* ── Process the slot queue one by one ───────────── */
async function processSlotQueue() {
  if (processingSlots) return;
  processingSlots = true;

  while (slotQueue.length > 0) {
    const { resolve } = slotQueue.shift();

    const now = Date.now();
    const elapsed = now - lastApiCallTime;

    if (elapsed < RATE_LIMIT_GAP_MS) {
      await sleep(RATE_LIMIT_GAP_MS - elapsed);
    }

    lastApiCallTime = Date.now();
    resolve({ granted: true, time: lastApiCallTime });
  }

  processingSlots = false;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ── Cache helpers ───────────────────────────────── */
function getFromCache(contestId, index) {
  return new Promise((resolve) => {
    const key = `cfgr_${contestId}_${index}`;
    chrome.storage.local.get(key, (result) => {
      if (chrome.runtime.lastError) { resolve(null); return; }
      const entry = result[key];
      if (!entry || !entry.data) { resolve(null); return; }
      if (Date.now() - entry.ts > CACHE_TTL_MS) {
        chrome.storage.local.remove(key);
        resolve(null);
        return;
      }
      resolve(entry.data);
    });
  });
}

function saveToCache(contestId, index, data) {
  const key = `cfgr_${contestId}_${index}`;
  chrome.storage.local.set({ [key]: { data, ts: Date.now() } });
}

/* ── Message listener ────────────────────────────── */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // Content/popup wants to check cache
  if (message.type === 'CHECK_CACHE') {
    getFromCache(message.contestId, message.index).then((data) => {
      sendResponse({ hit: !!data, data });
    });
    return true;
  }

  // Content script wants to save to cache
  if (message.type === 'SAVE_CACHE') {
    saveToCache(message.contestId, message.index, message.data);
    sendResponse({ ok: true });
    return false;
  }

  // Content script requests a rate-limited slot before making API call
  if (message.type === 'REQUEST_SLOT') {
    const slotPromise = new Promise((resolve) => {
      slotQueue.push({ resolve });
    });
    processSlotQueue();

    slotPromise.then((result) => {
      sendResponse(result);
    });
    return true;
  }

  // Popup asks background to relay fetch request to content script on a tab
  if (message.type === 'FETCH_PROBLEM') {
    const { contestId, index, tabId } = message;

    // First check cache
    getFromCache(contestId, index).then((cached) => {
      if (cached) {
        sendResponse({ success: true, data: cached });
        return;
      }

      // Try asking content script on the tab
      if (tabId) {
        chrome.tabs.sendMessage(
          tabId,
          { type: 'GET_PROBLEM_DATA' },
          (response) => {
            if (chrome.runtime.lastError || !response || !response.success) {
              sendResponse({ success: false, data: null, error: 'Content script unavailable' });
              return;
            }
            sendResponse({ success: true, data: response.data });
          }
        );
      } else {
        sendResponse({ success: false, data: null, error: 'No tab ID' });
      }
    });

    return true;
  }
});
