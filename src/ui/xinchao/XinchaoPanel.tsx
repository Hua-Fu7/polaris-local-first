import { useEffect, useMemo, useState } from 'react';
import {
  readXinchaoSnapshot,
  resetXinchaoState,
  subscribeXinchaoUpdates,
  type XinchaoReplyContext
} from '../../engines/xinchao/runtime';
import {
  isXinchaoInjectionEnabled,
  setXinchaoInjectionEnabled
} from '../../engines/xinchao/injection';
import { Icon } from '../Icon';
import { XinchaoFlower } from './XinchaoFlower';

type XinchaoPanelProps = {
  collaboratorId: string | null;
  collaboratorName: string;
};

function consciousnessLabel(value: string) {
  if (value === 'sleeping') return '睡梦中';
  if (value === 'awake') return '清醒';
  return value || '清醒';
}

function percent(value: number) {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

const DRIVE_VALUE_ORDER = [
  'possess',
  'monitor',
  'crave',
  'libido',
  'share',
  'social',
  'curiosity',
  'duty',
  'reflection',
  'boredom',
  'grieve',
  'anger'
] as const;

const DRIVE_VALUE_LABELS: Record<(typeof DRIVE_VALUE_ORDER)[number], string> = {
  possess: '占有',
  monitor: '惦记',
  crave: '渴求',
  libido: '亲密',
  share: '分享',
  social: '陪伴',
  curiosity: '好奇',
  duty: '责任',
  reflection: '反思',
  boredom: '无聊',
  grieve: '难过',
  anger: '生气'
};

export function XinchaoPanel({ collaboratorId, collaboratorName }: XinchaoPanelProps) {
  const key = collaboratorId || 'default';
  const [snapshot, setSnapshot] = useState<XinchaoReplyContext>(() => readXinchaoSnapshot(key));
  const [injectEnabled, setInjectEnabled] = useState<boolean>(() => isXinchaoInjectionEnabled());

  useEffect(() => {
    const refresh = () => setSnapshot(readXinchaoSnapshot(key));
    refresh();
    return subscribeXinchaoUpdates(key, refresh);
  }, [key]);

  const topDrive = snapshot.drives[0] ?? null;
  const summary = useMemo(() => {
    if (!topDrive) return '心潮正在形成。';
    if (snapshot.consciousness === 'sleeping') return '她睡着了，念头还在慢慢沉降。';
    return `${topDrive.label}最有存在感。`;
  }, [snapshot.consciousness, topDrive]);

  return (
    <div className="xinchao-panel">
      <section className="xinchao-hero-card">
        <span className="xinchao-hero-mark" aria-hidden="true">
          <Icon name="heart" size={34} />
        </span>
        <div className="xinchao-hero-copy">
          <span className="xinchao-kicker">心潮</span>
          <h2>{collaboratorName || '当前协作者'}</h2>
          <p>{summary}</p>
        </div>
        <span className={`xinchao-state-pill is-${snapshot.consciousness}`}>
          {consciousnessLabel(snapshot.consciousness)}
        </span>
      </section>

      <section className="xinchao-grid">
        <div className="xinchao-card xinchao-drive-card">
          <div className="xinchao-card-head">
            <strong>驱动力</strong>
            <span>{snapshot.drives.length} 维 · rev {snapshot.revision}</span>
          </div>
          <XinchaoFlower drives={snapshot.drives} />
          <div className="xinchao-drive-values">
            {DRIVE_VALUE_ORDER.map((driveKey) => {
              const drive = snapshot.drives.find((entry) => entry.key === driveKey);
              const value = drive?.value ?? 0;
              return (
                <div className="xinchao-drive-value" key={driveKey}>
                  <div className="xinchao-drive-value-head">
                    <span>{drive?.label ?? DRIVE_VALUE_LABELS[driveKey]}</span>
                    <strong>{percent(value)}</strong>
                  </div>
                  <div className="xinchao-drive-value-track">
                    <i style={{ width: percent(value), opacity: 0.32 + value * 0.68 }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="xinchao-card">
          <div className="xinchao-card-head">
            <strong>当前意图</strong>
          </div>
          <p className="xinchao-intent">{snapshot.intent?.label || '暂时没有明确意图。'}</p>
          <p className="xinchao-caption">
            {snapshot.intent ? `强度 ${percent(snapshot.intent.value)}` : '等到心潮稳定后会自然出现。'}
          </p>
        </div>

        <div className="xinchao-card xinchao-thought-card">
          <div className="xinchao-card-head">
            <strong>念头池</strong>
            <span>{snapshot.thoughts.length} 条</span>
          </div>
          {snapshot.thoughts.length ? (
            <div className="xinchao-thought-list">
              {snapshot.thoughts.map((thought, index) => (
                <p key={`${thought.key}-${index}`}>
                  <span>{percent(thought.intensity)}</span>
                  {thought.text}
                </p>
              ))}
            </div>
          ) : <p className="xinchao-empty">现在很安静，还没有浮上来的念头。</p>}
        </div>
      </section>

      <div className="xinchao-footer">
        <span>{snapshot.lastInteraction ? `最近互动：${snapshot.lastInteraction}` : '会在对话里慢慢累积状态。'}</span>
        <div className="xinchao-footer-actions">
          <button
            type="button"
            className={`xinchao-inject-toggle${injectEnabled ? ' is-on' : ''}`}
            aria-pressed={injectEnabled}
            onClick={() => {
              const next = !injectEnabled;
              setXinchaoInjectionEnabled(next);
              setInjectEnabled(next);
            }}
          >
            {injectEnabled ? '注入对话：开' : '注入对话：关'}
          </button>
          <button
            type="button"
            className="xinchao-reset"
            onClick={() => {
              resetXinchaoState(key);
              setSnapshot(readXinchaoSnapshot(key));
            }}
          >
            重置
          </button>
        </div>
      </div>
    </div>
  );
}
