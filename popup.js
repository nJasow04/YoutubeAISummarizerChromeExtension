const AI_SERVICES = {
  claude:  { name: 'Claude',  url: 'https://claude.ai/new' },
  gemini:  { name: 'Gemini',  url: 'https://gemini.google.com/app' },
  chatgpt: { name: 'ChatGPT', url: 'https://chatgpt.com/' },
};

const PROMPT_PREFIX =
`Please summarize this YouTube video transcript. Provide:
- A brief overview (2-3 sentences)
- The key points and main ideas covered
- Any important conclusions or takeaways

Keep it concise and easy to scan.\n\n`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isYouTubeVideo(url) {
  return /youtube\.com\/watch\?.*v=/.test(url || '');
}

// ─── Core transcript fetch (DOM-based) ───────────────────────────────────────
//
// Reads the transcript directly from the YouTube page DOM — the same way the
// user does it manually. If the panel isn't open yet, it clicks "Show
// transcript" first and waits for the segments to appear.

async function pageExtractTranscript() {
  try {
    const title   = document.title.replace(' - YouTube', '').trim();
    const videoId = new URLSearchParams(location.search).get('v');
    if (!videoId) return { error: 'NO_VIDEO_ID' };

    // ── 1. InnerTube API key ──────────────────────────────────────────────────
    const keyMatch = document.documentElement.innerHTML.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
    const apiKey   = keyMatch ? keyMatch[1] : null;
    const playerUrl = 'https://www.youtube.com/youtubei/v1/player' + (apiKey ? '?key=' + apiKey : '');

    // ── 2. Fetch caption tracks (WEB → ANDROID → page fallback) ──────────────
    async function callPlayer(body) {
      try {
        const r = await fetch(playerUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        });
        if (!r.ok) return null;
        const d = await r.json();
        const tracks = d && d.captions && d.captions.playerCaptionsTracklistRenderer
          && d.captions.playerCaptionsTracklistRenderer.captionTracks;
        return (tracks && tracks.length) ? tracks : null;
      } catch (e) {
        return null;
      }
    }

    const webBody = {
      context: { client: { clientName: 'WEB', clientVersion: '2.20251215.01.00' } },
      videoId: videoId,
    };
    const androidBody = {
      context: { client: {
        clientName: 'ANDROID', clientVersion: '20.10.38',
        androidSdkVersion: 30,
        userAgent: 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip',
        hl: 'en', gl: 'US',
      }},
      videoId: videoId,
    };

    let tracks = await callPlayer(webBody)
              || await callPlayer(androidBody);

    // Page-level fallback
    if (!tracks || !tracks.length) {
      const pr = window.ytInitialPlayerResponse;
      if (pr && pr.captions && pr.captions.playerCaptionsTracklistRenderer) {
        tracks = pr.captions.playerCaptionsTracklistRenderer.captionTracks;
      }
    }

    if (!tracks || !tracks.length) return { error: 'NO_CAPTIONS' };

    // ── 3. Pick best track ────────────────────────────────────────────────────
    const track = tracks.find(function(t) { return t.languageCode === 'en' && t.kind !== 'asr'; })
               || tracks.find(function(t) { return t.languageCode === 'en'; })
               || tracks.find(function(t) { return t.languageCode && t.languageCode.startsWith('en'); })
               || tracks[0];

    if (!track || !track.baseUrl) return { error: 'NO_TRACK_URL' };

    // ── 4. Fetch XML ──────────────────────────────────────────────────────────
    const url = track.baseUrl.replace(/[&?]fmt=(srv3|ttml)/g, '');
    let raw;
    try {
      const r = await fetch(url, { credentials: 'include' });
      if (!r.ok) return { error: 'HTTP_' + r.status };
      raw = await r.text();
    } catch (e) {
      return { error: 'FETCH_FAILED: ' + e.message };
    }

    if (!raw || !raw.trim()) return { error: 'EMPTY_RESPONSE' };

    // Return raw to the popup for parsing — DOMParser is blocked by
    // YouTube's Trusted Types CSP in the page context.
    return { title: title, raw: raw };

  } catch (e) {
    return { error: 'EXCEPTION: ' + e.message };
  }
}

function parseTranscriptRaw(raw) {
  // XML (default timedtext format) — parsed here in the popup, not the page
  const xmlDoc = new DOMParser().parseFromString(raw, 'text/xml');
  if (!xmlDoc.querySelector('parsererror')) {
    const nodes = xmlDoc.querySelectorAll('text');
    const transcript = Array.from(nodes).map(n => {
      // Decode HTML entities via a temporary textarea
      const ta = document.createElement('textarea');
      ta.innerHTML = n.textContent || '';
      return ta.value.trim();
    }).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    if (transcript) return transcript;
  }

  // JSON3 fallback
  if (raw.trimStart().charAt(0) === '{') {
    const d = JSON.parse(raw);
    return (d.events || [])
      .filter(e => e.segs)
      .map(e => e.segs.map(s => s.utf8 || '').join(''))
      .join(' ').replace(/\s+/g, ' ').trim();
  }

  return null;
}

async function fetchTranscriptData(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world:  'MAIN',
    func:   pageExtractTranscript,
  });

  if (!result)                        throw new Error('Script returned no data');
  if (result.error === 'NO_CAPTIONS') throw new Error('NO_CAPTIONS');
  if (result.error)                   throw new Error(result.error);

  const transcript = parseTranscriptRaw(result.raw);
  if (!transcript) throw new Error('Could not parse transcript text');

  return { title: result.title, transcript };
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function showStatus(msg, type = 'info') {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = `status ${type}`;
  el.classList.remove('hidden');
}

function setButtonsDisabled(disabled, loadingId = null) {
  Object.keys(AI_SERVICES).forEach(id => {
    const btn    = document.getElementById(`${id}-btn`);
    btn.disabled = disabled;
    btn.querySelector('.btn-text').textContent =
      (loadingId === id) ? 'Fetching transcript…'
                         : `Summarize with ${AI_SERVICES[id].name}`;
  });
}

// ─── Main action ──────────────────────────────────────────────────────────────

async function handleSummarize(service, tab) {
  setButtonsDisabled(true, service);
  showStatus('Fetching transcript…', 'info');

  try {
    const { title, transcript } = await fetchTranscriptData(tab.id);

    const titleLine = title ? `Video: "${title}"\n\n` : '';
    const payload   = PROMPT_PREFIX + titleLine + 'Transcript:\n' + transcript;

    await navigator.clipboard.writeText(payload);

    chrome.tabs.create({ url: AI_SERVICES[service].url });
    showStatus(`✓ Copied! Paste (⌘V / Ctrl+V) into ${AI_SERVICES[service].name}.`, 'success');

  } catch (err) {
    console.error(err);
    showStatus(
      err.message === 'NO_CAPTIONS'
        ? 'No transcript available for this video.'
        : 'Failed: ' + err.message,
      'error',
    );
  }

  setButtonsDisabled(false);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Get the real URL from the page in case tab.url isn't exposed
    const [{ result: pageUrl }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => location.href,
    });

    if (!isYouTubeVideo(pageUrl)) {
      document.getElementById('not-youtube').classList.remove('hidden');
      return;
    }

    // Show video title (best-effort)
    try {
      const [{ result: title }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => document.title?.replace(' - YouTube', '').trim(),
      });
      if (title) {
        document.getElementById('video-title').textContent = title;
        document.getElementById('video-info').classList.remove('hidden');
      }
    } catch { /* non-fatal */ }

    document.getElementById('buttons').classList.remove('hidden');

    Object.keys(AI_SERVICES).forEach(id => {
      document.getElementById(`${id}-btn`)
        .addEventListener('click', () => handleSummarize(id, tab));
    });

  } catch (err) {
    console.error(err);
    document.getElementById('not-youtube').classList.remove('hidden');
  }
});
