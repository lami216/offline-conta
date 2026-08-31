/** True when a shortcut originated in a control where keystrokes are user data. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.matches("input, textarea, select, [contenteditable]:not([contenteditable='false'])");
}

export function isModifiedEnter(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey">): boolean {
  return event.key === "Enter" && (event.ctrlKey || event.metaKey);
}
