// LeetRecall scheduling core.
// This file is loaded by the background service worker with importScripts().

(function initScheduler(global) {
  "use strict";

  function computeQuality(performance) {
    if (performance.viewedSolution) return 0;
    if (!performance.solved) return 0;

    const { time, attempts } = performance;
    if (time < 15 && attempts === 1) return 5;
    if (time <= 30 && attempts === 1) return 4;
    if (attempts <= 2) return 3;
    if (attempts <= 4) return 2;
    return 1;
  }

  // A successful solve should always leave some space for forgetting, even
  // when it took several attempts. Attempts affect fluency, but do not erase
  // the fact that the problem was eventually solved without viewing a solution.
  function getStartingInterval(quality) {
    if (quality <= 2) return 1;
    if (quality === 3) return 2;
    if (quality === 4) return 3;
    return 5;
  }

  function sm2(card, quality, now) {
    card.easeFactor = Math.max(
      1.3,
      card.easeFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)
    );

    if (quality === 0) {
      card.repetition = 0;
      card.interval = 0;
    } else if (quality < 3) {
      // A difficult but ultimately successful solve starts a short relearning
      // step instead of remaining due forever on the same day.
      card.repetition = 1;
      card.interval = 1;
    } else {
      card.repetition += 1;
      const startingInterval = getStartingInterval(quality);
      if (card.repetition === 1) {
        card.interval = startingInterval;
      } else {
        card.interval = Math.max(
          startingInterval,
          Math.round(Math.max(1, card.interval) * card.easeFactor)
        );
      }
    }

    const next = new Date(now);
    next.setDate(next.getDate() + card.interval);
    next.setHours(0, 0, 0, 0);
    card.nextReview = next.toISOString();

    return card;
  }

  function migrateSuccessfulSameDayCards(problems) {
    let changed = false;
    const nextProblems = (Array.isArray(problems) ? problems : []).map(card => {
      const history = Array.isArray(card.history) ? card.history : [];
      const latest = history[history.length - 1];
      const wasDifficultIndependentSolve =
        card.interval === 0 &&
        latest?.solved === true &&
        latest.viewedSolution === false &&
        (latest.quality === 1 || latest.quality === 2);

      if (!wasDifficultIndependentSolve) return card;

      const next = new Date(latest.date || card.nextReview);
      if (Number.isNaN(next.getTime())) return card;

      next.setDate(next.getDate() + 1);
      next.setHours(0, 0, 0, 0);
      changed = true;
      return {
        ...card,
        interval: 1,
        repetition: 1,
        nextReview: next.toISOString()
      };
    });

    return { problems: nextProblems, changed };
  }

  function scheduleForTomorrow(problems, problemIds, nowValue) {
    const selectedIds = new Set(Array.isArray(problemIds) ? problemIds : []);
    if (!selectedIds.size) return { problems, updatedCount: 0, nextReview: null };

    const tomorrow = nowValue ? new Date(nowValue) : new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const nextReview = tomorrow.toISOString();
    let updatedCount = 0;

    const nextProblems = (Array.isArray(problems) ? problems : []).map(card => {
      if (!selectedIds.has(card.id)) return card;
      updatedCount += 1;
      return { ...card, nextReview };
    });

    return { problems: nextProblems, updatedCount, nextReview };
  }

  /**
   * Applies one submission to the current problems array.
   * Existing cards keep the same schema; new history fields are additive so
   * data created by older extension versions remains valid.
   */
  function applyReview(problems, problemData, performance, submissionId, nowValue) {
    const currentProblems = Array.isArray(problems) ? problems : [];
    const now = nowValue ? new Date(nowValue) : new Date();
    const nowIso = now.toISOString();

    if (submissionId) {
      const duplicate = currentProblems.some(problem =>
        (problem.history || []).some(entry => entry.submissionId === submissionId)
      );

      if (duplicate) {
        return { problems: currentProblems, card: null, duplicate: true };
      }
    }

    const quality = computeQuality(performance);
    const nextProblems = [...currentProblems];
    const existingIdx = nextProblems.findIndex(problem => problem.id === problemData.id);

    let card;
    if (existingIdx === -1) {
      card = {
        id: problemData.id,
        title: problemData.title,
        url: problemData.url,
        interval: 0,
        repetition: 0,
        easeFactor: 2.5,
        nextReview: nowIso,
        history: []
      };
    } else {
      card = { ...nextProblems[existingIdx] };
      card.history = [...(card.history || [])];
      card.interval = Number.isFinite(card.interval) ? card.interval : 0;
      card.repetition = Number.isFinite(card.repetition) ? card.repetition : 0;
      card.easeFactor = Number.isFinite(card.easeFactor) ? card.easeFactor : 2.5;
    }

    card.history.push({
      date: nowIso,
      submissionId: submissionId || undefined,
      quality,
      solved: performance.solved,
      time: performance.time,
      attempts: performance.attempts,
      viewedSolution: performance.viewedSolution
    });

    card = sm2(card, quality, now);
    card.lastPerformance = {
      solved: performance.solved,
      time: performance.time,
      attempts: performance.attempts,
      viewedSolution: performance.viewedSolution,
      date: nowIso,
      submissionId: submissionId || undefined
    };

    if (existingIdx === -1) nextProblems.push(card);
    else nextProblems[existingIdx] = card;

    return { problems: nextProblems, card, quality, duplicate: false };
  }

  global.LeetRecallScheduler = {
    migrateSuccessfulSameDayCards,
    scheduleForTomorrow,
    applyReview
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.LeetRecallScheduler;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
