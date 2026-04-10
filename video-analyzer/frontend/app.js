const API_BASE = window.location.origin;
const POLL_INTERVAL = 3000;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const state = {
    userToken: localStorage.getItem('va_user_token') || '',
    polling: null,
};

function init() {
    if (state.userToken) {
        $('#userToken').value = state.userToken;
        loadStoredKeys();
    }

    $('#settingsBtn').addEventListener('click', toggleSettings);
    $('#closeSettings').addEventListener('click', toggleSettings);
    $('#generateTokenBtn').addEventListener('click', generateToken);
    $('#copyTokenBtn').addEventListener('click', () => copyText($('#userToken').value, 'Token copied'));
    $('#analyzeForm').addEventListener('submit', handleSubmit);
    $('#strategy').addEventListener('change', onStrategyChange);
    $('#copyResult').addEventListener('click', () => copyText($('#resultContent').textContent, 'Result copied'));
    $('#mcpInfoLink').addEventListener('click', (e) => { e.preventDefault(); showMcpModal(); });
    $('#closeMcpModal').addEventListener('click', () => $('#mcpModal').classList.add('hidden'));

    $$('.save-key-btn').forEach(btn => {
        btn.addEventListener('click', () => saveKey(btn.dataset.provider));
    });
}

function toggleSettings() {
    $('#settingsPanel').classList.toggle('hidden');
}

function toast(message, type = 'success') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

function copyText(text, msg) {
    navigator.clipboard.writeText(text).then(() => toast(msg));
}

async function generateToken() {
    try {
        const res = await fetch(`${API_BASE}/api/generate-token`, { method: 'POST' });
        const data = await res.json();
        state.userToken = data.user_token;
        localStorage.setItem('va_user_token', state.userToken);
        $('#userToken').value = state.userToken;
        toast('Token generated');
    } catch (e) {
        toast('Failed to generate token', 'error');
    }
}

async function saveKey(provider) {
    const inputMap = { google: '#googleKey', openai: '#openaiKey', anthropic: '#anthropicKey' };
    const key = $(inputMap[provider]).value.trim();
    if (!key) return toast('Enter an API key first', 'error');
    if (!state.userToken) {
        await generateToken();
    }

    try {
        const res = await fetch(`${API_BASE}/api/store-key`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_token: state.userToken, provider, api_key: key }),
        });
        if (!res.ok) throw new Error(await res.text());
        $(inputMap[provider]).value = '';
        toast(`${provider} key saved`);
        loadStoredKeys();
    } catch (e) {
        toast(`Failed to save key: ${e.message}`, 'error');
    }
}

async function loadStoredKeys() {
    if (!state.userToken) return;
    try {
        const res = await fetch(`${API_BASE}/api/keys/${state.userToken}`);
        const data = await res.json();
        const container = $('#storedKeys');
        if (data.providers.length === 0) {
            container.innerHTML = '<p class="hint">No keys stored yet.</p>';
            return;
        }
        container.innerHTML = data.providers.map(p =>
            `<div class="key-item">
                <span>${p.provider}</span>
                <span class="key-badge">Stored</span>
            </div>`
        ).join('');
    } catch (e) {
        console.error('Failed to load keys', e);
    }
}

function onStrategyChange() {
    const isSegments = $('#strategy').value === 'user_segments';
    $('#segmentFields').classList.toggle('hidden', !isSegments);
}

async function handleSubmit(e) {
    e.preventDefault();
    hideResults();

    const body = {
        google_drive_url: $('#driveUrl').value.trim(),
        prompt: $('#prompt').value.trim(),
        model: $('#model').value,
        strategy: $('#strategy').value,
        user_token: state.userToken || undefined,
    };

    if ($('#segmentStart').value) body.segment_start = parseFloat($('#segmentStart').value);
    if ($('#segmentEnd').value) body.segment_end = parseFloat($('#segmentEnd').value);
    if ($('#temperature').value) body.temperature = parseFloat($('#temperature').value);
    if ($('#maxTokens').value) body.max_tokens = parseInt($('#maxTokens').value);
    if ($('#chunkDuration').value) body.max_chunk_duration = parseInt($('#chunkDuration').value);
    if ($('#inlineApiKey').value.trim()) body.api_key = $('#inlineApiKey').value.trim();

    setLoading(true);
    showStatus('Submitting analysis request...');

    try {
        const res = await fetch(`${API_BASE}/api/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: res.statusText }));
            throw new Error(err.detail || JSON.stringify(err));
        }

        const data = await res.json();
        startPolling(data.job_id);
    } catch (e) {
        setLoading(false);
        showError(e.message);
    }
}

function startPolling(jobId) {
    showStatus('Downloading video from Google Drive...');
    state.polling = setInterval(async () => {
        try {
            const res = await fetch(`${API_BASE}/api/job/${jobId}`);
            const data = await res.json();

            if (data.status === 'downloading') {
                showStatus('Downloading video from Google Drive...');
            } else if (data.status === 'analyzing') {
                showStatus('Analyzing video with AI model...');
            } else if (data.status === 'completed') {
                clearInterval(state.polling);
                setLoading(false);
                showStatus('Analysis complete', true);
                showResult(data);
            } else if (data.status === 'failed') {
                clearInterval(state.polling);
                setLoading(false);
                showStatus('Analysis failed', false, true);
                showError(data.error || 'Unknown error');
            }
        } catch (e) {
            console.error('Polling error', e);
        }
    }, POLL_INTERVAL);
}

function setLoading(loading) {
    const btn = $('#submitBtn');
    btn.disabled = loading;
    btn.querySelector('.btn-text').classList.toggle('hidden', loading);
    btn.querySelector('.btn-loading').classList.toggle('hidden', !loading);
}

function showStatus(text, done = false, error = false) {
    $('#statusSection').classList.remove('hidden');
    $('#statusText').textContent = text;
    const indicator = $('#statusSection .status-indicator');
    indicator.classList.toggle('done', done);
    indicator.classList.toggle('error', error);
}

function showResult(data) {
    $('#resultSection').classList.remove('hidden');
    $('#resultContent').textContent = data.result;

    const meta = [];
    if (data.model) meta.push(`Model: ${data.model}`);
    if (data.strategy_used) meta.push(`Strategy: ${data.strategy_used}`);
    if (data.chunks_processed) meta.push(`Chunks: ${data.chunks_processed}/${data.total_chunks}`);
    $('#resultMeta').innerHTML = meta.map(m => `<span>${m}</span>`).join('');
}

function showError(message) {
    $('#errorSection').classList.remove('hidden');
    $('#errorText').textContent = message;
}

function hideResults() {
    if (state.polling) clearInterval(state.polling);
    $('#statusSection').classList.add('hidden');
    $('#resultSection').classList.add('hidden');
    $('#errorSection').classList.add('hidden');
}

function showMcpModal() {
    const host = window.location.origin;
    const config = {
        mcpServers: {
            "video-analyzer": {
                "url": `${host}/mcp`,
                "transport": "sse"
            }
        }
    };
    $('#mcpConfig').textContent = JSON.stringify(config, null, 2);
    $('#mcpModal').classList.remove('hidden');
}

document.addEventListener('DOMContentLoaded', init);
