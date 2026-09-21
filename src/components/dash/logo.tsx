export function Logo() {
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden
        className="bg-primary/15 text-primary ring-primary/25 flex size-7 items-center justify-center rounded-md font-mono text-xs font-bold ring-1"
      >
        RR
      </span>
      <span className="text-sm font-semibold tracking-tight">
        RRTrack
        <span className="text-muted-foreground ml-1 font-mono text-[10px]">
          2.0
        </span>
      </span>
    </span>
  );
}
