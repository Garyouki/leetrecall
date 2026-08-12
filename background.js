// LeetRecall service worker.

importScripts("scheduler.js", "review-queue.js");

console.log("LeetRecall: background service worker started");

// chrome.storage.local has no atomic read-modify-write operation. Route every
// submission through one background queue so writes from different tabs cannot
// overwrite each other.
let submissionWriteQueue = Promise.resolve();

function getProblems() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get({ problems: [] }, result => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result.problems || []);
    });
  });
}

function getReviewState() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get({ problems: [], reviewSettings: {} }, result => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve({ problems: result.problems || [], reviewSettings: result.reviewSettings || {} });
    });
  });
}

function setProblems(problems) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ problems }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function setReviewState(problems, reviewSettings) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ problems, reviewSettings }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function ensureDailyQueueSnapshot(problems, reviewSettings, now = new Date()) {
  const existing = reviewSettings.dailyQueue;
  const today = LeetRecallReviewQueue.createDailyQueueSnapshot([], {}, now).day;
  if (existing?.day === today && Array.isArray(existing.ids)) return reviewSettings;

  return {
    ...reviewSettings,
    dailyQueue: LeetRecallReviewQueue.createDailyQueueSnapshot(problems, reviewSettings, now)
  };
}

async function migrateStoredSchedules() {
  const problems = await getProblems();
  const migration = LeetRecallScheduler.migrateSuccessfulSameDayCards(problems);
  if (!migration.changed) return;

  await setProblems(migration.problems);
  console.log("LeetRecall: migrated successful same-day reviews to one-day intervals");
}

// Run migrations through the same queue as submissions so an update cannot
// overwrite a submission arriving at the same time.
submissionWriteQueue = migrateStoredSchedules().catch(error => {
  console.error("LeetRecall: failed to migrate stored schedules", error);
});

async function recordSubmission(payload) {
  if (!payload?.problemData?.id || !payload?.performance) {
    throw new Error("Invalid submission payload");
  }

  const { problems, reviewSettings } = await getReviewState();
  // Snapshot before applying the submission. This prevents the submitted card
  // from changing today's six-card selection.
  const settingsWithQueue = ensureDailyQueueSnapshot(problems, reviewSettings);
  const result = LeetRecallScheduler.applyReview(
    problems,
    payload.problemData,
    payload.performance,
    payload.submissionId
  );

  if (result.duplicate) {
    console.log("LeetRecall: duplicate submission ignored", payload.submissionId);
    return { duplicate: true };
  }

  await setReviewState(result.problems, settingsWithQueue);
  console.log("LeetRecall: submission saved", {
    submissionId: payload.submissionId,
    title: result.card.title,
    solved: payload.performance.solved,
    quality: result.quality,
    nextReview: result.card.nextReview
  });

  return {
    duplicate: false,
    nextReview: result.card.nextReview,
    quality: result.quality
  };
}

async function scheduleTomorrow(problemIds) {
  if (!Array.isArray(problemIds) || !problemIds.length) {
    throw new Error("Select at least one problem");
  }

  const problems = await getProblems();
  const result = LeetRecallScheduler.scheduleForTomorrow(problems, problemIds);
  if (!result.updatedCount) throw new Error("The selected problems were not found");

  await setProblems(result.problems);
  return { updatedCount: result.updatedCount, nextReview: result.nextReview };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "RECORD_SUBMISSION" && message?.type !== "SCHEDULE_TOMORROW") {
    return false;
  }

  const write = submissionWriteQueue.then(() =>
    message.type === "RECORD_SUBMISSION"
      ? recordSubmission(message.payload)
      : scheduleTomorrow(message.problemIds)
  );
  submissionWriteQueue = write.catch(error => {
    console.error("LeetRecall: failed to save submission", error);
  });

  write
    .then(result => sendResponse({ ok: true, ...result }))
    .catch(error => sendResponse({ ok: false, error: error.message }));

  return true;
});

function updateBadge() {
  chrome.storage.local.get({ problems: [], reviewSettings: {} }, ({ problems, reviewSettings }) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const settingsWithQueue = ensureDailyQueueSnapshot(problems, reviewSettings, today);
    if (settingsWithQueue !== reviewSettings) {
      chrome.storage.local.set({ reviewSettings: settingsWithQueue });
    }

    const dueCount = LeetRecallReviewQueue.getDailyReviewQueue(
      problems,
      settingsWithQueue,
      today
    ).length;

    if (dueCount > 0) {
      chrome.action.setBadgeText({ text: String(dueCount) });
      chrome.action.setBadgeBackgroundColor({ color: "#ef4743" });
    } else {
      chrome.action.setBadgeText({ text: "" });
    }
  });
}

updateBadge();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.problems || changes.reviewSettings)) {
    updateBadge();
  }
});

function getNext9am() {
  const now = new Date();
  const next = new Date(now);

  next.setHours(9, 0, 0, 0);
  if (now >= next) {
    next.setDate(next.getDate() + 1);
  }

  return next.getTime();
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("LeetRecall: extension installed/updated — setting up daily alarm");

  chrome.alarms.clear("dailyReminder", () => {
    chrome.alarms.create("dailyReminder", {
      when: getNext9am(),
      periodInMinutes: 1440
    });

    console.log("LeetRecall: daily reminder alarm set for 9am every day");
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "dailyReminder") return;

  console.log("LeetRecall: daily alarm fired — checking due problems");

  chrome.storage.local.get({ problems: [], reviewSettings: {} }, ({ problems, reviewSettings }) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const settingsWithQueue = ensureDailyQueueSnapshot(problems, reviewSettings, today);
    if (settingsWithQueue !== reviewSettings) {
      chrome.storage.local.set({ reviewSettings: settingsWithQueue });
    }

    const dueCount = LeetRecallReviewQueue.getDailyReviewQueue(
      problems,
      settingsWithQueue,
      today
    ).length;

    if (dueCount === 0) {
      console.log("LeetRecall: no problems due today — skipping notification");
      return;
    }

    const title = `LeetRecall — ${dueCount} problem${dueCount > 1 ? "s" : ""} due today`;
    const message = dueCount === 1
      ? "You have 1 problem waiting for review. Keep your streak alive!"
      : `You have ${dueCount} problems waiting for review. Don't let your streak break!`;

    chrome.notifications.create("leetrecall-daily", {
      type: "basic",
      iconUrl: "icon128.png",
      title,
      message,
      priority: 1
    });

    console.log(`LeetRecall: notification sent — ${dueCount} problems due`);
  });
});

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId !== "leetrecall-daily") return;

  chrome.notifications.clear(notificationId);
  chrome.tabs.create({
    url: chrome.runtime.getURL("index.html")
  });
});
