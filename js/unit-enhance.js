// Enhances a Unit page with:
//   - Top bar ("← 主页" link)
//   - Mode tab: 复习模式 / 测验模式
//   - Quiz mode: input boxes, lenient grading, score writeback
//   - lastVisit timestamp on load
//
// Depends on window.MyStar (shared.js).
// Reads the unit slug from the URL: /units/<book>/<slug>/index.html

(function () {
    var M = window.MyStar;
    if (!M) {
        console.error('[unit-enhance] shared.js not loaded');
        return;
    }

    function detectSlug() {
        var parts = location.pathname.split('/').filter(Boolean);
        // expected: ['units', 'book1', '<slug>', 'index.html']
        var idx = parts.indexOf('units');
        if (idx >= 0 && parts.length >= idx + 3) return parts[idx + 2];
        return 'unknown';
    }

    var SLUG = detectSlug();
    var KEY_LAST = 'lastVisit_' + SLUG;
    var KEY_SCORE = 'quizScore_' + SLUG;
    var KEY_QTIME = 'quizTime_' + SLUG;

    // ---------- DOM injection ----------
    function injectTopBar() {
        var container = document.querySelector('.container');
        if (!container) return;
        var bar = document.createElement('div');
        bar.className = 'unit-topbar';
        bar.innerHTML =
            '<a href="../../../index.html" class="btn-back">← 主页</a>' +
            '<div class="mode-tabs" role="tablist">' +
            '  <button class="mode-tab active" data-mode="review">复习模式</button>' +
            '  <button class="mode-tab" data-mode="quiz">测验模式</button>' +
            '</div>';
        container.insertBefore(bar, container.firstChild);
    }

    function injectQuizBanner() {
        var existing = document.querySelector('.quiz-banner');
        if (existing) existing.remove();
        var b = document.createElement('div');
        b.className = 'quiz-banner';
        b.innerHTML = '<span class="banner-text"></span><button class="banner-retry">重新测验</button>';
        var container = document.querySelector('.container');
        container.insertBefore(b, container.querySelector('#content'));
        return b;
    }

    function injectSubmitButton() {
        var existing = document.querySelector('.quiz-submit-wrap');
        if (existing) return existing.querySelector('button');
        var wrap = document.createElement('div');
        wrap.className = 'quiz-submit-wrap';
        wrap.innerHTML = '<button class="quiz-submit">提交并查看结果</button>';
        var content = document.getElementById('content');
        content.parentNode.insertBefore(wrap, content.nextSibling);
        return wrap.querySelector('button');
    }

    function removeQuizUi() {
        var b = document.querySelector('.quiz-banner');
        if (b) b.remove();
        var s = document.querySelector('.quiz-submit-wrap');
        if (s) s.remove();
    }

    // ---------- Quiz input lifecycle ----------
    function createQuizInputs() {
        var blanks = document.querySelectorAll('.blank');
        blanks.forEach(function (blank) {
            if (blank.dataset.quizPaired === '1') return;
            var answer = blank.getAttribute('data-answer') || '';
            var input = document.createElement('input');
            input.type = 'text';
            input.className = 'quiz-input';
            input.setAttribute('data-answer', answer);
            input.autocomplete = 'off';
            input.autocapitalize = 'off';
            input.spellcheck = false;
            // Width: ~0.55em per char, clamped
            var ch = Math.max(8, Math.min(40, answer.length + 2));
            input.style.width = (ch * 0.55) + 'em';
            blank.parentNode.insertBefore(input, blank.nextSibling);
            blank.dataset.quizPaired = '1';
        });
    }

    function resetQuizInputs() {
        document.querySelectorAll('.quiz-input').forEach(function (inp) {
            inp.value = '';
            inp.classList.remove('correct', 'wrong');
            var hint = inp.nextElementSibling;
            if (hint && hint.classList && hint.classList.contains('quiz-hint')) hint.remove();
        });
    }

    function gradeQuiz() {
        var inputs = document.querySelectorAll('.quiz-input');
        var total = inputs.length;
        var correct = 0;
        inputs.forEach(function (inp) {
            var expected = inp.getAttribute('data-answer') || '';
            var ok = M.isAnswerCorrect(inp.value, expected);
            inp.classList.remove('correct', 'wrong');
            // remove previous hint
            var hint = inp.nextElementSibling;
            if (hint && hint.classList && hint.classList.contains('quiz-hint')) hint.remove();
            if (ok) {
                inp.classList.add('correct');
                correct++;
            } else {
                inp.classList.add('wrong');
                var h = document.createElement('span');
                h.className = 'quiz-hint';
                h.textContent = '✗ ' + expected;
                inp.parentNode.insertBefore(h, inp.nextSibling);
            }
        });
        var score = total > 0 ? Math.round((correct / total) * 100) : 0;
        return { score: score, correct: correct, total: total };
    }

    function showBanner(result) {
        var b = injectQuizBanner();
        b.querySelector('.banner-text').textContent =
            '本次得分 ' + result.score + '% （' + result.correct + ' / ' + result.total + ' 正确）';
        b.classList.add('visible');
        M.addTapListener(b.querySelector('.banner-retry'), function () {
            resetQuizInputs();
            b.classList.remove('visible');
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    // ---------- Mode switching ----------
    function setMode(mode) {
        document.body.classList.toggle('quiz-mode', mode === 'quiz');
        document.querySelectorAll('.mode-tab').forEach(function (t) {
            t.classList.toggle('active', t.dataset.mode === mode);
        });
        if (mode === 'quiz') {
            createQuizInputs();
            // Collapse any revealed answers from review mode to avoid spoiling
            document.querySelectorAll('.blank.revealed').forEach(function (b) {
                b.classList.remove('revealed');
            });
            document.querySelectorAll('.btn-card-toggle').forEach(function (b) {
                b.textContent = '显示答案';
            });
            var btn = injectSubmitButton();
            M.addTapListener(btn, function () {
                var result = gradeQuiz();
                M.writeNumber(KEY_SCORE, result.score);
                M.writeNumber(KEY_QTIME, Date.now());
                showBanner(result);
            });
        } else {
            // review mode: clean up
            resetQuizInputs();
            removeQuizUi();
        }
    }

    // ---------- Entry ----------
    document.addEventListener('DOMContentLoaded', function () {
        M.writeNumber(KEY_LAST, Date.now());
        injectTopBar();

        document.querySelectorAll('.mode-tab').forEach(function (tab) {
            M.addTapListener(tab, function () {
                setMode(this.dataset.mode);
            });
        });
    });
})();
