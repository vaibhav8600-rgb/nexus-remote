import type { ReactNode } from 'react';
import type { Ctx } from '../App';
import { BackwardIcon, ForwardIcon, MuteIcon, PlayPauseIcon, SunIcon, VolumeDownIcon, VolumeUpIcon } from '../icons';
import { Page } from '../protocol/packets';

// Consumer usages; docs/remote-input-protocol.md in the NEXUS repo.
const USAGE = {
  prev: 0xb6, play: 0xcd, next: 0xb5,
  volDown: 0xea, mute: 0xe2, volUp: 0xe9,
  dim: 0x70, bright: 0x6f,
};

export function Media({ ctx }: { ctx: Ctx }) {
  const key = (usage: number, label: string, icon: ReactNode, big = false) => (
    <button
      className={big ? 'media-button big' : 'media-button'}
      aria-label={label}
      onClick={() => ctx.tapKey(Page.consumer, usage)}
    >
      {icon}
    </button>
  );

  return (
    <div className="media">
      <div className="media-card transport">
        {key(USAGE.prev, 'Previous track', <BackwardIcon />)}
        {key(USAGE.play, 'Play or pause', <PlayPauseIcon />, true)}
        {key(USAGE.next, 'Next track', <ForwardIcon />)}
      </div>
      <div className="media-card">
        <span className="media-caption">Volume</span>
        <div className="media-row">
          {key(USAGE.volDown, 'Volume down', <VolumeDownIcon />)}
          {key(USAGE.mute, 'Mute', <MuteIcon />)}
          {key(USAGE.volUp, 'Volume up', <VolumeUpIcon />)}
        </div>
      </div>
      <div className="media-card">
        <span className="media-caption">Brightness</span>
        <div className="media-row">
          {key(USAGE.dim, 'Brightness down', <SunIcon />)}
          {key(USAGE.bright, 'Brightness up', <SunIcon big />)}
        </div>
      </div>
    </div>
  );
}
