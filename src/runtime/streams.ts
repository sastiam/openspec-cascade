/**
 * Byte-stream helpers shared by engines that consume line-delimited subprocess output.
 */

/**
 * Invokes `onLine` for every newline-delimited line of `stream`, including a trailing partial line.
 */
export async function forEachStreamLine(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach(onLine);
  }
  buffer += decoder.decode();
  if (buffer) {
    onLine(buffer);
  }
}
