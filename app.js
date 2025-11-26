import { db, collection, addDoc, query, where, orderBy, limit, getDocs, serverTimestamp, auth } from './firebase-init.js';

class ReactionApp {
    constructor() {
        this.currentLevel = 1;
        this.trials = [];
        this.maxTrials = 5;
        this.gameState = 'idle'; // idle, waiting, reaction, math, finished
        this.stimulusStart = 0;
        this.timeoutIds = [];

        // Audio Context
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();

        // DOM Elements
        this.screens = {
            setup: document.getElementById('setup-screen'),
            game: document.getElementById('game-screen'),
            result: document.getElementById('result-screen'),
            ranking: document.getElementById('ranking-screen')
        };

        this.stimulusArea = document.getElementById('stimulus-area');
        this.stimulusText = document.getElementById('stimulus-text');
        this.mathOverlay = document.getElementById('math-overlay');

        // Bind events
        this.stimulusArea.addEventListener('touchstart', (e) => this.handleInput(e, 'touch'), { passive: false });
        this.stimulusArea.addEventListener('mousedown', (e) => this.handleInput(e, 'click'));

        // Swipe detection variables
        this.touchStartX = 0;
        this.touchStartY = 0;
    }

    // --- Navigation ---
    showScreen(name) {
        Object.values(this.screens).forEach(s => s.classList.remove('active'));
        this.screens[name].classList.add('active');
    }

    toTitle() {
        this.showScreen('setup');
    }

    // --- Audio ---
    playBeep() {
        if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.frequency.value = 880; // A5
        gain.gain.value = 0.1;
        osc.start();
        osc.stop(this.audioCtx.currentTime + 0.1);
    }

    // --- Game Logic ---
    startLevel(level) {
        this.currentLevel = level;
        this.trials = [];
        this.gameState = 'idle';

        // Set trial counts based on level
        const trialCounts = { 1: 5, 2: 5, 3: 7, 4: 8, 5: 10, 6: 10 };
        this.maxTrials = trialCounts[level];

        this.showScreen('game');
        document.getElementById('level-title').textContent = `Level ${level}`;

        // Reset UI
        this.stimulusArea.className = '';
        this.stimulusText.textContent = '';
        this.mathOverlay.style.display = 'none';

        // Show swipe hints for Lv6
        const hints = document.querySelectorAll('.swipe-hint');
        hints.forEach(h => h.classList.toggle('hidden', level !== 6));

        this.startCountdown();
    }

    retryLevel() {
        this.startLevel(this.currentLevel);
    }

    startCountdown() {
        const el = document.getElementById('countdown');
        el.classList.remove('hidden');
        let count = 3;
        el.textContent = count;

        const tick = () => {
            count--;
            if (count > 0) {
                el.textContent = count;
                this.timeoutIds.push(setTimeout(tick, 1000));
            } else {
                el.classList.add('hidden');
                this.nextTrial();
            }
        };
        this.timeoutIds.push(setTimeout(tick, 1000));
    }

    nextTrial() {
        if (this.trials.length >= this.maxTrials) {
            this.finishGame();
            return;
        }

        this.gameState = 'waiting';
        this.stimulusArea.className = '';
        this.stimulusText.textContent = '...';

        // Random delay 1-3s (Lv5 is faster: 0.8-1.5s)
        const minDelay = this.currentLevel === 5 ? 800 : 1000;
        const maxDelay = this.currentLevel === 5 ? 1500 : 3000;
        const delay = Math.random() * (maxDelay - minDelay) + minDelay;

        this.timeoutIds.push(setTimeout(() => this.presentStimulus(), delay));
    }

    presentStimulus() {
        this.gameState = 'reaction';
        this.stimulusStart = performance.now();
        this.currentStimulus = this.generateStimulus(this.currentLevel);

        // Apply visual
        if (this.currentStimulus.color) {
            this.stimulusArea.classList.add(`stimulus-${this.currentStimulus.color}`);
        }

        // Apply audio
        if (this.currentStimulus.sound) {
            this.playBeep();
        }

        // Text (optional, mostly for debugging or clarity)
        this.stimulusText.textContent = this.currentStimulus.text || '';
    }

    generateStimulus(level) {
        // Returns { type: 'go'|'no-go'|'left'|'right', color: 'green'|'red'|'blue'|null, sound: bool, text: str }
        const r = Math.random();

        switch (level) {
            case 1: // Light only
                return { type: 'go', color: 'green', sound: false };
            case 2: // Sound only
                return { type: 'go', color: null, sound: true, text: '♪' };
            case 3: // Light or Sound
                return r > 0.5
                    ? { type: 'go', color: 'green', sound: false }
                    : { type: 'go', color: null, sound: true, text: '♪' };
            case 4: // Inhibition
                return r > 0.7
                    ? { type: 'no-go', color: 'red', sound: false } // 30% No-Go
                    : { type: 'go', color: 'green', sound: false };
            case 5: // Continuous + Math
                return { type: 'go', color: 'green', sound: false };
            case 6: // Complex
                // Green+Sound -> Tap (Go)
                // Red+Sound -> Left
                // Blue+Silent -> Right
                if (r < 0.4) return { type: 'go', color: 'green', sound: true };
                if (r < 0.7) return { type: 'left', color: 'red', sound: true };
                return { type: 'right', color: 'blue', sound: false };
        }
    }

    handleInput(e, inputType) {
        if (this.gameState !== 'reaction' && this.gameState !== 'waiting') return;

        // Prevent default only if active game interaction to avoid scrolling issues elsewhere
        if (e.cancelable && this.gameState === 'reaction') e.preventDefault();

        // Swipe detection logic
        if (inputType === 'touch') {
            if (e.type === 'touchstart') {
                this.touchStartX = e.changedTouches[0].screenX;
                this.touchStartY = e.changedTouches[0].screenY;
                return; // Wait for end
            }
            // We'll handle action on touchstart for simple taps if no swipe needed?
            // Actually, to support swipes, we might need touchend.
            // But for simple reaction, touchend adds latency.
            // Strategy: For Lv6 (Swipe), use touchend. For others, use touchstart.
        }

        let action = 'tap';

        if (this.currentLevel === 6 && inputType === 'touch' && e.type !== 'touchstart') {
            // Logic handled in touchend listener attached dynamically or globally?
            // To keep it simple, let's just use a separate handler for swipes if needed.
            // Re-implementing simple swipe detection here:
            // Since we only bound touchstart, we need touchend for swipes.
        }
    }
}

// Re-implementing Input Handling for better Swipe support
const app = new ReactionApp();

// Add global touchend for swipe detection
app.stimulusArea.addEventListener('touchend', (e) => {
    if (app.gameState !== 'reaction' && app.gameState !== 'waiting') return;

    const touchEndX = e.changedTouches[0].screenX;
    const diffX = touchEndX - app.touchStartX;

    // Determine action
    let action = 'tap';
    if (Math.abs(diffX) > 50) { // Threshold
        action = diffX > 0 ? 'right' : 'left';
    }

    // If Level 6, we wait for swipe (touchend).
    // If Level 1-5, we want instant tap (touchstart).
    if (app.currentLevel === 6) {
        app.processReaction(action);
    }
}, { passive: false });

// Override handleInput for Tap-based levels (1-5)
app.handleInput = function (e, inputType) {
    if (this.gameState === 'waiting') {
        // False start
        this.processReaction('false-start');
        return;
    }

    if (this.gameState !== 'reaction') return;

    // For Lv 1-5, react on TouchStart/MouseDown immediately
    if (this.currentLevel < 6) {
        if (inputType === 'touch' && e.type === 'touchstart') {
            this.processReaction('tap');
        } else if (inputType === 'click') {
            this.processReaction('tap');
        }
    }
};

app.processReaction = function (action) {
    if (this.gameState !== 'reaction' && this.gameState !== 'waiting') return;

    const reactionTime = performance.now() - this.stimulusStart;

    // Check correctness
    const target = this.currentStimulus.type; // go, no-go, left, right
    let isCorrect = false;
    let isMiss = false;

    if (action === 'false-start') {
        isCorrect = false;
        isMiss = true; // Penalty
        // Reset timeout
        this.timeoutIds.forEach(clearTimeout);
        this.timeoutIds = [];
        alert("お手つき！"); // Simple feedback
    } else if (target === 'no-go') {
        // Should not react. If we are here, user reacted.
        isCorrect = false;
        isMiss = true;
    } else if (target === 'go' && action === 'tap') {
        isCorrect = true;
    } else if (target === 'left' && action === 'left') {
        isCorrect = true;
    } else if (target === 'right' && action === 'right') {
        isCorrect = true;
    } else {
        // Wrong action
        isCorrect = false;
        isMiss = true;
    }

    // Save trial data
    const trialData = {
        reactionTime: isCorrect ? reactionTime : null,
        isCorrect: isCorrect,
        isMiss: isMiss,
        stimulus: this.currentStimulus
    };

    // Transition
    if (this.currentLevel >= 5) {
        // Show Math
        this.gameState = 'math';
        this.showMathProblem(trialData);
    } else {
        this.trials.push(trialData);
        this.nextTrial();
    }
};

app.showMathProblem = function (trialData) {
    this.mathOverlay.style.display = 'flex';

    let q, a, options;
    if (this.currentLevel === 5) { // Addition
        const n1 = Math.floor(Math.random() * 9) + 1;
        const n2 = Math.floor(Math.random() * 9) + 1;
        q = `${n1} + ${n2}`;
        a = n1 + n2;
    } else { // Multiplication (Lv6)
        const n1 = Math.floor(Math.random() * 9) + 1;
        const n2 = Math.floor(Math.random() * 9) + 1;
        q = `${n1} × ${n2}`;
        a = n1 * n2;
    }

    // Generate options
    options = [a, a + 1, a - 1, a + 2].sort(() => Math.random() - 0.5);

    document.getElementById('math-problem').textContent = `${q} = ?`;
    const container = document.getElementById('math-options');
    container.innerHTML = '';

    options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'btn math-btn';
        btn.textContent = opt;
        btn.onclick = () => this.handleMathAnswer(opt === a, trialData);
        container.appendChild(btn);
    });
};

app.handleMathAnswer = function (isCorrect, trialData) {
    trialData.mathCorrect = isCorrect;
    this.trials.push(trialData);
    this.mathOverlay.style.display = 'none';
    this.nextTrial();
};

app.finishGame = function () {
    this.gameState = 'finished';
    this.showScreen('result');
    this.calculateScore();
};

app.calculateScore = function () {
    // Filter valid reactions
    const validReactions = this.trials.filter(t => t.isCorrect && t.reactionTime !== null);
    const avgReaction = validReactions.length > 0
        ? validReactions.reduce((a, b) => a + b.reactionTime, 0) / validReactions.length
        : 0;

    const correctCount = this.trials.filter(t => t.isCorrect && (t.mathCorrect !== false)).length;
    const missCount = this.trials.filter(t => t.isMiss || t.mathCorrect === false).length;
    const correctRate = correctCount / this.trials.length;

    // Multipliers
    const multipliers = { 1: 1.0, 2: 1.2, 3: 1.4, 4: 1.6, 5: 1.8, 6: 2.0 };
    const levelMult = multipliers[this.currentLevel];

    // Penalty
    let penalty = missCount * 500;
    if (this.currentLevel === 6) penalty = missCount * 1000;

    // Standard Deviation Bonus (Lv5)
    let sdBonus = 0;
    if (this.currentLevel === 5 && validReactions.length > 1) {
        const variance = validReactions.reduce((a, b) => a + Math.pow(b.reactionTime - avgReaction, 2), 0) / validReactions.length;
        const sd = Math.sqrt(variance);
        if (sd < 50) sdBonus = 1000;
        else if (sd < 100) sdBonus = 500;
    }

    let score = 0;
    if (avgReaction > 0) {
        score = (10000 / avgReaction) * correctRate * levelMult * 1000; // Scaled up
        score -= penalty;
        score += sdBonus;
    }
    score = Math.max(0, Math.floor(score));

    // Display
    document.getElementById('res-score').textContent = score;
    document.getElementById('res-avg').textContent = `${Math.round(avgReaction)} ms`;
    document.getElementById('res-accuracy').textContent = `${Math.round(correctRate * 100)}%`;
    document.getElementById('res-miss').textContent = missCount;

    // Save to Firebase
    this.saveScore({
        score,
        avgReaction,
        correctCount,
        wrongCount: missCount,
        trialCount: this.trials.length,
        fastest: validReactions.length ? Math.min(...validReactions.map(t => t.reactionTime)) : 0,
        slowest: validReactions.length ? Math.max(...validReactions.map(t => t.reactionTime)) : 0
    });
};

app.saveScore = async function (data) {
    const user = auth.currentUser;
    if (!user) return;

    try {
        await addDoc(collection(db, "scores"), {
            userId: user.uid,
            mode: "simple_reaction",
            level: this.currentLevel,
            ...data,
            createdAt: serverTimestamp()
        });
        console.log("Score saved!");
    } catch (e) {
        console.error("Error saving score: ", e);
    }
};

app.showRanking = function () {
    this.showScreen('ranking');
    this.loadRanking(1); // Default Lv1
};

app.loadRanking = async function (level) {
    const list = document.getElementById('ranking-list');
    list.innerHTML = '読み込み中...';

    const q = query(
        collection(db, "scores"),
        where("mode", "==", "simple_reaction"),
        where("level", "==", parseInt(level)),
        orderBy("score", "desc"),
        limit(10)
    );

    try {
        const querySnapshot = await getDocs(q);
        let html = `<table><tr><th>順位</th><th>スコア</th><th>平均反応</th><th>正答率</th><th>日付</th></tr>`;

        let rank = 1;
        querySnapshot.forEach((doc) => {
            const d = doc.data();
            const date = d.createdAt ? new Date(d.createdAt.toDate()).toLocaleDateString() : '-';
            const isMyScore = auth.currentUser && d.userId === auth.currentUser.uid;

            html += `<tr class="${isMyScore ? 'highlight-row' : ''}">
                <td>${rank}</td>
                <td>${d.score}</td>
                <td>${Math.round(d.avgReaction)} ms</td>
                <td>${Math.round((d.correctCount / d.trialCount) * 100)}%</td>
                <td>${date}</td>
            </tr>`;
            rank++;
        });
        html += '</table>';

        if (querySnapshot.empty) {
            html = '<p>まだ記録がありません。</p>';
        }

        list.innerHTML = html;
    } catch (e) {
        console.error(e);
        list.innerHTML = '<p>ランキングの取得に失敗しました。</p>';
    }
};

// Export to window for HTML access
window.app = app;
