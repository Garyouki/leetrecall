const assert = require("node:assert/strict");
const queue = require("./review-queue.js");
const scheduler = require("./scheduler.js");

const now = new Date(2026, 7, 10, 12);

function daysFromNow(days) {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

function card(id, overrides = {}) {
  return {
    id,
    nextReview: daysFromNow(0),
    repetition: 6,
    easeFactor: 2.5,
    history: [{ date: daysFromNow(0), quality: 5, solved: true }],
    ...overrides
  };
}

assert.deepEqual(
  queue.getDailyReviewQueue([card("future", { nextReview: daysFromNow(1) })], {}, now),
  [],
  "future reviews must not fill the daily queue"
);
assert.deepEqual(
  queue.getDuePool([card("future", { nextReview: daysFromNow(1) })], now),
  [],
  "future reviews must not enter the due pool"
);
assert.equal(
  queue.getDuePool([card("future", { nextReview: daysFromNow(1) })], new Date(2026, 7, 11, 12)).length,
  1,
  "reviews enter the due pool once their scheduled day arrives"
);
assert.equal(
  queue.isDue(card("same-day", { nextReview: "2026-08-10T16:00:00.000Z" }), now),
  true,
  "reviews due later on the same calendar day are due"
);

const sevenDue = Array.from({ length: 7 }, (_, index) => card(`due-${index}`));
assert.equal(queue.getDailyReviewQueue(sevenDue, {}, now).length, 6, "default limit is six");
assert.equal(queue.getDuePool(sevenDue, now).length, 7, "due pool includes every due review");
assert.equal(
  queue.getDailyReviewQueue(sevenDue, { dailyLimit: 7 }, now).length,
  7,
  "stored limit controls queue size"
);

assert.ok(
  queue.getPriority(card("late", { nextReview: daysFromNow(-7) }), now) >
    queue.getPriority(card("recent", { nextReview: daysFromNow(-1) }), now),
  "longer overdue reviews rank higher"
);

assert.ok(
  queue.getPriority(card("weak", { repetition: 0 }), now) >
    queue.getPriority(card("mastered"), now),
  "lower proficiency ranks higher"
);

assert.ok(
  queue.getPriority(card("failed", { history: [{ date: daysFromNow(0), quality: 0, solved: false }] }), now) >
    queue.getPriority(card("clean"), now),
  "recent failures rank higher"
);

assert.ok(
  queue.getPriority(card("untouched", { history: [{ date: daysFromNow(-30), quality: 5, solved: true }] }), now) >
    queue.getPriority(card("touched"), now),
  "long-untouched reviews rank higher"
);

const tied = [
  card("later", { nextReview: "2026-08-10T16:00:00.000Z", history: [] }),
  card("earlier", { nextReview: "2026-08-10T08:00:00.000Z", history: [] })
];
assert.equal(queue.getDuePool(tied, now)[0].id, "earlier");
assert.equal(
  new Set(queue.getDailyReviewQueue(sevenDue, {}, now).map(problem => problem.id)).size,
  6,
  "daily queue samples due problems without duplicates"
);
assert.ok(
  queue.getDailyReviewQueue(sevenDue, {}, now).every(problem =>
    queue.getDuePool(sevenDue, now).some(dueProblem => dueProblem.id === problem.id)
  ),
  "daily queue only samples from the due pool"
);

const weighted = [
  card("low", { repetition: 6, easeFactor: 2.5, nextReview: daysFromNow(0) }),
  card("high", {
    repetition: 0,
    easeFactor: 1.3,
    nextReview: daysFromNow(-7),
    history: [{ date: daysFromNow(0), quality: 0, solved: false, viewedSolution: true }]
  })
];
assert.equal(
  queue.getWeightedReviewQueue(weighted, 1, now, () => 0.99)[0].id,
  "high",
  "higher priority reviews receive larger weighted-random ranges"
);

const reviewed = scheduler.applyReview(
  [card("/problems/reviewed")],
  { id: "/problems/reviewed", title: "Reviewed", url: "https://leetcode.com/problems/reviewed/" },
  { solved: true, viewedSolution: false, time: 10, attempts: 1 },
  "submission-reviewed",
  now
);
assert.equal(
  queue.getDuePool(reviewed.problems, now).some(problem => problem.id === "/problems/reviewed"),
  false,
  "successful reviews leave the due pool after nextReview moves forward"
);
assert.equal(queue.getDailyReviewLimit({ dailyLimit: 0 }), 1);
assert.equal(queue.getDailyReviewLimit({ dailyLimit: 99 }), 20);

console.log("review-queue tests passed");
