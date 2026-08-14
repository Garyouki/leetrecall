// Resilient reset handling for review links opened on LeetCode.

globalThis.LeetRecallReviewReset = (() => {
  const STORAGE_KEY = "leetrecall:auto-reset";
  const REQUEST_TIMEOUT_MS = 2 * 60 * 1000;
  const ATTEMPT_TIMEOUT_MS = 30 * 1000;
  const RETRY_DELAY_MS = 1500;
  const EDITOR_STABLE_MS = 1200;
  const RESET_LABELS = ["reset to default code definition", "reset code", "reset"];
  const CONFIRM_LABELS = ["confirm", "reset", "reset code", "确认", "重置"];
  const CANCEL_LABELS = ["cancel", "close", "取消", "关闭"];

  function getProblemPath(pathname) {
    return pathname
      .replace(/\/(submissions|solutions|editorial|description)(\/.*)?$/, "")
      .replace(/\/$/, "");
  }

  function elementLabel(element) {
    return [
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("data-tooltip"),
      element.getAttribute("data-tooltip-content"),
      element.getAttribute("data-tip"),
      element.textContent
    ].filter(Boolean).join(" ").trim().toLowerCase();
  }

  function isUsableButton(button) {
    if (!button || button.disabled || button.getAttribute("aria-disabled") === "true") return false;
    const rect = button.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findResetButton(documentObject) {
    const iconButtons = Array.from(
      documentObject.querySelectorAll('[data-icon="arrow-rotate-left"]')
    ).map(icon => icon.closest("button"));
    const iconButton = iconButtons.find(isUsableButton);
    if (iconButton) return iconButton;

    const buttons = Array.from(documentObject.querySelectorAll("button"));
    const labelledButton = buttons.find(button => {
      const label = elementLabel(button);
      return isUsableButton(button) && RESET_LABELS.some(resetLabel => label.includes(resetLabel));
    });
    if (labelledButton) return labelledButton;

    const editor = documentObject.querySelector(".monaco-editor");
    if (!editor) return null;

    const editorRect = editor.getBoundingClientRect();
    const toolbarButtons = buttons.filter(button => {
      const rect = button.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      return isUsableButton(button) && button.querySelector("svg") &&
        centerX >= editorRect.left && centerX <= editorRect.right &&
        centerY >= editorRect.top - 100 && centerY <= editorRect.top + 100;
    });

    // In LeetCode's editor toolbar, Reset is immediately before Full Screen.
    return toolbarButtons.length >= 2 ? toolbarButtons.at(-2) : null;
  }

  function getEditorSnapshot(documentObject) {
    const editor = documentObject.querySelector(".monaco-editor");
    if (!editor) return null;
    const lines = editor.querySelector(".view-lines");
    return (lines || editor).textContent || "";
  }

  function findDialog(documentObject) {
    return documentObject.querySelector('[role="dialog"], [aria-modal="true"]');
  }

  function findConfirmButton(dialog) {
    const buttons = Array.from(dialog.querySelectorAll("button")).filter(isUsableButton);
    const labelled = buttons.find(button => {
      const label = elementLabel(button);
      return CONFIRM_LABELS.some(confirmLabel =>
        label === confirmLabel || label.includes(`${confirmLabel} code`)
      );
    });
    if (labelled) return labelled;

    // LeetCode occasionally changes the confirmation copy. In a modal with
    // Cancel and one primary action, the non-cancel action is the safe fallback.
    const actions = buttons.filter(button => {
      const label = elementLabel(button);
      return !CANCEL_LABELS.some(cancelLabel => label === cancelLabel || label.includes(cancelLabel));
    });
    return actions.length === 1 ? actions[0] : null;
  }

  function createController(options) {
    const windowObject = options.windowObject;
    const documentObject = options.documentObject;
    const storage = options.storage || windowObject.sessionStorage;
    const now = options.now || Date.now;
    const wait = options.wait || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
    const setTimer = options.setTimer || setTimeout;
    const clearTimer = options.clearTimer || clearTimeout;
    const logger = options.logger || console;
    const requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
    const attemptTimeoutMs = options.attemptTimeoutMs ?? ATTEMPT_TIMEOUT_MS;
    const retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS;
    const editorStableMs = options.editorStableMs ?? EDITOR_STABLE_MS;
    let runningPromise = null;
    let retryTimer = null;
    let disposed = false;

    function clearRequest() {
      storage.removeItem(STORAGE_KEY);
    }

    function hasRequest() {
      const url = new URL(windowObject.location.href);
      const requested = url.searchParams.get(options.queryParam) === "1" ||
        url.hash === options.resetHash;
      const problemPath = getProblemPath(windowObject.location.pathname);

      if (requested) {
        storage.setItem(STORAGE_KEY, JSON.stringify({
          problemPath,
          expiresAt: now() + requestTimeoutMs
        }));
        url.searchParams.delete(options.queryParam);
        url.hash = "";
        windowObject.history.replaceState(windowObject.history.state, "", url.href);
        return true;
      }

      try {
        const pending = JSON.parse(storage.getItem(STORAGE_KEY) || "null");
        if (pending?.problemPath === problemPath && pending.expiresAt > now()) return true;
        if (pending) clearRequest();
      } catch {
        clearRequest();
      }

      return false;
    }

    async function waitForReadyButton(deadline) {
      let previousSnapshot = null;
      let stableSince = 0;

      while (!disposed && now() < deadline) {
        if (!hasRequest()) return null;
        const button = findResetButton(documentObject);
        const snapshot = getEditorSnapshot(documentObject);
        if (button && snapshot !== null) {
          if (snapshot === previousSnapshot) {
            if (!stableSince) stableSince = now();
            if (now() - stableSince >= editorStableMs) return button;
          } else {
            previousSnapshot = snapshot;
            stableSince = 0;
          }
        } else {
          previousSnapshot = null;
          stableSince = 0;
        }
        await wait(200);
      }

      return null;
    }

    async function confirmResetIfNeeded() {
      const deadline = now() + 5000;
      let sawDialog = false;

      while (!disposed && now() < deadline) {
        const dialog = findDialog(documentObject);
        if (dialog) {
          sawDialog = true;
          const confirmButton = findConfirmButton(dialog);
          if (confirmButton) {
            confirmButton.click();
            return true;
          }
        } else if (sawDialog) {
          return true;
        }

        // Some LeetCode variants reset immediately without a confirmation.
        if (!sawDialog && now() >= deadline - 2000) return true;
        await wait(100);
      }

      return false;
    }

    async function resetEditorToDefault() {
      const deadline = now() + attemptTimeoutMs;
      const resetButton = await waitForReadyButton(deadline);
      if (!resetButton) return false;
      if (!hasRequest()) return false;

      resetButton.click();
      return confirmResetIfNeeded();
    }

    const performReset = options.performReset || resetEditorToDefault;

    function scheduleRetry() {
      if (disposed || retryTimer !== null || !hasRequest()) return;
      retryTimer = setTimer(() => {
        retryTimer = null;
        return start();
      }, retryDelayMs);
    }

    function start() {
      if (disposed || !hasRequest()) return Promise.resolve(false);
      if (runningPromise) return runningPromise;
      if (retryTimer !== null) {
        clearTimer(retryTimer);
        retryTimer = null;
      }

      runningPromise = Promise.resolve()
        .then(() => performReset())
        .then(succeeded => {
          if (succeeded) {
            clearRequest();
            logger.log("LeetRecall: editor reset to the default code definition");
            return true;
          }
          logger.warn("LeetRecall: reset attempt timed out; retrying while the request is active");
          return false;
        })
        .catch(error => {
          logger.warn("LeetRecall: reset attempt failed; retrying", error);
          return false;
        })
        .finally(() => {
          runningPromise = null;
          scheduleRetry();
        });

      return runningPromise;
    }

    function dispose() {
      disposed = true;
      if (retryTimer !== null) clearTimer(retryTimer);
      retryTimer = null;
    }

    return { start, dispose, hasRequest };
  }

  return Object.freeze({
    STORAGE_KEY,
    createController,
    getProblemPath
  });
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = globalThis.LeetRecallReviewReset;
}
