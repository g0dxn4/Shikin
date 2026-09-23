let browserOperationQueue: Promise<unknown> = Promise.resolve()

/** Serialize same-client hosted-browser operations that pass through the data-server gate. */
export function enqueueBrowserOperation<T>(operation: () => Promise<T>): Promise<T> {
  const run = browserOperationQueue.then(operation, operation)
  browserOperationQueue = run.catch(() => {})
  return run
}
