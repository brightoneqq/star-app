// Shared utilities used by homepage, review page, and Unit pages.
// Keep this dependency-free and IE-safe (var, no const/let).

(function () {
    var W = window;

    // ---------- Storage (localStorage + cookie double-write) ----------
    function readJSON(key) {
        try {
            var v = localStorage.getItem(key);
            if (v) return JSON.parse(v);
        } catch (e) {}
        var m = document.cookie.match(new RegExp('(?:^|;\\s*)' + key + '=([^;]*)'));
        if (m) {
            try { return JSON.parse(decodeURIComponent(m[1])); } catch (e) {}
        }
        return null;
    }

    function writeJSON(key, value) {
        var v = JSON.stringify(value);
        try { localStorage.setItem(key, v); } catch (e) {}
        var d = new Date();
        d.setTime(d.getTime() + 10 * 365 * 24 * 60 * 60 * 1000);
        document.cookie = key + '=' + encodeURIComponent(v) + ';expires=' + d.toUTCString() + ';path=/';
    }

    function readNumber(key) {
        try {
            var v = localStorage.getItem(key);
            if (v != null) return Number(v);
        } catch (e) {}
        return null;
    }

    function writeNumber(key, value) {
        try { localStorage.setItem(key, String(value)); } catch (e) {}
    }

    // ---------- Lenient answer matching (quiz mode) ----------
    function normalize(s) {
        if (s == null) return '';
        s = String(s).toLowerCase();
        s = s.replace(/[.,!?。，！？；;]+$/g, '');
        s = s.replace(/\s+/g, ' ').trim();
        return s;
    }

    function isAnswerCorrect(input, expected) {
        var got = normalize(input);
        if (!got) return false;
        var candidates = String(expected).split('/');
        for (var i = 0; i < candidates.length; i++) {
            if (normalize(candidates[i]) === got) return true;
        }
        return false;
    }

    // ---------- Tap listener (iPad-safe: touchend + click w/ dedup) ----------
    function addTapListener(el, handler) {
        var touchMoved = false;
        var touchHandled = false;
        el.addEventListener('touchstart', function () {
            touchMoved = false;
            touchHandled = false;
        }, { passive: true });
        el.addEventListener('touchmove', function () { touchMoved = true; }, { passive: true });
        el.addEventListener('touchend', function (e) {
            if (!touchMoved) {
                touchHandled = true;
                e.preventDefault();
                handler.call(this, e);
            }
        });
        el.addEventListener('click', function (e) {
            if (!touchHandled) handler.call(this, e);
            touchHandled = false;
        });
    }

    // ---------- Time formatting ----------
    function timeAgo(ts) {
        if (!ts) return '';
        var diff = Date.now() - Number(ts);
        if (diff < 0 || isNaN(diff)) return '';
        var min = 60 * 1000;
        var hr = 60 * min;
        var day = 24 * hr;
        if (diff < min) return '刚刚';
        if (diff < hr) return Math.floor(diff / min) + ' 分钟前';
        if (diff < day) return Math.floor(diff / hr) + ' 小时前';
        if (diff < 7 * day) return Math.floor(diff / day) + ' 天前';
        var d = new Date(Number(ts));
        return (d.getMonth() + 1) + '月' + d.getDate() + '日';
    }

    W.MyStar = {
        readJSON: readJSON,
        writeJSON: writeJSON,
        readNumber: readNumber,
        writeNumber: writeNumber,
        isAnswerCorrect: isAnswerCorrect,
        addTapListener: addTapListener,
        timeAgo: timeAgo
    };
})();
