import { link } from '../ble/link';
import type { HostOs } from '../protocol/hid';
import { Ctrl } from '../protocol/packets';
import { haptic, hapticMethod, updateSettings, useSettings, type Settings } from '../settings';
import { ActionRow, Row, Section, Segmented, Slider, Switch, Tick } from '../ui';

const times = (v: number) => `${v.toFixed(1)}×`;

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const s = useSettings();
  const connected = link.state === 'connected';

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grabber" />
        <header className="sheet-header">
          <h1>Settings</h1>
          <button className="text-button bold" onClick={onClose}>
            Done
          </button>
        </header>
        <div className="sheet-body">
          <Section
            header="NEXUS"
            footer="To pair a new phone, open Settings → PHONE on NEXUS, tap Connect, and enter the six digits NEXUS shows. If NEXUS is missing from the list later, do the same: a paired phone needs no code."
          >
            <Row label={connected ? link.name || 'NEXUS' : 'Not Connected'}>
              <span className="cell-value">
                {connected ? (link.status?.remoteOn ? 'Connected' : 'Remote off') : ''}
              </span>
            </Row>
            {link.state === 'idle' ? (
              <ActionRow label="Connect" onClick={() => void link.pick()} />
            ) : (
              <ActionRow label="Disconnect" onClick={() => link.disconnect()} />
            )}
            <ActionRow
              label="Identify NEXUS"
              disabled={!connected}
              onClick={() => void link.control(Ctrl.identify).catch(() => undefined)}
            />
            <ActionRow
              label="Forget This Device"
              destructive
              disabled={!link.name}
              onClick={() => void link.forget()}
            />
          </Section>

          <Section header="Appearance">
            <Row label="Theme">
              <Segmented<Settings['theme']>
                label="Theme"
                value={s.theme}
                options={[
                  ['auto', 'Automatic'],
                  ['light', 'Light'],
                  ['dark', 'Dark'],
                ]}
                onChange={(theme) => updateSettings({ theme })}
              />
            </Row>
          </Section>

          <Section header="Pointer">
            <Slider
              label="Tracking Speed"
              value={s.speed}
              min={0.5}
              max={4}
              step={0.1}
              format={times}
              onChange={(speed) => updateSettings({ speed })}
            />
            <Slider
              label="Acceleration"
              value={s.accel}
              min={0}
              max={2}
              step={0.1}
              format={times}
              onChange={(accel) => updateSettings({ accel })}
            />
            <Slider
              label="Scrolling Speed"
              value={s.scroll}
              min={0.2}
              max={3}
              step={0.1}
              format={times}
              onChange={(scroll) => updateSettings({ scroll })}
            />
            <Switch label="Natural Scrolling" checked={s.natural} onChange={(natural) => updateSettings({ natural })} />
            <Switch
              label="Tap to Click"
              checked={s.tapToClick}
              onChange={(tapToClick) => updateSettings({ tapToClick })}
            />
            <Switch
              label="Long Press to Right Click"
              checked={s.longPressRight}
              onChange={(longPressRight) => updateSettings({ longPressRight })}
            />
          </Section>

          <Section
            header="Typing"
            footer="Slow the typing down if a remote desktop or virtual machine drops characters."
          >
            <Row label="Computer">
              <Segmented<HostOs>
                label="Computer"
                value={s.os}
                options={[
                  ['windows', 'Windows'],
                  ['mac', 'macOS'],
                  ['linux', 'Linux'],
                ]}
                onChange={(os) => updateSettings({ os })}
              />
            </Row>
            <Slider
              label="Typing Delay"
              value={s.typeDelay}
              min={2}
              max={50}
              step={1}
              format={(v) => `${v} ms`}
              onChange={(typeDelay) => updateSettings({ typeDelay })}
            />
          </Section>

          <Section
            header="General"
            footer={
              hapticMethod === 'ios-switch'
                ? 'Haptics on iPhone use the system tick, iOS 18 or later, with System Haptics on in Sounds & Haptics. Some browsers block it.'
                : hapticMethod === 'none'
                  ? 'This browser cannot vibrate.'
                  : undefined
            }
          >
            <Switch label="Haptics" checked={s.haptics} onChange={(haptics) => updateSettings({ haptics })} />
            <button className="cell action" onClick={() => haptic(true)}>
              <Tick always />
              Test Haptics
            </button>
            <Switch
              label="Keep Screen Awake"
              checked={s.keepAwake}
              onChange={(keepAwake) => updateSettings({ keepAwake })}
            />
          </Section>
        </div>
      </div>
    </div>
  );
}
