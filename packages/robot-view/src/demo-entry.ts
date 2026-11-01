import { registerPibRobotView } from './index.js';
import type { JointStateSample } from './joints/liveState.js';

registerPibRobotView();

interface LiveFixture {
  hz: number;
  samples: JointStateSample[];
}

async function runLiveDemo(): Promise<void> {
  const el = document.querySelector('pib-robot-view');
  if (!el) return;

  el.setAttribute('mode', 'read');

  await new Promise<void>((resolve) => {
    el.addEventListener('ready', () => resolve(), { once: true });
  });

  const res = await fetch('./live-joint.fixture.json');
  if (!res.ok) {
    console.error('live demo: fixture missing', res.status);
    return;
  }
  const fixture = (await res.json()) as LiveFixture;
  const periodMs = Math.round(1000 / (fixture.hz || 20));
  const t0 = performance.now();
  let i = 0;

  const tick = (): void => {
    if (i >= fixture.samples.length) return;
    const sample = fixture.samples[i]!;
    const view = el as HTMLElement & {
      setJointStateSample: (s: JointStateSample) => void;
      setCommandedStates: (m: Record<string, number>) => void;
    };
    view.setJointStateSample({
      names: sample.names,
      positions: sample.positions,
      stampMs: sample.stampMs,
    });
    if (i % 4 === 0) {
      const cmd: Record<string, number> = {};
      for (let j = 0; j < sample.names.length; j++) {
        const motor = sample.names[j]!;
        cmd[motor] = (sample.positions[j] ?? 0) + 0.05;
      }
      view.setCommandedStates(cmd);
    }
    i += 1;
    if (i < fixture.samples.length) {
      const nextAt = t0 + i * periodMs;
      const delay = Math.max(0, nextAt - performance.now());
      setTimeout(tick, delay);
    }
  };

  tick();
}

const demo = new URLSearchParams(globalThis.location.search).get('demo');
if (demo === 'live') {
  void runLiveDemo();
}

async function runCommandDemo(): Promise<void> {
  const el = document.querySelector('pib-robot-view');
  if (!el) return;

  el.setAttribute('mapping-url', './mapping-command-demo.json');

  await new Promise<void>((resolve) => {
    el.addEventListener('ready', () => resolve(), { once: true });
  });

  const limitsRes = await fetch('./command-limits.fixture.json');
  if (!limitsRes.ok) {
    console.error('command demo: limits fixture missing', limitsRes.status);
    return;
  }
  const limits = (await limitsRes.json()) as Record<string, { minDeg: number; maxDeg: number }>;

  const view = el as HTMLElement & {
    setLimits: (m: Record<string, { minDeg: number; maxDeg: number }>) => void;
    approve: () => void;
    stop: () => void;
  };
  view.setLimits(limits);
  el.setAttribute('mode', 'command');

  type DemoPhase = 'idle' | 'drag' | 'approve' | 'post-estop';
  let phase: DemoPhase = 'idle';
  const measured = {
    commandsDuringDrag: 0,
    commandsDuringApprove: 0,
    commandsAfterEstop: 0,
  };

  el.addEventListener('commandrequest', () => {
    if (phase === 'drag') measured.commandsDuringDrag += 1;
    else if (phase === 'approve') measured.commandsDuringApprove += 1;
    else if (phase === 'post-estop') measured.commandsAfterEstop += 1;
  });

  el.addEventListener('estop', () => {
    phase = 'post-estop';
  });

  (globalThis as unknown as {
    __pibCommandDemo?: {
      measured: typeof measured;
      phase: DemoPhase;
      setPhase: (p: DemoPhase) => void;
    };
  }).__pibCommandDemo = {
    measured,
    get phase() {
      return phase;
    },
    setPhase(p: DemoPhase) {
      phase = p;
    },
  };

  console.info(
    '[command demo] ready — effective mode',
    (el as HTMLElement & { effectiveMode?: string }).effectiveMode,
  );
}

if (demo === 'command') {
  void runCommandDemo();
}
