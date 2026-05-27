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

    // ---------- Active-day tracking (for streak / today count) ----------
    function pad2(n) { return n < 10 ? '0' + n : String(n); }

    function todayKey() {
        var d = new Date();
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }

    function recordActiveDay() {
        var list = readJSON('mystar_active_days');
        if (!list || Object.prototype.toString.call(list) !== '[object Array]') list = [];
        var today = todayKey();
        // Dedup.
        var seen = {};
        var out = [];
        for (var i = 0; i < list.length; i++) {
            var k = list[i];
            if (typeof k === 'string' && !seen[k]) { seen[k] = 1; out.push(k); }
        }
        if (!seen[today]) out.push(today);
        // Sort ASC (lexicographic works for YYYY-MM-DD).
        out.sort();
        // Cap to last 400.
        if (out.length > 400) out = out.slice(out.length - 400);
        writeJSON('mystar_active_days', out);
        return out;
    }

    function getActiveDays() {
        var list = readJSON('mystar_active_days');
        if (!list || Object.prototype.toString.call(list) !== '[object Array]') return [];
        return list;
    }

    // Streak: consecutive days ending at today (or yesterday if today not active).
    // Returns 0 if no recent activity within last 1 day.
    function getStreak() {
        var days = getActiveDays();
        if (!days.length) return 0;
        var set = {};
        for (var i = 0; i < days.length; i++) set[days[i]] = 1;
        var d = new Date();
        // Anchor: today if active today, else yesterday if active yesterday, else 0.
        var anchor = todayKey();
        if (!set[anchor]) {
            d.setDate(d.getDate() - 1);
            anchor = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
            if (!set[anchor]) return 0;
        }
        // Count backwards from anchor.
        var count = 0;
        var cursor = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        while (true) {
            var key = cursor.getFullYear() + '-' + pad2(cursor.getMonth() + 1) + '-' + pad2(cursor.getDate());
            if (set[key]) {
                count++;
                cursor.setDate(cursor.getDate() - 1);
            } else {
                break;
            }
        }
        return count;
    }

    function isSameLocalDay(ts) {
        if (!ts) return false;
        var d = new Date(Number(ts));
        if (isNaN(d.getTime())) return false;
        var now = new Date();
        return d.getFullYear() === now.getFullYear()
            && d.getMonth() === now.getMonth()
            && d.getDate() === now.getDate();
    }

    W.MyStar = {
        readJSON: readJSON,
        writeJSON: writeJSON,
        readNumber: readNumber,
        writeNumber: writeNumber,
        isAnswerCorrect: isAnswerCorrect,
        addTapListener: addTapListener,
        timeAgo: timeAgo,
        recordActiveDay: recordActiveDay,
        getActiveDays: getActiveDays,
        getStreak: getStreak,
        isSameLocalDay: isSameLocalDay
    };
})();
