import { TaskRunner } from '@midscene/core';
import { describe, expect, test } from '@rstest/core';
import { attachLocationReporting } from '../../src/runner/location-reporting';

function recorder(shrink = 1) {
  const events: Record<string, unknown>[] = [];
  const listeners: Array<(serialized: string, dump?: unknown) => void> = [];
  const agent = {
    addDumpUpdateListener(
      listener: (serialized: string, dump?: unknown) => void,
    ) {
      listeners.push(listener);
    },
  };
  attachLocationReporting(agent, shrink, (event) => events.push(event));
  return {
    events,
    update(dump: unknown) {
      for (const listener of listeners) listener('', dump);
    },
  };
}

describe('TaskRunner element reporting', () => {
  test('reads real TaskRunner locate output before tapping, preserving bounds and target metadata', async () => {
    const { events, update } = recorder(2);
    const element = {
      center: [100, 200],
      rect: { left: 60, top: 180, width: 100, height: 60 },
      description: 'Wi-Fi row',
      dpr: 1,
    };
    const param: Record<string, unknown> = { locate: { prompt: 'Wi-Fi' } };
    const runner = new TaskRunner(
      'YAML aiTap',
      async () =>
        ({
          shotSize: { width: 540, height: 1200 },
          shrunkShotToLogicalRatio: 0.5,
        }) as never,
      {
        onSnapshotChange: async (runner) => update(runner.dump()),
      },
    );
    await runner.appendAndFlush([
      {
        type: 'Planning',
        subType: 'Locate',
        param: { prompt: 'Wi-Fi' },
        executor: async () => {
          param.locate = element;
          return {
            output: { element },
            log: {
              dump: {
                taskInfo: {
                  searchArea: { left: 0, top: 0, width: 540, height: 1200 },
                },
              },
            },
          };
        },
      },
      {
        type: 'Action Space',
        subType: 'Tap',
        param,
        executor: async ({ element: actual }) => {
          expect(actual).toEqual(element);
          expect(events.filter((event) => event.event === 'tap')).toEqual([
            { event: 'tap', x: 200, y: 400 },
          ]);
        },
      },
    ]);
    update(runner.dump());
    expect(events.filter((event) => event.event === 'locate')).toHaveLength(2);
    expect(events[0]).toMatchObject({
      event: 'locate',
      source: 'output.element',
      geometry: 'bbox',
      description: 'Wi-Fi row',
      center: [100, 200],
      rect: { x: 120, y: 360, w: 200, h: 120 },
    });
    expect(events[1]).toMatchObject({
      source: 'param.locate',
      geometry: 'bbox',
    });
    expect(events.filter((event) => event.event === 'tap')).toHaveLength(1);
  });

  test('ignores search areas, planning predictions and unrelated query rectangles', () => {
    const { events, update } = recorder();
    const rect = { left: 1, top: 2, width: 900, height: 1000 };
    update({
      id: 'run',
      tasks: [
        {
          type: 'Planning',
          subType: 'Plan',
          status: 'finished',
          output: { element: { rect } },
        },
        {
          type: 'Planning',
          subType: 'Locate',
          status: 'running',
          log: { dump: { taskInfo: { searchArea: rect } } },
        },
        {
          type: 'Insight',
          subType: 'Query',
          status: 'finished',
          output: { rect },
        },
      ],
    });
    expect(events).toEqual([]);
  });

  test('marks point-only results explicitly and never labels their marker as real bounds', () => {
    const { events, update } = recorder(2);
    update({
      id: 'yaml',
      tasks: [
        {
          taskId: 'locate',
          type: 'Planning',
          subType: 'Locate',
          status: 'finished',
          output: {
            element: { center: [540, 2203], description: '脚本', dpr: 1 },
          },
          uiContext: { shrunkShotToLogicalRatio: 1 },
        },
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      geometry: 'point',
      screenshot: null,
      rect: { x: 516, y: 2179, w: 48, h: 48 },
      scale: 1,
    });
  });

  test('reports repeated targets once per task, and only tap actions emit tap ripples', () => {
    const { events, update } = recorder();
    for (const [taskId, subType] of [
      ['1', 'Tap'],
      ['2', 'Tap'],
      ['3', 'Input'],
      ['4', 'Scroll'],
    ]) {
      const dump = {
        id: 'yaml',
        tasks: [
          {
            taskId,
            type: 'Action Space',
            subType,
            status: 'running',
            param: { locate: { center: [20, 30] } },
          },
        ],
      };
      update(dump);
      update(dump);
    }
    expect(events.filter((event) => event.event === 'locate')).toHaveLength(4);
    expect(events.filter((event) => event.event === 'tap')).toHaveLength(2);
  });

  test('chains to a listener the agent already had, on either registration path', () => {
    const box = {
      taskId: 'locate',
      type: 'Planning',
      subType: 'Locate',
      status: 'finished',
      output: { element: { center: [10, 20] } },
    };
    const dump = { id: 'run', tasks: [box] };

    // The path both shipped agents take: their own listener list keeps the old one.
    const ownListeners: Array<(serialized: string, dump?: unknown) => void> =
      [];
    let ownCalls = 0;
    ownListeners.push(() => {
      ownCalls++;
    });
    const modern = {
      addDumpUpdateListener(listener: (s: string, d?: unknown) => void) {
        ownListeners.push(listener);
      },
    };
    const modernEvents: Record<string, unknown>[] = [];
    attachLocationReporting(modern, 1, (event) => modernEvents.push(event));
    for (const listener of ownListeners) listener('', dump);
    expect(ownCalls).toBe(1);
    expect(
      modernEvents.filter((event) => event.event === 'locate'),
    ).toHaveLength(1);

    // The compatibility path for an agent that only exposes the callback.
    let previousCalls = 0;
    const legacy: { onDumpUpdate?: (s: string, d?: unknown) => void } = {
      onDumpUpdate: () => {
        previousCalls++;
      },
    };
    const legacyEvents: Record<string, unknown>[] = [];
    attachLocationReporting(legacy, 1, (event) => legacyEvents.push(event));
    legacy.onDumpUpdate?.('', dump);
    expect(previousCalls).toBe(1);
    expect(
      legacyEvents.filter((event) => event.event === 'locate'),
    ).toHaveLength(1);
  });

  test('ignores failed locates and invalid element coordinates', () => {
    const { events, update } = recorder();
    update({
      id: 'run',
      tasks: [
        {
          type: 'Planning',
          subType: 'Locate',
          status: 'failed',
          output: { element: { center: [10, 20] } },
        },
        {
          type: 'Planning',
          subType: 'Locate',
          status: 'finished',
          output: {
            element: { center: [Number.NaN, Number.POSITIVE_INFINITY] },
          },
        },
      ],
    });
    expect(events).toEqual([]);
  });
});
