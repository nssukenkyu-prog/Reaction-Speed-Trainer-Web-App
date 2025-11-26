import { db, collection, addDoc, query, where, orderBy, limit, getDocs, serverTimestamp, auth } from './firebase-init.js';

class ReactionApp {
    constructor() {
        this.currentLevel = 1;
        this.trials = [];
        this.maxTrials = 5;
        this.gameState = 'idle';
        this.stimulusStart = 0;
        this.timeoutIds = [];
        this.nickname = localStorage.getItem('reaction_nickname') || '';

        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();

        // UI Elements
        this.screens = {
            setup: document.getElementById('setup-screen'),
            game: document.getElementById('game-screen'),
            result: document.getElementById('result-screen'),
            ranking: document.getElementById('ranking-screen')
        };

        this.els = {
            stimulusDisplay: document.getElementById('stimulus-display'),
            stimulusIcon: document.getElementById('stimulus-icon'),
            mathModal: document.getElementById('math-modal'),
            nicknameInput: document.getElementById('nickname-input'),
            swipeHints: document.getElementById('swipe-hints')
        };

        // Init Nickname
        this.els.nicknameInput.value = this.nickname;
        this.els.nicknameInput.addEventListener('change', (e) => {
            this.nickname = e.target.value.trim();
            localStorage.setItem('reaction_nickname', this.nickname);
        });

        // Input Bindings
        this.els.stimulusDisplay.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });
        this.els.stimulusDisplay.addEventListener('touchend', (e) => this.handleTouchEnd(e), { passive: false });
        this.els.stimulusDisplay.addEventListener('mousedown', (e) => this.handleClick(e));

        this.touchStartX = 0;
    }

    // --- Navigation ---
    showScreen(name) {
        Object.values(this.screens).forEach(s => s.classList.remove('active'));
        this.screens[name].classList.add('active');
    }

    toTitle() {
        this.showScreen('setup');
    }

    toggleScoreDetail() {
        const el = document.getElementById('score-detail');
        el.classList.toggle('hidden');
    }

    // --- Audio ---
    playBeep() {
        if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.frequency.value = 880;
        gain.gain.value = 0.1;
        osc.start();
        osc.stop(this.audioCtx.currentTime + 0.1);
    }

    // --- Game Logic ---
    startLevel(level) {
        if (!this.nickname) {
            // Optional: Force nickname? For now, allow empty (Anonymous)
        }

        this.currentLevel = level;
        this.trials = [];
        this.gameState = 'idle';

        const trialCounts = { 1: 5, 2: 5, 3: 7, 4: 8, 5: 10, 6: 10 };
        this.maxTrials = trialCounts[level];

        this.showScreen('game');
        document.getElementById('game-level-indicator').textContent = `LV.${level}`;

        // Reset UI
        this.resetStimulus();
        this.els.mathModal.classList.add('hidden');
        this.els.swipeHints.classList.toggle('hidden', level !== 6);

        this.startCountdown();
    }

    retryLevel() {
        this.startLevel(this.currentLevel);
    }

    resetStimulus() {
        this.els.stimulusDisplay.className = '';
        this.els.stimulusIcon.textContent = '';
    }

    startCountdown() {
        this.resetStimulus();
        this.els.stimulusIcon.textContent = '3';
        let count = 3;

        const tick = () => {
            count--;
            if (count > 0) {
                this.els.stimulusIcon.textContent = count;
                this.timeoutIds.push(setTimeout(tick, 1000));
            } else {
                this.els.stimulusIcon.textContent = '';
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
        this.resetStimulus();

        const minDelay = this.currentLevel === 5 ? 800 : 1000;
        const maxDelay = this.currentLevel === 5 ? 1500 : 3000;
        const delay = Math.random() * (maxDelay - minDelay) + minDelay;

        this.timeoutIds.push(setTimeout(() => this.presentStimulus(), delay));
    }

    presentStimulus() {
        this.gameState = 'reaction';
        this.stimulusStart = performance.now();
        this.currentStimulus = this.generateStimulus(this.currentLevel);

        // Visual
        if (this.currentStimulus.color) {
            this.els.stimulusDisplay.classList.add(`stimulus-${this.currentStimulus.color}`);
        }

        // Audio
        if (this.currentStimulus.sound) {
            this.playBeep();
            if (!this.currentStimulus.color) {
                this.els.stimulusIcon.textContent = '♪';
            }
        }
    }

    generateStimulus(level) {
        const r = Math.random();
        switch (level) {
            case 1: return { type: 'go', color: 'green', sound: false };
            case 2: return { type: 'go', color: null, sound: true };
            case 3: return r > 0.5 ? { type: 'go', color: 'green', sound: false } : { type: 'go', color: null, sound: true };
            case 4: return r > 0.7 ? { type: 'no-go', color: 'red', sound: false } : { type: 'go', color: 'green', sound: false };
            case 5: return { type: 'go', color: 'green', sound: false };
            case 6:
                if (r < 0.4) return { type: 'go', color: 'green', sound: true };
                if (r < 0.7) return { type: 'left', color: 'red', sound: true };
                return { type: 'right', color: 'blue', sound: false };
        }
    }

    // --- Input Handling ---
    handleClick(e) {
        if (this.currentLevel === 6) return; // Lv6 uses swipes (touch)
        this.processInput('tap');
    }

    handleTouchStart(e) {
        if (this.gameState !== 'reaction' && this.gameState !== 'waiting') return;
        this.touchStartX = e.changedTouches[0].screenX;

        if (this.currentLevel < 6) {
            e.preventDefault(); // Prevent ghost clicks
            this.processInput('tap');
        }
    }

    handleTouchEnd(e) {
        if (this.currentLevel !== 6) return;
        if (this.gameState !== 'reaction' && this.gameState !== 'waiting') return;

        const touchEndX = e.changedTouches[0].screenX;
        const diffX = touchEndX - this.touchStartX;

        let action = 'tap';
        if (Math.abs(diffX) > 40) {
            action = diffX > 0 ? 'right' : 'left';
        }
        this.processInput(action);
    }

    processInput(action) {
        if (this.gameState === 'waiting') {
            this.handleFalseStart();
            return;
        }
        if (this.gameState !== 'reaction') return;

        const reactionTime = performance.now() - this.stimulusStart;
        const target = this.currentStimulus.type;

        let isCorrect = false;
        let isMiss = false;

        if (target === 'no-go') {
            isCorrect = false;
            isMiss = true;
        } else if (target === 'go' && action === 'tap') {
            isCorrect = true;
        } else if (target === 'left' && action === 'left') {
            isCorrect = true;
        } else if (target === 'right' && action === 'right') {
            isCorrect = true;
        } else {
            isCorrect = false;
            isMiss = true;
        }

        const trialData = { reactionTime, isCorrect, isMiss };

        if (this.currentLevel >= 5) {
            this.gameState = 'math';
            this.showMathProblem(trialData);
        } else {
            this.trials.push(trialData);
            this.nextTrial();
        }
    }

    handleFalseStart() {
        this.timeoutIds.forEach(clearTimeout);
        this.timeoutIds = [];
        this.els.stimulusDisplay.style.background = '#ef4444'; // Red flash
        setTimeout(() => {
            this.trials.push({ reactionTime: null, isCorrect: false, isMiss: true });
            this.nextTrial();
        }, 500);
    }

    // --- Math Logic ---
    showMathProblem(trialData) {
        this.els.mathModal.classList.remove('hidden');

        let q, a;
        if (this.currentLevel === 5) {
            const n1 = Math.floor(Math.random() * 9) + 1;
            const n2 = Math.floor(Math.random() * 9) + 1;
            q = `${n1} + ${n2}`;
            a = n1 + n2;
        } else {
            const n1 = Math.floor(Math.random() * 9) + 1;
            const n2 = Math.floor(Math.random() * 9) + 1;
            q = `${n1} × ${n2}`;
            a = n1 * n2;
        }

        document.getElementById('math-q').textContent = q;
        const container = document.getElementById('math-options');
        container.innerHTML = '';

        const options = [a, a + 1, a - 1, a + 2].sort(() => Math.random() - 0.5);
        options.forEach(opt => {
            const btn = document.createElement('button');
            btn.className = 'math-opt';
            btn.textContent = opt;
            btn.onclick = () => {
                trialData.mathCorrect = (opt === a);
                this.trials.push(trialData);
                this.els.mathModal.classList.add('hidden');
                this.nextTrial();
            };
            container.appendChild(btn);
        });
    }

    // --- Scoring ---
    finishGame() {
        this.gameState = 'finished';
        this.showScreen('result');

        const valid = this.trials.filter(t => t.isCorrect && t.reactionTime);
        const avg = valid.length ? valid.reduce((a, b) => a + b.reactionTime, 0) / valid.length : 0;
        const correctCount = this.trials.filter(t => t.isCorrect && t.mathCorrect !== false).length;
        const missCount = this.trials.filter(t => t.isMiss || t.mathCorrect === false).length;
        const accuracy = correctCount / this.trials.length;

        const multipliers = { 1: 1.0, 2: 1.2, 3: 1.4, 4: 1.6, 5: 1.8, 6: 2.0 };
        const mult = multipliers[this.currentLevel];

        let penalty = missCount * (this.currentLevel === 6 ? 1000 : 500);
        let bonus = 0;

        // SD Bonus for Lv5
        if (this.currentLevel === 5 && valid.length > 1) {
            const variance = valid.reduce((a, b) => a + Math.pow(b.reactionTime - avg, 2), 0) / valid.length;
            if (Math.sqrt(variance) < 50) bonus = 1000;
        }

        let score = 0;
        if (avg > 0) {
            score = Math.floor(((10000 / avg) * accuracy * mult * 1000) - penalty + bonus);
        }
        score = Math.max(0, score);

        // Render
        document.getElementById('final-score').textContent = score;
        document.getElementById('res-time').textContent = `${Math.round(avg)} ms`;
        document.getElementById('res-acc').textContent = `${Math.round(accuracy * 100)}%`;
        document.getElementById('res-miss').textContent = missCount;
        document.getElementById('res-rank').textContent = '...';

        this.saveScore(score, avg, correctCount, missCount);
    }

    async saveScore(score, avg, correct, miss) {
        const user = auth.currentUser;
        if (!user) return;

        try {
            await addDoc(collection(db, "scores"), {
                userId: user.uid,
                nickname: this.nickname || "Anonymous",
                mode: "simple_reaction",
                level: this.currentLevel,
                score,
                avgReaction: avg,
                correctCount: correct,
                wrongCount: miss,
                trialCount: this.trials.length,
                createdAt: serverTimestamp()
            });
            console.log("Score saved");
            this.getPersonalRank(score);
        } catch (e) {
            console.error(e);
        }
    }

    async getPersonalRank(myScore) {
        // Simple client-side estimation or separate query could be done here.
        // For now, we'll just leave it as '...' or implement a count query if needed.
        // Given Firestore constraints, exact rank is hard without aggregation.
        // We will just show "Saved" for now.
        document.getElementById('res-rank').textContent = 'Saved';
    }

    // --- Ranking ---
    showRanking() {
        this.showScreen('ranking');
        this.loadRanking(1);
    }

    async loadRanking(level) {
        const table = document.getElementById('ranking-table');
        table.innerHTML = '<tr><td>Loading...</td></tr>';

        const q = query(
            collection(db, "scores"),
            where("mode", "==", "simple_reaction"),
            where("level", "==", parseInt(level)),
            orderBy("score", "desc"),
            limit(20)
        );

        try {
            const snap = await getDocs(q);
            let html = `<tr><th>順位</th><th>名前</th><th>スコア</th><th>タイム</th></tr>`;

            let rank = 1;
            snap.forEach(doc => {
                const d = doc.data();
                const isMe = auth.currentUser && d.userId === auth.currentUser.uid;
                const rankClass = rank <= 3 ? `rank-${rank}` : '';

                html += `<tr class="${isMe ? 'my-rank' : ''}">
                    <td class="${rankClass}">#${rank}</td>
                    <td>${d.nickname || 'Anonymous'}</td>
                    <td style="font-weight:bold; color:white;">${d.score}</td>
                    <td>${Math.round(d.avgReaction)}ms</td>
                </tr>`;
                rank++;
            });
            table.innerHTML = html;
        } catch (e) {
            console.error(e);
            table.innerHTML = '<tr><td>Error loading ranking. Check console.</td></tr>';
        }
    }
}

window.app = new ReactionApp();
