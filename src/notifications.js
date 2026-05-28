(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	const STORAGE_KEY_ENABLED  = 'cc_notify_enabled';
	const STORAGE_KEY_NOTIFIED = 'cc_notified_';   // + 'session' or 'weekly'
	const STORAGE_KEY_WINDOW   = 'cc_window_';     // + 'session' or 'weekly'

	const THRESHOLDS = [50, 75, 90, 95, 100]; // % values to fire at

	const WINDOW_MS = {
		session: 5 * 60 * 60 * 1000,       // 5 hours
		weekly:  7 * 24 * 60 * 60 * 1000,   // 7 days
	};

	// ── helpers ──────────────────────────────────────────────────────────────

	function formatMs(ms) {
		if (ms <= 0) return 'now';
		const totalMin = Math.floor(ms / 60000);
		const h = Math.floor(totalMin / 60);
		const m = totalMin % 60;
		return h > 0 ? `${h}h ${m}m` : `${m}m`;
	}

	async function getEnabled() {
		try {
			const data = await chrome.storage.local.get(STORAGE_KEY_ENABLED);
			// Default: enabled (true) unless explicitly set to false
			return data[STORAGE_KEY_ENABLED] !== false;
		} catch {
			return true;
		}
	}

	// ── permission request ───────────────────────────────────────────────────

	function requestPermission() {
		if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
			Notification.requestPermission();
		}
	}

	// ── fire a notification ──────────────────────────────────────────────────

	function fire(type, pct, resetMs) {
		const label   = type === 'session' ? 'Session (5h)' : 'Weekly';
		const remaining = Math.max(0, 100 - pct).toFixed(0);
		const resetIn   = resetMs ? formatMs(resetMs - Date.now()) : null;

		const title = `⚠️ Claude ${label} usage: ${Math.round(pct)}%`;
		const body  = pct >= 100
			? (resetIn ? `Limit reached — resets in ${resetIn}` : 'Limit reached for this window.')
			: `${remaining}% remaining` + (resetIn ? ` — resets in ${resetIn}` : '');

		// MV3 extensions: use chrome.notifications
		if (typeof chrome !== 'undefined' && chrome.notifications?.create) {
			chrome.notifications.create(`cc_${type}_${pct}`, {
				type:     'basic',
				iconUrl:  chrome.runtime.getURL('icons/icon48.png'),
				title,
				message:  body,
				priority: pct >= 100 ? 2 : 1,
			});
		} else {
			// Fallback: Web Notifications API
			new Notification(title, { body });
		}
	}

	// ── main notify function ─────────────────────────────────────────────────

	async function notifyIfNeeded(type, pct, resetMs) {
		if (typeof pct !== 'number' || isNaN(pct)) return;

		// Check user toggle
		const enabled = await getEnabled();
		if (!enabled) return;

		// Check browser permission
		if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') return;

		const notifiedKey = STORAGE_KEY_NOTIFIED + type;
		const windowKey   = STORAGE_KEY_WINDOW + type;

		// Derive window start from reset time
		const windowDuration = WINDOW_MS[type] ?? WINDOW_MS.session;
		const windowStart    = resetMs ? resetMs - windowDuration : null;

		let stored = {};
		try {
			stored = await chrome.storage.local.get([notifiedKey, windowKey]);
		} catch {
			return;
		}

		// New window → reset which thresholds we've notified
		if (windowStart !== null && stored[windowKey] !== windowStart) {
			await chrome.storage.local.set({ [notifiedKey]: 0, [windowKey]: windowStart });
			stored[notifiedKey] = 0;
		}

		const lastNotified = stored[notifiedKey] ?? 0;

		// Find highest un-notified threshold that's been crossed
		const hit = [...THRESHOLDS].reverse().find(t => pct >= t && lastNotified < t);
		if (hit === undefined) return;

		fire(type, pct, resetMs);
		await chrome.storage.local.set({ [notifiedKey]: hit });
	}

	// ── toggle ───────────────────────────────────────────────────────────────

	let _onToggleCallback = null;

	async function toggle() {
		const wasEnabled = await getEnabled();
		const nowEnabled = !wasEnabled;
		await chrome.storage.local.set({ [STORAGE_KEY_ENABLED]: nowEnabled });
		if (nowEnabled) requestPermission();
		if (_onToggleCallback) _onToggleCallback(nowEnabled);
		return nowEnabled;
	}

	// Call this once from ui.js to get notified when toggle changes
	function onToggle(cb) {
		_onToggleCallback = cb;
		// Also call immediately with current state so the button renders correctly
		getEnabled().then(cb);
	}

	// ── export ───────────────────────────────────────────────────────────────

	CC.notifications = { notifyIfNeeded, toggle, onToggle, requestPermission, getEnabled };
})();
