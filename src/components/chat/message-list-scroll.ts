let scrolling = false;

export function setMessageListScrolling(next: boolean) {
  scrolling = next;
}

export function isMessageListScrolling() {
  return scrolling;
}
