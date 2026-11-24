// Run at most one `run()` at a time. A trigger that arrives while one is running
// (e.g. Send pressed during an upload) makes exactly one more run happen right after,
// and every caller gets the result of the last run.
export function coalesce(run) {
  let current = null;
  let again = false;
  return function trigger() {
    if (current) {
      again = true;
      return current;
    }
    current = (async () => {
      try {
        let result;
        do {
          again = false;
          result = await run();
        } while (again);
        return result;
      } finally {
        current = null;
      }
    })();
    return current;
  };
}
