import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IncomingCallOverlay } from './IncomingCallOverlay';

/**
 * 这一屏是方向反过来的一通电话：拨号的是对方，用户才是接的人。所以它只需要
 * 两个键（接听 / 拒接），而且不该出现静音和免提 —— 麦克风还没开，那两个键按了
 * 不会有任何反应。
 */
function render(overrides: { name?: string; reason?: string } = {}) {
  return renderToStaticMarkup(
    <IncomingCallOverlay
      name={overrides.name ?? '薇加'}
      reason={overrides.reason ?? ''}
      onAccept={() => {}}
      onDecline={() => {}}
    />
  );
}

describe('IncomingCallOverlay', () => {
  it('names the caller and asks the question out loud', () => {
    const html = render();

    expect(html).toContain('薇加');
    expect(html).toContain('想跟你通话');
    expect(html).toContain('来电');
  });

  it('offers exactly two keys: answer and decline', () => {
    const html = render();

    expect(html).toContain('voice-call-accept');
    expect(html).toContain('voice-call-decline');
    expect(html).toContain('接听');
    expect(html).toContain('拒接');
    // 麦克风还没开，免提和静音在这一屏上都是死键。
    expect(html).not.toContain('免提');
    expect(html).not.toContain('静音');
    expect(html).not.toContain('voice-call-end');
  });

  it('shows the reason for calling when there is one', () => {
    expect(render({ reason: '想跟你说件事' })).toContain('想跟你说件事');
  });

  it('does not hold an empty card when no reason came along', () => {
    expect(render()).not.toContain('voice-call-said');
  });

  it('rings, rather than sitting still', () => {
    expect(render()).toContain('phase-incoming');
  });
});
