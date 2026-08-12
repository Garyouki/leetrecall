// Shared daily review queue logic for the extension UI and service worker.
(function initReviewQueue(global) {
  "use strict";

  const DEFAULT_DAILY_REVIEW_LIMIT = 6;
  const MIN_DAILY_REVIEW_LIMIT = 1;
  const MAX_DAILY_REVIEW_LIMIT = 20;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const BASE_RANDOM_WEIGHT = 0.05;

  function startOfDay(value) {
    const date = value instanceof Date ? new Date(value) : new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function isValidDate(value) {
    return value instanceof Date && !Number.isNaN(value.getTime());
  }

  function calendarDayNumber(value) {
    const date = startOfDay(value);
    if (!isValidDate(date)) return null;
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
  }

  function daysSince(value, today) {
    const valueDay = calendarDayNumber(value);
    const todayDay = calendarDayNumber(today);
    if (valueDay === null || todayDay === null) return 0;
    return Math.max(0, todayDay - valueDay);
  }

  function getDailyReviewLimit(reviewSettings) {
    const rawLimit = Number(reviewSettings?.dailyLimit);
    if (!Number.isInteger(rawLimit)) return DEFAULT_DAILY_REVIEW_LIMIT;
    return Math.min(MAX_DAILY_REVIEW_LIMIT, Math.max(MIN_DAILY_REVIEW_LIMIT, rawLimit));
  }

  function getProficiencyLabel(card) {
    const repetition = Number.isFinite(card?.repetition) ? card.repetition : 0;
    const easeFactor = Number.isFinite(card?.easeFactor) ? card.easeFactor : 2.5;

    if (repetition === 0) return "Novice";
    if (repetition <= 3 || easeFactor < 1.8) return "Learning";
    if (repetition <= 5 && easeFactor < 2.3) return "Familiar";
    if (repetition <= 5 && easeFactor >= 2.3) return "Proficient";
    if (repetition >= 6 && easeFactor >= 2.3) return "Mastered";
    return "Familiar";
  }

  function getWeakness(card) {
    const byProficiency = {
      Novice: 1,
      Learning: 0.75,
      Familiar: 0.5,
      Proficient: 0.25,
      Mastered: 0
    };
    return byProficiency[getProficiencyLabel(card)];
  }

  function getHistory(card) {
    return Array.isArray(card?.history) ? card.history : [];
  }

  function getLatestHistoryDate(card, predicate) {
    let latest = null;
    getHistory(card).forEach(entry => {
      if (predicate && !predicate(entry)) return;
      const date = new Date(entry?.date);
      if (!isValidDate(date)) return;
      if (!latest || date > latest) latest = date;
    });

    if (!latest && !predicate) {
      const fallback = new Date(card?.lastPerformance?.date);
      if (isValidDate(fallback)) latest = fallback;
    }

    return latest;
  }

  function getPriority(card, nowValue) {
    const today = startOfDay(nowValue || new Date());
    const nextReview = new Date(card?.nextReview);
    const overdue = isValidDate(nextReview)
      ? Math.min(daysSince(nextReview, today) / 7, 1)
      : 0;
    const weakness = getWeakness(card);
    const latestNegative = getLatestHistoryDate(
      card,
      entry => entry?.quality === 0 || entry?.viewedSolution === true
    );
    const recentFailure = latestNegative
      ? Math.exp(-daysSince(latestNegative, today) / 7)
      : 0;
    const latestTouch = getLatestHistoryDate(card);
    const untouched = latestTouch
      ? Math.min(daysSince(latestTouch, today) / 30, 1)
      : 0;

    return 0.4 * overdue + 0.25 * weakness + 0.2 * recentFailure + 0.15 * untouched;
  }

  function getDueProblems(problems, nowValue) {
    const today = startOfDay(nowValue || new Date());
    const todayDay = calendarDayNumber(today);
    return (Array.isArray(problems) ? problems : []).filter(card => {
      const nextReview = new Date(card?.nextReview);
      const nextReviewDay = calendarDayNumber(nextReview);
      return nextReviewDay !== null && nextReviewDay <= todayDay;
    });
  }

  function isDue(card, nowValue) {
    return getDueProblems([card], nowValue).length === 1;
  }

  function compareByPriority(first, second, nowValue) {
    const scoreDifference = getPriority(second, nowValue) - getPriority(first, nowValue);
    if (Math.abs(scoreDifference) > Number.EPSILON) return scoreDifference;

    const firstDate = new Date(first?.nextReview).getTime();
    const secondDate = new Date(second?.nextReview).getTime();
    if (firstDate !== secondDate) return firstDate - secondDate;
    return String(first?.id || "").localeCompare(String(second?.id || ""));
  }

  function getDailyReviewQueue(problems, reviewSettings, nowValue) {
    const storedQueue = getStoredDailyReviewQueue(problems, reviewSettings, nowValue);
    if (storedQueue) return storedQueue;

    const limit = getDailyReviewLimit(reviewSettings);
    const duePool = getDuePool(problems, nowValue);
    const seed = getDailyQueueSeed(duePool, limit, nowValue);
    return getWeightedReviewQueue(duePool, limit, nowValue, createSeededRandom(seed));
  }

  // A daily snapshot keeps the chosen set fixed while submissions change the
  // due pool. Completed cards are omitted, but no replacement card is added.
  function getStoredDailyReviewQueue(problems, reviewSettings, nowValue) {
    const snapshot = reviewSettings?.dailyQueue;
    if (!snapshot || snapshot.day !== getCalendarDayKey(nowValue) || !Array.isArray(snapshot.ids)) {
      return null;
    }

    const cardsById = new Map((Array.isArray(problems) ? problems : []).map(card => [card.id, card]));
    return snapshot.ids
      .map(id => cardsById.get(id))
      .filter(card => card && isDue(card, nowValue));
  }

  function createDailyQueueSnapshot(problems, reviewSettings, nowValue) {
    const date = nowValue || new Date();
    return {
      day: getCalendarDayKey(date),
      ids: getDailyReviewQueue(problems, { ...reviewSettings, dailyQueue: null }, date)
        .map(card => card.id)
    };
  }

  function getCalendarDayKey(value) {
    const date = startOfDay(value || new Date());
    if (!isValidDate(date)) return null;
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  }

  function getDuePool(problems, nowValue) {
    return getDueProblems(problems, nowValue)
      .sort((first, second) => compareByPriority(first, second, nowValue));
  }

  function getWeightedReviewQueue(cards, limit, nowValue, random = Math.random) {
    const remaining = Array.isArray(cards) ? [...cards] : [];
    const queue = [];
    const queueLimit = Math.min(Math.max(0, limit), remaining.length);

    while (queue.length < queueLimit) {
      const weights = remaining.map(card => BASE_RANDOM_WEIGHT + Math.max(0, getPriority(card, nowValue)));
      const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
      let draw = random() * totalWeight;
      let selectedIndex = weights.length - 1;

      for (let index = 0; index < weights.length; index += 1) {
        draw -= weights[index];
        if (draw <= 0) {
          selectedIndex = index;
          break;
        }
      }

      queue.push(remaining.splice(selectedIndex, 1)[0]);
    }

    return queue;
  }

  function getDailyQueueSeed(cards, limit, nowValue) {
    const day = calendarDayNumber(nowValue || new Date());
    const ids = (Array.isArray(cards) ? cards : [])
      .map(card => String(card?.id || ""))
      .sort()
      .join("|");
    return `${day}:${limit}:${ids}`;
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function createSeededRandom(seedValue) {
    let state = hashString(String(seedValue));
    return function seededRandom() {
      state = Math.imul(state + 0x6d2b79f5, 1);
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  global.LeetRecallReviewQueue = Object.freeze({
    DEFAULT_DAILY_REVIEW_LIMIT,
    MIN_DAILY_REVIEW_LIMIT,
    MAX_DAILY_REVIEW_LIMIT,
    getDailyReviewLimit,
    getProficiencyLabel,
    getPriority,
    isDue,
    getDueProblems,
    getDuePool,
    getWeightedReviewQueue,
    getStoredDailyReviewQueue,
    createDailyQueueSnapshot,
    createSeededRandom,
    getDailyReviewQueue
  });

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.LeetRecallReviewQueue;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
