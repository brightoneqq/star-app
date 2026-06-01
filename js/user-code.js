// Identity UI for the server-user-state feature.
// ES5 only: var + function. No const/let/arrow/template-literal/Promise.
// Depends on MyStar.* from shared.js + sync.js. Load AFTER both.

(function () {
    var W = window;
    if (!W.MyStar || !W.MyStar.syncFromServer) {
        if (typeof console !== 'undefined' && console.error) {
            console.error('[user-code.js] sync.js not loaded');
        }
        return;
    }
    var M = W.MyStar;
    var CODE_RE = /^[a-zA-Z0-9_]{6,16}$/;

    // ---------- Module state ----------
    var _statusRefreshTimer = null;
    var _modalEl = null;
    var _modalKeyHandler = null;
    var _toastEl = null;
    var _toastTimer = null;

    // ---------- DOM helpers ----------
    function _el(tag, className) {
        var e = document.createElement(tag);
        if (className) e.className = className;
        return e;
    }

    function _removeUserbar() {
        var existing = document.querySelector('.mystar-userbar');
        if (existing && existing.parentNode) {
            existing.parentNode.removeChild(existing);
        }
    }

    function _pad2(n) { return n < 10 ? '0' + n : String(n); }

    function _formatStamp(ts) {
        var n = Number(ts);
        if (!n || isNaN(n)) return '';
        var d = new Date(n);
        if (isNaN(d.getTime())) return '';
        return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + _pad2(d.getHours()) + ':' + _pad2(d.getMinutes());
    }

    // ---------- Summary computation (R5#4) ----------
    function _computeSummary(blob) {
        if (!blob) return '空数据';
        var N = 0;
        var K = 0;
        var QUIZ_RE = /^quizScore_[^_]+$/;
        var STAR_RE = /^starredCards_/;
        for (var k in blob) {
            if (!Object.prototype.hasOwnProperty.call(blob, k)) continue;
            if (STAR_RE.test(k)) {
                try {
                    var arr = JSON.parse(blob[k]);
                    if (arr && Object.prototype.toString.call(arr) === '[object Array]') {
                        N += arr.length;
                    }
                } catch (e) {}
            } else if (QUIZ_RE.test(k)) {
                var v = Number(blob[k]);
                if (!isNaN(v) && v > 0) K++;
            }
        }
        return '约 ' + N + ' 张星标 · ' + K + ' 个 unit 有成绩';
    }

    function _collectLocalBlobLite() {
        // Mirror sync.js _collectStateBlob but inline — only for the modal summary.
        var KNOWN_PREFIXES = ['mystar_', 'quizScore_', 'quizTime_', 'lastVisit_', 'starredCards_'];
        var ENVELOPE_KEYS = { 'mystar_user_code': 1, 'mystar_local_updated_at': 1 };
        function matches(key) {
            for (var i = 0; i < KNOWN_PREFIXES.length; i++) {
                if (key.indexOf(KNOWN_PREFIXES[i]) === 0) return true;
            }
            return false;
        }
        var keys = {};
        var blob = {};
        var i;
        try {
            for (i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (!k) continue;
                if (ENVELOPE_KEYS[k]) continue;
                if (matches(k)) {
                    var lv = null;
                    try { lv = localStorage.getItem(k); } catch (e) {}
                    if (lv != null) { blob[k] = lv; keys[k] = 1; }
                }
            }
        } catch (e) {}
        var pairs = document.cookie ? document.cookie.split(/;\s*/) : [];
        for (i = 0; i < pairs.length; i++) {
            var eq = pairs[i].indexOf('=');
            if (eq < 0) continue;
            var ck = pairs[i].substring(0, eq);
            if (ENVELOPE_KEYS[ck] || keys[ck]) continue;
            if (matches(ck)) {
                var cv = '';
                try { cv = decodeURIComponent(pairs[i].substring(eq + 1)); } catch (e2) { cv = pairs[i].substring(eq + 1); }
                blob[ck] = cv;
                keys[ck] = 1;
            }
        }
        return blob;
    }

    function _localUpdatedAt() {
        var v = null;
        try { v = localStorage.getItem('mystar_local_updated_at'); } catch (e) {}
        if (!v) {
            var m = document.cookie.match(/(?:^|;\s*)mystar_local_updated_at=([^;]*)/);
            if (m) {
                try { v = decodeURIComponent(m[1]); } catch (e2) { v = m[1]; }
            }
        }
        var n = Number(v);
        return isNaN(n) ? 0 : n;
    }

    // ---------- Toast ----------
    function _showToast(msg) {
        if (_toastEl && _toastEl.parentNode) {
            _toastEl.parentNode.removeChild(_toastEl);
            _toastEl = null;
        }
        if (_toastTimer) {
            clearTimeout(_toastTimer);
            _toastTimer = null;
        }
        var t = _el('div', 'mystar-toast');
        t.textContent = String(msg == null ? '' : msg);
        t.style.position = 'fixed';
        t.style.left = '50%';
        t.style.bottom = '32px';
        t.style.transform = 'translateX(-50%)';
        t.style.background = 'rgba(22, 58, 95, 0.92)';
        t.style.color = '#fff';
        t.style.padding = '10px 18px';
        t.style.borderRadius = '8px';
        t.style.fontSize = '14px';
        t.style.zIndex = '10001';
        t.style.transition = 'opacity 0.3s ease';
        t.style.opacity = '1';
        document.body.appendChild(t);
        _toastEl = t;
        _toastTimer = setTimeout(function () {
            if (_toastEl) {
                _toastEl.style.opacity = '0';
                setTimeout(function () {
                    if (_toastEl && _toastEl.parentNode) {
                        _toastEl.parentNode.removeChild(_toastEl);
                    }
                    _toastEl = null;
                }, 300);
            }
            _toastTimer = null;
        }, 3000);
    }

    // ---------- Modal core ----------
    function _closeModal() {
        if (_modalEl && _modalEl.parentNode) {
            _modalEl.parentNode.removeChild(_modalEl);
        }
        _modalEl = null;
        if (_modalKeyHandler) {
            document.removeEventListener('keydown', _modalKeyHandler);
            _modalKeyHandler = null;
        }
        try { document.body.style.overflow = ''; } catch (e) {}
    }

    function _openModal(node, onCancel) {
        if (_modalEl) _closeModal();
        var overlay = _el('div', 'mystar-modal-overlay');
        var card = _el('div', 'mystar-modal');
        card.appendChild(node);
        overlay.appendChild(card);
        document.body.appendChild(overlay);
        _modalEl = overlay;
        try { document.body.style.overflow = 'hidden'; } catch (e) {}
        _modalKeyHandler = function (ev) {
            if (ev && (ev.key === 'Escape' || ev.keyCode === 27)) {
                if (onCancel) {
                    try { onCancel(); } catch (e2) {}
                } else {
                    _closeModal();
                }
            }
        };
        document.addEventListener('keydown', _modalKeyHandler);
    }

    // ---------- Status indicator ----------
    function _statusText(status) {
        if (!status) return '未启用云同步';
        if (status.state === 'synced') {
            var rel = M.timeAgo ? M.timeAgo(status.lastSyncAt) : '';
            return rel ? ('已同步 · ' + rel) : '已同步';
        }
        if (status.state === 'offline') return '离线，仅本地保存';
        return '未启用云同步';
    }

    function _renderStatusInto(statusEl, status) {
        if (!statusEl) return;
        var state = (status && status.state) ? status.state : 'disabled';
        statusEl.setAttribute('data-state', state);
        var textEl = statusEl.querySelector('.text');
        if (textEl) textEl.textContent = _statusText(status);
    }

    // ---------- Header strip rendering ----------
    function _renderHeaderStrip() {
        _removeUserbar();
        var bar = _el('div', 'mystar-userbar');
        var code = M.getUserCode();

        if (!code) {
            bar.innerHTML = ''
                + '<span class="mystar-userbar__label">学习账号</span>'
                + '<input class="mystar-userbar__input" type="text" maxlength="16" autocomplete="off" autocapitalize="off" spellcheck="false">'
                + '<button class="mystar-userbar__btn mystar-userbar__btn--primary" type="button">开始</button>'
                + '<span class="mystar-userbar__hint"></span>';
            if (document.body.firstChild) {
                document.body.insertBefore(bar, document.body.firstChild);
            } else {
                document.body.appendChild(bar);
            }
            var input = bar.querySelector('.mystar-userbar__input');
            var startBtn = bar.querySelector('.mystar-userbar__btn--primary');
            var hint = bar.querySelector('.mystar-userbar__hint');
            if (startBtn && M.addTapListener) {
                M.addTapListener(startBtn, function () { _onStartTapped(input, hint); });
            }
            if (input) {
                input.addEventListener('keydown', function (ev) {
                    if (ev && (ev.key === 'Enter' || ev.keyCode === 13)) {
                        ev.preventDefault();
                        _onStartTapped(input, hint);
                    }
                });
            }
            return;
        }

        bar.innerHTML = ''
            + '<span class="mystar-userbar__greeting">你好，<b class="mystar-userbar__code"></b></span>'
            + '<button class="mystar-userbar__btn mystar-userbar__btn--switch" type="button">切换</button>'
            + '<button class="mystar-userbar__btn mystar-userbar__btn--text mystar-userbar__btn--clear" type="button">清除云端进度</button>'
            + '<span class="mystar-userbar__status" data-state="disabled"><span class="dot"></span><span class="text">未启用云同步</span></span>';
        if (document.body.firstChild) {
            document.body.insertBefore(bar, document.body.firstChild);
        } else {
            document.body.appendChild(bar);
        }
        var codeEl = bar.querySelector('.mystar-userbar__code');
        if (codeEl) codeEl.textContent = code;
        var switchBtn = bar.querySelector('.mystar-userbar__btn--switch');
        var clearBtn = bar.querySelector('.mystar-userbar__btn--clear');
        if (switchBtn && M.addTapListener) {
            M.addTapListener(switchBtn, function () {
                M.clearUserCode();
                _renderHeaderStrip();
            });
        }
        if (clearBtn && M.addTapListener) {
            M.addTapListener(clearBtn, function () { _onClearCloudTapped(); });
        }
        // Initial paint of status.
        var statusEl = bar.querySelector('.mystar-userbar__status');
        if (statusEl && M.getSyncStatus) {
            _renderStatusInto(statusEl, M.getSyncStatus());
        }
    }

    // ---------- Start / probe flow ----------
    function _onStartTapped(input, hint) {
        var raw = (input && input.value) ? input.value : '';
        var typed = raw.replace(/^\s+|\s+$/g, '');
        if (!CODE_RE.test(typed)) {
            if (hint) hint.textContent = '账号需 6–16 位字母 / 数字 / 下划线';
            return;
        }
        if (hint) hint.textContent = '';
        _probeIdentity(typed);
    }

    function _probeIdentity(typedCode) {
        if (!M.__xhrJson) return;
        M.__xhrJson('GET', '/api/state?code=' + encodeURIComponent(typedCode), null, function (err, status, body) {
            if (err || status !== 200) {
                // Offline / unknown server response — treat as Scenario C semantics.
                M.setUserCode(typedCode);
                if (M.syncFromServer) M.syncFromServer(function () {});
                _renderHeaderStrip();
                return;
            }
            var serverData = (body && body.data) ? body.data : null;
            var serverUpdatedAt = body ? body.updatedAt : null;
            var serverHasData = false;
            if (serverData && typeof serverData === 'object') {
                for (var k in serverData) {
                    if (Object.prototype.hasOwnProperty.call(serverData, k)) {
                        serverHasData = true;
                        break;
                    }
                }
            }
            var localHas = M.__hasLocalUserState ? M.__hasLocalUserState() : false;

            if (serverHasData && !localHas) {
                // Scenario A
                M.setUserCode(typedCode);
                try { M.__applyServerBlob(serverData, serverUpdatedAt); } catch (e) {}
                try { location.reload(); } catch (e2) {}
                return;
            }
            if (!serverHasData) {
                // Scenario C (server null/empty; local may or may not exist)
                M.setUserCode(typedCode);
                if (M.syncToServer) M.syncToServer();
                _renderHeaderStrip();
                return;
            }
            // Scenario D — both non-empty
            _renderConflictModal(typedCode, serverData, serverUpdatedAt);
        });
    }

    // ---------- Scenario D conflict modal ----------
    function _renderConflictModal(typedCode, cloudBlob, cloudUpdatedAt) {
        var localBlob = _collectLocalBlobLite();
        var localTs = _localUpdatedAt();
        var cloudSummary = _computeSummary(cloudBlob);
        var localSummary = _computeSummary(localBlob);
        var cloudTime = _formatStamp(cloudUpdatedAt) || '未知时间';
        var localTime = _formatStamp(localTs) || '未知时间';

        var wrap = _el('div');
        wrap.innerHTML = ''
            + '<h3>账号已有云端进度</h3>'
            + '<p>你输入的账号 <b class="mystar-modal__code"></b> 已存在云端记录，本机也有未上传的进度。请选择：</p>'
            + '<div class="mystar-modal__compare">'
                + '<div class="mystar-modal__col"><h4>云端</h4><p class="mystar-modal__time"></p><p class="mystar-modal__sum"></p></div>'
                + '<div class="mystar-modal__col"><h4>本机</h4><p class="mystar-modal__time"></p><p class="mystar-modal__sum"></p></div>'
            + '</div>'
            + '<div class="mystar-modal__actions">'
                + '<button class="mystar-modal__cta--cloud-wins" type="button">用云端覆盖本地</button>'
                + '<button class="mystar-modal__cta--local-wins" type="button">用本地覆盖云端</button>'
                + '<button class="mystar-modal__cta--cancel" type="button">取消</button>'
            + '</div>';
        var codeBold = wrap.querySelector('.mystar-modal__code');
        if (codeBold) codeBold.textContent = typedCode;
        var cols = wrap.querySelectorAll('.mystar-modal__col');
        if (cols && cols.length >= 2) {
            cols[0].querySelector('.mystar-modal__time').textContent = cloudTime;
            cols[0].querySelector('.mystar-modal__sum').textContent = cloudSummary;
            cols[1].querySelector('.mystar-modal__time').textContent = localTime;
            cols[1].querySelector('.mystar-modal__sum').textContent = localSummary;
        }

        var cancelFn = function () { _closeModal(); };
        _openModal(wrap, cancelFn);

        var cloudWinsBtn = wrap.querySelector('.mystar-modal__cta--cloud-wins');
        var localWinsBtn = wrap.querySelector('.mystar-modal__cta--local-wins');
        var cancelBtn = wrap.querySelector('.mystar-modal__cta--cancel');
        if (cloudWinsBtn && M.addTapListener) {
            M.addTapListener(cloudWinsBtn, function () {
                M.setUserCode(typedCode);
                try { M.__applyServerBlob(cloudBlob, cloudUpdatedAt); } catch (e) {}
                _closeModal();
                try { location.reload(); } catch (e2) {}
            });
        }
        if (localWinsBtn && M.addTapListener) {
            M.addTapListener(localWinsBtn, function () {
                M.setUserCode(typedCode);
                if (M.touchLocalUpdatedAt) {
                    try { M.touchLocalUpdatedAt(); } catch (e) {}
                }
                if (M.syncToServer) M.syncToServer();
                _closeModal();
                _renderHeaderStrip();
            });
        }
        if (cancelBtn && M.addTapListener) {
            M.addTapListener(cancelBtn, cancelFn);
        }
    }

    // ---------- R9 clear-cloud flow ----------
    function _onClearCloudTapped() {
        var code = M.getUserCode();
        if (!code) return;
        var wrap = _el('div');
        wrap.innerHTML = ''
            + '<h3>确认删除云端进度</h3>'
            + '<p>这将永久删除云端账号 <b class="mystar-modal__code"></b> 的所有进度。本机数据不会被清除。确认？</p>'
            + '<div class="mystar-modal__actions">'
                + '<button class="mystar-modal__cta--cloud-wins mystar-modal__cta--danger" type="button">确认删除</button>'
                + '<button class="mystar-modal__cta--cancel" type="button">取消</button>'
            + '</div>';
        var codeEl = wrap.querySelector('.mystar-modal__code');
        if (codeEl) codeEl.textContent = code;

        var cancelFn = function () { _closeModal(); };
        _openModal(wrap, cancelFn);

        var confirmBtn = wrap.querySelector('.mystar-modal__cta--cloud-wins');
        var cancelBtn = wrap.querySelector('.mystar-modal__cta--cancel');
        if (confirmBtn && M.addTapListener) {
            M.addTapListener(confirmBtn, function () {
                if (!M.__deleteCloudData) {
                    _closeModal();
                    _showToast('删除失败，请稍后重试');
                    return;
                }
                M.__deleteCloudData(function (err, status) {
                    _closeModal();
                    if (status === 204) {
                        _showToast('已删除云端进度');
                    } else {
                        _showToast('删除失败，请稍后重试');
                    }
                    _renderHeaderStrip();
                });
            });
        }
        if (cancelBtn && M.addTapListener) {
            M.addTapListener(cancelBtn, cancelFn);
        }
    }

    // ---------- Wire callback slots ----------
    M.__onSyncStatus = function (status) {
        var statusEl = document.querySelector('.mystar-userbar__status');
        if (!statusEl) return;
        _renderStatusInto(statusEl, status);
    };
    M.__onToast = _showToast;

    // ---------- Boot ----------
    function _boot() {
        _renderHeaderStrip();
        if (_statusRefreshTimer) clearInterval(_statusRefreshTimer);
        _statusRefreshTimer = setInterval(function () {
            if (M.__onSyncStatus && M.getSyncStatus) {
                try { M.__onSyncStatus(M.getSyncStatus()); } catch (e) {}
            }
        }, 30000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _boot);
    } else {
        _boot();
    }

    window.addEventListener('beforeunload', function () {
        if (_statusRefreshTimer) {
            clearInterval(_statusRefreshTimer);
            _statusRefreshTimer = null;
        }
    });
})();
