const assert = require("node:assert/strict");
const reset = require("./review-reset.js");

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

function createWindow(url) {
  const windowObject = {
    location: new URL(url),
    history: {
      state: null,
      replaceState(state, _unused, nextUrl) {
        this.state = state;
        windowObject.location = new URL(nextUrl);
      }
    }
  };
  return windowObject;
}

function createController(overrides = {}) {
  return reset.createController({
    windowObject: overrides.windowObject || createWindow("https://leetcode.com/problems/two-sum/"),
    documentObject: overrides.documentObject || {},
    storage: overrides.storage || createStorage(),
    queryParam: "leetrecall_reset",
    resetHash: "#leetrecall-reset",
    logger: { log() {}, warn() {} },
    ...overrides
  });
}

async function run() {
  assert.equal(reset.getProblemPath("/problems/two-sum/submissions/detail/123"), "/problems/two-sum");
  assert.equal(reset.getProblemPath("/problems/two-sum/editorial/"), "/problems/two-sum");

  {
    const storage = createStorage();
    const windowObject = createWindow(
      "https://leetcode.com/problems/two-sum/?leetrecall_reset=1#leetrecall-reset"
    );
    let resetCalls = 0;
    const controller = createController({
      storage,
      windowObject,
      now: () => 1000,
      performReset: async () => {
        resetCalls += 1;
        return true;
      }
    });

    assert.equal(await controller.start(), true, "a review URL should trigger a reset");
    assert.equal(resetCalls, 1);
    assert.equal(storage.getItem(reset.STORAGE_KEY), null, "success should consume the request");
    assert.equal(windowObject.location.search, "", "the internal query flag should be hidden");
    assert.equal(windowObject.location.hash, "", "the internal hash flag should be hidden");
  }

  {
    const storage = createStorage({
      [reset.STORAGE_KEY]: JSON.stringify({
        problemPath: "/problems/two-sum",
        expiresAt: 10000
      })
    });
    const scheduled = [];
    let resetCalls = 0;
    const controller = createController({
      storage,
      now: () => 1000,
      setTimer(callback) {
        scheduled.push(callback);
        return scheduled.length;
      },
      clearTimer() {},
      performReset: async () => {
        resetCalls += 1;
        return resetCalls > 1;
      }
    });

    assert.equal(await controller.start(), false, "a failed attempt should report failure");
    assert.notEqual(storage.getItem(reset.STORAGE_KEY), null, "failure should keep the request pending");
    assert.equal(scheduled.length, 1, "failure should schedule a retry");
    assert.equal(await scheduled[0](), true, "the scheduled retry should run the reset again");
    assert.equal(resetCalls, 2);
    assert.equal(storage.getItem(reset.STORAGE_KEY), null, "a successful retry should consume the request");
  }

  {
    const storage = createStorage({
      [reset.STORAGE_KEY]: JSON.stringify({
        problemPath: "/problems/two-sum",
        expiresAt: 500
      })
    });
    let resetCalls = 0;
    const controller = createController({
      storage,
      now: () => 1000,
      performReset: async () => {
        resetCalls += 1;
        return true;
      }
    });

    assert.equal(await controller.start(), false, "an expired request should not reset");
    assert.equal(resetCalls, 0);
    assert.equal(storage.getItem(reset.STORAGE_KEY), null, "expired state should be cleaned up");
  }

  {
    let currentTime = 0;
    let dialog = null;
    let resetClicks = 0;
    let confirmClicks = 0;
    const rect = { left: 0, top: 0, width: 20, height: 20 };
    const confirmButton = {
      disabled: false,
      textContent: "Reset",
      getAttribute() { return null; },
      getBoundingClientRect() { return rect; },
      click() {
        confirmClicks += 1;
        dialog = null;
      }
    };
    const resetButton = {
      disabled: false,
      textContent: "",
      getAttribute() { return null; },
      getBoundingClientRect() { return rect; },
      querySelector() { return {}; },
      click() {
        resetClicks += 1;
        dialog = {
          querySelectorAll(selector) {
            return selector === "button" ? [confirmButton] : [];
          }
        };
      }
    };
    const icon = { closest: () => resetButton };
    const editor = {
      textContent: "draft code",
      getBoundingClientRect: () => ({ left: 0, top: 100, width: 500, height: 400 }),
      querySelector: () => null
    };
    const documentObject = {
      querySelector(selector) {
        if (selector === ".monaco-editor") return editor;
        if (selector.includes("dialog")) return dialog;
        return null;
      },
      querySelectorAll(selector) {
        if (selector.includes("arrow-rotate-left")) return [icon];
        if (selector === "button") return [resetButton];
        return [];
      }
    };
    const windowObject = createWindow(
      "https://leetcode.com/problems/two-sum/?leetrecall_reset=1"
    );
    const controller = createController({
      windowObject,
      documentObject,
      now: () => currentTime,
      wait: async milliseconds => {
        currentTime += milliseconds;
      },
      attemptTimeoutMs: 5000,
      editorStableMs: 400
    });

    assert.equal(await controller.start(), true, "a stable editor should be reset and confirmed");
    assert.equal(resetClicks, 1, "the reset button should only be clicked once per attempt");
    assert.equal(confirmClicks, 1, "the confirmation action should be clicked");
  }
}

run().then(() => {
  console.log("review-reset tests passed");
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
