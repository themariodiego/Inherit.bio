/** HTTP adapters may expose a zero-byte POST as an empty stream rather than
 * null. Check EOF, never a caller-controlled Content-Length declaration. */
export async function hasEmptyRequestBody(request: Request): Promise<boolean> {
  if (request.body === null) return true;
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("body_deadline")), 1000);
  });
  try {
    for (;;) {
      const part = await Promise.race([reader.read(), deadline]);
      if (part.done) return true;
      if (part.value.length > 0) return false;
    }
  } catch { return false; }
  finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
