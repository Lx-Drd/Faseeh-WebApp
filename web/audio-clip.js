/** Create a browser Audio element. A bounded clip stops at the media clock's end time. */
export function audioClip(path, start = 0, end = Infinity) {
  if (!path || !Number.isFinite(start) || start < 0 || !(end > start)) return null;
  const audio = new Audio(path);
  if (start) audio.currentTime = start;
  if (!Number.isFinite(end)) return audio;

  let timer;
  function checkEnd() {
    clearTimeout(timer);
    if (audio.currentTime >= end) audio.pause();
    else if (!audio.paused) timer = setTimeout(checkEnd, Math.max(20, (end - audio.currentTime) * 1000));
  }
  audio.addEventListener('playing', checkEnd);
  audio.addEventListener('timeupdate', checkEnd);
  for (const event of ['pause', 'ended', 'error', 'emptied']) {
    audio.addEventListener(event, () => clearTimeout(timer));
  }
  return audio;
}

export function releaseAudio(audio) {
  if (!audio) return;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
}
