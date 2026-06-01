// Storage-layer half of the server-user-state sync engine.
// ES5 only: var + function. No const/let/arrow/template-literal/Promise.
// Network half (XHR, debounce, status callbacks) is added in task 14.

(function () {
    var W = window;
    if (!W.MyStar) {
        if (typeof console !== 'undefined' && console.error) {
            console.error('[sync.js] shared.js not loaded');
        }
        return;
    }
    var M = W.MyStar;

    // ---------- Module-level state ----------
    var _oversizeBlocked = false;
    var _initialSyncBlocking = false;
    var _lastSyncAt = null;
    var _lastError = null;
    var _debounceTimer = null;
    var _rateLimitUntil = 0;

    var KNOWN_PREFIXES = ['mystar_', 'quizScore_', 'quizTime_', 'lastVisit_', 'starredCards_'];
    var ENVELOPE_KEYS = { 'mystar_user_code': 1, 'mystar_local_updated_at': 1 };

    // ---------- Cookie helpers (raw, silent) ----------
    function _writeCookieRaw(key, valueStr) {
        var d = new Date();
        d.setTime(d.getTime() + 10 * 365 * 24 * 60 * 60 * 1000);
        document.cookie = key + '=' + encodeURIComponent(valueStr) + ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax';
    }

    function _deleteCookie(key) {
        document.cookie = key + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    }

    function _matchesAnyPrefix(key) {
        for (var i = 0; i < KNOWN_PREFIXES.length; i++) {
            if (key.indexOf(KNOWN_PREFIXES[i]) === 0) return true;
        }
        return false;
    }

    // ---------- Public identity helpers (R1#4 — silent raw writes) ----------
    function setUserCode(code) {
        try { localStorage.setItem('mystar_user_code', code); } catch (e) {}
        _writeCookieRaw('mystar_user_code', code);
    }

    function getUserCode() {
        var v = null;
        try { v = localStorage.getItem('mystar_user_code'); } catch (e) {}
        if (!v) {
            var m = document.cookie.match(/(?:^|;\s*)mystar_user_code=([^;]*)/);
            if (m) v = decodeURIComponent(m[1]);
        }
        if (!v) return null;
        return /^[a-zA-Z0-9_\-]{6,16}$/.test(v) ? v : null;
    }

    function clearUserCode() {
        try { localStorage.removeItem('mystar_user_code'); } catch (e) {}
        _deleteCookie('mystar_user_code');
    }

    // ---------- Storage blob collection (R2#1, C-2) ----------
    function _collectStateBlob() {
        var keys = {};
        var blob = {};
        // localStorage pass
        var i;
        try {
            for (i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (!k) continue;
                if (ENVELOPE_KEYS[k]) continue;
                if (_matchesAnyPrefix(k)) {
                    var lv = null;
                    try { lv = localStorage.getItem(k); } catch (e) {}
                    if (lv != null) {
                        blob[k] = lv;
                        keys[k] = 1;
                    }
                }
            }
        } catch (e) {}
        // cookie pass — only if key not already seen in localStorage
        var pairs = document.cookie ? document.cookie.split(/;\s*/) : [];
        for (i = 0; i < pairs.length; i++) {
            var eq = pairs[i].indexOf('=');
            if (eq < 0) continue;
            var ck = pairs[i].substring(0, eq);
            if (ENVELOPE_KEYS[ck] || keys[ck]) continue;
            if (_matchesAnyPrefix(ck)) {
                var cv = '';
                try { cv = decodeURIComponent(pairs[i].substring(eq + 1)); } catch (e2) { cv = pairs[i].substring(eq + 1); }
                blob[ck] = cv;
                keys[ck] = 1;
            }
        }
        return { blob: blob, allKeys: keys };
    }

    function _hasLocalUserState() {
        var coll = _collectStateBlob();
        var blob = coll.blob;
        for (var k in blob) {
            if (!Object.prototype.hasOwnProperty.call(blob, k)) continue;
            var v = blob[k];
            if (v && v !== '0' && v !== '""' && v !== '[]' && v !== '{}') {
                return true;
            }
        }
        return false;
    }

    // ---------- Atomic apply of server blob (R5#7, C-2) ----------
    function _atomicApplyServerBlob(blob, serverUpdatedAt) {
        var coll = _collectStateBlob();
        var currentKeys = coll.allKeys;
        var k, v;

        // 1. Write pending keys (skip envelope-metadata).
        for (k in blob) {
            if (!Object.prototype.hasOwnProperty.call(blob, k)) continue;
            if (ENVELOPE_KEYS[k]) continue;
            v = blob[k];
            try { localStorage.setItem('__pending_' + k + '__', v); } catch (e) {}
            _writeCookieRaw('__pending_' + k + '__', v);
        }

        // 2. Delete keys present in currentKeys but absent from new blob (and not envelope).
        for (k in currentKeys) {
            if (!Object.prototype.hasOwnProperty.call(currentKeys, k)) continue;
            if (ENVELOPE_KEYS[k]) continue;
            if (Object.prototype.hasOwnProperty.call(blob, k)) continue;
            try { localStorage.removeItem(k); } catch (e) {}
            _deleteCookie(k);
        }

        // 3. Final swap: write origKey from blob, then drop the pending temp key.
        for (k in blob) {
            if (!Object.prototype.hasOwnProperty.call(blob, k)) continue;
            if (ENVELOPE_KEYS[k]) continue;
            v = blob[k];
            try { localStorage.setItem(k, v); } catch (e) {}
            _writeCookieRaw(k, v);
            try { localStorage.removeItem('__pending_' + k + '__'); } catch (e2) {}
            _deleteCookie('__pending_' + k + '__');
        }

        // 4. Silent clock set — no _touchLocalUpdatedAt, no notify.
        var ts = String(serverUpdatedAt);
        try { localStorage.setItem('mystar_local_updated_at', ts); } catch (e) {}
        _writeCookieRaw('mystar_local_updated_at', ts);
    }

    // ---------- XHR wrapper (8s timeout, JSON, never throws) ----------
    function _xhrJson(method, url, body, cb) {
        var called = false;
        function done(err, status, parsedJson, retryAfterSeconds) {
            if (called) return;
            called = true;
            try { cb(err, status, parsedJson, retryAfterSeconds); } catch (e) {}
        }
        var xhr;
        try { xhr = new XMLHttpRequest(); } catch (e) { done(e, 0, null, 0); return; }
        try {
            xhr.open(method, url, true);
            xhr.timeout = 8000;
            var hasBody = (method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH') && body != null;
            if (hasBody) {
                try { xhr.setRequestHeader('Content-Type', 'application/json'); } catch (e2) {}
            }
            xhr.onload = function () {
                var status = xhr.status;
                var parsed = null;
                var text = '';
                try { text = xhr.responseText || ''; } catch (e3) { text = ''; }
                if (text) {
                    try { parsed = JSON.parse(text); } catch (e4) { parsed = null; }
                }
                var ra = 0;
                try {
                    var raHeader = xhr.getResponseHeader('Retry-After');
                    if (raHeader) {
                        var n = Number(raHeader);
                        if (!isNaN(n) && n > 0) ra = n;
                    }
                } catch (e5) {}
                done(null, status, parsed, ra);
            };
            xhr.onerror = function () { done('network error', 0, null, 0); };
            xhr.ontimeout = function () { done('timeout', 0, null, 0); };
            if (hasBody) {
                xhr.send(JSON.stringify(body));
            } else {
                xhr.send();
            }
        } catch (e6) {
            done(e6 && e6.message ? e6.message : 'xhr error', 0, null, 0);
        }
    }

    // ---------- Broadcast helper ----------
    function _broadcast() {
        if (M.__onSyncStatus) {
            try { M.__onSyncStatus(getSyncStatus()); } catch (e) {}
        }
    }

    // ---------- Status accessor ----------
    function getSyncStatus() {
        var state;
        if (!getUserCode()) {
            state = 'disabled';
        } else if (_lastError) {
            state = 'offline';
        } else {
            state = 'synced';
        }
        return { state: state, lastSyncAt: _lastSyncAt, lastError: _lastError };
    }

    // ---------- Push to server ----------
    function syncToServer() {
        if (!getUserCode()) return;
        if (_oversizeBlocked) return;
        if (Date.now() < _rateLimitUntil) return;
        var pair = _collectStateBlob();
        var blob = pair.blob;
        var updatedAt = 0;
        try { updatedAt = Number(localStorage.getItem('mystar_local_updated_at')) || 0; } catch (e) {}
        if (!updatedAt) updatedAt = Date.now();
        _xhrJson('PUT', '/api/state', { code: getUserCode(), data: blob, updatedAt: updatedAt }, function (err, status, body, retryAfter) {
            if (err) {
                _lastError = String(err);
                _broadcast();
                return;
            }
            if (status === 204) {
                _lastSyncAt = Date.now();
                _lastError = null;
                _broadcast();
                return;
            }
            if (status === 400) {
                _lastError = 'bad request';
                _broadcast();
                return;
            }
            if (status === 413) {
                _oversizeBlocked = true;
                _lastError = 'payload too large (>64KB)';
                if (M.__onToast) {
                    try { M.__onToast(_lastError); } catch (e2) {}
                }
                _broadcast();
                return;
            }
            if (status === 429) {
                var secs = retryAfter > 0 ? retryAfter : 60;
                _rateLimitUntil = Date.now() + (secs * 1000);
                _lastError = 'rate limited';
                _broadcast();
                return;
            }
            _lastError = 'status ' + status;
            _broadcast();
        });
    }

    // ---------- Pull from server (Sequence A) ----------
    function syncFromServer(cb) {
        cb = cb || function () {};
        if (!getUserCode()) {
            _lastError = null;
            _broadcast();
            cb();
            return;
        }
        _initialSyncBlocking = true;
        var localClockSnapshot = 0;
        try { localClockSnapshot = Number(localStorage.getItem('mystar_local_updated_at')) || 0; } catch (e) {}

        _xhrJson('GET', '/api/state?code=' + encodeURIComponent(getUserCode()), null, function (err, status, body) {
            if (err || status !== 200) {
                _lastError = err ? String(err) : ('status ' + status);
                _initialSyncBlocking = false;
                _broadcast();
                cb();
                return;
            }

            // Re-check the local clock at apply time. If the user wrote during in-flight
            // we must NOT overwrite local — treat as local-newer (PUT path).
            var localNow = 0;
            try { localNow = Number(localStorage.getItem('mystar_local_updated_at')) || 0; } catch (e2) {}
            var userWroteDuringFlight = localNow > localClockSnapshot;

            var serverData = body ? body.data : null;
            var serverUpdatedAt = body ? Number(body.updatedAt) || 0 : 0;

            // Scenario C: server has no row → push local.
            if (serverData === null || serverData === undefined) {
                _finishInitialSyncWithPut(cb);
                return;
            }

            // Server-wins overwrite branch (only when user didn't write during in-flight).
            if (!userWroteDuringFlight && serverUpdatedAt > localClockSnapshot) {
                try { _atomicApplyServerBlob(serverData, serverUpdatedAt); } catch (e3) {}
                _initialSyncBlocking = false;
                _lastError = null;
                _broadcast();
                try { location.reload(); } catch (e4) {}
                return;
            }

            // Local newer (or equal) → push local.
            _finishInitialSyncWithPut(cb);
        });
    }

    function _finishInitialSyncWithPut(cb) {
        // Post-initial-sync flush (I-1 / I-3-r6): bump clock then PUT.
        var nowStr = String(Date.now());
        try { localStorage.setItem('mystar_local_updated_at', nowStr); } catch (e) {}
        _writeCookieRaw('mystar_local_updated_at', nowStr);
        syncToServer();
        _initialSyncBlocking = false;
        _broadcast();
        cb();
    }

    // ---------- Debounced change notification ----------
    M.__notifyChange = function () {
        if (_oversizeBlocked || _initialSyncBlocking) return;
        if (!getUserCode()) return;
        if (Date.now() < _rateLimitUntil) return;
        if (_debounceTimer) clearTimeout(_debounceTimer);
        _debounceTimer = setTimeout(syncToServer, 600);
    };

    // ---------- Flush pending writes (unload hooks) ----------
    function flushPendingSync() {
        if (_debounceTimer) {
            clearTimeout(_debounceTimer);
            _debounceTimer = null;
        }
        if (!getUserCode()) return;
        if (_oversizeBlocked) return;
        if (_initialSyncBlocking) return;
        syncToServer();
    }

    // ---------- Cloud delete (R9) ----------
    function __deleteCloudData(cb) {
        cb = cb || function () {};
        var code = getUserCode();
        if (!code) { cb(null, 204); return; }
        _xhrJson('DELETE', '/api/state', { code: code }, function (err, status) {
            cb(err, status);
        });
    }

    // ---------- Exports ----------
    M.setUserCode = setUserCode;
    M.getUserCode = getUserCode;
    M.clearUserCode = clearUserCode;
    M.__hasLocalUserState = _hasLocalUserState;
    M.__applyServerBlob = _atomicApplyServerBlob;
    M.syncFromServer = syncFromServer;
    M.syncToServer = syncToServer;
    M.flushPendingSync = flushPendingSync;
    M.getSyncStatus = getSyncStatus;
    M.__xhrJson = _xhrJson;
    M.__deleteCloudData = __deleteCloudData;
    // Callback slots reserved for task 15 (user-code.js) — discoverable.
    if (M.__onSyncStatus === undefined) M.__onSyncStatus = null;
    if (M.__onToast === undefined) M.__onToast = null;

    // ---------- Unload hooks ----------
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') M.flushPendingSync();
    });
    window.addEventListener('beforeunload', function () { M.flushPendingSync(); });
})();
