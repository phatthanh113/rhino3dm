type IconName =
  | "cube"
  | "search"
  | "upload"
  | "plus"
  | "layers"
  | "scissors"
  | "check"
  | "eye"
  | "target"
  | "file"
  | "folder"
  | "more"
  | "x"
  | "cursor"
  | "hand"
  | "ruler"
  | "camera"
  | "bell"
  | "chevron"
  | "info"
  | "flip";

export function Icon({
  name,
  className = "icon",
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}

/** Inline sprite: one copy per page, referenced by every Icon. */
export function IconSprite() {
  return (
    <svg className="sprite" aria-hidden="true">
      <symbol id="i-cube" viewBox="0 0 24 24">
        <path d="M12 3 20 7.5v9L12 21 4 16.5v-9L12 3Z" />
        <path d="M4 7.5 12 12l8-4.5" />
        <path d="M12 12v9" />
      </symbol>
      <symbol id="i-search" viewBox="0 0 24 24">
        <circle cx="11" cy="11" r="6" />
        <path d="m20 20-4.5-4.5" />
      </symbol>
      <symbol id="i-upload" viewBox="0 0 24 24">
        <path d="M12 16V5m0 0-4 4m4-4 4 4" />
        <path d="M5 19h14" />
      </symbol>
      <symbol id="i-plus" viewBox="0 0 24 24">
        <path d="M12 6v12M6 12h12" />
      </symbol>
      <symbol id="i-layers" viewBox="0 0 24 24">
        <path d="M12 4 4 8l8 4 8-4-8-4Z" />
        <path d="m4 12 8 4 8-4" />
        <path d="m4 16 8 4 8-4" />
      </symbol>
      <symbol id="i-scissors" viewBox="0 0 24 24">
        <circle cx="6" cy="7" r="2.2" />
        <circle cx="6" cy="17" r="2.2" />
        <path d="M8 8.4 20 17M8 15.6 20 7" />
      </symbol>
      <symbol id="i-check" viewBox="0 0 24 24">
        <path d="m5 13 4 4L19 7" />
      </symbol>
      <symbol id="i-eye" viewBox="0 0 24 24">
        <path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12Z" />
        <circle cx="12" cy="12" r="2.6" />
      </symbol>
      <symbol id="i-target" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="7" />
        <circle cx="12" cy="12" r="2.2" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      </symbol>
      <symbol id="i-file" viewBox="0 0 24 24">
        <path d="M7 3h7l4 4v14H7Z" />
        <path d="M14 3v4h4" />
      </symbol>
      <symbol id="i-folder" viewBox="0 0 24 24">
        <path d="M3 6h6l2 2h10v10H3Z" />
      </symbol>
      <symbol id="i-more" viewBox="0 0 24 24">
        <circle cx="6" cy="12" r="1.1" fill="currentColor" />
        <circle cx="12" cy="12" r="1.1" fill="currentColor" />
        <circle cx="18" cy="12" r="1.1" fill="currentColor" />
      </symbol>
      <symbol id="i-x" viewBox="0 0 24 24">
        <path d="m6 6 12 12M18 6 6 18" />
      </symbol>
      <symbol id="i-cursor" viewBox="0 0 24 24">
        <path d="m5 3 14 7-6.2 1.6L10 19 5 3Z" />
      </symbol>
      <symbol id="i-hand" viewBox="0 0 24 24">
        <path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11" />
        <path d="M11 11V5.5a1.5 1.5 0 0 1 3 0V11" />
        <path d="M14 11V6.5a1.5 1.5 0 0 1 3 0V12" />
        <path d="M17 12v-1a1.5 1.5 0 0 1 3 0v4.5a5.5 5.5 0 0 1-5.5 5.5h-2a5 5 0 0 1-3.9-1.9L5 15.2a1.6 1.6 0 0 1 2.4-2.1L9 15" />
      </symbol>
      <symbol id="i-ruler" viewBox="0 0 24 24">
        <path d="M3 9.5h18v5H3Z" />
        <path d="M7 9.5v2.4M11 9.5v2.4M15 9.5v2.4M19 9.5v2.4" />
      </symbol>
      <symbol id="i-camera" viewBox="0 0 24 24">
        <path d="M3 8h4l1.6-2h6.8L17 8h4v11H3Z" />
        <circle cx="12" cy="13" r="3.2" />
      </symbol>
      <symbol id="i-bell" viewBox="0 0 24 24">
        <path d="M6 16v-5a6 6 0 1 1 12 0v5l2 2H4l2-2Z" />
        <path d="M10 20h4" />
      </symbol>
      <symbol id="i-chevron" viewBox="0 0 24 24">
        <path d="m7 10 5 5 5-5" />
      </symbol>
      <symbol id="i-info" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 11v5" />
        <path d="M12 8h.01" />
      </symbol>
      <symbol id="i-flip" viewBox="0 0 24 24">
        <path d="M4 8h13l-3-3" />
        <path d="M20 16H7l3 3" />
      </symbol>
    </svg>
  );
}
