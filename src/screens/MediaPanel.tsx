import type { ReactNode } from 'react';
import type { Ctx } from '../App';
import { ChevronLeft, ChevronRight, CloseIcon, MuteIcon, PlayPauseIcon, StopIcon } from '../icons';
import { Page } from '../protocol/packets';
import { Tick } from '../ui';

// Consumer usages, from the NEXUS protocol page.
const U = { play: 0xcd, next: 0xb5, prev: 0xb6, stop: 0xb7, volUp: 0xe9, volDown: 0xea, mute: 0xe2 };

/** A click wheel: volume up and down, previous and next, play in the middle. */
export function MediaPanel({ ctx, onClose }: { ctx: Ctx; onClose: () => void }) {
  const tap = (usage: number) => () => ctx.tapKey(Page.consumer, usage);
  const side = (label: string, icon: ReactNode, onClick: () => void) => (
    <button className="round" aria-label={label} onClick={onClick}>
      <Tick />
      {icon}
    </button>
  );

  return (
    <div className="media-panel">
      <div className="wheel">
        <button className="wheel-zone top" aria-label="Volume up" onClick={tap(U.volUp)}>
          <Tick />
          +
        </button>
        <button className="wheel-zone bottom" aria-label="Volume down" onClick={tap(U.volDown)}>
          <Tick />
          −
        </button>
        <button className="wheel-zone left" aria-label="Previous track" onClick={tap(U.prev)}>
          <Tick />
          <ChevronLeft />
        </button>
        <button className="wheel-zone right" aria-label="Next track" onClick={tap(U.next)}>
          <Tick />
          <ChevronRight />
        </button>
        <button className="wheel-center" aria-label="Play or pause" onClick={tap(U.play)}>
          <Tick />
          <PlayPauseIcon />
        </button>
      </div>
      <div className="side-buttons">
        {side('Mute', <MuteIcon />, tap(U.mute))}
        {side('Stop', <StopIcon />, tap(U.stop))}
        {side('Close', <CloseIcon />, onClose)}
      </div>
    </div>
  );
}
